import { AppSettings } from '@lib/constants/GlobalValues'
import i18n from '@lib/i18n'
import { buildThinkRules } from '@lib/markdown/ThinkTags'
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
    let total_length = systemPromptLength + summaryLength
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
    for (const message of messages.reverse()) {
        if (hasSummary && turnCount >= MAX_TURNS_WITH_SUMMARY) break

        const swipe_data = message.swipes[message.swipe_id]
        const { attachments, hasImageNew } = getValidAttachments(
            message,
            completionFeats,
            hasImage
        )

        const len = message.id !== -1 ? await chatTokenizer(message, index) : 0

        if (total_length + len > maxLength && !bypassContextLength) break
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

    if (apiConfig.features.useFirstMessage && apiValues.firstMessage)
        messageBuffer.push({
            role: completionFeats.userRole,
            [completionFeats.contentName]: apiValues.firstMessage,
        })

    const output = [...payload, ...messageBuffer.reverse()]
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
