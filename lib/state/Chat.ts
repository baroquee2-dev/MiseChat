import { and, count, desc, eq, getTableColumns, inArray, like, sql } from 'drizzle-orm'
import { randomUUID } from 'expo-crypto'
import mime from 'mime/lite'
import { create } from 'zustand'
import { useShallow } from 'zustand/react/shallow'

import { db as database } from '@db'
import { Tokenizer } from '@lib/engine/Tokenizer'
import { getContextLimit } from '@lib/hooks/ContextLimit'
import i18n from '@lib/i18n'
import { replaceMacros } from '@lib/state/Macros'
import { scheduleChatSummaryUpdate } from '@lib/summary/ChatSummary'
import { KeyFactOp, MAX_KEY_FACTS_PER_CHAT, scheduleKeyFactsUpdate } from '@lib/summary/KeyFacts'
import { AppDirectory, copyFile, deleteFile, fileInfo } from '@lib/utils/File'
import { convertToFormatInstruct } from '@lib/utils/TextFormat'
import {
    chatAttachments,
    ChatAttachmentType,
    chatEntries,
    ChatEntryType,
    chatKeyFacts,
    ChatKeyFactType,
    chats,
    ChatSwipe,
    chatSwipes,
    ChatType,
} from 'db/schema'

import { Characters } from './Characters'
import { Logger } from './Logger'
import { AppSettings } from '../constants/GlobalValues'
import { mmkv } from '../storage/MMKV'

export interface ChatSwipeState extends ChatSwipe {
    token_count?: number
    attachment_count?: number
    regen_cache?: string
}

export interface ChatEntry extends ChatEntryType {
    swipes: ChatSwipeState[]
    attachments: ChatAttachmentType[]
}

export interface ChatData extends ChatType {
    messages: ChatEntry[]
    keyFacts: ChatKeyFactType[]
    autoScroll?: { cause: 'search' | 'saveScroll'; index: number }
}

/** Trigger a summary once accumulated tokens since the last one reach this. */
const SUMMARY_EVERY_N_TOKENS = 4000
/** ...or once they reach this fraction of the current context window, whichever comes first. */
const SUMMARY_CONTEXT_RATIO = 0.6

/** Indexes (from the end) of messages belonging to the current, not-yet-summarized turn. */
const getCurrentTurnIndexes = (messages: ChatEntry[]): number[] => {
    const indexes: number[] = []
    for (let i = messages.length - 1; i >= 0; i--) {
        // Stop when we reach the previous assistant message (not the current last one)
        if (!messages[i].is_user && i !== messages.length - 1) break
        indexes.push(i)
    }
    return indexes
}

interface ChatSearchQueryResult {
    swipeId: number
    chatId: number
    chatEntryId: number
    chatName: string
    swipe: string
    sendDate: number
}

interface ChatSearchResult extends Omit<ChatSearchQueryResult, 'sendDate'> {
    sendDate: Date
}

export interface ChatState {
    data: ChatData | undefined
    buffer: OutputBuffer
    // chat data
    load: (
        chatId: number,
        overrideScrollOffset?: { value: number; type: 'entryId' | 'index' }
    ) => Promise<void>
    delete: (chatId: number) => Promise<void>
    reset: () => void

    // chat entry data
    addEntry: (
        name: string,
        is_user: boolean,
        message: string,
        attachments?: string[]
    ) => Promise<number | void>
    updateEntry: (
        index: number,
        message: string,
        options?: {
            updateFinished?: boolean
            updateStarted?: boolean
            verifySwipeId?: number
        }
    ) => Promise<void>
    deleteEntry: (index: number) => Promise<void>
    renameChat: (chatId: number, name: string) => void
    setAutoSummary: (enabled: boolean) => Promise<void>
    setChatSummary: (chatId: number, summary: string) => Promise<void>
    refreshKeyFacts: (chatId: number) => Promise<void>
    // swipe data
    swipe: (index: number, direction: number) => Promise<boolean>
    addSwipe: (index: number, message?: string) => Promise<number | void>

    // buffer data
    setBuffer: (data: OutputBuffer) => void
    insertBuffer: (data: string) => void
    updateFromBuffer: (cachedSwipeId?: number) => Promise<void>
    insertLastToBuffer: () => void

    // regen data
    setRegenCache: () => void
    getRegenCache: () => string
    resetRegenCache: () => void

    // attachments
    // add attachment
    removeAttachment: (entryId: number, attachmentId: number) => Promise<void>

    // generation system
    getTokenCount: (
        index: number,
        options?: { addAttachments: boolean; lastImageOnly: boolean }
    ) => Promise<number>
    stopGenerating: () => void
    startGenerating: (swipeId: number) => void
}

type InferenceStateType = {
    abortFunction: () => void | Promise<void>
    nowGenerating: boolean
    generationAborted: boolean
    generationFailed: boolean
    currentSwipeId?: number
    startGenerating: (swipeId: number) => void
    stopGenerating: () => void
    markGenerationFailed: () => void
    setAbort: (fn: () => void | Promise<void>) => void
}

type OutputBuffer = {
    data: string
    error?: string
}

