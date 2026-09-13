import { create } from 'zustand'
import { persist } from 'zustand/middleware'

import { Storage } from '@lib/enums/Storage'
import { createMMKVStorage } from '@lib/storage/MMKV'

interface LipSyncSettingsState {
    enabled: boolean
    apiKey: string
    dailyUrl: string
    dailyApiKey: string
    /** Minted from dailyApiKey; kept so a working token survives a restart. */
    dailyToken: string
    setEnabled: (enabled: boolean) => void
    setApiKey: (apiKey: string) => void
    setDailyUrl: (dailyUrl: string) => void
    setDailyApiKey: (dailyApiKey: string) => void
    setDailyToken: (dailyToken: string) => void
}

export const useLipSyncSettings = create<LipSyncSettingsState>()(
    persist(
        (set) => ({
            enabled: false,
            apiKey: '',
            dailyUrl: '',
            dailyApiKey: '',
            dailyToken: '',
            setEnabled: (enabled) => set({ enabled: enabled }),
            setApiKey: (apiKey) => set({ apiKey: apiKey }),
            // A meeting token is scoped to one room and one Daily account.
            setDailyUrl: (dailyUrl) => set({ dailyUrl: dailyUrl, dailyToken: '' }),
            setDailyApiKey: (dailyApiKey) => set({ dailyApiKey: dailyApiKey, dailyToken: '' }),
            setDailyToken: (dailyToken) => set({ dailyToken: dailyToken }),
        }),
        {
            name: Storage.LemonSlice,
            storage: createMMKVStorage(),
            version: 2,
            // v1 belonged to the standalone chat test page; its image and prompt
            // fields are simply no longer persisted.
            migrate: (persisted) => persisted as LipSyncSettingsState,
            partialize: (state) => ({
                enabled: state.enabled,
                apiKey: state.apiKey,
                dailyUrl: state.dailyUrl,
                dailyApiKey: state.dailyApiKey,
                dailyToken: state.dailyToken,
            }),
        }
    )
)

export type LipSyncConnection = 'idle' | 'connecting' | 'connected' | 'error'

interface LipSyncSessionState {
    connection: LipSyncConnection
    viewerToken: string
    dailyUrl: string
    connectedAt: number | null
    lastActivity: number
    /** Animated portraits currently on screen. Nothing plays the avatar's audio without one. */
    viewers: number
    markActivity: () => void
}

export const useLipSyncSession = create<LipSyncSessionState>()((set, get) => ({
    connection: 'idle',
    viewerToken: '',
    dailyUrl: '',
    connectedAt: null,
    lastActivity: 0,
    viewers: 0,
    markActivity: () => {
        if (get().connection !== 'connected') return
        const now = Date.now()
        // Typing calls this per keystroke; one-second resolution is plenty for the idle timeout.
        if (now - get().lastActivity < 1000) return
        set({ lastActivity: now })
    },
}))

/** True when the avatar will voice replies itself, so regular TTS must stay quiet. */
export const isLipSyncVoicing = () => {
    const session = useLipSyncSession.getState()
    return (
        useLipSyncSettings.getState().enabled &&
        session.connection === 'connected' &&
        session.viewers > 0
    )
}
