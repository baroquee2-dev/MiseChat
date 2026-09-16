import { extractPngTextChunk, replacePngTextChunk } from '@vali98/react-native-png-utils'
import { and, asc, desc, eq, gte, inArray, like, ne, notInArray, sql } from 'drizzle-orm'
import { useLiveQuery } from 'drizzle-orm/expo-sqlite'
import * as DocumentPicker from 'expo-document-picker'
import { Paths } from 'expo-file-system'
import { useEffect } from 'react'
import { z } from 'zod'
import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import i18n from '@lib/i18n'

import { db as database } from '@db'
import { Tokenizer } from '@lib/engine/Tokenizer'
import { Storage } from '@lib/enums/Storage'
import {
    copyFile,
    deleteFile,
    fileExists,
    readBase64Async,
    readStringAsync,
    resolveBundledAssetFileUri,
    saveStringToDownload,
} from '@lib/utils/File'
import { replaceMacroBase } from '@lib/utils/Macros'
import {
    characterGreetings,
    characterTags,
    characters,
    chatEntries,
    chatSwipes,
    chats,
    tags,
} from 'db/schema'

import { Logger } from './Logger'
import { deleteMouthSprites } from './MouthSprites'
import { createMMKVStorage } from '../storage/MMKV'

export type CharInfo = {
    name: string
    id: number
    image_id: number
    last_modified: number
    tags: string[]
    description: string
    latestSwipe?: string
    latestName?: string
    latestChat?: number
}

export type CharacterTokenCache = {
    otherName: string
    description_length: number
    examples_length: number
    personality_length: number
    scenario_length: number
}

type CharacterCardState = {
    card?: CharacterCardData
    tokenCache: CharacterTokenCache | undefined
    id: number | undefined
    updateCard: (card: CharacterCardData) => void
    setCard: (id: number) => Promise<string | undefined>
    unloadCard: () => void
    getImage: () => string
    updateImage: (sourceURI: string) => void
    getCache: (otherName: string) => Promise<CharacterTokenCache>
}

export type CharacterCardData = Awaited<ReturnType<typeof Characters.db.query.cardQuery>>

const CHARACTER_CARD_TEXT_CHUNK_KEYWORDS = [
    'Description', // AI bot base description
    'Comment', // incorrect migration, needs to be retained
    'character_card',
    'chara',
    'ccv3',
]

export namespace Characters {
    export const useUserStore = create<CharacterCardState>()(
        persist(
            (set, get) => ({
                id: undefined,
                card: undefined,
                tokenCache: undefined,
                setCard: async (id: number) => {
                    const card = await db.query.card(id)
                    if (card) set({ card: card, id: id, tokenCache: undefined })
                    return card?.name
                },
                unloadCard: () => {
                    set({
                        id: undefined,
                        card: undefined,
                        tokenCache: undefined,
                    })
                },
                updateCard: (card: CharacterCardData) => {
                    set({ card })
                },
                getImage: () => {
                    return getImageDir(get().card?.image_id ?? 0)
                },
                updateImage: async (sourceURI: string) => {
                    await runCharacterMediaUpdate(async () => {
                        const id = get().id
                        const oldImageID = get().card?.image_id
                        const card = get().card
                        if (!id || !oldImageID || !card) {
                            Logger.errorToast(i18n.t('toast.couldNotGetData'))
                            return
                        }
                        const imageID = nextImageId()
                        const copied = await copyImage(sourceURI, imageID)
                        if (!copied) {
                            Logger.errorToast(i18n.t('toast.couldNotGetData'))
                            return
                        }
                        await db.mutate.updateCardField('image_id', imageID, id)
                        set({ card: { ...card, image_id: imageID } })
                        queueDeleteImage(oldImageID)
                    })
                },
                getCache: async (userName: string) => {
                    const cache = get().tokenCache
                    if (cache && cache?.otherName === userName) return cache

                    const card = get().card
                    if (!card)
                        return {
                            otherName: userName,
                            description_length: 0,
                            examples_length: 0,
                            personality_length: 0,
                            scenario_length: 0,
                        }
                    const description = replaceMacros(card.description)
                    const examples = replaceMacros(card.mes_example)
                    const personality = replaceMacros(card.personality)
                    const scenario = replaceMacros(card.scenario)

                    const getTokenCount = Tokenizer.getTokenizer()

                    const newCache: CharacterTokenCache = {
                        otherName: userName,
                        description_length: await getTokenCount(description),
                        examples_length: await getTokenCount(examples),
                        personality_length: await getTokenCount(personality),
                        scenario_length: await getTokenCount(scenario),
                    }

                    set({ tokenCache: newCache })
                    return newCache
                },
            }),
            {
                name: Storage.UserCard,
                storage: createMMKVStorage(),
                version: 1,
                partialize: (state) => ({ id: state.id, card: state.card }),
            }
        )
    )