type ChatSwipeUpdated = Pick<ChatSwipe, 'swipe' | 'id'> & Partial<Omit<ChatSwipe, 'swipe' | 'id'>>
export const useInference = create<InferenceStateType>((set, get) => ({
    abortFunction: async () => {
        set({ generationAborted: true })
        get().stopGenerating()
    },
    nowGenerating: false,
    generationAborted: false,
    generationFailed: false,
    currentSwipeId: undefined,
    startGenerating: (swipeId: number) =>
        set({
            currentSwipeId: swipeId,
            nowGenerating: true,
            generationAborted: false,
            generationFailed: false,
        }),
    stopGenerating: () => {
        set({ nowGenerating: false, currentSwipeId: undefined })
    },
    markGenerationFailed: () => set({ generationFailed: true }),
    setAbort: (fn) => {
        set({
            abortFunction: async () => {
                set({ generationAborted: true })
                await fn()
            },
        })
    },
}))

export namespace Chats {
    export const useChatState = create<ChatState>((set, get: () => ChatState) => ({
        data: undefined,
        buffer: { data: '' },
        startGenerating: (swipeId: number) => {
            useInference.getState().startGenerating(swipeId)
        },
        // TODO : Replace this function
        stopGenerating: async () => {
            const inferenceState = useInference.getState()
            const cachedSwipeId = inferenceState.currentSwipeId
            const wasAborted = inferenceState.generationAborted
            const wasFailed = inferenceState.generationFailed
            Logger.info(`Saving Chat`)
            await get().updateFromBuffer(cachedSwipeId)
            const chat = get().data
            const output = get().buffer.data
            const autoSummary = !!mmkv.getBoolean(AppSettings.AutoSummary)
            const autoKeyFacts = !!mmkv.getBoolean(AppSettings.AutoExtractKeyFacts)
            const shouldTrackMemory =
                (autoSummary || autoKeyFacts) &&
                !!output.trim() &&
                !wasAborted &&
                !wasFailed &&
                !!chat?.id

            const memoryChatId = chat?.id
            const previousSummary = chat?.summary ?? ''
            const previousKeyFacts = chat?.keyFacts ? [...chat.keyFacts] : []
            const messagesSnapshot = chat?.messages ? [...chat.messages] : []

            useInference.getState().stopGenerating()
            get().setBuffer({ data: '' })

            if (!shouldTrackMemory || !memoryChatId) return

            let turnTokenCount = 0
            for (const index of getCurrentTurnIndexes(messagesSnapshot)) {
                turnTokenCount += await get().getTokenCount(index)
            }

            const nextTurnCount = (chat?.summary_turn_count ?? 0) + 1
            const nextTokenCount = (chat?.summary_token_count ?? 0) + turnTokenCount
            const contextTriggerLimit = Math.floor(getContextLimit() * SUMMARY_CONTEXT_RATIO)
            const shouldTriggerSummary =
                nextTokenCount >= SUMMARY_EVERY_N_TOKENS ||
                (contextTriggerLimit > 0 && nextTokenCount >= contextTriggerLimit)

            if (!shouldTriggerSummary) {
                Logger.info(
                    `Summary token count for chat ${memoryChatId}: ${nextTokenCount}/${SUMMARY_EVERY_N_TOKENS} (${SUMMARY_CONTEXT_RATIO * 100}% context: ${nextTokenCount}/${contextTriggerLimit})`
                )
                await db.mutate.setSummaryTurnCount(memoryChatId, nextTurnCount)
                await db.mutate.setSummaryTokenCount(memoryChatId, nextTokenCount)
                set((state) => {
                    if (!state.data || state.data.id !== memoryChatId) return state
                    return {
                        data: {
                            ...state.data,
                            summary_turn_count: nextTurnCount,
                            summary_token_count: nextTokenCount,
                        },
                    }
                })
                return
            }

            const triggerReasons: string[] = []
            if (nextTokenCount >= SUMMARY_EVERY_N_TOKENS) triggerReasons.push('token count')
            if (contextTriggerLimit > 0 && nextTokenCount >= contextTriggerLimit)
                triggerReasons.push(`${SUMMARY_CONTEXT_RATIO * 100}% of context window`)
            Logger.info(
                `Memory update triggered for chat ${memoryChatId}: ${triggerReasons.join(' + ')} (tokens: ${nextTokenCount}/${SUMMARY_EVERY_N_TOKENS}, ${SUMMARY_CONTEXT_RATIO * 100}% context: ${nextTokenCount}/${contextTriggerLimit})`
            )

            // Both jobs read this window, so the counters reset here rather than in
            // either job's persist step. A failed run waits for the next threshold
            // instead of retrying against a possibly broken provider every turn.
            await db.mutate.setSummaryTurnCount(memoryChatId, 0)
            await db.mutate.setSummaryTokenCount(memoryChatId, 0)
            set((state) => {
                if (!state.data || state.data.id !== memoryChatId) return state
                return {
                    data: { ...state.data, summary_turn_count: 0, summary_token_count: 0 },
                }
            })

            if (autoSummary)
                scheduleChatSummaryUpdate({
                    chatId: memoryChatId,
                    previousSummary: previousSummary,
                    messages: messagesSnapshot,
                    turnCount: nextTurnCount,
                    persist: async (chatId, summary, updatedAt) => {
                        await db.mutate.updateChatSummary(chatId, summary, updatedAt)
                    },
                    onApplied: (chatId, summary, updatedAt) => {
                        set((state) => {
                            if (!state.data || state.data.id !== chatId) return state
                            return {
                                data: {
                                    ...state.data,
                                    summary: summary,
                                    summary_updated_at: updatedAt,
                                },
                            }
                        })
                    },
                })

            if (autoKeyFacts)
                scheduleKeyFactsUpdate({
                    chatId: memoryChatId,
                    facts: previousKeyFacts,
                    messages: messagesSnapshot,
                    turnCount: nextTurnCount,
                    persist: db.mutate.applyKeyFactOps,
                    onApplied: (chatId, keyFacts) => {
                        set((state) => {
                            if (!state.data || state.data.id !== chatId) return state
                            return { data: { ...state.data, keyFacts } }
                        })
                    },
                })
        },
        load: async (chatId, overrideScrollOffset) => {
            const data = (await db.query.chat(chatId)) as ChatData | undefined
            if (data) data.keyFacts = await db.query.keyFacts(chatId)

            if (data?.user_id && mmkv.getBoolean(AppSettings.AutoLoadUser)) {
                const userID = Characters.useUserStore.getState().id
                if (userID !== data.user_id) {
                    Logger.info('Autoloading User with ID: ' + data.user_id)
                    const name = await Characters.useUserStore.getState().setCard(data.user_id)
                    if (name) {
                        Logger.infoToast(i18n.t('toast.loadingUser', { name }))
                    } else {
                        Logger.warn(
                            `Failed to load User with ID ${data.user_id}, it was likely deleted. Consider relinking this chat.`
                        )
                    }
                }
            }

            if (data) {
                if (overrideScrollOffset !== undefined) {
                    if (overrideScrollOffset.type === 'index') {
                        const entryIndex = Math.max(
                            0,
                            data.messages.length - overrideScrollOffset.value
                        )
                        data.autoScroll = { cause: 'search', index: entryIndex }
                    }
                    if (overrideScrollOffset.type === 'entryId') {
                        const entryIndex = data.messages.findIndex(
                            (item) => item.id === overrideScrollOffset.value
                        )
                        if (entryIndex !== -1) {
                            data.autoScroll = {
                                cause: 'search',
                                index: data.messages.length - entryIndex - 1,
                            }
                        }
                    }
                } else {
                    // we assume this is taken from ChatWindow
                    data.autoScroll = { cause: 'saveScroll', index: data.scroll_offset }
                }

                if (data.autoScroll?.index && data.autoScroll.index > data.messages.length) {
                    data.autoScroll.index = data.messages.length - 1
                }
            }

            set({
                data: data,
            })
        },

        delete: async (chatId: number) => {
            await db.mutate.deleteChat(chatId)
            if (get().data?.id === chatId) get().reset()
        },

        reset: () => set({ data: undefined }),

        addEntry: async (
            name: string,
            is_user: boolean,
            message: string,
            attachments: string[] = []
        ) => {
            const messages = get().data?.messages
            const chatId = get().data?.id
            if (!messages || !chatId) return
            const order = messages.length > 0 ? messages[messages.length - 1].order + 1 : 0
            const entry = await db.mutate.createEntry(
                chatId,
                name,
                is_user,
                order,
                message,
                attachments
            )
            if (attachments.length > 0 && entry) {
                // TODO: Recall what this was even for
                // const entryId = entry.id
            }
            if (entry) messages.push(entry)
            set((state) => ({
                data: state?.data ? { ...state.data, messages: [...messages] } : state.data,
            }))
            return entry?.swipes[0].id
        },
        deleteEntry: async (index: number) => {
            const messages = get().data?.messages
            if (!messages) return
            const entryId = messages[index].id
            if (!entryId) return

            await db.mutate.deleteChatEntry(entryId)

            set((state) => {
                if (!state.data) return state
                return {
                    data: {
                        ...state.data,
                        messages: messages.filter((item, ind) => ind !== index),
                    },
                }
            })
        },

        updateEntry: async (index: number, message: string, options = {}) => {
            const { verifySwipeId, updateFinished, updateStarted } = options
            const messages = get()?.data?.messages
            if (!messages) return

            let chatSwipeId: number | undefined =
                messages[index]?.swipes[messages[index].swipe_id].id
            let updateState = true

            if (verifySwipeId) {
                updateState = verifySwipeId === chatSwipeId
                if (!updateState) {
                    chatSwipeId = verifySwipeId
                }
            }

            if (!chatSwipeId) return

            const date = new Date()

            const updatedSwipe: ChatSwipeUpdated = {
                id: chatSwipeId,
                swipe: message,
            }
            if (updateFinished) updatedSwipe.gen_finished = date
            if (updateStarted) updatedSwipe.gen_started = date

            await db.mutate.updateChatSwipe(updatedSwipe)

            if (!updateState) return

            const entry = messages[index].swipes[messages[index].swipe_id]
            entry.swipe = message
            entry.token_count = undefined
            if (updateFinished) entry.gen_finished = date
            if (updateStarted) entry.gen_started = date
            messages[index].swipes[messages[index].swipe_id] = entry

            set((state) => ({
                data: state?.data ? { ...state.data, messages: messages } : state.data,
            }))
        },

        // returns true if overflowing right swipe, used to trigger generate
        swipe: async (index: number, direction: number) => {
            let messages = get()?.data?.messages
            if (!messages) return false
            messages = [...messages]
            const swipe_id = messages[index].swipe_id
            const target = swipe_id + direction
            const limit = messages[index].swipes.length - 1

            if (target < 0) return false
            if (target > limit) return true
            messages[index].swipe_id = target
            messages[index] = { ...messages[index] }
            set((state) => {
                if (state.data) {
                    return {
                        data: { ...state.data, messages: messages },
                    }
                } else return state
            })

            const entryId = messages[index].id
            await db.mutate.updateEntrySwipeId(entryId, target)

            return false
        },

        addSwipe: async (index: number, message: string = '') => {
            const messages = get().data?.messages
            if (!messages) return
            const entryId = messages[index].id

            const swipe = await db.mutate.createSwipe(entryId, message)
            if (swipe) messages[index].swipes.push(swipe)
            await db.mutate.updateEntrySwipeId(entryId, messages[index].swipes.length - 1)
            messages[index].swipe_id = messages[index].swipes.length - 1
            set((state) => ({
                data: state?.data ? { ...state.data, messages: messages } : state.data,
            }))
            return swipe?.id
        },

        getTokenCount: async (
            index: number,
            options = {
                lastImageOnly: false,
                addAttachments: false,
            }
        ) => {
            const messages = get()?.data?.messages
            if (!messages) return 0
            const message = messages[index]
            const swipe_id = message.swipe_id
            const swipe = message.swipes[swipe_id]
            const attachmentLength = message.attachments.length
            const attachmentCount = options.addAttachments
                ? options.lastImageOnly
                    ? 1
                    : attachmentLength
                : 0

            const { token_count, attachment_count } = swipe
            if (token_count !== undefined && attachmentCount === (attachment_count ?? 0))
                return token_count
            const getTokenCount = Tokenizer.getTokenizer()

            const new_token_count = await getTokenCount(
                messages[index].swipes[swipe_id].swipe,
                messages[index].attachments.map((item) => item.uri)
            )

            messages[index].swipes[swipe_id].token_count = new_token_count
            set((state: ChatState) => ({
                data: state?.data ? { ...state.data, messages: messages } : state.data,
            }))
            return new_token_count
        },
        setBuffer: (newBuffer: OutputBuffer) => set({ buffer: newBuffer }),

        insertBuffer: (data: string) =>
            set((state: ChatState) => ({
                buffer: { ...state.buffer, data: state.buffer.data + data },
            })),

        updateFromBuffer: async (cachedSwipeId) => {
            const NO_VALID_ENTRY = -1
            const index = get().data?.messages?.length
            const buffer = get().buffer
            const updatedSwipe: ChatSwipeUpdated = {
                id: index ?? cachedSwipeId ?? NO_VALID_ENTRY,
                swipe: buffer.data,
            }
            if (updatedSwipe.id === NO_VALID_ENTRY) {
                Logger.error('Attempted to insert to buffer, but no valid entry was found!')
                return
            }
            if (!index) {
                // this means there is no chat loaded, we need to update the db anyways
                await db.mutate.updateChatSwipe(updatedSwipe)
            } else
                await get().updateEntry(index - 1, get().buffer.data, {
                    updateFinished: true,
                    verifySwipeId: cachedSwipeId,
                })
        },
        insertLastToBuffer: () => {
            const message = get()?.data?.messages?.at(-1)
            if (!message) return
            const mes = message.swipes[message.swipe_id].swipe

            set((state: ChatState) => ({ ...state, buffer: { ...state.buffer, data: mes } }))
        },
        setRegenCache: () => {
            const messages = get()?.data?.messages
            const message = messages?.[messages.length - 1]
            if (!messages || !message) return
            message.swipes[message.swipe_id].regen_cache = message.swipes[message.swipe_id].swipe
            messages[messages.length - 1] = message
            set((state) => ({
                data: state?.data ? { ...state.data, messages: messages } : state.data,
            }))
        },
        getRegenCache: () => {
            const messages = get()?.data?.messages
            const message = messages?.[messages.length - 1]
            if (!messages || !message) return ''
            return message.swipes[message.swipe_id].regen_cache ?? ''
        },
        resetRegenCache: () => {
            const messages = get()?.data?.messages
            const message = messages?.[messages.length - 1]
            if (!messages || !message) return
            message.swipes[message.swipe_id].regen_cache = ''
            messages[messages.length - 1] = message
            set((state) => ({
                data: state?.data ? { ...state.data, messages: messages } : state.data,
            }))
        },
        removeAttachment: async (index: number, attachmentId: number) => {
            const messages = get()?.data?.messages
            const message = messages?.[index]
            if (!messages || !message) return
            await db.mutate.deleteAttachment(attachmentId)
            message.attachments = message.attachments.filter((item) => item.id !== attachmentId)
            messages[index] = message
            set((state) => ({
                data: state?.data ? { ...state.data, messages: [...messages] } : state.data,
            }))
        },
        renameChat: (chatId: number, name: string) => {
            const data = get().data
            if (!data) return
            if (data.id === chatId)
                set({
                    data: { ...data, name: name },
                })
            db.mutate.renameChat(chatId, name)
        },
        setAutoSummary: async (enabled: boolean) => {
            const chatId = get().data?.id
            if (!chatId) return
            await db.mutate.setAutoSummary(chatId, enabled)
            set((state) => ({
                data: state.data ? { ...state.data, auto_summary: enabled } : state.data,
            }))
        },
        setChatSummary: async (chatId: number, summary: string) => {
            const trimmed = summary.trim()
            const updatedAt = trimmed ? Date.now() : null
            await db.mutate.updateChatSummary(chatId, trimmed, updatedAt)
            set((state) => {
                if (!state.data || state.data.id !== chatId) return state
                return {
                    data: {
                        ...state.data,
                        summary: trimmed,
                        summary_updated_at: updatedAt,
                    },
                }
            })
        },
        refreshKeyFacts: async (chatId: number) => {
            if (get().data?.id !== chatId) return
            const keyFacts = await db.query.keyFacts(chatId)
            set((state) => {
                if (!state.data || state.data.id !== chatId) return state
                return { data: { ...state.data, keyFacts } }
            })
        },
    }))

