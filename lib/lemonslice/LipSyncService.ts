import { AppState } from 'react-native'

import i18n from '@lib/i18n'
import { Characters } from '@lib/state/Characters'
import { Chats, useInference } from '@lib/state/Chat'
import { isLipSyncVoicing, useLipSyncSession, useLipSyncSettings } from '@lib/state/LemonSlice'
import { Logger } from '@lib/state/Logger'
import { useTTSStore } from '@lib/state/TTS'

import {
    CHUNK_BYTES,
    createSession,
    encodeBase64,
    mintDailyToken,
    prepareImageBase64,
    SAMPLE_RATE,
    synthesizePcm,
} from './LemonSliceApi'

/** LemonSlice bills wall-clock session time, so a forgotten session keeps charging. */
export const IDLE_LIMIT_MS = 50_000
export const COST_PER_MINUTE_USD = 0.164

let socket: WebSocket | null = null
let idleTimer: ReturnType<typeof setInterval> | null = null
/** Bumped by every connect and disconnect, so a slow connect can tell it was cancelled. */
let attempt = 0
/** When the current line should finish; a lost playback_finished must not pin the session open. */
let speakingUntil = 0

const log = (message: string) => Logger.info(`[lipsync] ${message}`)

const sendTerminate = (ws: WebSocket) => {
    try {
        ws.send(JSON.stringify({ command: 'terminate' }))
    } catch {
        log('could not send terminate')
    }
    try {
        ws.close()
    } catch {
        // Already closed; the terminate above is what stops billing.
    }
}

const stopIdleTimer = () => {
    if (idleTimer) clearInterval(idleTimer)
    idleTimer = null
}

const resetSession = (connection: 'idle' | 'error' = 'idle') => {
    stopIdleTimer()
    speakingUntil = 0
    useLipSyncSession.setState({ connection: connection, viewerToken: '', connectedAt: null })
}

export const disconnectLipSync = (reason: string) => {
    attempt++
    const ws = socket
    socket = null
    // A socket still connecting cannot send yet; its onopen notices the bump and terminates.
    if (ws && ws.readyState === WebSocket.OPEN) sendTerminate(ws)
    if (ws || useLipSyncSession.getState().connection !== 'idle') log(`session ended (${reason})`)
    resetSession()
}

const startIdleTimer = () => {
    stopIdleTimer()
    idleTimer = setInterval(() => {
        if (!socket) return
        // A reply still being written counts as activity, not idleness.
        if (useInference.getState().nowGenerating) return
        const quietSince = Math.max(useLipSyncSession.getState().lastActivity, speakingUntil)
        if (Date.now() - quietSince > IDLE_LIMIT_MS) {
            Logger.infoToast(
                i18n.t('lemonSlice.idleDisconnected', { seconds: IDLE_LIMIT_MS / 1000 })
            )
            disconnectLipSync('idle')
        }
    }, 1000)
}

export const connectLipSync = async () => {
    const { connection } = useLipSyncSession.getState()
    if (connection === 'connecting' || connection === 'connected') return

    const settings = useLipSyncSettings.getState()
    const { card } = Characters.useCharacterStore.getState()
    if (!settings.apiKey.trim() || !settings.dailyUrl.trim() || !settings.dailyApiKey.trim())
        throw new Error(i18n.t('lemonSlice.missingKeys'))
    if (!card) throw new Error(i18n.t('lemonSlice.noCharacter'))
    // Checked up front: a session that cannot speak would still be billed.
    if (!useTTSStore.getState().elevenLabsApiKey.trim())
        throw new Error(i18n.t('lemonSlice.missingElevenLabs'))

    const mine = ++attempt
    const dailyUrl = settings.dailyUrl.trim()
    useLipSyncSession.setState({ connection: 'connecting' })

    try {
        let token = settings.dailyToken.trim()
        if (!token) {
            token = await mintDailyToken(settings.dailyApiKey.trim(), dailyUrl)
            useLipSyncSettings.getState().setDailyToken(token)
        }
        const image = await prepareImageBase64(Characters.getImageDir(card.image_id))
        if (mine !== attempt) return

        log(`creating session for ${card.name}`)
        const created = await createSession({
            apiKey: settings.apiKey.trim(),
            dailyUrl: dailyUrl,
            dailyToken: token,
            imageBase64: image.base64,
        })

        const ws = new WebSocket(created.websocket_address)
        ws.onopen = () => {
            // Cancelled while the session was being created: end it before it bills.
            if (mine !== attempt) {
                sendTerminate(ws)
                return
            }
            const openedAt = Date.now()
            socket = ws
            useLipSyncSession.setState({
                connection: 'connected',
                viewerToken: token,
                dailyUrl: dailyUrl,
                connectedAt: openedAt,
                lastActivity: openedAt,
            })
            startIdleTimer()
            log(`session ${created.session_id} open`)
        }
        ws.onmessage = (message) => {
            if (!String(message.data).includes('playback_finished')) return
            speakingUntil = 0
            useLipSyncSession.setState({ lastActivity: Date.now() })
        }
        ws.onerror = () => log('websocket error')
        ws.onclose = () => {
            if (mine !== attempt) return
            if (socket === ws) socket = null
            const wasConnecting = useLipSyncSession.getState().connection === 'connecting'
            log(wasConnecting ? 'connection failed before opening' : 'connection closed')
            resetSession(wasConnecting ? 'error' : 'idle')
        }
    } catch (error) {
        if (mine === attempt) resetSession('error')
        throw error
    }
}