    export const useCharacterStore = create<CharacterCardState>()((set, get) => ({
        id: undefined,
        card: undefined,
        tokenCache: undefined,
        setCard: async (id: number) => {
            const card = await db.query.card(id)
            set({ card: card, id: id, tokenCache: undefined })
            return card?.name
        },
        updateCard: (card: CharacterCardData) => {
            set({ card })
        },
        unloadCard: () => {
            set({
                id: undefined,
                card: undefined,
                tokenCache: undefined,
            })
        },
        getImage: () => {
            return getImageDir(get().card?.image_id ?? 0)
        },
        updateImage: async (sourceURI: string) => {
            await runCharacterMediaUpdate(async () => {
                const id = get().id
                const oldImageID = get().card?.image_id
                const card = get().card
                if (!id || !oldImageID || !card) {
                    Logger.errorToast(i18n.t('toast.couldNotGetData'))
                    return
                }
                const imageID = nextImageId()
                const copied = await copyImage(sourceURI, imageID)
                if (!copied) {
                    Logger.errorToast(i18n.t('toast.couldNotGetData'))
                    return
                }
                await db.mutate.updateCardField('image_id', imageID, id)
                set({ card: { ...card, image_id: imageID } })
                queueDeleteImage(oldImageID)
            })
        },
        getCache: async (charName: string) => {
            const cache = get().tokenCache
            const card = get().card
            if (cache?.otherName && cache.otherName === useUserStore.getState().card?.name)
                return cache

            if (!card)
                return {
                    otherName: charName,
                    description_length: 0,
                    examples_length: 0,
                    personality_length: 0,
                    scenario_length: 0,
                }
            const description = replaceMacros(card.description)
            const examples = replaceMacros(card.mes_example)
            const personality = replaceMacros(card.personality)
            const scenario = replaceMacros(card.scenario)

            const getTokenCount = Tokenizer.getTokenizer()

            const newCache = {
                otherName: charName,
                description_length: await getTokenCount(description),
                examples_length: await getTokenCount(examples),
                personality_length: await getTokenCount(personality),
                scenario_length: await getTokenCount(scenario),
            }
            set({ tokenCache: newCache })
            return newCache
        },
    }))

    export namespace db {
        export namespace query {
            export const cardQuery = (charId: number) => {
                return database.query.characters.findFirst({
                    where: eq(characters.id, charId),
                    with: {
                        tags: {
                            columns: {
                                character_id: false,
                            },
                            with: {
                                tag: true,
                            },
                        },
                        alternate_greetings: true,
                    },
                })
            }

            export const card = async (charId: number): Promise<CharacterCardData | undefined> => {
                const data = await cardQuery(charId)
                return data
            }

            export const cardList = async (
                type: 'character' | 'user',
                orderBy: 'id' | 'modified' = 'id'
            ) => {
                const query = await database.query.characters.findMany({
                    columns: {
                        id: true,
                        name: true,
                        image_id: true,
                        last_modified: true,
                    },
                    with: {
                        tags: {
                            columns: {
                                character_id: false,
                            },
                            with: {
                                tag: true,
                            },
                        },
                        chats: {
                            columns: {
                                id: true,
                            },
                            limit: 1,
                            orderBy: desc(chats.last_modified),
                            with: {
                                messages: {
                                    columns: {
                                        id: true,
                                        name: true,
                                    },
                                    limit: 1,
                                    orderBy: desc(chatEntries.id),
                                    with: {
                                        swipes: {
                                            columns: {
                                                swipe: true,
                                            },
                                            orderBy: desc(chatSwipes.id),
                                            limit: 1,
                                        },
                                    },
                                },
                            },
                        },
                    },
                    where: (characters, { eq }) => eq(characters.type, type),
                    orderBy: orderBy === 'id' ? characters.id : desc(characters.last_modified),
                })

                return query.map((item) => ({
                    ...item,
                    latestChat: item.chats[0]?.id,
                    latestSwipe: item.chats[0]?.messages[0]?.swipes[0]?.swipe,
                    latestName: item.chats[0]?.messages[0]?.name,
                    last_modified: item.last_modified ?? 0,
                    tags: item.tags.map((item) => item.tag.tag),
                }))
            }