    export namespace db {
        export namespace query {
            export const chat = async (chatId: number) => {
                const chat = await database.query.chats.findFirst({
                    where: eq(chats.id, chatId),
                    with: {
                        messages: {
                            orderBy: chatEntries.order,
                            with: {
                                swipes: true,
                                attachments: true,
                            },
                        },
                    },
                })
                if (chat) return { ...chat }
            }

            export const chatNewestId = async (charId: number): Promise<number | undefined> => {
                const result = await database.query.chats.findFirst({
                    orderBy: desc(chats.last_modified),
                    where: eq(chats.character_id, charId),
                })
                return result?.id
            }

            export const chatNewest = async () => {
                const result = await database.query.chats.findFirst({
                    orderBy: desc(chats.last_modified),
                })
                return result
            }

            export const chatList = async (charId: number) => {
                const result = await database
                    .select({
                        ...getTableColumns(chats),
                        entryCount: count(chatEntries.id),
                    })
                    .from(chats)
                    .leftJoin(chatEntries, eq(chats.id, chatEntries.chat_id))
                    .groupBy(chats.id)
                    .where(eq(chats.character_id, charId))
                return result
            }

            export const chatListQuery = (charId: number) => {
                return database
                    .select({
                        ...getTableColumns(chats),
                        entryCount: count(chatEntries.id),
                    })
                    .from(chats)
                    .leftJoin(chatEntries, eq(chats.id, chatEntries.chat_id))
                    .groupBy(chats.id)
                    .where(eq(chats.character_id, charId))
                    .orderBy(desc(chats.last_modified))
            }

