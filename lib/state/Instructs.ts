import { eq, notInArray } from 'drizzle-orm'
import { create } from 'zustand'
import { persist } from 'zustand/middleware'

import { db as database } from '@db'
import { Tokenizer } from '@lib/engine/Tokenizer'
import { Storage } from '@lib/enums/Storage'
import i18n from '@lib/i18n'
import { instructs } from 'db/schema'

import { Logger } from './Logger'
import { replaceMacros } from '../state/Macros'
import { createMMKVStorage } from '../storage/MMKV'

export const defaultSystemPromptFormat =
    '{{system_prompt}}\n{{character_desc}}\n{{personality}}\n{{scenario}}\n{{user_desc}}'

export const BUILTIN_STYLE_NAMES = ['NovelStyle', 'ChatStyle'] as const

/** Fields every style carries but the chat completions format never varies. */
const styleFillerFields = {
    stop_sequence: '',
    user_alignment_message: '',
    activation_regex: '',
    macro: false,
    timestamp: false,
    examples: true,
    scenario: true,
    personality: true,
    hide_think_tags: true,
    use_common_stop: true,
    send_images: true,
    send_audio: true,
    send_documents: true,
    last_image_only: true,
    system_prompt_format: defaultSystemPromptFormat,
}

const defaultStyles: InstructType[] = [
    {
        name: 'NovelStyle',
        system_prompt:
            "Roleplay as {{char}}, always responding from {{char}}'s perspective and in character.\n\nCombine natural dialogue with novel-style narration, including actions, emotions, and atmosphere when appropriate.\n\nKeep the writing vivid, engaging, immersive, and enjoyable to read.\n",
        format_type: 0,
        ...styleFillerFields,
    },
    {
        name: 'ChatStyle',
        system_prompt:
            "Roleplay as {{char}}, always responding to {{user}} from {{char}}'s identity and perspective.\n\nSimulate natural, realistic human conversation with concise, casual language. Keep each response around 3-5 sentences and avoid unnecessary verbosity.\n\nOutput only {{char}}'s dialogue. Do not include narration, background descriptions, actions, notes, or any other extra content.\n",
        format_type: 0,
        ...styleFillerFields,
    },
]

/** Sent as stop strings so chat models do not spill their own turn markers into a reply. */
export const commonStopStrings = [
    '</s>',
    '<|end|>',
    '<|eot_id|>',
    '<|end_of_text|>',
    '<|im_end|>',
    '<|EOT|>',
    '<|END_OF_TURN_TOKEN|>',
    '<|end_of_turn|>',
    '<|endoftext|>',
    '<end_of_turn>',
    '<eos>',
    '<｜end▁of▁sentence｜>',
]

export type InstructListItem = {
    id: number
    name: string
}

export type InstructTokenCache = {
    charName: string
    userName: string
    system_prompt_length: number
    user_alignment_message_length: number
}

export type InstructType = Omit<typeof instructs.$inferSelect, 'id'> & { id?: number }

const emptyTokenCache = (charName: string, userName: string): InstructTokenCache => ({
    charName,
    userName,
    system_prompt_length: 0,
    user_alignment_message_length: 0,
})

const applyMacros = (base: InstructType): InstructType => ({
    ...base,
    system_prompt: replaceMacros(base.system_prompt),
    user_alignment_message: replaceMacros(base.system_prompt),
    stop_sequence: replaceMacros(base.stop_sequence),
})

type InstructState = {
    data: InstructType | undefined
    load: (id: number) => Promise<void>
    setData: (instruct: InstructType) => void
    tokenCache: InstructTokenCache | undefined
    getCache: (charName: string, userName: string) => Promise<InstructTokenCache>
    replacedMacros: () => InstructType
    getStopSequence: () => string[]
}

export namespace Instructs {
    export const defaultInstruct: InstructType = defaultStyles[0]

    export const useInstruct = create<InstructState>()(
        persist(
            (set, get: () => InstructState) => ({
                data: defaultStyles[0],
                tokenCache: undefined,
                load: async (id: number) => {
                    const data = await db.query.instruct(id)
                    set({ data: data, tokenCache: undefined })
                },
                setData: (instruct: InstructType) => {
                    set({ data: instruct, tokenCache: undefined })
                },
                getCache: async (charName: string, userName: string) => {
                    const cache = get().tokenCache
                    if (cache && cache.charName === charName && cache.userName === userName)
                        return cache
                    const instruct = get().replacedMacros()
                    if (!instruct) return emptyTokenCache(charName, userName)
                    const getTokenCount = Tokenizer.getTokenizer()

                    const newCache: InstructTokenCache = {
                        charName: charName,
                        userName: userName,
                        system_prompt_length: await getTokenCount(instruct.system_prompt),
                        user_alignment_message_length: await getTokenCount(instruct.system_prompt),
                    }
                    set({ tokenCache: newCache })
                    return newCache
                },
                replacedMacros: () => {
                    const data = get().data
                    if (!data) {
                        Logger.errorToast(i18n.t('toast.instructDataError'))
                        return Instructs.defaultInstruct
                    }
                    return applyMacros(data)
                },
                getStopSequence: () => {
                    const instruct = get().replacedMacros()
                    const sequence: string[] = []

                    if (instruct.stop_sequence !== '')
                        instruct.stop_sequence
                            .split(',')
                            .forEach((item) => item !== '' && sequence.push(item))

                    if (instruct.use_common_stop) return [...sequence, ...commonStopStrings]

                    return sequence
                },
            }),
            {
                name: Storage.Instruct,
                storage: createMMKVStorage(),
                partialize: (state) => ({ data: state.data }),
                version: 1,
            }
        )
    )

    export namespace db {
        export namespace query {
            export const instruct = async (id: number): Promise<InstructType | undefined> => {
                const instruct = await database.query.instructs.findFirst({
                    where: eq(instructs.id, id),
                })
                return instruct
            }

            export const instructList = async (): Promise<InstructListItem[] | undefined> => {
                return await database.query.instructs.findMany({
                    columns: {
                        id: true,
                        name: true,
                    },
                })
            }

            export const instructListQuery = () => {
                return database.query.instructs.findMany({
                    columns: {
                        id: true,
                        name: true,
                    },
                })
            }
        }

        export namespace mutate {
            export const createInstruct = async (instruct: InstructType): Promise<number> => {
                const { id, ...input } = instruct
                const [{ newid }] = await database
                    .insert(instructs)
                    .values({
                        ...styleFillerFields,
                        ...input,
                        format_type: input.format_type ?? 0,
                    })
                    .returning({ newid: instructs.id })
                return newid
            }

            export const updateInstruct = async (id: number, instruct: InstructType) => {
                const { id: _id, ...input } = instruct
                await database.update(instructs).set(input).where(eq(instructs.id, id))
            }

            export const deleteInstruct = async (id: number) => {
                await database.delete(instructs).where(eq(instructs.id, id))
            }

            export const deleteNonBuiltinStyles = async () => {
                await database
                    .delete(instructs)
                    .where(notInArray(instructs.name, [...BUILTIN_STYLE_NAMES]))
            }
        }
    }

    export const generateInitialDefaults = async () => {
        const list = await db.query.instructList()
        let data = -1
        for (const item of defaultStyles) {
            if (!list?.some((e) => e.name === item.name)) {
                const newid = await db.mutate.createInstruct(item)
                if (data === -1) data = newid
            }
        }
        Logger.info('Default Instruct Styles Successfully Generated')
        return data === -1 ? (list?.[0]?.id ?? 1) : data
    }
}