            export const cardListQuery = (
                type: 'character' | 'user',
                orderBy: 'id' | 'modified' = 'id'
            ) => {
                return database.query.characters.findMany({
                    columns: {
                        id: true,
                        name: true,
                        image_id: true,
                        last_modified: true,
                    },
                    with: {
                        tags: {
                            columns: {
                                character_id: false,
                            },
                            with: {
                                tag: true,
                            },
                        },
                        chats: {
                            columns: {
                                id: true,
                            },
                            limit: 1,
                            orderBy: desc(chats.last_modified),
                            with: {
                                messages: {
                                    columns: {
                                        id: true,
                                        name: true,
                                    },
                                    limit: 1,
                                    orderBy: desc(chatEntries.id),
                                    with: {
                                        swipes: {
                                            columns: {
                                                swipe: true,
                                            },
                                            orderBy: desc(chatSwipes.id),
                                            limit: 1,
                                        },
                                    },
                                },
                            },
                        },
                    },
                    where: (characters, { eq }) => eq(characters.type, type),
                    orderBy: orderBy === 'id' ? characters.id : desc(characters.last_modified),
                })
            }

            export const charactersWithSummary = () => {
                return database.query.characters.findMany({
                    columns: {
                        id: true,
                        name: true,
                        image_id: true,
                        last_modified: true,
                    },
                    with: {
                        chats: {
                            columns: {
                                id: true,
                            },
                            where: (chats, { ne }) => ne(chats.summary, ''),
                            limit: 1,
                            orderBy: desc(chats.last_modified),
                        },
                    },
                    where: (characters, { eq }) => eq(characters.type, 'character'),
                    orderBy: desc(characters.last_modified),
                })
            }

            export const cardListQueryWindow = (
                type: 'character' | 'user',
                orderBy: 'name' | 'modified' = 'modified',
                direction: 'desc' | 'asc' = 'desc',
                limit = 20,
                offset = 0,
                searchFilter: string = '',
                searchTags: string[] = []
            ) => {
                const dir = direction === 'asc' ? asc : desc
                return database.query.characters.findMany({
                    columns: {
                        id: true,
                        name: true,
                        image_id: true,
                        last_modified: true,
                        description: true,
                    },
                    where: (characters) => {
                        const base = eq(characters.type, type)
                        const search = searchFilter
                            ? like(characters.name, `%${searchFilter.trim().toLocaleLowerCase()}%`)
                            : undefined
                        const filteredTags =
                            searchTags.length > 0
                                ? gte(
                                      database
                                          .select({ count: sql<number>`count(*)` })
                                          .from(characterTags)
                                          .innerJoin(tags, eq(characterTags.tag_id, tags.id))
                                          .where(
                                              and(
                                                  eq(characterTags.character_id, characters.id),
                                                  inArray(tags.tag, searchTags)
                                              )
                                          ),
                                      searchTags.length
                                  )
                                : undefined

                        return and(base, search, filteredTags)
                    },
                    with: {
                        tags: {
                            columns: {},
                            with: {
                                tag: true,
                            },
                        },
                        chats: {
                            columns: {
                                id: true,
                            },
                            limit: 1,
                            orderBy: desc(chats.last_modified),
                            with: {
                                messages: {
                                    columns: {
                                        id: true,
                                        name: true,
                                    },
                                    limit: 1,
                                    orderBy: desc(chatEntries.id),
                                    with: {
                                        swipes: {
                                            columns: {
                                                swipe: true,
                                            },
                                            orderBy: desc(chatSwipes.id),
                                            limit: 1,
                                        },
                                    },
                                },
                            },
                        },
                    },
                    orderBy:
                        orderBy === 'name' ? dir(characters.name) : dir(characters.last_modified),
                    limit: limit,
                    offset: offset,
                })
            }

