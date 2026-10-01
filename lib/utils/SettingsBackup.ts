import { Storage } from '@lib/enums/Storage'
import { mmkv } from '@lib/storage/MMKV'

/** Every MMKV entry worth carrying between installs, keyed exactly as stored. */
export type SettingsSnapshot = Record<string, string | number | boolean>

/**
 * Logs and the cached model catalogue rebuild themselves, and mouth sprite bindings
 * travel with the characters they belong to.
 */
const SKIPPED_KEYS: string[] = [Storage.Logs, Storage.LiteLLMModels, Storage.MouthSprites]

/** Secret fields inside each persisted store, relative to the zustand `state` object. */
const SECRET_FIELDS: Record<string, string[]> = {
    [Storage.TTS]: ['elevenLabsApiKey', 'cartesiaApiKey'],
    [Storage.LemonSlice]: ['apiKey', 'dailyApiKey', 'dailyToken'],
}

type PersistedState = { state?: Record<string, any> }

const parsePersisted = (value: string): PersistedState | undefined => {
    try {
        const parsed = JSON.parse(value)
        return parsed && typeof parsed === 'object' ? parsed : undefined
    } catch {
        return undefined
    }
}

/**
 * Blanks out API keys so a backup can be shared without handing over credentials.
 * They are blanked rather than dropped, since a connection with no key at all would
 * reach the provider as the literal string "undefined".
 */
const stripSecrets = (key: string, value: string) => {
    const fields = SECRET_FIELDS[key]
    if (!fields && key !== Storage.API) return value

    const parsed = parsePersisted(value)
    if (!parsed?.state) return value
    const state = parsed.state

    fields?.forEach((field) => {
        if (field in state) state[field] = ''
    })
    if (key === Storage.API && Array.isArray(state.values)) {
        state.values = state.values.map((entry: Record<string, any>) => ({ ...entry, key: '' }))
    }
    return JSON.stringify(parsed)
}

/** Reads every stored setting; `includeKeys` decides whether API keys travel with it. */
export const collectSettings = (includeKeys: boolean): SettingsSnapshot => {
    const snapshot: SettingsSnapshot = {}
    for (const key of mmkv.getAllKeys()) {
        if (SKIPPED_KEYS.includes(key)) continue

        const text = mmkv.getString(key)
        if (text !== undefined) {
            snapshot[key] = includeKeys ? text : stripSecrets(key, text)
            continue
        }
        const flag = mmkv.getBoolean(key)
        if (flag !== undefined) {
            snapshot[key] = flag
            continue
        }
        const num = mmkv.getNumber(key)
        if (num !== undefined) snapshot[key] = num
    }
    return snapshot
}

/** Drops every setting this backup format owns, so a restore replaces rather than merges. */
export const clearSettings = () => {
    for (const key of mmkv.getAllKeys()) {
        if (SKIPPED_KEYS.includes(key)) continue
        mmkv.remove(key)
    }
}

export const restoreSettings = (snapshot: SettingsSnapshot) => {
    for (const [key, value] of Object.entries(snapshot)) {
        if (SKIPPED_KEYS.includes(key)) continue
        if (typeof value === 'string' || typeof value === 'boolean' || typeof value === 'number') {
            mmkv.set(key, value)
        }
    }
}
