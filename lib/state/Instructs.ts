import { eq, notInArray } from 'drizzle-orm'
import { create } from 'zustand'
import { persist } from 'zustand/middleware'

import { db as database } from '@db'
import { Tokenizer } from '@lib/engine/Tokenizer'
import { Storage } from '@lib/enums/Storage'
import i18n from '@lib/i18n'
import { instructFormats, instructs } from 'db/schema'

import { Characters } from './Characters'
import { Logger } from './Logger'
import { replaceMacros } from '../state/Macros'
import { createMMKVStorage } from '../storage/MMKV'

export const defaultSystemPromptFormat =
    '{{system_prefix}}{{system_prompt}}\n{{character_desc}}\n{{personality}}\n{{scenario}}\n{{user_desc}}{{system_suffix}}'

export const BUILTIN_STYLE_NAMES = ['NovelStyle', 'ChatStyle'] as const

const styleFillerFields = {
    system_prefix: '<|im_start|>system\n',
    system_suffix: '<|im_end|>\n',
    input_prefix: '<|im_start|>user\n',
    input_suffix: '<|im_end|>\n',
    output_prefix: '<|im_start|>assistant\n',
    last_output_prefix: '<|im_start|>assistant\n',
    output_suffix: '<|im_end|>\n',
    stop_sequence: '<|im_end|>',
    user_alignment_message: '',
    activation_regex: '',
    wrap: false,
    macro: false,
    names: false,
    names_force_groups: false,
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

const formatGenerics = {
    wrap: false,
    macro: false,
    names: false,
    names_force_groups: false,
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
    user_alignment_message: '',
    activation_regex: '',
}

const defaultFormats: InstructFormatType[] = [
    {
        name: 'ChatML',
        system_prefix: '<|im_start|>system\n',
        system_suffix: '<|im_end|>\n',
        input_prefix: '<|im_start|>user\n',
        input_suffix: '<|im_end|>\n',
        output_prefix: '<|im_start|>assistant\n',
        last_output_prefix: '<|im_start|>assistant\n',
        output_suffix: '<|im_end|>\n',
        stop_sequence: '<|im_end|>',
        ...formatGenerics,
    },
    {
        name: 'Alpaca',
        system_prefix: '### Instruction: ',
        system_suffix: '\n',
        input_prefix: '### Instruction: ',
        input_suffix: '\n',
        output_prefix: '### Response: ',
        last_output_prefix: '### Response: ',
        output_suffix: '\n',
        stop_sequence: '### Instruction',
        ...formatGenerics,
    },
    {
        name: 'Llama 3',
        system_prefix: '<|start_header_id|>system<|end_header_id|>\n\n',
        system_suffix: '<|eot_id|>',
        input_prefix: '<|start_header_id|>user<|end_header_id|>\n\n',
        input_suffix: '<|eot_id|>',
        output_prefix: '<|start_header_id|>assistant<|end_header_id|>\n\n',
        last_output_prefix: '<|start_header_id|>assistant<|end_header_id|>\n\n',
        output_suffix: '<|eot_id|>',
        stop_sequence: '<|eot_id|>',
        ...formatGenerics,
    },
    {
        name: 'StableLM-Zephyr',
        system_prefix: '<|system|>\n',
        system_suffix: '<|endoftext|>\n',
        input_prefix: '<|user|>\n',
        input_suffix: '<|endoftext|>\n',
        output_prefix: '<|assistant|>\n',
        last_output_prefix: '<|assistant|>\n',
        output_suffix: '<|endoftext|>\n',
        stop_sequence: '<|endoftext|>',
        ...formatGenerics,
    },
    {
        name: 'phi3',
        system_prefix: '<|system|>\n',
        system_suffix: '<|end|>\n',
        input_prefix: '<|user|>\n',
        input_suffix: '<|end|>\n',
        output_prefix: '<|assistant|>\n',
        last_output_prefix: '<|assistant|>\n',
        output_suffix: '<|end|>\n',
        stop_sequence: '<|end|>',
        ...formatGenerics,
    },
    {
        name: 'Gemma 2',
        system_prefix: '<start_of_turn>user\n',
        system_suffix: '<end_of_turn>\n',
        input_prefix: '<start_of_turn>user\n',
        input_suffix: '<end_of_turn>\n',
        output_prefix: '<start_of_turn>model\n',
        last_output_prefix: '<start_of_turn>model\n',
        output_suffix: '<end_of_turn>\n',
        stop_sequence: '<end_of_turn>',
        ...formatGenerics,
    },
    {
        name: 'Mistral V1',
        system_prefix: '',
        system_suffix: '',
        input_prefix: '[INST]',
        input_suffix: '',
        output_prefix: '[/INST]',
        last_output_prefix: '[/INST]',
        output_suffix: '</s>',
        stop_sequence: '</s>',
        ...formatGenerics,
    },
    {
        name: 'DeepSeek-R1',
        system_prefix: '',
        system_suffix: '',
        input_prefix: '<｜User｜>',
        input_suffix: '',
        output_prefix: '<｜Assistant｜>',
        last_output_prefix: '<｜Assistant｜>',
        output_suffix: '<｜end▁of▁sentence｜>',
        stop_sequence: '<｜end▁of▁sentence｜>',
        ...formatGenerics,
        activation_regex: 'deepseek',
    },
]

export const outputPrefixes = defaultFormats
    .map((item) => item.output_prefix)
    .filter((item) => !!item)

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
    system_prefix_length: number
    system_suffix_length: number
    input_prefix_length: number
    input_suffix_length: number
    output_prefix_length: number
    last_output_prefix_length: number
    output_suffix_length: number
    user_alignment_message_length: number
}