            export const chatExists = async (chatId: number) => {
                return await database.query.chats.findFirst({ where: eq(chats.id, chatId) })
            }

            export const searchChat = async (
                query: string,
                charId: number
            ): Promise<ChatSearchResult[]> => {
                const swipesWithIndex = sql`
                    SELECT
                        ${chatSwipes.id} AS swipeId,
                        ${chatSwipes.entry_id} AS entryId,
                        ${chatSwipes.swipe},
                        ${chatSwipes.send_date} AS sendDate,
                        ROW_NUMBER() OVER (PARTITION BY ${chatSwipes.entry_id} ORDER BY ${chatSwipes.id}) AS swipeIndex
                    FROM ${chatSwipes}
                    `

                const result = (await database
                    .select({
                        swipeId: sql`swipeId`,
                        chatId: chatEntries.chat_id,
                        chatEntryId: chatEntries.id,
                        chatName: chats.name,
                        swipe: sql`swipe`,
                        sendDate: sql`sendDate`,
                    })
                    .from(chatEntries)
                    .innerJoin(
                        sql`(${swipesWithIndex}) AS swi`,
                        sql`swi.entryId = ${chatEntries.id} AND swi.swipeIndex = ${chatEntries.swipe_id} + 1`
                    )
                    .innerJoin(chats, eq(chatEntries.chat_id, chats.id))
                    .where(and(like(sql`swipe`, `%${query}%`), eq(chats.character_id, charId)))
                    .orderBy(sql`sendDate`)
                    .limit(100)) as ChatSearchQueryResult[]

                return result.map((item) => {
                    return { ...item, sendDate: new Date(item.sendDate * 1000) }
                })
            }