            export const cardExists = async (charId: number) => {
                return await database.query.characters.findFirst({
                    where: eq(characters.id, charId),
                })
            }

            export const backgroundImageQuery = (charId: number) => {
                return database.query.characters.findFirst({
                    where: eq(characters.id, charId),
                    columns: { background_image: true },
                })
            }
        }

        export namespace mutate {
            export const createCard = async (
                name: string,
                type: 'user' | 'character' = 'character'
            ) => {
                const { data } = createBlankV2Card(name)

                const [{ id }] = await database
                    .insert(characters)
                    .values({ ...data, type: type })
                    .returning({ id: characters.id })
                return id
            }

            export const updateCard = async (card: CharacterCardData, cardID: number) => {
                if (!card) return

                try {
                    await database
                        .update(characters)
                        .set({
                            description: card.description,
                            first_mes: card.first_mes,
                            name: card.name,
                            personality: card.personality,
                            scenario: card.scenario,
                            mes_example: card.mes_example,
                        })
                        .where(eq(characters.id, cardID))
                    await Promise.all(
                        card.alternate_greetings.map(async (item) => {
                            await database
                                .update(characterGreetings)
                                .set({ greeting: item.greeting })
                                .where(eq(characterGreetings.id, item.id))
                        })
                    )
                    if (card.tags) {
                        // create { tag: string }[]
                        const newTags = card.tags
                            .filter((item) => item.tag_id === -1)
                            .map((tag) => ({ tag: tag.tag.tag }))

                        // New tags are marked with -1
                        const currentTagIDs = card.tags
                            .filter((item) => item.tag_id !== -1)
                            .map((item) => ({
                                character_id: card.id,
                                tag_id: item.tag.id,
                            }))
                        const newTagIDs: (typeof characterTags.$inferSelect)[] = []

                        // optimistically add missing tags
                        if (newTags.length !== 0) {
                            await database
                                .insert(tags)
                                .values(newTags)
                                .onConflictDoNothing()
                                .returning({
                                    id: tags.id,
                                })
                                // concat new tags to tagids
                                .then((result) => {
                                    newTagIDs.push(
                                        ...result.map((item) => ({
                                            character_id: card.id,
                                            tag_id: item.id,
                                        }))
                                    )
                                })
                        }
                        const mergedTags = [...currentTagIDs, ...newTagIDs]
                        if (mergedTags.length !== 0)
                            await database
                                .insert(characterTags)
                                .values(mergedTags)
                                .onConflictDoNothing()

                        const ids = mergedTags.map((item) => item.tag_id)
                        // delete orphaned characterTags

                        await database
                            .delete(characterTags)
                            .where(
                                and(
                                    notInArray(characterTags.tag_id, ids),
                                    eq(characterTags.character_id, card.id)
                                )
                            )

                        // delete orphaned tags
                        await database
                            .delete(tags)
                            .where(
                                notInArray(
                                    tags.id,
                                    database
                                        .select({ tag_id: characterTags.tag_id })
                                        .from(characterTags)
                                )
                            )
                    }
                } catch (e) {
                    Logger.warn(`${e}`)
                }
            }

            export const addAltGreeting = async (charId: number) => {
                const [{ id }] = await database
                    .insert(characterGreetings)
                    .values({
                        character_id: charId,
                        greeting: '',
                    })
                    .returning({ id: characterGreetings.id })
                return id
            }

            export const deleteAltGreeting = async (altGreetingId: number) => {
                await database
                    .delete(characterGreetings)
                    .where(eq(characterGreetings.id, altGreetingId))
            }

            // TODO: Proper per field updates, though not that expensive
            export const updateCardField = async (
                field: keyof NonNullable<CharacterCardData>,
                data: any,
                charId: number
            ) => {
                if (field === 'alternate_greetings') {
                    // find greetings and update
                    Logger.warn('ALT GREETINGS MODIFICATION NOT IMPLEMENTED')
                    return
                }
                await database
                    .update(characters)
                    .set({ [field]: data })
                    .where(eq(characters.id, charId))
            }

