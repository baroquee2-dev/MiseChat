import { AppSettings } from '@lib/constants/GlobalValues'
import i18n from '@lib/i18n'
import { buildThinkRules } from '@lib/markdown/ThinkTags'
import { RetrievedMessage } from '@lib/retrieval/KeywordSearch'
import { CharacterCardData, CharacterTokenCache } from '@lib/state/Characters'
import { ChatEntry } from '@lib/state/Chat'
import { defaultSystemPromptFormat, InstructTokenCache, InstructType } from '@lib/state/Instructs'
import { Logger } from '@lib/state/Logger'
import { replaceMacros } from '@lib/state/Macros'
import { mmkv } from '@lib/storage/MMKV'
import { formatKeyFactsForContext } from '@lib/summary/KeyFactsFormat'
import { readBase64Async } from '@lib/utils/File'
import { Macro } from '@lib/utils/Macros'
import { ChatKeyFactType } from 'db/schema'

import { APIConfiguration, APIValues } from './APIBuilder.types'

export type MessageLoader = {
    retrieve: (limit: number, offset: number) => Promise<ChatEntry[]>
    initialLimit: number
    initialOffset: number
}

export type TokenCache = {
    userCache: CharacterTokenCache
    characterCache: CharacterTokenCache
    instructCache: InstructTokenCache
}

export interface ContextBuilderParams {
    apiConfig: APIConfiguration
    apiValues: APIValues
    messages: ChatEntry[]
    character: CharacterCardData
    instruct: InstructType
    user: CharacterCardData
    tokenizer: (data: string, media_paths?: string[]) => Promise<number> | number
    chatTokenizer: (entry: ChatEntry, index: number) => Promise<number>
    maxLength: number
    cache: TokenCache
    summary?: string
    authorNote?: string
    retrieved?: RetrievedMessage[]
    keyFacts?: ChatKeyFactType[]
    bypassContextLength?: boolean
    messageLoader?: MessageLoader
}

type ContentTypes =
    | { type: 'input_text' | 'text'; text: string }
    | { type: 'image_url'; image_url: { url: string } }
    | { type: 'input_audio'; input_audio: { data: string; format: string } }

export type Message = { role: string; [x: string]: ContentTypes[] | string }

export const buildContext = async (params: ContextBuilderParams) => {
    return await buildChatCompletionContext(params)
}

/**
 * TODO:
 * Context Builder is not a pure function:
 * - Macros rely on macro state
 */

