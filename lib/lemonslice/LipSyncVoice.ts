import i18n from '@lib/i18n'
import type { TTSProvider } from '@lib/state/TTS'

/** The slice of Voice settings lip sync needs; the TTS store satisfies it directly. */
export type LipSyncVoiceSettings = {
    provider: TTSProvider
    rate: number
    elevenLabsApiKey: string
    elevenLabsVoiceId: string
    elevenLabsModel: string
    geminiApiKey: string
    geminiVoiceName: string
    geminiModel: string
    cartesiaApiKey: string
    cartesiaVoiceId: string
    cartesiaModel: string
    cartesiaLanguage: string
}

export type LipSyncVoiceIssue = 'unsupported' | 'missingKey' | null

export interface PcmAudio {
    /** Mono PCM16, little-endian. */
    pcm: Uint8Array
    sampleRate: number
}

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
    voice: Pick<
        LipSyncVoiceSettings,
        'provider' | 'elevenLabsApiKey' | 'geminiApiKey' | 'cartesiaApiKey'
    >
): LipSyncVoiceIssue => {
    switch (voice.provider) {
        case 'elevenlabs':
            return voice.elevenLabsApiKey.trim() ? null : 'missingKey'
        case 'gemini':
            return voice.geminiApiKey.trim() ? null : 'missingKey'
        case 'cartesia':
            return voice.cartesiaApiKey.trim() ? null : 'missingKey'
        default:
            return 'unsupported'
    }
}

const readError = async (response: Response) => {
    const body = await response.text().catch(() => '')
    return `${response.status}${body ? `: ${body.slice(0, 300)}` : ''}`
}

const decodeBase64 = (base64: string) => {
    const binary = atob(base64)
    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
    return bytes
}

const synthesizeElevenLabs = async (
    text: string,
    voice: LipSyncVoiceSettings
): Promise<PcmAudio> => {
    const response = await fetch(
        `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(
            voice.elevenLabsVoiceId
        )}?output_format=pcm_16000`,
        {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'xi-api-key': voice.elevenLabsApiKey.trim(),
            },
            body: JSON.stringify({ text: text, model_id: voice.elevenLabsModel }),
        }
    )
    if (!response.ok) throw new Error(`ElevenLabs failed ${await readError(response)}`)
    return { pcm: new Uint8Array(await response.arrayBuffer()), sampleRate: 16000 }
}

const synthesizeGemini = async (text: string, voice: LipSyncVoiceSettings): Promise<PcmAudio> => {
    const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
            voice.geminiModel
        )}:generateContent`,
        {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-goog-api-key': voice.geminiApiKey.trim(),
            },
            body: JSON.stringify({
                contents: [{ parts: [{ text: text }] }],
                generationConfig: {
                    responseModalities: ['AUDIO'],
                    speechConfig: {
                        voiceConfig: { prebuiltVoiceConfig: { voiceName: voice.geminiVoiceName } },
                    },
                },
            }),
        }
    )
    if (!response.ok) throw new Error(`Gemini TTS failed ${await readError(response)}`)

    const result = (await response.json()) as {
        candidates?: {
            content?: { parts?: { inlineData?: { data?: string; mimeType?: string } }[] }
        }[]
    }
    const audio = result.candidates?.[0]?.content?.parts?.[0]?.inlineData
    if (!audio?.data) throw new Error('Gemini TTS returned no audio data')

    // Gemini emits raw 24kHz mono PCM16 and names the rate in the mime type.
    // LemonSlice resamples non-16kHz input itself, so no conversion is needed here.
    const rate = Number(/rate=(\d+)/.exec(audio.mimeType ?? '')?.[1]) || 24000
    return { pcm: decodeBase64(audio.data), sampleRate: rate }
}

const synthesizeCartesia = async (text: string, voice: LipSyncVoiceSettings): Promise<PcmAudio> => {
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
            output_format: { container: 'raw', encoding: 'pcm_s16le', sample_rate: 16000 },
            // Same clamp as regular Cartesia playback, so speed matches either way.
            generation_config: { speed: Math.min(1.5, Math.max(0.6, voice.rate)) },
        }),
    })
    if (!response.ok) throw new Error(`Cartesia failed ${await readError(response)}`)
    return { pcm: new Uint8Array(await response.arrayBuffer()), sampleRate: 16000 }
}

/** Synthesises a reply with whatever provider Voice settings currently selects. */
export const synthesizeForLipSync = (
    text: string,
    voice: LipSyncVoiceSettings
): Promise<PcmAudio> => {
    switch (voice.provider) {
        case 'elevenlabs':
            return synthesizeElevenLabs(text, voice)
        case 'gemini':
            return synthesizeGemini(text, voice)
        case 'cartesia':
            return synthesizeCartesia(text, voice)
        default:
            return Promise.reject(new Error(`${voice.provider} voice cannot drive lip sync`))
    }
}