            export const deleteCard = async (charID: number) => {
                const data = await database.query.characters.findFirst({
                    where: eq(characters.id, charID),
                    columns: { image_id: true, background_image: true },
                })
                if (data?.image_id) deleteImage(data.image_id)
                if (data?.background_image) deleteImage(data.background_image)
                deleteMouthSprites(charID)

                await database.delete(characters).where(eq(characters.id, charID))
                await database
                    .delete(tags)
                    .where(
                        notInArray(
                            tags.id,
                            database.select({ tag_id: characterTags.tag_id }).from(characterTags)
                        )
                    )
            }

            export const updateModified = async (charID: number) => {
                await database
                    .update(characters)
                    .set({ last_modified: Date.now() })
                    .where(eq(characters.id, charID))
            }

            export const createCharacter = async (card: CharacterCardV2, imageuri: string = '') => {
                const { data } = card
                const image_id = await database.transaction(async (tx) => {
                    try {
                        const [{ id, image_id }] = await tx
                            .insert(characters)
                            .values({
                                type: 'character',
                                ...data,
                            })
                            .returning({ id: characters.id, image_id: characters.image_id })

                        const greetingdata =
                            typeof data?.alternate_greetings === 'object'
                                ? (data?.alternate_greetings?.map((item) => ({
                                      character_id: id,
                                      greeting: item,
                                  })) ?? [])
                                : []
                        if (greetingdata.length > 0)
                            for (const greeting of greetingdata)
                                await tx.insert(characterGreetings).values(greeting)

                        if (data.tags && data?.tags?.length !== 0) {
                            const tagsdata = data.tags.map((tag) => ({ tag: tag }))
                            for (const tag of tagsdata)
                                await tx.insert(tags).values(tag).onConflictDoNothing()

                            const tagids = (
                                await tx.query.tags.findMany({
                                    where: inArray(tags.tag, data.tags),
                                })
                            ).map((item) => ({
                                character_id: id,
                                tag_id: item.id,
                            }))
                            await tx.insert(characterTags).values(tagids).onConflictDoNothing()
                        }
                        return image_id
                    } catch (error) {
                        Logger.errorToast(i18n.t('toast.rollbackError', { error }))
                        tx.rollback()
                        return undefined
                    }
                })
                if (image_id && imageuri) await copyImage(imageuri, image_id)
            }

            export const duplicateCard = async (charId: number) => {
                const card = await db.query.card(charId)

                if (!card) {
                    Logger.errorToast(i18n.t('toast.cardDoesNotExist'))
                    return
                }
                const imageDir = getImageDir(card.image_id)
                const imageCacheDir = `${Paths.cache.uri}${card.image_id}`
                let cacheLoc = ''

                if (fileExists(imageDir)) {
                    cacheLoc = imageCacheDir
                    copyFile({
                        from: imageDir,
                        to: cacheLoc,
                    })
                }

                const now = Date.now()
                card.last_modified = now
                card.image_id = now
                if (card.background_image) {
                    const backgroundId = Date.now()
                    await copyFile({
                        from: getImageDir(card.background_image),
                        to: getImageDir(backgroundId),
                    })
                    card.background_image = backgroundId
                }
                const cv2 = convertDBDataToCV2(card)
                if (!cv2) {
                    Logger.errorToast(i18n.t('toast.failedCopyCard'))
                    return
                }
                await createCharacter(cv2, cacheLoc)
                    .then(() => Logger.info(`Card cloned: ${card.name}`))
                    .catch((e) => Logger.info(`Failed to clone card: ${e}`))
            }

            export const updateBackground = async (charId: number, imageURI: number) => {
                await database
                    .update(characters)
                    .set({ background_image: imageURI })
                    .where(eq(characters.id, charId))
            }

            export const deleteBackground = async (charId: number) => {
                await database
                    .update(characters)
                    .set({ background_image: null })
                    .where(eq(characters.id, charId))
            }
        }
    }

    export const importBackground = async (charId: number, oldBackground?: number | null) => {
        try {
            const result = await DocumentPicker.getDocumentAsync({
                copyToCacheDirectory: true,
                type: ['image/*', 'application/json'],
            })
            if (result.canceled) return
            const dir = result.assets[0].uri
            if (!dir) return
            await runCharacterMediaUpdate(async () => {
                const imageId = nextImageId()
                // Keep the old file until chat UI can leave the URI (chat freezes
                // media while Character Editor is focused on top).
                const copied = await copyImage(dir, imageId)
                if (!copied) return
                await db.mutate.updateBackground(charId, imageId)
                if (oldBackground) {
                    queueDeleteImage(oldBackground)
                }
            })
        } catch (e) {
            Logger.error(`Failed to import background`)
            Logger.error(`Error: ` + e)
        }
    }

