import { fetch as streamingFetch } from 'expo/fetch'
import { createAudioPlayer, setAudioModeAsync, type AudioPlayer } from 'expo-audio'
import { File, Paths } from 'expo-file-system'
import * as Speech from 'expo-speech'
import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { useShallow } from 'zustand/react/shallow'

import { PcmStreamPlayer } from '@lib/audio/PcmStreamPlayer'
import { getGeminiApiKey } from '@lib/engine/API/GeminiKey'
import { Storage } from '@lib/enums/Storage'
import i18n from '@lib/i18n'
import { isLipSyncVoicing } from '@lib/state/LemonSlice'
import { Logger } from '@lib/state/Logger'
import { createMMKVStorage } from '@lib/storage/MMKV'

import { Chats, useInference } from './Chat'

export type TTSProvider = 'device' | 'elevenlabs' | 'gemini' | 'cartesia'

type TTSState = {
    activeChatIndex?: number
    voice?: Speech.Voice
    enabled: boolean
    auto: boolean
    rate: number
    provider: TTSProvider
    elevenLabsApiKey: string
    elevenLabsVoiceId: string
    elevenLabsModel: string
    geminiVoiceName: string
    geminiModel: string
    cartesiaApiKey: string
    cartesiaVoiceId: string
    cartesiaModel: string
    cartesiaLanguage: string
    startTTS: (text: string, index: number) => Promise<void>
    stopTTS: () => Promise<void>
    setEnabled: (b: boolean) => void
    setAuto: (b: boolean) => void
    setVoice: (v: Speech.Voice) => void
    setRate: (r: number) => void
    setProvider: (provider: TTSProvider) => void
    setElevenLabsApiKey: (apiKey: string) => void
    setElevenLabsVoiceId: (voiceId: string) => void
    setElevenLabsModel: (model: string) => void
    setGeminiVoiceName: (voiceName: string) => void
    setGeminiModel: (model: string) => void
    setCartesiaApiKey: (apiKey: string) => void
    setCartesiaVoiceId: (voiceId: string) => void
    setCartesiaModel: (model: string) => void
    setCartesiaLanguage: (language: string) => void
    setLiveTTS: (b: boolean) => void

    speak: (text: string, onDone?: () => void, onStop?: () => void) => void
    handleEndGeneration: (lastIndex: number, text: string) => Promise<void>
    handleStartGeneration: (lastIndex: number) => void
    // stream TTS
    liveTTS: boolean
    pauseLive?: boolean
    setPauseLive: (b: boolean) => void
    buffer: string
    clearAndRunBuffer: (lastIndex: number) => void
    clearBuffer: () => void
    /**
     * Inserts text into the buffer, attempts TTS if valid sentence and adds remainder to buffer
     * @param text text for TTS
     * @returns
     */
    insertBuffer: (text: string) => void
}