            export const keyFacts = async (chatId: number) => {
                return await database.query.chatKeyFacts.findMany({
                    where: eq(chatKeyFacts.chat_id, chatId),
                    orderBy: chatKeyFacts.id,
                })
            }

            /** Live-queryable fact counts for every chat of a character. */
            export const keyFactCountQuery = (charId: number) => {
                return database
                    .select({
                        chatId: chatKeyFacts.chat_id,
                        factCount: count(chatKeyFacts.id),
                    })
                    .from(chatKeyFacts)
                    .innerJoin(chats, eq(chats.id, chatKeyFacts.chat_id))
                    .where(eq(chats.character_id, charId))
                    .groupBy(chatKeyFacts.chat_id)
            }

            export const chatWithoutId = async (chatId: number, limit?: number) => {
                return await database.query.chats.findFirst({
                    where: eq(chats.id, chatId),
                    columns: { id: false },
                    with: {
                        messages: {
                            columns: { id: false },
                            orderBy: chatEntries.order,
                            with: {
                                swipes: {
                                    columns: { id: false },
                                },
                            },
                            ...(limit && { limit: limit }),
                        },
                    },
                })
            }
        }
        export namespace mutate {
            export const createChat = async (charId: number) => {
                const card = await Characters.db.query.card(charId)
                if (!card) {
                    Logger.error('Character does not exist!')
                    return
                }
                const userId = Characters.useUserStore.getState().id
                const charName = card.name
                return await database.transaction(async (tx) => {
                    if (!card || !charName) return
                    const [{ chatId }] = await tx
                        .insert(chats)
                        .values({
                            character_id: charId,
                            user_id: userId ?? null,
                        })
                        .returning({ chatId: chats.id })

                    // custom setting to not generate first mes
                    if (!mmkv.getBoolean(AppSettings.CreateFirstMes)) return chatId
                    const greetings = [
                        card.first_mes ?? '',
                        ...card.alternate_greetings.map((item) => item.greeting),
                    ].filter((item) => item)

                    if (greetings.length > 0) {
                        const [{ entryId }] = await tx
                            .insert(chatEntries)
                            .values({
                                chat_id: chatId,
                                is_user: false,
                                name: card.name ?? '',
                                order: 0,
                            })
                            .returning({ entryId: chatEntries.id })

                        await tx.insert(chatSwipes).values(
                            greetings.map((item) => ({
                                entry_id: entryId,
                                swipe: convertToFormatInstruct(replaceMacros(item)),
                            }))
                        )
                    }

                    await Characters.db.mutate.updateModified(charId)
                    return chatId
                })
            }

