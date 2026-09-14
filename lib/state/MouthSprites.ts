import { create } from 'zustand'
import { persist } from 'zustand/middleware'

import { Storage } from '@lib/enums/Storage'
import { createMMKVStorage } from '@lib/storage/MMKV'
import { AppDirectory, copyFile, deleteFile, makeDirectory } from '@lib/utils/File'

export const MOUTH_SLOTS = ['closed', 'half', 'open'] as const
export type MouthSlot = (typeof MOUTH_SLOTS)[number]
/** File URIs of one character's frames. */
export type MouthSpriteSet = Record<MouthSlot, string>

const MOUTH_SPRITE_DIR = `${AppDirectory.CharacterPath}mouth/`

interface MouthSpriteState {
    enabled: boolean
    /** Bound frames keyed by character id. */
    bindings: Record<string, MouthSpriteSet>
    setEnabled: (enabled: boolean) => void
}

export const useMouthSprites = create<MouthSpriteState>()(
    persist(
        (set) => ({
            enabled: false,
            bindings: {},
            setEnabled: (enabled) => set({ enabled: enabled }),
        }),
        {
            name: Storage.MouthSprites,
            storage: createMMKVStorage(),
            version: 1,
            partialize: (state) => ({ enabled: state.enabled, bindings: state.bindings }),
        }
    )
)

export const isCompleteSpriteSet = (
    frames: Partial<MouthSpriteSet> | undefined
): frames is MouthSpriteSet => !!frames && MOUTH_SLOTS.every((slot) => !!frames[slot])

/** The frames to animate for a character, or undefined when image lip sync should not run. */
export const useActiveMouthSprites = (characterId: number | undefined) =>
    useMouthSprites((state) =>
        state.enabled && characterId !== undefined ? state.bindings[characterId] : undefined
    )

/** Copies reviewed frames into app storage and binds them, replacing any earlier ones. */
export const saveMouthSprites = async (characterId: number, frames: MouthSpriteSet) => {
    await makeDirectory(MOUTH_SPRITE_DIR)
    const previous = useMouthSprites.getState().bindings[characterId]
    const stamp = Date.now()
    const saved = { ...frames }

    for (const slot of MOUTH_SLOTS) {
        // Frames that were already bound are in place and need no copy.
        if (previous?.[slot] === frames[slot]) continue
        const extension = /\.(png|jpe?g|webp)$/i.exec(frames[slot])?.[0] ?? '.png'
        // A new name per save keeps image caches from showing the old frame.
        const target = `${MOUTH_SPRITE_DIR}${characterId}-${slot}-${stamp}${extension}`
        if (!(await copyFile({ from: frames[slot], to: target }))) {
            throw new Error(`Could not store the ${slot} frame`)
        }
        saved[slot] = target
    }

    useMouthSprites.setState((state) => ({
        bindings: { ...state.bindings, [characterId]: saved },
    }))
    for (const slot of MOUTH_SLOTS) {
        if (previous?.[slot] && previous[slot] !== saved[slot]) deleteFile(previous[slot])
    }
    return saved
}

/** Removes a character's frames, both the files and the binding. */
export const deleteMouthSprites = (characterId: number) => {
    const frames = useMouthSprites.getState().bindings[characterId]
    if (!frames) return
    MOUTH_SLOTS.forEach((slot) => deleteFile(frames[slot]))
    useMouthSprites.setState((state) => {
        const bindings = { ...state.bindings }
        delete bindings[characterId]
        return { bindings: bindings }
    })
}