export const buildChatCompletionContext = async ({
    apiConfig,
    apiValues,
    messages,
    character,
    user,
    cache,
    summary,
    authorNote,
    retrieved,
    keyFacts,
    instruct,
    tokenizer,
    chatTokenizer,
    maxLength,
    bypassContextLength,
    messageLoader,
}: ContextBuilderParams) => {
    const delta = performance.now()

    if (apiConfig.request.completionType.type !== 'chatCompletions') return
    const completionFeats = apiConfig.request.completionType
    const { characterCache, userCache, instructCache } = cache
    const { systemPrompt, systemPromptLength } = getSystemPrompt({
        instruct,
        user,
        character,
        userCache,
        characterCache,
        instructCache,
    })

    const summaryContext = formatSummaryContext(summary) + formatKeyFactsForContext(keyFacts)
    const summaryLength = summaryContext ? await tokenizer(summaryContext) : 0
    const initial = systemPrompt + summaryContext

    /**
     * Charged before the history is gathered, exactly as the summary is. The loop
     * below fills the context to the brim, so anything billed afterwards never
     * fits — and it would be the long chats, the only ones retrieval helps, that
     * silently lost it. Overlapping entries are dropped after the loop, which can
     * only make the real cost smaller than what was set aside here.
     *
     * Capped at a slice of what is left, and dropped outright when it will not fit
     * in that slice. Recall is an extra; the conversation itself must never be the
     * thing that gets squeezed out to make room for it.
     */
    const retrievedEstimate = retrieved?.length
        ? await tokenizer(formatRetrievedContext(retrieved))
        : 0
    const headroom = Math.max(0, maxLength - systemPromptLength - summaryLength)
    const retrievedFits =
        retrievedEstimate > 0 &&
        (bypassContextLength || retrievedEstimate <= headroom * RETRIEVED_BUDGET_SHARE)
    if (retrievedEstimate > 0 && !retrievedFits) {
        Logger.warn('Dropped recalled history, too little context left for it')
    }
    const retrievedReserve = retrievedFits ? retrievedEstimate : 0
    let total_length = systemPromptLength + summaryLength + retrievedReserve
    let first_message_reached = false

    const payload: Message[] = [
        {
            role: completionFeats.systemRole,
            [completionFeats.contentName]: replaceMacrosInternal(initial, instruct),
        },
    ]
    let hasImage = false
    const messageBuffer: Message[] = []
    let index = messages.length - 1
    const hasSummary = !!summary?.trim()
    let turnCount = 0
    /** How far back the raw history reaches, which is what retrieval must not duplicate. */
    let oldestIncludedOrder = Infinity
    for (const message of messages.reverse()) {
        if (hasSummary && turnCount >= MAX_TURNS_WITH_SUMMARY) break

        const swipe_data = message.swipes[message.swipe_id]
        const { attachments, hasImageNew } = getValidAttachments(
            message,
            completionFeats,
            hasImage
        )

        const len = message.id !== -1 ? await chatTokenizer(message, index) : 0

        // One message always goes in: every provider rejects a request with no contents,
        // and a request that is too long fails more usefully than one that is empty.
        if (total_length + len > maxLength && !bypassContextLength && messageBuffer.length > 0)
            break
        hasImage = hasImageNew

        const prefill = index === messages.length - 1 ? apiValues.prefill : ''

        if (!swipe_data.swipe && !prefill && index === messages.length - 1) {
            index--
            continue
        }
        const role = message.is_user ? completionFeats.userRole : completionFeats.assistantRole

        if (message.attachments.length > 0) {
            Logger.warn('Image output is incomplete')

            const images: ContentTypes[] = await Promise.all(
                attachments.map(async (item) => {
                    const base64data = await readBase64Async(item.uri)
                    if (item.type === 'image')
                        return {
                            type: 'image_url',
                            image_url: {
                                url: 'data:' + item.mime_type + ';base64,' + base64data,
                            },
                        }
                    return {
                        type: 'input_audio',
                        input_audio: {
                            data: base64data,
                            format: item.mime_type.split('/')[1],
                        },
                    }
                })
            )

            messageBuffer.push({
                role: role,
                [completionFeats.contentName]: [
                    {
                        type: 'text',
                        text: replaceMacrosInternal(prefill + swipe_data.swipe, instruct),
                    },
                    ...images,
                ],
            })
        } else {
            messageBuffer.push({
                role: role,
                [completionFeats.contentName]: replaceMacrosInternal(
                    prefill + swipe_data.swipe,
                    instruct
                ),
            })
        }
        first_message_reached = index === 0
        if (message.order < oldestIncludedOrder) oldestIncludedOrder = message.order
        total_length += len
        if (message.is_user) turnCount++
        index--
    }

    if (index >= messages.length - 1 && messages.length !== 0) {
        warnNoMessages()
    }

    const examples = character?.mes_example
    if (
        first_message_reached &&
        examples &&
        total_length + characterCache.examples_length < maxLength
    ) {
        payload[0][completionFeats.contentName] += replaceMacrosInternal(examples, instruct)
        total_length += characterCache.examples_length
    }

    /**
     * Only now is it known how far back the raw history reached, so only now can
     * the messages that are already in the context be dropped from the recalled
     * set. Pulling one of those back would spend tokens to repeat a message and
     * label it as old when it is not.
     */
    const recalled = retrievedFits
        ? (retrieved?.filter((item) => item.order < oldestIncludedOrder) ?? [])
        : []
    // One line whenever recall is on, so a quiet turn still proves it ran
    if (retrieved) {
        Logger.info(`Keyword recall: added ${recalled.length} of ${retrieved.length} matches`)
    }
    const retrievedContext = formatRetrievedContext(recalled)

    if (apiConfig.features.useFirstMessage && apiValues.firstMessage)
        messageBuffer.push({
            role: completionFeats.userRole,
            [completionFeats.contentName]: apiValues.firstMessage,
        })

    const output = [...payload, ...messageBuffer.reverse()]

    // Before the author's note, so the user's own steering stays closest to the model.
    if (retrievedContext) {
        const insertAt = Math.max(1, output.length - RETRIEVED_DEPTH)
        output.splice(insertAt, 0, {
            role: completionFeats.systemRole,
            [completionFeats.contentName]: replaceMacrosInternal(retrievedContext, instruct),
        })
    }

    if (authorNote?.trim()) {
        // Never before the system prompt, and never past the start of the history.
        const insertAt = Math.max(1, output.length - AUTHOR_NOTE_DEPTH)
        output.splice(insertAt, 0, {
            role: completionFeats.systemRole,
            [completionFeats.contentName]: replaceMacrosInternal(
                `[Author's note: ${authorNote.trim()}]`,
                instruct
            ),
        })
    }
    Logger.info(`Approximate Context Size: ${total_length} tokens`)
    Logger.info(`${(performance.now() - delta).toFixed(2)}ms taken to build context`)
    if (mmkv.getBoolean(AppSettings.PrintContext)) {
        Logger.info(
            JSON.stringify(
                output.map((item) => {
                    const content = item[completionFeats.contentName]
                    if (typeof content === 'string') return content
                    if (Array.isArray(content))
                        return content.filter((part) => part.type === 'text')
                    return content
                })
            )
        )
    }

    return output
}

const thinkRule = buildThinkRules()