            export const updateChatModified = async (chatID: number) => {
                const chat = await database.query.chats.findFirst({ where: eq(chats.id, chatID) })
                if (chat?.character_id) {
                    await Characters.db.mutate.updateModified(chat.character_id)
                }
                await database
                    .update(chats)
                    .set({ last_modified: Date.now() })
                    .where(eq(chats.id, chatID))
            }

            export const createEntry = async (
                chatId: number,
                name: string,
                isUser: boolean,
                order: number,
                message: string,
                attachments: string[] = []
            ) => {
                const [{ entryId }] = await database
                    .insert(chatEntries)
                    .values({
                        chat_id: chatId,
                        name: name,
                        is_user: isUser,
                        order: order,
                    })
                    .returning({ entryId: chatEntries.id })
                await database
                    .insert(chatSwipes)
                    .values({ swipe: replaceMacros(message), entry_id: entryId })

                await Promise.all(
                    attachments.map(async (uri) => {
                        await createAttachment(entryId, uri)
                    })
                )

                const entry = await database.query.chatEntries.findFirst({
                    where: eq(chatEntries.id, entryId),
                    with: { swipes: true, attachments: true },
                })

                await updateChatModified(chatId)
                return entry
            }

            export const updateEntryModified = async (entryId: number) => {
                const entry = await database.query.chatEntries.findFirst({
                    where: eq(chatEntries.id, entryId),
                })
                if (entry?.chat_id) {
                    await updateChatModified(entry.chat_id)
                }
            }

            export const createSwipe = async (entryId: number, message: string) => {
                const [swipe] = await database
                    .insert(chatSwipes)
                    .values({
                        entry_id: entryId,
                        swipe: replaceMacros(message),
                    })
                    .returning()
                await updateEntryModified(entryId)
                return swipe
            }

            export const updateEntrySwipeId = async (entryId: number, swipeId: number) => {
                await updateEntryModified(entryId)
                await database
                    .update(chatEntries)
                    .set({ swipe_id: swipeId })
                    .where(eq(chatEntries.id, entryId))
            }

            export const updateChatSwipe = async (chatSwipe: ChatSwipeUpdated) => {
                await database
                    .update(chatSwipes)
                    .set(chatSwipe)
                    .where(eq(chatSwipes.id, chatSwipe.id))
                const swipe = await database.query.chatSwipes.findFirst({
                    where: eq(chatSwipes.id, chatSwipe.id),
                })
                if (swipe?.entry_id) updateEntryModified(swipe.entry_id)
            }

            export const deleteChat = async (chatId: number) => {
                await updateChatModified(chatId)
                await database.delete(chats).where(eq(chats.id, chatId))
            }

            export const deleteChatEntry = async (entryId: number) => {
                await updateEntryModified(entryId)
                const attachments = await database.query.chatAttachments.findMany({
                    where: eq(chatAttachments.chat_entry_id, entryId),
                })
                await Promise.all(attachments.map(async (item) => deleteFile(item.uri)))

                await database.delete(chatEntries).where(eq(chatEntries.id, entryId))
            }