const sentenceEndRegex =
    /(?<=[^\d])([。…？！.?!])(?:["'`*_)]*)\s+(?=[A-Z0-9])|([。…？！.?!])(?:["'`*_)]*)$/gm

export const useTTS = () => {
    const {
        startTTS,
        activeChatIndex,
        stopTTS,
        setVoice,
        setEnabled,
        setAuto,
        setRate,
        auto,
        enabled,
        voice,
        rate,
        provider,
        elevenLabsApiKey,
        elevenLabsVoiceId,
        elevenLabsModel,
        setProvider,
        setElevenLabsApiKey,
        setElevenLabsVoiceId,
        setElevenLabsModel,
        geminiVoiceName,
        geminiModel,
        setGeminiVoiceName,
        setGeminiModel,
        cartesiaApiKey,
        cartesiaVoiceId,
        cartesiaModel,
        cartesiaLanguage,
        setCartesiaApiKey,
        setCartesiaVoiceId,
        setCartesiaModel,
        setCartesiaLanguage,
        live,
        setLive,
    } = useTTSStore(
        useShallow((state) => ({
            startTTS: state.startTTS,
            stopTTS: state.stopTTS,
            activeChatIndex: state.activeChatIndex,
            setVoice: state.setVoice,
            setEnabled: state.setEnabled,
            setAuto: state.setAuto,
            setRate: state.setRate,
            auto: state.auto,
            enabled: state.enabled,
            voice: state.voice,
            rate: state.rate,
            provider: state.provider,
            elevenLabsApiKey: state.elevenLabsApiKey,
            elevenLabsVoiceId: state.elevenLabsVoiceId,
            elevenLabsModel: state.elevenLabsModel,
            setProvider: state.setProvider,
            setElevenLabsApiKey: state.setElevenLabsApiKey,
            setElevenLabsVoiceId: state.setElevenLabsVoiceId,
            setElevenLabsModel: state.setElevenLabsModel,
            geminiVoiceName: state.geminiVoiceName,
            geminiModel: state.geminiModel,
            setGeminiVoiceName: state.setGeminiVoiceName,
            setGeminiModel: state.setGeminiModel,
            cartesiaApiKey: state.cartesiaApiKey,
            cartesiaVoiceId: state.cartesiaVoiceId,
            cartesiaModel: state.cartesiaModel,
            cartesiaLanguage: state.cartesiaLanguage,
            setCartesiaApiKey: state.setCartesiaApiKey,
            setCartesiaVoiceId: state.setCartesiaVoiceId,
            setCartesiaModel: state.setCartesiaModel,
            setCartesiaLanguage: state.setCartesiaLanguage,
            live: state.liveTTS,
            setLive: state.setLiveTTS,
        }))
    )
    return {
        startTTS,
        activeChatIndex,
        stopTTS,
        setVoice,
        setEnabled,
        setAuto,
        setRate,
        auto,
        enabled,
        voice,
        rate,
        provider,
        elevenLabsApiKey,
        elevenLabsVoiceId,
        elevenLabsModel,
        setProvider,
        setElevenLabsApiKey,
        setElevenLabsVoiceId,
        setElevenLabsModel,
        geminiVoiceName,
        geminiModel,
        setGeminiVoiceName,
        setGeminiModel,
        cartesiaApiKey,
        cartesiaVoiceId,
        cartesiaModel,
        cartesiaLanguage,
        setCartesiaApiKey,
        setCartesiaVoiceId,
        setCartesiaModel,
        setCartesiaLanguage,
        live,
        setLive,
    }
}

useInference.subscribe(({ nowGenerating }) => {
    const data = Chats.useChatState.getState().data
    const length = data?.messages?.length
    if (!length) return
    if (!nowGenerating) {
        const message = data?.messages?.[length - 1]
        if (!message) return
        useTTSStore
            .getState()
            .handleEndGeneration(length - 1, message.swipes[message.swipe_id].swipe)
    } else {
        useTTSStore.getState().handleStartGeneration(length - 1)
    }
})

export const useTTSStore = create<TTSState>()(
    persist(
        (set, get) => ({
            voice: undefined,
            enabled: false,
            auto: false,
            liveTTS: false,
            rate: 1,
            provider: 'device',
            elevenLabsApiKey: '',
            // Rachel is an ElevenLabs premade voice. Users may replace this with any Voice ID.
            elevenLabsVoiceId: '21m00Tcm4TlvDq8ikWAM',
            elevenLabsModel: 'eleven_v3',
            geminiVoiceName: 'Kore',
            geminiModel: 'gemini-3.1-flash-tts-preview',
            cartesiaApiKey: '',
            cartesiaVoiceId: 'db6b0ed5-d5d3-463d-ae85-518a07d3c2b4',
            cartesiaModel: 'sonic-3.6',
            cartesiaLanguage: 'zh',
            activeChatIndex: undefined,
            startTTS: async (text: string, index: number) => {
                const clearIndex = () => {
                    if (get().activeChatIndex === index) set({ activeChatIndex: undefined })
                }

                const currentSpeaker = get().voice

                Logger.info('Starting TTS')
                if (get().provider === 'elevenlabs') {
                    if (!get().elevenLabsApiKey.trim()) {
                        Logger.errorToast(i18n.t('toast.enterElevenLabsKey'))
                        clearIndex()
                        return
                    }
                    stopElevenLabsPlayback()
                    set({ activeChatIndex: index })
                    try {
                        await queueElevenLabsSpeech(
                            text,
                            get().elevenLabsApiKey,
                            get().elevenLabsVoiceId,
                            get().elevenLabsModel,
                            get().rate
                        )
                    } catch (error) {
                        Logger.errorToast(getElevenLabsError(error))
                    } finally {
                        clearIndex()
                    }
                    return
                }
                if (get().provider === 'gemini') {
                    const geminiApiKey = getGeminiApiKey()
                    if (!geminiApiKey) {
                        Logger.errorToast(i18n.t('toast.enterGeminiKey'))
                        clearIndex()
                        return
                    }
                    stopGeminiPlayback()
                    set({ activeChatIndex: index })
                    try {
                        await queueGeminiSpeech(
                            text,
                            geminiApiKey,
                            get().geminiVoiceName,
                            get().geminiModel,
                            get().rate
                        )
                    } catch (error) {
                        Logger.errorToast(getGeminiError(error))
                    } finally {
                        clearIndex()
                    }
                    return
                }
                if (get().provider === 'cartesia') {
                    if (!get().cartesiaApiKey.trim()) {
                        Logger.errorToast(i18n.t('toast.enterCartesiaKey'))
                        clearIndex()
                        return
                    }
                    stopCartesiaPlayback()
                    set({ activeChatIndex: index })
                    try {
                        await queueCartesiaSpeech(
                            text,
                            get().cartesiaApiKey,
                            get().cartesiaVoiceId,
                            get().cartesiaModel,
                            get().cartesiaLanguage,
                            get().rate
                        )
                    } catch (error) {
                        Logger.errorToast(getCartesiaError(error))
                    } finally {
                        clearIndex()
                    }
                    return
                }
                if (currentSpeaker === undefined) {
                    Logger.errorToast(i18n.t('toast.noSpeaker'))
                    clearIndex()
                    return
                }
                if (await Speech.isSpeakingAsync()) await Speech.stop()
                const filter = /([。…！？、!?.,*"])/
                const filteredchunks: string[] = []
                const chunks = text.split(filter)
                chunks.forEach((item, index) => {
                    if (!filter.test(item) && item) return filteredchunks.push(item)
                    if (index > 0)
                        filteredchunks[filteredchunks.length - 1] =
                            filteredchunks[filteredchunks.length - 1] + item
                })
                if (filteredchunks.length === 0) filteredchunks.push(text)

                const cleanedchunks = filteredchunks.map((item) =>
                    item.replaceAll(/[*"]/g, '').trim()
                )
                Logger.debug('TTS started with ' + cleanedchunks.length + ' chunks')
                set({ activeChatIndex: index })
                cleanedchunks.forEach((chunk, index) =>
                    Speech.speak(chunk, {
                        language: currentSpeaker?.language,
                        voice: currentSpeaker?.identifier,
                        onDone: () => {
                            index === cleanedchunks.length - 1 && clearIndex()
                        },
                        onStopped: () => clearIndex(),
                        rate: get().rate,
                    })
                )
                if (cleanedchunks.length === 0) clearIndex()
            },
            stopTTS: async () => {
                Logger.info('TTS stopped')
                set({ buffer: '', activeChatIndex: undefined, pauseLive: get().liveTTS })
                await Speech.stop()
                stopElevenLabsPlayback()
                stopGeminiPlayback()
                stopCartesiaPlayback()
            },
            setEnabled: (b: boolean) => {
                set({ enabled: b })
            },
            setAuto: (b: boolean) => {
                set({ auto: b })
            },
            setVoice: (v: Speech.Voice) => {
                set({ voice: v })
            },
            setRate: (r: number) => {
                set({ rate: r })
            },
            setProvider: (provider) => {
                set({ provider })
            },
            setElevenLabsApiKey: (elevenLabsApiKey) => {
                set({ elevenLabsApiKey })
            },
            setElevenLabsVoiceId: (elevenLabsVoiceId) => {
                set({ elevenLabsVoiceId })
            },
            setElevenLabsModel: (elevenLabsModel) => {
                set({ elevenLabsModel })
            },
            setGeminiVoiceName: (geminiVoiceName) => {
                set({ geminiVoiceName })
            },
            setGeminiModel: (geminiModel) => {
                set({ geminiModel })
            },
            setCartesiaApiKey: (cartesiaApiKey) => {
                set({ cartesiaApiKey })
            },
            setCartesiaVoiceId: (cartesiaVoiceId) => {
                set({ cartesiaVoiceId })
            },
            setCartesiaModel: (cartesiaModel) => {
                set({ cartesiaModel })
            },
            setCartesiaLanguage: (cartesiaLanguage) => {
                set({ cartesiaLanguage })
            },
            setLiveTTS: (b: boolean) => {
                set({ liveTTS: b })
            },
            setPauseLive: (b: boolean) => {
                set({ pauseLive: b })
            },
            speak: (text, onDone = () => {}, onStop = () => {}) => {
                if (get().provider === 'elevenlabs') {
                    const { elevenLabsApiKey, elevenLabsVoiceId, elevenLabsModel, rate } = get()
                    if (!elevenLabsApiKey.trim()) {
                        Logger.errorToast(i18n.t('toast.enterElevenLabsKey'))
                        onStop()
                        return
                    }
                    queueElevenLabsSpeech(
                        text,
                        elevenLabsApiKey,
                        elevenLabsVoiceId,
                        elevenLabsModel,
                        rate
                    )
                        .then(onDone)
                        .catch((error) => {
                            Logger.errorToast(getElevenLabsError(error))
                            onStop()
                        })
                    return
                }
                if (get().provider === 'gemini') {
                    const { geminiVoiceName, geminiModel, rate } = get()
                    const geminiApiKey = getGeminiApiKey()
                    if (!geminiApiKey) {
                        Logger.errorToast(i18n.t('toast.enterGeminiKey'))
                        onStop()
                        return
                    }
                    queueGeminiSpeech(text, geminiApiKey, geminiVoiceName, geminiModel, rate)
                        .then(onDone)
                        .catch((error) => {
                            Logger.errorToast(getGeminiError(error))
                            onStop()
                        })
                    return
                }
                if (get().provider === 'cartesia') {
                    const { cartesiaApiKey, cartesiaVoiceId, cartesiaModel, cartesiaLanguage, rate } =
                        get()
                    if (!cartesiaApiKey.trim()) {
                        Logger.errorToast(i18n.t('toast.enterCartesiaKey'))
                        onStop()
                        return
                    }
                    queueCartesiaSpeech(
                        text,
                        cartesiaApiKey,
                        cartesiaVoiceId,
                        cartesiaModel,
                        cartesiaLanguage,
                        rate
                    )
                        .then(onDone)
                        .catch((error) => {
                            Logger.errorToast(getCartesiaError(error))
                            onStop()
                        })
                    return
                }
                const currentSpeaker = get().voice
                Speech.speak(text, {
                    language: currentSpeaker?.language,
                    voice: currentSpeaker?.identifier,
                    onDone: onDone,
                    onStopped: onStop,
                    rate: get().rate,
                })
            },

            handleEndGeneration: async (lastIndex, text) => {
                if (!get().enabled) return
                // The lip-sync avatar voices the reply itself; playing TTS too would double it.
                if (isLipSyncVoicing()) return
                if (get().liveTTS) {
                    get().clearAndRunBuffer(lastIndex)
                } else if (get().auto) {
                    await get().stopTTS()
                    get().startTTS(text, lastIndex)
                }
            },

            handleStartGeneration: async (lastIndex) => {
                if (get().enabled && get().liveTTS) {
                    await Speech.stop()
                    stopElevenLabsPlayback()
                    stopGeminiPlayback()
                    stopCartesiaPlayback()
                    set({ activeChatIndex: lastIndex })
                }
                set({ pauseLive: false })
            },

            // Stream Data

            buffer: '',
            clearAndRunBuffer: (lastIndex) => {
                const buffer = get().buffer

                if (!get().pauseLive && buffer.trim()) {
                    const clean = cleanMarkdown(buffer)
                    if (clean) {
                        set({ activeChatIndex: lastIndex })
                        get().speak(clean, () => set({ activeChatIndex: undefined }))
                    }
                } else {
                    set({ activeChatIndex: undefined })
                }
                set({ buffer: '' })
            },
            clearBuffer: () => {
                set({ buffer: '' })
            },
            insertBuffer: (text: string) => {
                if (!get().enabled || !get().liveTTS || get().pauseLive || isLipSyncVoicing())
                    return
                const newBuffer = get().buffer + text

                let lastMatchIndex = -1

                while (sentenceEndRegex.exec(newBuffer) !== null) {
                    lastMatchIndex = sentenceEndRegex.lastIndex
                }

                if (lastMatchIndex !== -1) {
                    const fullSentence = newBuffer.slice(0, lastMatchIndex).trim()
                    const remainder = newBuffer.slice(lastMatchIndex)
                    const clean = cleanMarkdown(fullSentence)
                    if (clean) {
                        get().speak(clean)
                    }
                    set({ buffer: remainder })
                } else {
                    set({ buffer: newBuffer })
                }
            },
        }),
        {
            name: Storage.TTS,
            storage: createMMKVStorage(),
            version: 4,
            partialize: (state) => ({
                enabled: state.enabled,
                auto: state.auto,
                voice: state.voice,
                rate: state.rate,
                liveTTS: state.liveTTS,
                provider: state.provider,
                elevenLabsApiKey: state.elevenLabsApiKey,
                elevenLabsVoiceId: state.elevenLabsVoiceId,
                elevenLabsModel: state.elevenLabsModel,
                geminiVoiceName: state.geminiVoiceName,
                geminiModel: state.geminiModel,
                cartesiaApiKey: state.cartesiaApiKey,
                cartesiaVoiceId: state.cartesiaVoiceId,
                cartesiaModel: state.cartesiaModel,
                cartesiaLanguage: state.cartesiaLanguage,
            }),
        }
    )
)

let elevenLabsPlayer: AudioPlayer | undefined
let elevenLabsAbortController: AbortController | undefined
let elevenLabsQueue = Promise.resolve()
let elevenLabsGeneration = 0
let finishElevenLabsPlayback: (() => void) | undefined

const stopElevenLabsPlayback = () => {
    elevenLabsGeneration += 1
    elevenLabsAbortController?.abort()
    elevenLabsAbortController = undefined
    elevenLabsPlayer?.pause()
    finishElevenLabsPlayback?.()
    finishElevenLabsPlayback = undefined
    elevenLabsPlayer?.remove()
    elevenLabsPlayer = undefined
}

const queueElevenLabsSpeech = (
    text: string,
    apiKey: string,
    voiceId: string,
    model: string,
    rate: number
): Promise<void> => {
    const generation = elevenLabsGeneration
    elevenLabsQueue = elevenLabsQueue
        .catch(() => undefined)
        .then(async () => {
            if (generation !== elevenLabsGeneration) return
            await playElevenLabsSpeech(text, apiKey, voiceId, model, rate)
        })
    return elevenLabsQueue
}

const playElevenLabsFile = async (
    text: string,
    apiKey: string,
    voiceId: string,
    model: string,
    rate: number
): Promise<void> => {
    const controller = new AbortController()
    elevenLabsAbortController = controller
    const response = await fetch(
        `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}?output_format=mp3_44100_128`,
        {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'xi-api-key': apiKey },
            body: JSON.stringify({ text: text, model_id: model }),
            signal: controller.signal,
        }
    )
    if (!response.ok) {
        const detail = await response.text()
        throw new Error(detail || `ElevenLabs request failed (${response.status})`)
    }

    const audioFile = new File(Paths.cache, `elevenlabs-tts-${Date.now()}.mp3`)
    audioFile.write(new Uint8Array(await response.arrayBuffer()))
    await setAudioModeAsync({ playsInSilentMode: true })

    await new Promise<void>((resolve) => {
        const player = createAudioPlayer(audioFile.uri, { updateInterval: 200 })
        elevenLabsPlayer = player
        player.setPlaybackRate(Math.min(rate, 2))
        let hasStarted = false

        const finish = () => {
            if (elevenLabsPlayer !== player) return
            clearInterval(playbackCheck)
            elevenLabsPlayer = undefined
            finishElevenLabsPlayback = undefined
            player.remove()
            resolve()
        }
        finishElevenLabsPlayback = finish
        const playbackCheck = setInterval(() => {
            if (player.playing || player.currentTime > 0) hasStarted = true
            if (hasStarted && !player.playing) finish()
        }, 200)
        player.play()
    })
}

/** Raw PCM can be played while the response is still arriving; mp3 has to be complete first. */
const STREAM_SAMPLE_RATE = 24000

const isAbort = (error: unknown) => error instanceof Error && error.name === 'AbortError'

/** Logs, once per reply, how long a streamed voice took to produce its first audio. */
const createFirstAudioLogger = (provider: string) => {
    const startedAt = Date.now()
    let logged = false
    return () => {
        if (logged) return
        logged = true
        Logger.info(`${provider} speech first audio after ${Date.now() - startedAt}ms`)
    }
}

const playElevenLabsSpeech = async (
    text: string,
    apiKey: string,
    voiceId: string,
    model: string,
    rate: number
): Promise<void> => {
    const onAudio = createFirstAudioLogger('ElevenLabs')
    const controller = new AbortController()
    elevenLabsAbortController = controller
    const response = await streamingFetch(
        `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}/stream?output_format=pcm_${STREAM_SAMPLE_RATE}`,
        {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'xi-api-key': apiKey },
            body: JSON.stringify({ text: text, model_id: model }),
            signal: controller.signal,
        }
    )
    if (response.status === 401) {
        const detail = await response.text()
        throw new Error(detail || 'ElevenLabs rejected the API key')
    }
    if (!response.ok || !response.body) {
        // PCM output can be gated by subscription tier; mp3 file playback still works there.
        const detail = await response.text().catch(() => '')
        Logger.warn(
            `ElevenLabs streaming unavailable (${response.status}), using file playback: ${detail.slice(0, 160)}`
        )
        return playElevenLabsFile(text, apiKey, voiceId, model, rate)
    }

    const player = new PcmStreamPlayer(STREAM_SAMPLE_RATE, Math.min(rate, 2))
    const finish = () => player.stop()
    finishElevenLabsPlayback = finish
    const reader = response.body.getReader()
    try {
        for (;;) {
            const { done, value } = await reader.read()
            if (done) break
            if (value) {
                onAudio()
                player.push(value)
            }
        }
        player.end()
    } catch (error) {
        player.stop()
        if (!isAbort(error)) throw error
    }
    await player.done
    if (finishElevenLabsPlayback === finish) finishElevenLabsPlayback = undefined
}

const getElevenLabsError = (error: unknown) => {
    if (error instanceof Error && error.name === 'AbortError') return 'ElevenLabs speech stopped'
    if (error instanceof Error) return `ElevenLabs: ${error.message}`
    return 'ElevenLabs speech failed'
}

let geminiPlayer: AudioPlayer | undefined
let geminiAbortController: AbortController | undefined
let geminiQueue = Promise.resolve()
let geminiGeneration = 0
let finishGeminiPlayback: (() => void) | undefined

const stopGeminiPlayback = () => {
    geminiGeneration += 1
    geminiAbortController?.abort()
    geminiAbortController = undefined
    geminiPlayer?.pause()
    finishGeminiPlayback?.()
    finishGeminiPlayback = undefined
    geminiPlayer?.remove()
    geminiPlayer = undefined
}

const queueGeminiSpeech = (
    text: string,
    apiKey: string,
    voiceName: string,
    model: string,
    rate: number
): Promise<void> => {
    const generation = geminiGeneration
    geminiQueue = geminiQueue
        .catch(() => undefined)
        .then(async () => {
            if (generation !== geminiGeneration) return
            await playGeminiSpeech(text, apiKey, voiceName, model, rate)
        })
    return geminiQueue
}

const GEMINI_API = 'https://generativelanguage.googleapis.com/v1beta/models'

type GeminiSpeechChunk = {
    candidates?: {
        content?: { parts?: { inlineData?: { data?: string } }[] }
        finishReason?: string
    }[]
    error?: { message?: string }
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

/** Requests a complete clip, which Gemini returns as 24kHz mono PCM16. */
const fetchGeminiAudio = async (
    text: string,
    apiKey: string,
    voiceName: string,
    model: string,
    signal: AbortSignal
): Promise<Uint8Array> => {
    const response = await fetch(`${GEMINI_API}/${encodeURIComponent(model)}:generateContent`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
        body: geminiSpeechBody(text, voiceName),
        signal: signal,
    })
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
const supportsGeminiStreaming = (model: string) => {
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

/**
 * Streams one piece into the player. Returns false when the stream produced no audio,
 * so the caller can fetch that piece as a complete clip instead.
 */
const streamGeminiSegment = async (
    text: string,
    apiKey: string,
    voiceName: string,
    model: string,
    player: PcmStreamPlayer,
    signal: AbortSignal,
    onAudio: () => void
): Promise<boolean> => {
    const response = await streamingFetch(
        `${GEMINI_API}/${encodeURIComponent(model)}:streamGenerateContent?alt=sse`,
        {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
            body: geminiSpeechBody(text, voiceName),
            signal: signal,
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
            onAudio()
            player.push(base64ToBytes(part.inlineData.data))
        }
    }

    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let pending = ''
    for (;;) {
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
    // Audio already played cannot be taken back, so a piece cut short is only reported.
    if (stream.error || (stream.finishReason && stream.finishReason !== 'STOP')) {
        Logger.warn(`Gemini speech stream ended early (${stream.error || stream.finishReason})`)
    }
    return true
}

const playGeminiSpeech = async (
    text: string,
    apiKey: string,
    voiceName: string,
    model: string,
    rate: number
): Promise<void> => {
    if (!supportsGeminiStreaming(model)) return playGeminiFile(text, apiKey, voiceName, model, rate)

    const generation = geminiGeneration
    const controller = new AbortController()
    geminiAbortController = controller
    const player = new PcmStreamPlayer(STREAM_SAMPLE_RATE, Math.min(rate, 2))
    const finish = () => player.stop()
    finishGeminiPlayback = finish

    const onAudio = createFirstAudioLogger('Gemini')

    try {
        for (const segment of splitGeminiSegments(text)) {
            if (generation !== geminiGeneration) break
            const streamed = await streamGeminiSegment(
                segment,
                apiKey,
                voiceName,
                model,
                player,
                controller.signal,
                onAudio
            )
            if (streamed || generation !== geminiGeneration) continue
            const pcm = await fetchGeminiAudio(segment, apiKey, voiceName, model, controller.signal)
            onAudio()
            player.push(pcm)
        }
        player.end()
    } catch (error) {
        player.stop()
        if (!isAbort(error)) throw error
    }
    await player.done
    if (finishGeminiPlayback === finish) finishGeminiPlayback = undefined
}

const playGeminiFile = async (
    text: string,
    apiKey: string,
    voiceName: string,
    model: string,
    rate: number
): Promise<void> => {
    const controller = new AbortController()
    geminiAbortController = controller
    const pcm = await fetchGeminiAudio(text, apiKey, voiceName, model, controller.signal)

    const audioFile = new File(Paths.cache, `gemini-tts-${Date.now()}.wav`)
    audioFile.write(pcmToWav(pcm))
    await setAudioModeAsync({ playsInSilentMode: true })

    await new Promise<void>((resolve) => {
        const player = createAudioPlayer(audioFile.uri, { updateInterval: 200 })
        geminiPlayer = player
        player.setPlaybackRate(Math.min(rate, 2))
        let hasStarted = false

        const finish = () => {
            if (geminiPlayer !== player) return
            clearInterval(playbackCheck)
            geminiPlayer = undefined
            finishGeminiPlayback = undefined
            player.remove()
            resolve()
        }
        finishGeminiPlayback = finish
        const playbackCheck = setInterval(() => {
            if (player.playing || player.currentTime > 0) hasStarted = true
            if (hasStarted && !player.playing) finish()
        }, 200)
        player.play()
    })
}

const getGeminiError = (error: unknown) => {
    if (error instanceof Error && error.name === 'AbortError') return 'Gemini speech stopped'
    if (error instanceof Error) return `Gemini: ${error.message}`
    return 'Gemini speech failed'
}

let cartesiaPlayer: AudioPlayer | undefined
let cartesiaAbortController: AbortController | undefined
let cartesiaQueue = Promise.resolve()
let cartesiaGeneration = 0
let finishCartesiaPlayback: (() => void) | undefined
let cartesiaSocket: WebSocket | undefined

const stopCartesiaPlayback = () => {
    cartesiaGeneration += 1
    cartesiaAbortController?.abort()
    cartesiaAbortController = undefined
    cartesiaSocket?.close()
    cartesiaSocket = undefined
    cartesiaPlayer?.pause()
    finishCartesiaPlayback?.()
    finishCartesiaPlayback = undefined
    cartesiaPlayer?.remove()
    cartesiaPlayer = undefined
}

const queueCartesiaSpeech = (
    text: string,
    apiKey: string,
    voiceId: string,
    model: string,
    language: string,
    rate: number
): Promise<void> => {
    const generation = cartesiaGeneration
    cartesiaQueue = cartesiaQueue
        .catch(() => undefined)
        .then(async () => {
            if (generation !== cartesiaGeneration) return
            await playCartesiaSpeech(text, apiKey, voiceId, model, language, rate)
        })
    return cartesiaQueue
}

const getCartesiaSpeechSpeed = (rate: number) => Math.min(1.5, Math.max(0.6, rate))

const playCartesiaFile = async (
    text: string,
    apiKey: string,
    voiceId: string,
    model: string,
    language: string,
    rate: number
): Promise<void> => {
    const controller = new AbortController()
    cartesiaAbortController = controller
    const speechSpeed = getCartesiaSpeechSpeed(rate)
    const response = await fetch('https://api.cartesia.ai/tts/bytes', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${apiKey}`,
            'Cartesia-Version': '2026-03-01',
        },
        body: JSON.stringify({
            model_id: model,
            transcript: text,
            voice: { mode: 'id', id: voiceId },
            language,
            output_format: {
                container: 'mp3',
                sample_rate: 44100,
                bit_rate: 128000,
            },
            generation_config: {
                speed: speechSpeed,
            },
        }),
        signal: controller.signal,
    })
    if (!response.ok) {
        const detail = await response.text()
        throw new Error(detail || `Cartesia request failed (${response.status})`)
    }

    const audioFile = new File(Paths.cache, `cartesia-tts-${Date.now()}.mp3`)
    audioFile.write(new Uint8Array(await response.arrayBuffer()))
    await setAudioModeAsync({ playsInSilentMode: true })

    await new Promise<void>((resolve) => {
        const player = createAudioPlayer(audioFile.uri, { updateInterval: 200 })
        cartesiaPlayer = player
        const playbackBoost = rate > speechSpeed ? Math.min(rate / speechSpeed, 2) : 1
        player.setPlaybackRate(playbackBoost)
        let hasStarted = false

        const finish = () => {
            if (cartesiaPlayer !== player) return
            clearInterval(playbackCheck)
            cartesiaPlayer = undefined
            finishCartesiaPlayback = undefined
            player.remove()
            resolve()
        }
        finishCartesiaPlayback = finish
        const playbackCheck = setInterval(() => {
            if (player.playing || player.currentTime > 0) hasStarted = true
            if (hasStarted && !player.playing) finish()
        }, 200)
        player.play()
    })
}

/**
 * Cartesia's HTTP endpoint is not documented as progressive, but its WebSocket is:
 * audio arrives as base64 PCM chunks while the rest is still being synthesised.
 */
const playCartesiaSpeech = async (
    text: string,
    apiKey: string,
    voiceId: string,
    model: string,
    language: string,
    rate: number
): Promise<void> => {
    const speechSpeed = getCartesiaSpeechSpeed(rate)
    // Beyond Cartesia's own speed range the remainder is applied at playback, as before.
    const playbackBoost = rate > speechSpeed ? Math.min(rate / speechSpeed, 2) : 1
    const generation = cartesiaGeneration
    const onAudio = createFirstAudioLogger('Cartesia')
    const player = new PcmStreamPlayer(STREAM_SAMPLE_RATE, playbackBoost)
    const contextId = `misechat-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    let receivedAudio = false

    const outcome = await new Promise<'played' | 'unavailable'>((resolve, reject) => {
        let settled = false
        const settle = (action: () => void) => {
            if (settled) return
            settled = true
            action()
        }

        const socket = new WebSocket(
            `wss://api.cartesia.ai/tts/websocket?cartesia_version=2026-08-14&api_key=${encodeURIComponent(apiKey)}`
        )
        cartesiaSocket = socket
        finishCartesiaPlayback = () => {
            player.stop()
            socket.close()
            settle(() => resolve('played'))
        }

        socket.onopen = () => {
            socket.send(
                JSON.stringify({
                    model_id: model,
                    transcript: text,
                    voice: voiceId,
                    language: language,
                    context_id: contextId,
                    continue: false,
                    output_format: {
                        container: 'raw',
                        encoding: 'pcm_s16le',
                        sample_rate: STREAM_SAMPLE_RATE,
                    },
                    generation_config: { speed: speechSpeed },
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
                player.stop()
                socket.close()
                settle(() => reject(new Error(message.message || message.title || 'stream error')))
                return
            }
            if (message.type === 'chunk' && message.data) {
                receivedAudio = true
                onAudio()
                player.push(base64ToBytes(message.data))
            }
            if (message.type === 'done' || message.done) {
                player.end()
                socket.close()
                settle(() => resolve('played'))
            }
        }
        // Failing before any audio usually means WebSockets are blocked on this network,
        // so file playback is tried instead; failing mid-reply just ends what was heard.
        socket.onerror = () => {
            if (!receivedAudio) settle(() => resolve('unavailable'))
        }
        socket.onclose = () => {
            if (!receivedAudio) {
                settle(() => resolve('unavailable'))
                return
            }
            player.end()
            settle(() => resolve('played'))
        }
    })

    if (cartesiaSocket?.readyState !== WebSocket.OPEN) cartesiaSocket = undefined
    if (outcome === 'unavailable') {
        player.stop()
        // Stopped by the user before audio arrived; that is not a reason to retry over HTTP.
        if (generation !== cartesiaGeneration) return
        Logger.warn('Cartesia streaming unavailable, using file playback')
        return playCartesiaFile(text, apiKey, voiceId, model, language, rate)
    }
    await player.done
    finishCartesiaPlayback = undefined
}

const getCartesiaError = (error: unknown) => {
    if (error instanceof Error && error.name === 'AbortError') return 'Cartesia speech stopped'
    if (error instanceof Error) return `Cartesia: ${error.message}`
    return 'Cartesia speech failed'
}

const base64ToBytes = (base64: string): Uint8Array => {
    const binary = atob(base64)
    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
    return bytes
}

const pcmToWav = (pcmData: Uint8Array, sampleRate = 24000, channels = 1, bitsPerSample = 16) => {
    const byteRate = (sampleRate * channels * bitsPerSample) / 8
    const blockAlign = (channels * bitsPerSample) / 8
    const buffer = new ArrayBuffer(44 + pcmData.length)
    const view = new DataView(buffer)

    const writeString = (offset: number, value: string) => {
        for (let i = 0; i < value.length; i++) view.setUint8(offset + i, value.charCodeAt(i))
    }

    writeString(0, 'RIFF')
    view.setUint32(4, 36 + pcmData.length, true)
    writeString(8, 'WAVE')
    writeString(12, 'fmt ')
    view.setUint32(16, 16, true)
    view.setUint16(20, 1, true)
    view.setUint16(22, channels, true)
    view.setUint32(24, sampleRate, true)
    view.setUint32(28, byteRate, true)
    view.setUint16(32, blockAlign, true)
    view.setUint16(34, bitsPerSample, true)
    writeString(36, 'data')
    view.setUint32(40, pcmData.length, true)

    const wav = new Uint8Array(buffer)
    wav.set(pcmData, 44)
    return wav
}

const cleanMarkdown = (text: string): string => {
    const result = text.replace(/([*_]{1,2}|`|\[\^.*?\]\(.*?\)|<\/?[^>]+>)/g, '')
    return result
}
