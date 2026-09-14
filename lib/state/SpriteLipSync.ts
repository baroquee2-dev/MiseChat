import { getDocumentAsync } from 'expo-document-picker'
import { create } from 'zustand'
import { persist } from 'zustand/middleware'

import { Storage } from '@lib/enums/Storage'
import { createMMKVStorage } from '@lib/storage/MMKV'
import { AppDirectory, copyFile, deleteFile } from '@lib/utils/File'

import { Logger } from './Logger'

export type MouthSlot = 'closed' | 'half' | 'open'

type SpriteLipSyncState = {
    /** File names inside the app assets directory, empty until picked. */
    images: Record<MouthSlot, string>
    character: string
    halfThreshold: number
    openThreshold: number
    pickImage: (slot: MouthSlot) => Promise<void>
    setCharacter: (character: string) => void
    setHalfThreshold: (value: number) => void
    setOpenThreshold: (value: number) => void
}

export const spriteImageUri = (name: string) => (name ? AppDirectory.Assets + name : '')

/** Settings for the mouth sprite test page. */
export const useSpriteLipSync = create<SpriteLipSyncState>()(
    persist(
        (set, get) => ({
            images: { closed: '', half: '', open: '' },
            character: '',
            // Speech RMS mostly sits around 0.05–0.2, so the defaults start inside that range.
            halfThreshold: 0.03,
            openThreshold: 0.09,
            pickImage: async (slot) => {
                try {
                    const result = await getDocumentAsync({
                        copyToCacheDirectory: true,
                        type: 'image/*',
                    })
                    if (result.canceled) return
                    const asset = result.assets[0]
                    const extension = /\.[a-z0-9]+$/i.exec(asset.name)?.[0] ?? '.png'
                    // A fresh name per pick keeps the image cache from showing the old picture.
                    const name = `sprite-${slot}-${Date.now()}${extension}`
                    const copied = await copyFile({
                        from: asset.uri,
                        to: AppDirectory.Assets + name,
                    })
                    if (!copied) return
                    const previous = get().images[slot]
                    if (previous) deleteFile(AppDirectory.Assets + previous)
                    set({ images: { ...get().images, [slot]: name } })
                } catch (error) {
                    Logger.error(`Failed to import mouth image: ${error}`)
                }
            },
            setCharacter: (character) => set({ character: character }),
            setHalfThreshold: (value) =>
                set({ halfThreshold: Math.min(value, get().openThreshold) }),
            setOpenThreshold: (value) =>
                set({ openThreshold: Math.max(value, get().halfThreshold) }),
        }),
        {
            name: Storage.SpriteLipSync,
            storage: createMMKVStorage(),
            version: 1,
            partialize: (state) => ({
                images: state.images,
                character: state.character,
                halfThreshold: state.halfThreshold,
                openThreshold: state.openThreshold,
            }),
        }
    )
)