            export const cloneChat = async (
                chat: NonNullable<Awaited<ReturnType<typeof query.chatWithoutId>>>
            ) => {
                chat.last_modified = Date.now()

                const newChatId = await database.transaction(async (tx) => {
                    const [{ newChatId }] = await tx
                        .insert(chats)
                        .values(chat)
                        .returning({ newChatId: chats.id })

                    chat.messages.forEach((item) => {
                        item.chat_id = newChatId
                    })
                    const newEntryIds = await tx
                        .insert(chatEntries)
                        .values(chat.messages)
                        .returning({ newEntryId: chatEntries.id })

                    chat.messages.forEach((message, index) => {
                        message.swipes.forEach((swipe) => {
                            swipe.entry_id = newEntryIds[index].newEntryId
                        })
                    })
                    const swipes = chat.messages.map((item) => item.swipes).flat()
                    await tx.insert(chatSwipes).values(swipes)
                    return newChatId
                })
                return newChatId
            }

            export const cloneChatFromId = async (chatId: number, limit?: number) => {
                const result = await query.chatWithoutId(chatId, limit)
                if (!result) return

                result.last_modified = Date.now()
                const newChatid = await cloneChat(result)
                if (!newChatid) return newChatid

                const facts = await query.keyFacts(chatId)
                if (facts.length > 0) {
                    await database.insert(chatKeyFacts).values(
                        facts.map(({ id, chat_id, ...fact }) => ({
                            ...fact,
                            chat_id: newChatid,
                        }))
                    )
                }
                return newChatid
            }

            export const renameChat = async (chatId: number, name: string) => {
                await database.update(chats).set({ name: name }).where(eq(chats.id, chatId))
            }

            export const setAutoSummary = async (chatId: number, enabled: boolean) => {
                await database
                    .update(chats)
                    .set({ auto_summary: enabled })
                    .where(eq(chats.id, chatId))
            }

            export const updateChatSummary = async (
                chatId: number,
                summary: string,
                updatedAt: number | null
            ) => {
                await database
                    .update(chats)
                    .set({ summary, summary_updated_at: updatedAt })
                    .where(eq(chats.id, chatId))
            }

            /**
             * Drop the least useful rows once a chat exceeds the cap: stale facts
             * first, then whichever active facts have gone longest without a change.
             */
            const pruneKeyFacts = async (chatId: number) => {
                const rows = await database
                    .select({
                        id: chatKeyFacts.id,
                        stale: chatKeyFacts.stale,
                        updated_at: chatKeyFacts.updated_at,
                    })
                    .from(chatKeyFacts)
                    .where(eq(chatKeyFacts.chat_id, chatId))
                if (rows.length <= MAX_KEY_FACTS_PER_CHAT) return

                const victims = rows
                    .sort(
                        (a, b) => Number(b.stale) - Number(a.stale) || a.updated_at - b.updated_at
                    )
                    .slice(0, rows.length - MAX_KEY_FACTS_PER_CHAT)
                await database.delete(chatKeyFacts).where(
                    inArray(
                        chatKeyFacts.id,
                        victims.map((item) => item.id)
                    )
                )
            }

            /**
             * Apply extractor output. Facts are keyed by name within a chat, so a
             * repeated key overwrites in place and keeps the old value plus the
             * model's reason for the change.
             */
            export const applyKeyFactOps = async (chatId: number, ops: KeyFactOp[]) => {
                const existing = await query.keyFacts(chatId)
                const byKey = new Map(existing.map((fact) => [fact.key, fact]))
                const now = Date.now()

                for (const op of ops) {
                    const current = byKey.get(op.key)

                    if (op.op === 'stale') {
                        if (!current || current.stale) continue
                        const changes = {
                            stale: true,
                            note: op.note || current.note,
                            updated_at: now,
                        }
                        await database
                            .update(chatKeyFacts)
                            .set(changes)
                            .where(eq(chatKeyFacts.id, current.id))
                        byKey.set(op.key, { ...current, ...changes })
                        continue
                    }

                    if (!current) {
                        // Tracked in byKey because a single batch can carry more than
                        // one op for the same key, and (chat_id, key) is unique.
                        const [inserted] = await database
                            .insert(chatKeyFacts)
                            .values({
                                chat_id: chatId,
                                category: op.category,
                                key: op.key,
                                value: op.value,
                                note: op.note,
                                created_at: now,
                                updated_at: now,
                            })
                            .returning()
                        byKey.set(op.key, inserted)
                        continue
                    }

                    if (current.value === op.value && !current.stale) continue
                    const changes = {
                        category: op.category,
                        value: op.value,
                        note: op.note,
                        previous_value: current.value,
                        stale: false,
                        updated_at: now,
                    }
                    await database
                        .update(chatKeyFacts)
                        .set(changes)
                        .where(eq(chatKeyFacts.id, current.id))
                    byKey.set(op.key, { ...current, ...changes })
                }

                await pruneKeyFacts(chatId)
                return await query.keyFacts(chatId)
            }

            export const upsertKeyFact = async (
                chatId: number,
                fact: Pick<ChatKeyFactType, 'category' | 'key' | 'value' | 'note' | 'stale'> & {
                    id?: number
                }
            ) => {
                const now = Date.now()
                if (fact.id) {
                    await database
                        .update(chatKeyFacts)
                        .set({
                            category: fact.category,
                            key: fact.key,
                            value: fact.value,
                            note: fact.note,
                            stale: fact.stale,
                            updated_at: now,
                        })
                        .where(eq(chatKeyFacts.id, fact.id))
                    return
                }
                await database.insert(chatKeyFacts).values({
                    chat_id: chatId,
                    category: fact.category,
                    key: fact.key,
                    value: fact.value,
                    note: fact.note,
                    stale: fact.stale,
                    created_at: now,
                    updated_at: now,
                })
            }