    export const deleteBackground = async (charId: number, imageId: number) => {
        try {
            await db.mutate.deleteBackground(charId)
            queueDeleteImage(imageId)
            Logger.info(`Deleted image with id: ` + imageId)
        } catch (e) {
            Logger.errorToast(i18n.t('toast.failedDeleteBackground'))
            Logger.error(`Error: ` + e)
        }
    }

    // Portrait + background share characters/*.png named by numeric id. Date.now()
    // alone can collide when both are changed back-to-back.
    let imageIdSeq = 0
    const nextImageId = () => {
        imageIdSeq = (imageIdSeq + 1) % 1000
        return Date.now() * 1000 + imageIdSeq
    }

    // Serialize portrait/background replaces so copies and DB writes do not overlap.
    let mediaUpdateChain: Promise<void> = Promise.resolve()
    const runCharacterMediaUpdate = async <T>(fn: () => Promise<T>): Promise<T> => {
        const run = mediaUpdateChain.then(fn, fn)
        mediaUpdateChain = run.then(
            () => undefined,
            () => undefined
        )
        return run
    }

    let pendingImageDeletes: number[] = []

    const queueDeleteImage = (imageID: number) => {
        if (!pendingImageDeletes.includes(imageID)) {
            pendingImageDeletes.push(imageID)
        }
    }

    /**
     * Delete replaced character/background files after chat Image views have
     * switched off those URIs (call when ChatScreen is focused again, or when
     * leaving the editor without an active chat).
     */
    export const flushPendingImageDeletes = (delayMs = 500) => {
        if (pendingImageDeletes.length === 0) return
        const ids = pendingImageDeletes
        pendingImageDeletes = []
        setTimeout(() => {
            for (const id of ids) {
                void deleteImage(id)
            }
        }, delayMs)
    }

    export const deleteImage = async (imageID: number) => {
        await deleteFile(getImageDir(imageID))
    }

    export const copyImage = async (uri: string, imageID: number) => {
        return await copyFile({
            from: uri,
            to: getImageDir(imageID),
        })
    }

    export const convertDBDataToCV2 = (data: NonNullable<CharacterCardData>): CharacterCardV2 => {
        const { id, ...rest } = data
        return {
            spec: 'chara_card_v2',
            spec_version: '2.0',
            data: {
                ...rest,
                tags: rest.tags.map((item) => item.tag.tag),
                alternate_greetings: rest.alternate_greetings.map((item) => item.greeting),
            },
        }
    }

    export const createCharacterFromImage = async (uri: string) => {
        try {
            const file = await readBase64Async(uri)
            if (!file) {
                Logger.errorToast(i18n.t('toast.failedCreateCardImage'))
                return
            }
            const [result] = extractPngTextChunk(file, {
                keywords: CHARACTER_CARD_TEXT_CHUNK_KEYWORDS,
            })

            if (!result?.data) {
                Logger.errorToast(i18n.t('toast.noCharacterFound'))
                return
            }

            const card = JSON.parse(result.data)
            if (card === undefined) {
                Logger.errorToast(i18n.t('toast.noCharacterFound'))
                return
            }

            await createCharacterFromV2JSON(card, uri)
        } catch (e) {
            Logger.errorToast(i18n.t('toast.failedCreateCharacter'))
            Logger.error(`${e}`)
        }
    }

    const createCharacterFromV1JSON = async (data: any, uri: string | undefined = undefined) => {
        const result = characterCardV1Schema.safeParse(data)
        if (result.error) {
            Logger.errorToast(i18n.t('toast.invalidCharacterCard'))
            return
        }
        const converted = createBlankV2Card(result.data.name, result.data)

        Logger.info(`Creating new character: ${result.data.name}`)
        return db.mutate.createCharacter(converted, uri)
    }

