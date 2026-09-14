import {
    GEMINI_SAMPLE_RATE,
    streamCartesiaPcm,
    streamElevenLabsPcm,
    streamGeminiPcm,
} from '@lib/audio/SpeechStreams'
import { getGeminiApiKey } from '@lib/engine/API/GeminiKey'
import i18n from '@lib/i18n'
import type { TTSProvider } from '@lib/state/TTS'

/** The slice of Voice settings lip sync needs; the TTS store satisfies it directly. */
export type LipSyncVoiceSettings = {
    provider: TTSProvider
    rate: number
    elevenLabsApiKey: string
    elevenLabsVoiceId: string
    elevenLabsModel: string
    geminiVoiceName: string
    geminiModel: string
    cartesiaApiKey: string
    cartesiaVoiceId: string
    cartesiaModel: string
    cartesiaLanguage: string
}

export type LipSyncVoiceIssue = 'unsupported' | 'missingKey' | null

/** Receives mono PCM16 as it arrives; the sample rate stays the same for a whole reply. */
export type LipSyncPcmSink = (pcm: Uint8Array, sampleRate: number) => void

export const providerLabel = (provider: TTSProvider) => {
    switch (provider) {
        case 'elevenlabs':
            return 'ElevenLabs'
        case 'gemini':
            return 'Gemini'
        case 'cartesia':
            return 'Cartesia'
        default:
            return i18n.t('lemonSlice.deviceVoice')
    }
}

/**
 * LemonSlice lip-syncs raw audio we send it. Device TTS speaks through the OS and
 * never exposes its samples, so it is the one provider that cannot drive it.
 */
export const getLipSyncVoiceIssue = (
    voice: Pick<LipSyncVoiceSettings, 'provider' | 'elevenLabsApiKey' | 'cartesiaApiKey'>,
    /** Gemini's key lives in API settings; screens pass it in so they re-render when it changes. */
    geminiApiKey: string = getGeminiApiKey()
): LipSyncVoiceIssue => {
    switch (voice.provider) {
        case 'elevenlabs':
            return voice.elevenLabsApiKey.trim() ? null : 'missingKey'
        case 'gemini':
            return geminiApiKey ? null : 'missingKey'
        case 'cartesia':
            return voice.cartesiaApiKey.trim() ? null : 'missingKey'
        default:
            return 'unsupported'
    }
}

/** ElevenLabs and Cartesia are asked for 16kHz; LemonSlice resamples other rates itself. */
const LIPSYNC_SAMPLE_RATE = 16000

/** Same clamp as regular Cartesia playback, so speed matches either way. */
const cartesiaSpeed = (rate: number) => Math.min(1.5, Math.max(0.6, rate))

const readError = async (response: Response) => {
    const body = await response.text().catch(() => '')
    return `${response.status}${body ? `: ${body.slice(0, 300)}` : ''}`
}

/** Used only when Cartesia's WebSocket cannot be reached. */
const fetchCartesiaPcm = async (
    text: string,
    voice: LipSyncVoiceSettings,
    signal: AbortSignal
): Promise<Uint8Array> => {
    const response = await fetch('https://api.cartesia.ai/tts/bytes', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${voice.cartesiaApiKey.trim()}`,
            'Cartesia-Version': '2026-03-01',
        },
        body: JSON.stringify({
            model_id: voice.cartesiaModel,
            transcript: text,
            voice: { mode: 'id', id: voice.cartesiaVoiceId },
            language: voice.cartesiaLanguage,
            output_format: {
                container: 'raw',
                encoding: 'pcm_s16le',
                sample_rate: LIPSYNC_SAMPLE_RATE,
            },
            generation_config: { speed: cartesiaSpeed(voice.rate) },
        }),
        signal: signal,
    })
    if (!response.ok) throw new Error(`Cartesia failed ${await readError(response)}`)
    return new Uint8Array(await response.arrayBuffer())
}

/** Streams a reply with whatever provider Voice settings selects, handing audio over as it arrives. */
export const streamForLipSync = async (
    text: string,
    voice: LipSyncVoiceSettings,
    signal: AbortSignal,
    onPcm: LipSyncPcmSink
): Promise<void> => {
    switch (voice.provider) {
        case 'elevenlabs': {
            const outcome = await streamElevenLabsPcm({
                text: text,
                apiKey: voice.elevenLabsApiKey.trim(),
                voiceId: voice.elevenLabsVoiceId,
                model: voice.elevenLabsModel,
                sampleRate: LIPSYNC_SAMPLE_RATE,
                signal: signal,
                onPcm: (pcm) => onPcm(pcm, LIPSYNC_SAMPLE_RATE),
            })
            // PCM is gated by plan tier, so a non-streaming PCM request would be refused too.
            if (outcome === 'unavailable') throw new Error('ElevenLabs PCM output is unavailable')
            return
        }
        case 'gemini':
            return streamGeminiPcm({
                text: text,
                apiKey: getGeminiApiKey(),
                voiceName: voice.geminiVoiceName,
                model: voice.geminiModel,
                signal: signal,
                onPcm: (pcm) => onPcm(pcm, GEMINI_SAMPLE_RATE),
            })
        case 'cartesia': {
            const outcome = await streamCartesiaPcm({
                text: text,
                apiKey: voice.cartesiaApiKey.trim(),
                voiceId: voice.cartesiaVoiceId,
                model: voice.cartesiaModel,
                language: voice.cartesiaLanguage,
                speed: cartesiaSpeed(voice.rate),
                sampleRate: LIPSYNC_SAMPLE_RATE,
                signal: signal,
                onPcm: (pcm) => onPcm(pcm, LIPSYNC_SAMPLE_RATE),
            })
            if (outcome === 'unavailable') {
                onPcm(await fetchCartesiaPcm(text, voice, signal), LIPSYNC_SAMPLE_RATE)
            }
            return
        }
        default:
            throw new Error(`${voice.provider} voice cannot drive lip sync`)
    }
}