            export const deleteKeyFact = async (factId: number) => {
                await database.delete(chatKeyFacts).where(eq(chatKeyFacts.id, factId))
            }

            export const deleteAllKeyFacts = async (chatId: number) => {
                await database.delete(chatKeyFacts).where(eq(chatKeyFacts.chat_id, chatId))
            }

            export const setSummaryTurnCount = async (chatId: number, turnCount: number) => {
                await database
                    .update(chats)
                    .set({ summary_turn_count: turnCount })
                    .where(eq(chats.id, chatId))
            }

            export const setSummaryTokenCount = async (chatId: number, tokenCount: number) => {
                await database
                    .update(chats)
                    .set({ summary_token_count: tokenCount })
                    .where(eq(chats.id, chatId))
            }

            export const updateUser = async (chatId: number, userId: number) => {
                await database.update(chats).set({ user_id: userId }).where(eq(chats.id, chatId))
            }

            export const createAttachment = async (entryId: number, uri: string) => {
                const attachmentId = randomUUID()
                const info = fileInfo(uri)
                if (!info.exists) return

                const name = uri.split('/').pop() ?? 'unknown'
                const extension = name.split('.').pop()?.toLowerCase()
                const mimeType = mime.getType(uri)
                const type = mimeType?.split('/')?.[0]
                if (!name || !extension || !mimeType || !type || !validExtensionTypes(type)) return
                const newURI = AppDirectory.Attachments + attachmentId + '.' + extension
                copyFile({
                    from: uri,
                    to: newURI,
                })
                const [attachment] = await database
                    .insert(chatAttachments)
                    .values({
                        type: type,
                        name: name,
                        chat_entry_id: entryId,
                        uri: newURI,
                        mime_type: mimeType,
                    })
                    .returning()
                return attachment
            }

            export const deleteAttachment = async (attachmentId: number) => {
                await database.delete(chatAttachments).where(eq(chatAttachments.id, attachmentId))
            }

            export const updateScrollOffset = async (chatId: number, scrollOffset: number) => {
                await database
                    .update(chats)
                    .set({ scroll_offset: scrollOffset })
                    .where(eq(chats.id, chatId))
            }
        }
    }

    export const useEntryData = (index: number) => {
        // TODO: Investigate if dummyEntry is dangerous
        const entry = useChatState((state) => state?.data?.messages?.[index])
        return entry ?? dummyEntry
    }

    export const useSwipes = () => {
        const { swipeChat, addSwipe } = Chats.useChatState(
            useShallow((state) => ({
                swipeChat: state.swipe,
                addSwipe: state.addSwipe,
            }))
        )
        return { swipeChat, addSwipe }
    }

    export const useSwipeData = (index: number) => {
        const message = useEntryData(index)
        const swipeIndex = message.swipe_id
        const swipesLength = message.swipes.length
        const { swipe, swipeText, swipeId } = useChatState(
            useShallow((state) => ({
                swipe: state?.data?.messages?.[index]?.swipes[swipeIndex],
                swipeText: state?.data?.messages?.[index]?.swipes[swipeIndex].swipe,
                swipeId: state?.data?.messages?.[index]?.swipes[swipeIndex].id,
            }))
        )
        return { swipeId, swipe, swipeText, swipeIndex, swipesLength }
    }

    export const useChat = () => {
        const { loadChat, unloadChat, chat, chatId, deleteChat, chatLength } = Chats.useChatState(
            useShallow((state) => ({
                loadChat: state.load,
                unloadChat: state.reset,
                chat: state.data,
                chatId: state.data?.id,
                deleteChat: state.delete,
                chatLength: state.data?.messages.length,
            }))
        )
        return { chat, loadChat, unloadChat, deleteChat, chatId, chatLength }
    }

    export const useEntry = () => {
        const { addEntry, deleteEntry, updateEntry } = Chats.useChatState(
            useShallow((state) => ({
                addEntry: state.addEntry,
                deleteEntry: state.deleteEntry,
                updateEntry: state.updateEntry,
            }))
        )
        return { addEntry, deleteEntry, updateEntry }
    }

    export const useBuffer = () => {
        const { buffer } = Chats.useChatState(
            useShallow((state) => ({
                buffer: state.buffer,
            }))
        )
        return { buffer }
    }

    export const dummyEntry: ChatEntry = {
        id: 0,
        chat_id: -1,
        name: '',
        is_user: false,
        order: -1,
        swipe_id: 0,
        swipes: [
            {
                id: -1,
                entry_id: -1,
                swipe: '',
                send_date: new Date(),
                gen_started: new Date(),
                gen_finished: new Date(),
            },
        ],
        attachments: [],
    }

    const validExtensionTypes = (type: string) => {
        //TODO: Add document, eg application/pdf or text/plain
        return type === 'audio' || type === 'image'
    }
}