    const createCharacterFromV2JSON = async (data: any, uri: string | undefined = undefined) => {
        const normalized = normalizeImportedCharacterCard(data)
        // check JSON def
        const result = characterCardV2Schema.safeParse(normalized)
        if (result.error) {
            Logger.warnToast(i18n.t('toast.v2ParseFallback'))
            return await createCharacterFromV1JSON(data, uri)
        }

        Logger.info(`Creating new character: ${result.data.data.name}`)
        return await db.mutate.createCharacter(result.data, uri)
    }

    export const importCharacter = async () => {
        const result = await DocumentPicker.getDocumentAsync({
            copyToCacheDirectory: true,
            type: ['image/*', 'application/json'],
            multiple: true,
        })
        if (result.canceled) return
        result.assets.map(async (item) => {
            const isPNG = item.mimeType?.includes('image/')
            const isJSON = item.mimeType?.includes('application/json')
            try {
                if (isJSON) {
                    const data = await readStringAsync(item.uri)
                    await createCharacterFromV2JSON(JSON.parse(data))
                }

                if (isPNG) await createCharacterFromImage(item.uri)
            } catch (e) {
                Logger.error(`Failed to create card from '${item.name}': ${e}`)
            }
        })
    }

    export const exportCharacter = async (id: number) => {
        const dbcard = await db.query.card(id)
        if (!dbcard) {
            Logger.error('Exported card does not exist!')
            return
        }
        // name can be empty string, should at least have something
        const exportedFileName = sanitizeExportFilename(dbcard.name ?? 'Character')
        const cardV2 = convertDBDataToCV2(dbcard)

        const imagePath = getImageDir(dbcard.image_id)
        if (fileExists(imagePath)) {
            const fileData = await readBase64Async(imagePath)
            if (!fileData) return
            const exportData = buildExportedCharacterPng(fileData, cardV2)
            await saveStringToDownload(exportData, exportedFileName + '.png', 'base64')
        } else {
            await saveStringToDownload(JSON.stringify(cardV2), exportedFileName + '.json', 'utf8')
        }
    }

    export const getImageDir = (imageId: number) => {
        return `${Paths.document.uri}characters/${imageId}.png`
    }

    export const createDefaultCard = async () => {
        // Card data is bundled as JSON because Android PNG crunching strips tEXt
        // character-card chunks from required image assets on device builds.
        const defaultCards = [
            {
                filename: 'EnglishSample.png',
                asset: require('./../../assets/characters/EnglishSample.png'),
                card: require('./../../assets/characters/EnglishSample.json'),
            },
            {
                filename: 'JapaneseSample.png',
                asset: require('./../../assets/characters/JapaneseSample.png'),
                card: require('./../../assets/characters/JapaneseSample.json'),
            },
            {
                filename: 'ChineseSample.png',
                asset: require('./../../assets/characters/ChineseSample.png'),
                card: require('./../../assets/characters/ChineseSample.json'),
            },
        ] as const

        for (const card of defaultCards) {
            const cardDefaultDir = `${Paths.document.uri}appAssets/${card.filename}`
            try {
                Logger.info(`Importing default card: ${card.filename}`)
                // Always refresh appAssets from the bundled asset so regenerate
                // does not keep a stale portrait from a previous install.
                const localUri = await resolveBundledAssetFileUri(card.asset)
                if (!localUri) {
                    throw new Error(`Missing local URI for ${card.filename}`)
                }
                if (fileExists(cardDefaultDir)) {
                    deleteFile(cardDefaultDir)
                }
                const copied = await copyFile({ from: localUri, to: cardDefaultDir })
                if (!copied || !fileExists(cardDefaultDir)) {
                    throw new Error(`Failed to copy ${card.filename} into appAssets`)
                }
                await createCharacterFromV2JSON(card.card, cardDefaultDir)
            } catch (e) {
                Logger.errorToast(i18n.t('toast.failedCreateDefaultCharacter'))
                Logger.error(`Error creating default card ${card.filename}: ` + e)
            }
        }
    }

    export const useCharacterUpdater = () => {
        const { id, updateCard } = useCharacterStore((state) => ({
            id: state.id,
            updateCard: state.updateCard,
        }))

        const { data } = useLiveQuery(db.query.cardQuery(id ?? -1))

        useEffect(() => {
            if (id && id === data?.id) {
                if (data) updateCard(data)
            }
        }, [data, id, updateCard])
    }
}