/** Roleplay replies carry actions and markup that TTS would otherwise read aloud. */
const toSpeakable = (text: string) =>
    text
        .replace(/<think>[\s\S]*?<\/think>/gi, ' ')
        .replace(/\*[^*]*\*/g, ' ')
        .replace(/[（(][^）)]*[）)]/g, ' ')
        .replace(/[`_#>~]/g, '')
        .replace(/\s+/g, ' ')
        .trim()

const speak = async (text: string) => {
    const ws = socket
    const speakable = toSpeakable(text)
    if (!ws || !speakable) return

    const tts = useTTSStore.getState()
    try {
        const pcm = await synthesizePcm({
            text: speakable,
            apiKey: tts.elevenLabsApiKey.trim(),
            voiceId: tts.elevenLabsVoiceId,
            model: tts.elevenLabsModel,
        })
        // The session may have ended while ElevenLabs was synthesising.
        if (socket !== ws || ws.readyState !== WebSocket.OPEN) return

        if (Date.now() < speakingUntil) ws.send(JSON.stringify({ command: 'interrupt' }))
        for (let offset = 0; offset < pcm.length; offset += CHUNK_BYTES) {
            ws.send(
                JSON.stringify({
                    command: 'audio',
                    audio: encodeBase64(pcm.subarray(offset, offset + CHUNK_BYTES)),
                    sampleRate: SAMPLE_RATE,
                    encoding: 'PCM16',
                })
            )
        }
        // Without audio_end the tail is dropped and the avatar freezes.
        ws.send(JSON.stringify({ command: 'audio_end' }))

        const durationMs = (pcm.length / (SAMPLE_RATE * 2)) * 1000
        speakingUntil = Date.now() + durationMs + 3000
        log(`speaking ${(durationMs / 1000).toFixed(1)}s`)
    } catch (error) {
        Logger.warn(`[lipsync] speech failed: ${error}`)
    }
}

useInference.subscribe((state, previous) => {
    if (!socket || state.nowGenerating === previous.nowGenerating) return
    useLipSyncSession.setState({ lastActivity: Date.now() })
    if (state.nowGenerating || state.generationAborted || state.generationFailed) return
    // With no animated portrait on screen (e.g. messenger layout), regular TTS voices the reply.
    if (!isLipSyncVoicing()) return

    const messages = Chats.useChatState.getState().data?.messages
    const last = messages?.[messages.length - 1]
    if (!last || last.is_user) return
    void speak(last.swipes[last.swipe_id]?.swipe ?? '')
})

Characters.useCharacterStore.subscribe((state, previous) => {
    if (state.id === previous.id) return
    // The session was built from the previous character's portrait.
    if (socket || useLipSyncSession.getState().connection === 'connecting')
        disconnectLipSync('character changed')
})

// Backgrounding the app is the easiest way to leak a billed session.
AppState.addEventListener('change', (next) => {
    if (next !== 'background') return
    if (socket || useLipSyncSession.getState().connection === 'connecting')
        disconnectLipSync('app backgrounded')
})
