import { AppState } from 'react-native'

import { createFirstAudioLogger, isAbort } from '@lib/audio/SpeechStreams'
import i18n from '@lib/i18n'
import { Characters } from '@lib/state/Characters'
import { Chats, useInference } from '@lib/state/Chat'
import { isLipSyncVoicing, useLipSyncSession, useLipSyncSettings } from '@lib/state/LemonSlice'
import { Logger } from '@lib/state/Logger'
import { useTTSStore } from '@lib/state/TTS'

import {
    chunkBytesFor,
    createSession,
    encodeBase64,
    mintDailyToken,
    prepareImageBase64,
} from './LemonSliceApi'
import { getLipSyncVoiceIssue, providerLabel, streamForLipSync } from './LipSyncVoice'

/** LemonSlice bills wall-clock session time, so a forgotten session keeps charging. */
export const IDLE_LIMIT_MS = 50_000
export const COST_PER_MINUTE_USD = 0.164

let socket: WebSocket | null = null
let idleTimer: ReturnType<typeof setInterval> | null = null
/** Bumped by every connect and disconnect, so a slow connect can tell it was cancelled. */
let attempt = 0
/** When the current line should finish; a lost playback_finished must not pin the session open. */
let speakingUntil = 0
/** The reply currently streaming to the avatar, so a newer reply or a disconnect can cancel it. */
let speech: AbortController | null = null

const log = (message: string) => Logger.info(`[lipsync] ${message}`)

const isActive = () => !!socket || useLipSyncSession.getState().connection === 'connecting'

/**
 * System overlays — the speech-recognition dialog, permission prompts — also put
 * the app in the background on Android, so only a sustained absence ends the session.
 */
const BACKGROUND_GRACE_MS = 30_000

let backgroundedAt: number | null = null
let backgroundTimer: ReturnType<typeof setTimeout> | null = null

const clearBackgroundWatch = () => {
    if (backgroundTimer) clearTimeout(backgroundTimer)
    backgroundTimer = null
    backgroundedAt = null
}

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
    clearBackgroundWatch()
    speech?.abort()
    speech = null
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
    const tts = useTTSStore.getState()
    const voiceIssue = getLipSyncVoiceIssue(tts)
    if (voiceIssue === 'unsupported') throw new Error(i18n.t('lemonSlice.deviceUnsupported'))
    if (voiceIssue === 'missingKey')
        throw new Error(
            tts.provider === 'gemini'
                ? i18n.t('lemonSlice.missingGeminiKey')
                : i18n.t('lemonSlice.missingVoiceKey', { provider: providerLabel(tts.provider) })
        )

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

    // A newer reply takes over from one still streaming.
    speech?.abort()
    const controller = new AbortController()
    speech = controller

    const tts = useTTSStore.getState()
    const logFirstAudio = createFirstAudioLogger(`[lipsync] ${providerLabel(tts.provider)}`)
    const isCurrent = () =>
        speech === controller && socket === ws && ws.readyState === WebSocket.OPEN
    const line = { started: false, startedAt: 0, durationMs: 0, sampleRate: 0 }
    let pending = new Uint8Array(0)

    const send = (bytes: Uint8Array, sampleRate: number) => {
        ws.send(
            JSON.stringify({
                command: 'audio',
                audio: encodeBase64(bytes),
                sampleRate: sampleRate,
                encoding: 'PCM16',
            })
        )
        line.durationMs += (bytes.length / (sampleRate * 2)) * 1000
        speakingUntil = line.startedAt + line.durationMs + 3000
    }

    // Audio is forwarded as it arrives, so the avatar starts talking before the reply is fully synthesised.
    const onPcm = (pcm: Uint8Array, sampleRate: number) => {
        // The session ended or a newer reply took over; stop pulling audio for this one.
        if (!isCurrent()) {
            controller.abort()
            return
        }
        logFirstAudio()
        if (!line.started) {
            line.started = true
            if (Date.now() < speakingUntil) ws.send(JSON.stringify({ command: 'interrupt' }))
            line.startedAt = Date.now()
        }
        line.sampleRate = sampleRate

        const merged = new Uint8Array(pending.length + pcm.length)
        merged.set(pending)
        merged.set(pcm, pending.length)
        const chunkBytes = chunkBytesFor(sampleRate)
        let offset = 0
        for (; offset + chunkBytes <= merged.length; offset += chunkBytes) {
            send(merged.subarray(offset, offset + chunkBytes), sampleRate)
        }
        pending = merged.slice(offset)
    }

    const finishLine = () => {
        if (!line.started || !isCurrent()) return
        // Drop a trailing odd byte so every PCM16 sample stays whole.
        const usable = pending.length - (pending.length % 2)
        if (usable) send(pending.subarray(0, usable), line.sampleRate)
        // Without audio_end the tail is dropped and the avatar freezes.
        ws.send(JSON.stringify({ command: 'audio_end' }))
    }

    try {
        await streamForLipSync(speakable, tts, controller.signal, onPcm)
        finishLine()
        if (line.started) {
            log(
                `spoke ${(line.durationMs / 1000).toFixed(1)}s via ${tts.provider} @ ${line.sampleRate}Hz`
            )
        }
    } catch (error) {
        if (isAbort(error)) return
        // Close out what was already sent so the avatar does not freeze mid-word.
        finishLine()
        Logger.warn(`[lipsync] speech failed: ${error}`)
    } finally {
        if (speech === controller) speech = null
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

useTTSStore.subscribe((state, previous) => {
    if (state.provider === previous.provider || !isActive()) return
    // Device voice cannot feed the avatar, and while a session is live regular TTS
    // is muted — staying connected would leave every reply silent.
    if (getLipSyncVoiceIssue(state) !== 'unsupported') return
    Logger.infoToast(i18n.t('lemonSlice.providerDisconnected'))
    disconnectLipSync('switched to device voice')
})

Characters.useCharacterStore.subscribe((state, previous) => {
    if (state.id === previous.id) return
    // The session was built from the previous character's portrait.
    if (isActive()) disconnectLipSync('character changed')
})

// Leaving the app is the easiest way to leak a billed session.
AppState.addEventListener('change', (next) => {
    if (next === 'background') {
        if (!isActive() || backgroundedAt !== null) return
        backgroundedAt = Date.now()
        backgroundTimer = setTimeout(() => {
            if (isActive()) disconnectLipSync('app backgrounded')
        }, BACKGROUND_GRACE_MS)
        return
    }
    if (next !== 'active' || backgroundedAt === null) return

    const away = Date.now() - backgroundedAt
    clearBackgroundWatch()
    if (!isActive()) return
    // JS timers can be suspended while backgrounded, so the absence is re-checked on return.
    if (away > BACKGROUND_GRACE_MS) disconnectLipSync('app backgrounded')
    // Returning, e.g. from voice input, is activity; the time away must not count as idle.
    else useLipSyncSession.setState({ lastActivity: Date.now() })
})