const characterCardV1Schema = z.object({
    name: z.string(),
    description: z.string(),
    personality: z.string().catch(''),
    scenario: z.string().catch(''),
    first_mes: z.string().catch(''),
    mes_example: z.string().catch(''),
})

const characterCardV2DataSchema = z.object({
    name: z.string(),
    description: z.string().catch(''),
    personality: z.string().catch(''),
    scenario: z.string().catch(''),
    first_mes: z.string().catch(''),
    mes_example: z.string().catch(''),

    creator_notes: z.string().catch(''),
    system_prompt: z.string().catch(''),
    post_history_instructions: z.string().catch(''),
    creator: z.string().catch(''),
    character_version: z.string().catch(''),
    alternate_greetings: z.string().array().catch([]),
    tags: z.string().array().catch([]),
})

const characterCardV2Schema = z.object({
    spec: z.literal('chara_card_v2'),
    spec_version: z.literal('2.0'),
    data: characterCardV2DataSchema,
})

// placeholder types
// type CharaterCardV1 = z.infer<typeof characterCardV1Schema>
// type CharacterCardV2Data = z.infer<typeof characterCardV2DataSchema>

type CharacterCardV2 = z.infer<typeof characterCardV2Schema>

const sanitizeExportFilename = (name: string) => name.replace(/[\\/:*?"<>|]/g, '_').trim() || 'Character'

/** SillyTavern decodes every tEXt chunk; remove all before writing chara + ccv3 (ST-compatible). */
const buildExportedCharacterPng = (fileDataBase64: string, card: CharacterCardV2): string => {
    const cardString = JSON.stringify(card)
    const v3String = JSON.stringify({
        ...card,
        spec: 'chara_card_v3',
        spec_version: '3.0',
    })

    const removeKeywords = new Set<string>(CHARACTER_CARD_TEXT_CHUNK_KEYWORDS)
    try {
        for (const chunk of extractPngTextChunk(fileDataBase64, { decodeBase64: false })) {
            removeKeywords.add(chunk.keyword)
        }
    } catch (e) {
        Logger.warn(`PNG export: could not list existing tEXt chunks: ${e}`)
    }

    return replacePngTextChunk(
        fileDataBase64,
        [
            { data: cardString, keyword: 'chara', b64encode: true },
            { data: v3String, keyword: 'ccv3', b64encode: true },
        ],
        { removeKeywords: [...removeKeywords] }
    )
}

/** Map CharCard v3 PNG/JSON payloads to v2 for DB import (unknown v3 fields are dropped by zod). */
const normalizeImportedCharacterCard = (raw: unknown): unknown => {
    if (!raw || typeof raw !== 'object') return raw
    const card = raw as { spec?: string; spec_version?: string; data?: unknown }
    if (card.spec === 'chara_card_v3' && card.data && typeof card.data === 'object') {
        return {
            spec: 'chara_card_v2',
            spec_version: '2.0',
            data: card.data,
        }
    }
    return raw
}

const createBlankV2Card = (
    name: string,
    options: {
        description: string
        personality: string
        scenario: string
        first_mes: string
        mes_example: string
    } = { description: '', personality: '', scenario: '', first_mes: '', mes_example: '' }
): CharacterCardV2 => {
    return {
        spec: 'chara_card_v2',
        spec_version: '2.0',
        data: {
            name: name,
            description: options.description,
            personality: options.personality,
            scenario: options.scenario,
            first_mes: options.first_mes,
            mes_example: options.mes_example,

            // New fields start here
            creator_notes: '',
            system_prompt: '',
            post_history_instructions: '',
            alternate_greetings: [],

            // May 8th additions
            tags: [],
            creator: '',
            character_version: '',
        },
    }
}

type Macro = {
    macro: string
    value: string
}

export const replaceMacros = (text: string) => {
    if (text === undefined) return ''
    let newText: string = text
    const charName = Characters.useCharacterStore.getState().card?.name ?? ''
    const userName = Characters.useUserStore.getState().card?.name ?? ''
    const rules: Macro[] = [
        { macro: '{{user}}', value: userName },
        { macro: '{{char}}', value: charName },
    ]
    newText = replaceMacroBase(newText, { extraMacros: rules })
    return newText
}
