import { createAudioPlayer, setAudioModeAsync, type AudioPlayer } from 'expo-audio'
import { File, Paths } from 'expo-file-system'
import * as Speech from 'expo-speech'
import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { useShallow } from 'zustand/react/shallow'
import i18n from '@lib/i18n'

import { Storage } from '@lib/enums/Storage'
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
    geminiApiKey: string
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
    setGeminiApiKey: (apiKey: string) => void
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
        geminiApiKey,
        geminiVoiceName,
        geminiModel,
        setGeminiApiKey,
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
            geminiApiKey: state.geminiApiKey,
            geminiVoiceName: state.geminiVoiceName,
            geminiModel: state.geminiModel,
            setGeminiApiKey: state.setGeminiApiKey,
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
        geminiApiKey,
        geminiVoiceName,
        geminiModel,
        setGeminiApiKey,
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
            geminiApiKey: '',
            geminiVoiceName: 'Kore',
            geminiModel: 'gemini-3.1-flash-tts-preview',
            cartesiaApiKey: '',
            cartesiaVoiceId: 'db6b0ed5-d5d3-463d-ae85-518a07d3c2b4',
            cartesiaModel: 'sonic-3.5',
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
                    if (!get().geminiApiKey.trim()) {
                        Logger.errorToast(i18n.t('toast.enterGeminiKey'))
                        clearIndex()
                        return
                    }
                    stopGeminiPlayback()
                    set({ activeChatIndex: index })
                    try {
                        await queueGeminiSpeech(
                            text,
                            get().geminiApiKey,
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
            setGeminiApiKey: (geminiApiKey) => {
                set({ geminiApiKey })
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
                    const { geminiApiKey, geminiVoiceName, geminiModel, rate } = get()
                    if (!geminiApiKey.trim()) {
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
                geminiApiKey: state.geminiApiKey,
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

const playElevenLabsSpeech = async (
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

const playGeminiSpeech = async (
    text: string,
    apiKey: string,
    voiceName: string,
    model: string,
    rate: number
): Promise<void> => {
    const controller = new AbortController()
    geminiAbortController = controller
    const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
        {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-goog-api-key': apiKey,
            },
            body: JSON.stringify({
                contents: [{ parts: [{ text }] }],
                generationConfig: {
                    responseModalities: ['AUDIO'],
                    speechConfig: {
                        voiceConfig: {
                            prebuiltVoiceConfig: { voiceName },
                        },
                    },
                },
            }),
            signal: controller.signal,
        }
    )
    if (!response.ok) {
        const detail = await response.text()
        throw new Error(detail || `Gemini TTS request failed (${response.status})`)
    }

    const result = (await response.json()) as {
        candidates?: { content?: { parts?: { inlineData?: { data?: string } }[] } }[]
    }
    const base64Audio = result.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data
    if (!base64Audio) throw new Error('Gemini TTS returned no audio data')

    const audioFile = new File(Paths.cache, `gemini-tts-${Date.now()}.wav`)
    audioFile.write(pcmToWav(base64ToBytes(base64Audio)))
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

const stopCartesiaPlayback = () => {
    cartesiaGeneration += 1
    cartesiaAbortController?.abort()
    cartesiaAbortController = undefined
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

const playCartesiaSpeech = async (
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