export type InstructType = Omit<typeof instructs.$inferSelect, 'id'> & { id?: number }
export type InstructFormatType = Omit<typeof instructFormats.$inferSelect, 'id'> & { id?: number }

const emptyTokenCache = (charName: string, userName: string): InstructTokenCache => ({
    charName,
    userName,
    system_prompt_length: 0,
    system_prefix_length: 0,
    system_suffix_length: 0,
    input_prefix_length: 0,
    input_suffix_length: 0,
    output_prefix_length: 0,
    last_output_prefix_length: 0,
    output_suffix_length: 0,
    user_alignment_message_length: 0,
})

const applyMacros = (base: InstructType): InstructType => ({
    ...base,
    system_prompt: replaceMacros(base.system_prompt),
    system_prefix: replaceMacros(base.system_prefix),
    system_suffix: replaceMacros(base.system_suffix),
    input_prefix: replaceMacros(base.input_prefix),
    input_suffix: replaceMacros(base.input_suffix),
    output_prefix: replaceMacros(base.output_prefix),
    last_output_prefix: replaceMacros(base.last_output_prefix),
    output_suffix: replaceMacros(base.output_suffix),
    user_alignment_message: replaceMacros(base.system_prompt),
    stop_sequence: replaceMacros(base.stop_sequence),
})

export const mergeInstructPresets = (
    style: InstructType | undefined,
    format: InstructFormatType | undefined
): InstructType => {
    const safeStyle = style ?? Instructs.defaultInstruct
    const safeFormat = format ?? InstructFormats.defaultFormat
    return {
        ...safeStyle,
        ...safeFormat,
        id: safeStyle.id,
        name: safeStyle.name,
        system_prompt: safeStyle.system_prompt,
        format_type: safeStyle.format_type,
    }
}

type InstructState = {
    data: InstructType | undefined
    load: (id: number) => Promise<void>
    setData: (instruct: InstructType) => void
    tokenCache: InstructTokenCache | undefined
    getCache: (charName: string, userName: string) => Promise<InstructTokenCache>
    replacedMacros: () => InstructType
    getMergedInstruct: () => InstructType
    getStopSequence: () => string[]
}

