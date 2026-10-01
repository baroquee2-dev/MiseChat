import { fetch as streamingFetch } from 'expo/fetch'

import { Logger } from '@lib/state/Logger'

/**
 * Streaming speech sources shared by regular voice playback and lip sync.
 *
 * Each source hands mono PCM16 to `onPcm` as it arrives, rejects with an AbortError once
 * its signal fires, and resolves 'unavailable' when streaming failed before any audio,
 * so each caller can choose its own fallback.
 */
export type PcmSink = (pcm: Uint8Array) => void
export type StreamOutcome = 'streamed' | 'unavailable'

export const base64ToBytes = (base64: string): Uint8Array => {
    const binary = atob(base64)
    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
    return bytes
}

export const isAbort = (error: unknown) => error instanceof Error && error.name === 'AbortError'

const abortError = () => {
    const error = new Error('Aborted')
    error.name = 'AbortError'
    return error
}

/** Logs, once per reply, how long a streamed voice took to produce its first audio. */
export const createFirstAudioLogger = (label: string) => {
    const startedAt = Date.now()
    let logged = false
    return () => {
        if (logged) return
        logged = true
        Logger.info(`${label} speech first audio after ${Date.now() - startedAt}ms`)
    }
}

type ElevenLabsStreamOptions = {
    text: string
    apiKey: string
    voiceId: string
    model: string
    sampleRate: number
    signal: AbortSignal
    onPcm: PcmSink
}

export const streamElevenLabsPcm = async (
    options: ElevenLabsStreamOptions
): Promise<StreamOutcome> => {
    const response = await streamingFetch(
        `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(options.voiceId)}/stream?output_format=pcm_${options.sampleRate}`,
        {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'xi-api-key': options.apiKey },
            body: JSON.stringify({ text: options.text, model_id: options.model }),
            signal: options.signal,
        }
    )
    if (response.status === 401) {
        const detail = await response.text()
        throw new Error(detail || 'ElevenLabs rejected the API key')
    }
    if (!response.ok || !response.body) {
        // PCM output can be gated by subscription tier.
        const detail = await response.text().catch(() => '')
        Logger.warn(
            `ElevenLabs PCM streaming unavailable (${response.status}): ${detail.slice(0, 160)}`
        )
        return 'unavailable'
    }

    const reader = response.body.getReader()
    for (;;) {
        if (options.signal.aborted) throw abortError()
        const { done, value } = await reader.read()
        if (done) return 'streamed'
        if (value?.length) options.onPcm(value)
    }
}

type CartesiaStreamOptions = {
    text: string
    apiKey: string
    voiceId: string
    model: string
    language: string
    /** Cartesia accepts 0.6–1.5. */
    speed: number
    sampleRate: number
    signal: AbortSignal
    onPcm: PcmSink
}

/**
 * Cartesia's HTTP endpoint is not documented as progressive, but its WebSocket is:
 * audio arrives as base64 PCM chunks while the rest is still being synthesised.
 */
export const streamCartesiaPcm = (options: CartesiaStreamOptions): Promise<StreamOutcome> =>
    new Promise((resolve, reject) => {
        if (options.signal.aborted) {
            reject(abortError())
            return
        }
        const contextId = `misechat-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
        const socket = new WebSocket(
            `wss://api.cartesia.ai/tts/websocket?cartesia_version=2026-08-14&api_key=${encodeURIComponent(options.apiKey)}`
        )
        let receivedAudio = false
        let settled = false

        const settle = (action: () => void) => {
            if (settled) return
            settled = true
            options.signal.removeEventListener('abort', onAbort)
            socket.close()
            action()
        }
        const onAbort = () => {
            if (socket.readyState === WebSocket.OPEN) {
                socket.send(JSON.stringify({ context_id: contextId, cancel: true }))
            }
            settle(() => reject(abortError()))
        }
        options.signal.addEventListener('abort', onAbort)

        socket.onopen = () => {
            socket.send(
                JSON.stringify({
                    model_id: options.model,
                    transcript: options.text,
                    voice: options.voiceId,
                    language: options.language,
                    context_id: contextId,
                    continue: false,
                    output_format: {
                        container: 'raw',
                        encoding: 'pcm_s16le',
                        sample_rate: options.sampleRate,
                    },
                    generation_config: { speed: options.speed },
                })
            )
        }
        socket.onmessage = (event) => {
            let message: {
                type?: string
                data?: string
                done?: boolean
                message?: string
                title?: string
            }
            try {
                message = JSON.parse(String(event.data))
            } catch {
                return
            }
            if (message.type === 'error') {
                settle(() => reject(new Error(message.message || message.title || 'stream error')))
                return
            }
            if (message.type === 'chunk' && message.data) {
                receivedAudio = true
                try {
                    options.onPcm(base64ToBytes(message.data))
                } catch (error) {
                    settle(() => reject(error))
                    return
                }
            }
            if (message.type === 'done' || message.done) settle(() => resolve('streamed'))
        }
        // Failing before any audio usually means WebSockets are blocked on this network;
        // failing mid-reply just ends what was already delivered.
        socket.onerror = () => settle(() => resolve(receivedAudio ? 'streamed' : 'unavailable'))
        socket.onclose = () => settle(() => resolve(receivedAudio ? 'streamed' : 'unavailable'))
    })

/** Gemini returns 24kHz mono PCM16, streamed or not. */
export const GEMINI_SAMPLE_RATE = 24000

const GEMINI_API = 'https://generativelanguage.googleapis.com/v1beta/models'

type GeminiSpeechChunk = {
    candidates?: {
        content?: { parts?: { inlineData?: { data?: string } }[] }
        finishReason?: string
    }[]
    error?: { message?: string }
}