/** Once a summary exists, raw history is hard-capped to this many recent turns. */
const MAX_TURNS_WITH_SUMMARY = 20

/**
 * How many messages from the end the author's note sits. Attention favours the end
 * of the prompt, so steering placed here keeps working in a long chat, while still
 * leaving the latest turns closest to the model.
 */
const AUTHOR_NOTE_DEPTH = 3

/**
 * Recalled history sits just behind the author's note, for the same reason it is
 * placed near the end at all: attention favours what comes last, and detail
 * dropped at the top of a long prompt tends to be read past.
 *
 * Keeping it out of the opening system turn also matters for cost. Providers cache
 * on the longest shared prefix, and this block is recomputed from whatever the user
 * just typed, so at the top it would invalidate the cache for the entire prompt
 * every single turn. Here it only costs the last few messages.
 */
const RETRIEVED_DEPTH = 5

/**
 * The most of the remaining context recall may claim before it is dropped instead.
 * Four snippets run to roughly 900 tokens at worst, which clears this bar on a
 * default context even behind a fat character card, while still leaving the
 * conversation three quarters of the room.
 */
const RETRIEVED_BUDGET_SHARE = 0.25

/**
 * Old messages pulled back by keyword retrieval. They sit among the recent turns,
 * so the fence and the opening line are what stop the model reading them as things
 * that just happened and replying to them.
 */
const formatRetrievedContext = (retrieved?: RetrievedMessage[]) => {
    if (!retrieved?.length) return ''
    const lines = retrieved.map((item) => `${item.name}: ${item.text}`).join('\n')
    return `\n\n<recalled_history>\n${i18n.t('chat.retrievedContextIntro')}\n${lines}\n</recalled_history>`
}

const formatSummaryContext = (summary?: string) => {
    if (!summary?.trim()) return ''
    return `\n\n<chat_summary>\n${i18n.t('chat.summaryContextIntro')}\n${summary.trim()}\n</chat_summary>`
}

const getMacroRules = (instruct: InstructType) => {
    if (instruct.hide_think_tags) {
        return thinkRule
    }
    return []
}

const replaceMacrosInternal = (data: string, instruct: InstructType) => {
    return replaceMacros(data, { extraMacros: getMacroRules(instruct) })
}

const getValidAttachments = (
    entry: ChatEntry,
    config: {
        type: 'chatCompletions'
        userRole: string
        systemRole: string
        assistantRole: string
        contentName: string
        supportsAudio?: boolean
        supportsImages?: boolean
    },
    hasImage: boolean
) => {
    let hasImageNew = hasImage
    const audioAttachments = entry.attachments.filter(
        (item) => item.type === 'audio' && config.supportsAudio
    )

    let imageAttachments: typeof entry.attachments = []
    if (config.supportsImages) {
        const images = entry.attachments.filter((item) => item.type === 'image')
        if (images.length > 0 && !hasImageNew) {
            hasImageNew = true
            imageAttachments = [images[0]]
        }
    }
    const attachments = [...audioAttachments, ...imageAttachments]
    return { hasImageNew, attachments }
}

export const getSystemPrompt = ({
    instruct,
    user,
    character,
    userCache,
    characterCache,
    instructCache,
}: {
    instruct: InstructType
    user?: CharacterCardData
    character?: CharacterCardData
    userCache: CharacterTokenCache
    characterCache: CharacterTokenCache
    instructCache: InstructTokenCache
}) => {
    let systemPrompt = instruct.system_prompt_format
    if (systemPrompt === undefined) {
        Logger.warn('System Prompt Format is undefined, falling back to default')
        systemPrompt = defaultSystemPromptFormat
    }
    if (systemPrompt === '') {
        Logger.warn('System Prompt Format is blank')
    }

    let systemPromptLength = 0
    const macros = [
        {
            macro: '{{system_prompt}}',
            value: instruct.system_prompt ?? '',
            length: instructCache.system_prompt_length,
        },
        {
            macro: '{{character_desc}}',
            value: character?.description ?? '',
            length: characterCache.description_length,
        },
        {
            macro: '{{user_desc}}',
            value: user?.description ?? '',
            length: userCache.description_length,
        },
        {
            macro: '{{personality}}',
            value: character?.personality ?? '',
            length: characterCache.personality_length,
        },
        {
            macro: '{{scenario}}',
            value: character?.scenario ?? '',
            length: characterCache.scenario_length,
        },
    ]
    macros.forEach((m) => {
        systemPrompt = systemPrompt.replaceAll(m.macro, m.value)
        systemPromptLength += m.length
    })
    return { systemPrompt, systemPromptLength }
}

const warnNoMessages = () => {
    Logger.warnToast(i18n.t('toast.noMessagesAdded'))
    Logger.warn(
        'No messages were added to the context. This can be caused by:\n- Generated Length is too high, lower it in AI Instructions\n- Your context length is too low\n- Your first message is too long'
    )
}