type InstructFormatState = {
    data: InstructFormatType | undefined
    load: (id: number) => Promise<void>
    setData: (format: InstructFormatType) => void
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
                getMergedInstruct: () => {
                    return mergeInstructPresets(
                        get().data,
                        InstructFormats.useFormat.getState().data
                    )
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
                        system_prefix_length: await getTokenCount(instruct.system_prefix),
                        system_suffix_length: await getTokenCount(instruct.system_suffix),
                        input_prefix_length: await getTokenCount(instruct.input_prefix),
                        input_suffix_length: await getTokenCount(instruct.input_suffix),
                        output_prefix_length: await getTokenCount(instruct.output_prefix),
                        last_output_prefix_length: await getTokenCount(instruct.last_output_prefix),
                        output_suffix_length: await getTokenCount(instruct.output_suffix),
                        user_alignment_message_length: await getTokenCount(instruct.system_prompt),
                    }
                    set({ tokenCache: newCache })
                    return newCache
                },
                replacedMacros: () => {
                    const merged = get().getMergedInstruct()
                    if (!merged) {
                        Logger.errorToast(i18n.t('toast.instructDataError'))
                        return Instructs.defaultInstruct
                    }
                    return applyMacros(merged)
                },
                getStopSequence: () => {
                    const instruct = get().replacedMacros()
                    const sequence: string[] = []
                    let extras: string[] = []
                    if (instruct.names) {
                        const userName = Characters.useCharacterStore.getState().card?.name
                        const charName = Characters.useCharacterStore.getState()?.card?.name
                        if (userName) sequence.push(`${userName} :`)
                        if (charName) sequence.push(`${charName} :`)
                    }

                    if (instruct.stop_sequence !== '')
                        instruct.stop_sequence
                            .split(',')
                            .forEach((item) => item !== '' && sequence.push(item))

                    if (instruct.use_common_stop) {
                        extras = [...extras, ...commonStopStrings]
                    }

                    return [...sequence, ...extras]
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
                // Styles only own system_prompt + format_type (+ name); keep filler fields stable
                await database
                    .update(instructs)
                    .set({
                        name: instruct.name,
                        system_prompt: instruct.system_prompt,
                        format_type: instruct.format_type,
                    })
                    .where(eq(instructs.id, id))
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
        return data === -1 ? list?.[0]?.id ?? 1 : data
    }

    export const migrateToStyleFormatSplit = async () => {
        await db.mutate.deleteNonBuiltinStyles()
        const styleId = await generateInitialDefaults()
        const formatId = await InstructFormats.generateInitialDefaults()

        const styleList = await db.query.instructList()
        const currentStyle = useInstruct.getState().data
        if (!currentStyle?.id || !styleList?.some((item) => item.id === currentStyle.id)) {
            await useInstruct.getState().load(styleId)
        }

        const formatList = await InstructFormats.db.query.formatList()
        const currentFormat = InstructFormats.useFormat.getState().data
        if (!currentFormat?.id || !formatList?.some((item) => item.id === currentFormat.id)) {
            await InstructFormats.useFormat.getState().load(formatId)
        }

        Logger.info('Instruct style/format split migration complete')
        return { styleId, formatId }
    }
}

export namespace InstructFormats {
    export const defaultFormat: InstructFormatType = defaultFormats[0]

    export const useFormat = create<InstructFormatState>()(
        persist(
            (set) => ({
                data: defaultFormats[0],
                load: async (id: number) => {
                    const data = await db.query.format(id)
                    set({ data })
                    Instructs.useInstruct.setState({ tokenCache: undefined })
                },
                setData: (format: InstructFormatType) => {
                    set({ data: format })
                    Instructs.useInstruct.setState({ tokenCache: undefined })
                },
            }),
            {
                name: Storage.InstructFormat,
                storage: createMMKVStorage(),
                partialize: (state) => ({ data: state.data }),
                version: 1,
            }
        )
    )

    export namespace db {
        export namespace query {
            export const format = async (id: number): Promise<InstructFormatType | undefined> => {
                return await database.query.instructFormats.findFirst({
                    where: eq(instructFormats.id, id),
                })
            }

            export const formatList = async (): Promise<InstructListItem[] | undefined> => {
                return await database.query.instructFormats.findMany({
                    columns: {
                        id: true,
                        name: true,
                    },
                })
            }

            export const formatListQuery = () => {
                return database.query.instructFormats.findMany({
                    columns: {
                        id: true,
                        name: true,
                    },
                })
            }
        }

        export namespace mutate {
            export const createFormat = async (format: InstructFormatType): Promise<number> => {
                const { id, ...input } = format
                const [{ newid }] = await database
                    .insert(instructFormats)
                    .values({
                        ...formatGenerics,
                        ...input,
                    })
                    .returning({ newid: instructFormats.id })
                return newid
            }

            export const updateFormat = async (id: number, format: InstructFormatType) => {
                const { id: _id, ...input } = format
                await database.update(instructFormats).set(input).where(eq(instructFormats.id, id))
            }

            export const deleteFormat = async (id: number) => {
                await database.delete(instructFormats).where(eq(instructFormats.id, id))
            }
        }
    }

    export const generateInitialDefaults = async () => {
        const list = await db.query.formatList()
        let data = -1
        for (const item of defaultFormats) {
            if (!list?.some((e) => e.name === item.name)) {
                const newid = await db.mutate.createFormat(item)
                if (data === -1) data = newid
            }
        }
        Logger.info('Default Instruct Formats Successfully Generated')
        return data === -1 ? list?.[0]?.id ?? 1 : data
    }
}