type GeminiSpeechOptions = {
    text: string
    apiKey: string
    voiceName: string
    model: string
    signal: AbortSignal
}

const geminiSpeechBody = (text: string, voiceName: string) =>
    JSON.stringify({
        contents: [{ parts: [{ text }] }],
        generationConfig: {
            responseModalities: ['AUDIO'],
            speechConfig: {
                voiceConfig: {
                    prebuiltVoiceConfig: { voiceName },
                },
            },
        },
    })

/** Requests a complete clip. */
export const fetchGeminiPcm = async (options: GeminiSpeechOptions): Promise<Uint8Array> => {
    const response = await fetch(
        `${GEMINI_API}/${encodeURIComponent(options.model)}:generateContent`,
        {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-goog-api-key': options.apiKey },
            body: geminiSpeechBody(options.text, options.voiceName),
            signal: options.signal,
        }
    )
    if (!response.ok) {
        const detail = await response.text()
        throw new Error(detail || `Gemini TTS request failed (${response.status})`)
    }

    const result = (await response.json()) as GeminiSpeechChunk
    const base64Audio = result.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data
    if (!base64Audio) throw new Error('Gemini TTS returned no audio data')
    return base64ToBytes(base64Audio)
}

/** Gemini streams speech from 3.1 on; earlier TTS models only return a complete clip. */
export const supportsGeminiStreaming = (model: string) => {
    const version = /gemini-(\d+)\.(\d+)/.exec(model)
    if (!version) return false
    const major = Number(version[1])
    return major > 3 || (major === 3 && Number(version[2]) >= 1)
}

/**
 * Streamed Gemini speech is often cut off once a response passes about a minute of audio,
 * so long text is sent as sentence-bounded pieces that stay well short of that.
 */
const GEMINI_SEGMENT_CHARS = 200

const splitGeminiSegments = (text: string) => {
    const sentences = text.match(/[^。！？!?.…\n]*[。！？!?.…\n]+|[^。！？!?.…\n]+$/g) ?? [text]
    const segments: string[] = []
    let current = ''
    for (const sentence of sentences) {
        if (current.length + sentence.length > GEMINI_SEGMENT_CHARS) {
            segments.push(current)
            current = ''
        }
        let rest = sentence
        while (rest.length > GEMINI_SEGMENT_CHARS) {
            segments.push(rest.slice(0, GEMINI_SEGMENT_CHARS))
            rest = rest.slice(GEMINI_SEGMENT_CHARS)
        }
        current += rest
    }
    segments.push(current)
    return segments.map((segment) => segment.trim()).filter(Boolean)
}

/** Streams one piece. Returns false when the stream produced no audio. */
const streamGeminiSegment = async (
    options: GeminiSpeechOptions & { onPcm: PcmSink }
): Promise<boolean> => {
    const response = await streamingFetch(
        `${GEMINI_API}/${encodeURIComponent(options.model)}:streamGenerateContent?alt=sse`,
        {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-goog-api-key': options.apiKey },
            body: geminiSpeechBody(options.text, options.voiceName),
            signal: options.signal,
        }
    )
    // A bad key, voice or model fails the same way without streaming, so it is reported now.
    if ([400, 401, 403, 404].includes(response.status)) {
        const detail = await response.text()
        throw new Error(detail || `Gemini TTS request failed (${response.status})`)
    }
    if (!response.ok || !response.body) {
        Logger.warn(`Gemini speech stream failed (${response.status}), retrying without streaming`)
        return false
    }

    const stream = { receivedAudio: false, finishReason: '', error: '' }
    const handleLine = (line: string) => {
        if (!line.startsWith('data:')) return
        let chunk: GeminiSpeechChunk
        try {
            chunk = JSON.parse(line.slice(5))
        } catch {
            return
        }
        if (chunk.error) stream.error = chunk.error.message || 'stream error'
        const candidate = chunk.candidates?.[0]
        if (candidate?.finishReason) stream.finishReason = candidate.finishReason
        for (const part of candidate?.content?.parts ?? []) {
            if (!part.inlineData?.data) continue
            stream.receivedAudio = true
            options.onPcm(base64ToBytes(part.inlineData.data))
        }
    }

    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let pending = ''
    for (;;) {
        if (options.signal.aborted) throw abortError()
        const { done, value } = await reader.read()
        if (done) break
        pending += decoder.decode(value, { stream: true })
        const lines = pending.split('\n')
        pending = lines.pop() ?? ''
        lines.forEach((line) => handleLine(line.trim()))
    }
    handleLine((pending + decoder.decode()).trim())

    if (!stream.receivedAudio) {
        Logger.warn(
            `Gemini speech stream returned no audio${stream.error ? `: ${stream.error}` : ''}, retrying without streaming`
        )
        return false
    }
    // Audio already delivered cannot be taken back, so a piece cut short is only reported.
    if (stream.error || (stream.finishReason && stream.finishReason !== 'STOP')) {
        Logger.warn(`Gemini speech stream ended early (${stream.error || stream.finishReason})`)
    }
    return true
}

/**
 * Streams piece by piece on models that support it, fetching a piece whole when its
 * stream yields no audio; older models get one complete clip.
 */
export const streamGeminiPcm = async (
    options: GeminiSpeechOptions & { onPcm: PcmSink }
): Promise<void> => {
    if (!supportsGeminiStreaming(options.model)) {
        options.onPcm(await fetchGeminiPcm(options))
        return
    }
    for (const segment of splitGeminiSegments(options.text)) {
        if (options.signal.aborted) throw abortError()
        const piece = { ...options, text: segment }
        if (await streamGeminiSegment(piece)) continue
        options.onPcm(await fetchGeminiPcm(piece))
    }
}
