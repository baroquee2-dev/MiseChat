import * as Speech from 'expo-speech'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Text, View } from 'react-native'
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller'

import ThemedButton from '@components/buttons/ThemedButton'
import DropdownSheet from '@components/input/DropdownSheet'
import ThemedSlider from '@components/input/ThemedSlider'
import ThemedSwitch from '@components/input/ThemedSwitch'
import ThemedTextInput from '@components/input/ThemedTextInput'
import SectionTitle from '@components/text/SectionTitle'
import HeaderTitle from '@components/views/HeaderTitle'
import { useGeminiApiKey } from '@lib/engine/API/GeminiKey'
import i18n from '@lib/i18n'
import { Logger } from '@lib/state/Logger'
import { useTTS, type TTSProvider } from '@lib/state/TTS'
import { Theme } from '@lib/theme/ThemeManager'
import { groupBy } from '@lib/utils/Array'
import { SPEECH_MODES, type SpeechMode } from '@lib/utils/SpeechText'

type LanguageListItem = {
    [key: string]: Speech.Voice[]
}

type ElevenLabsModel = {
    model_id: string
    name: string
    description?: string
    can_do_text_to_speech?: boolean
}

type ElevenLabsVoice = {
    voice_id: string
    name: string
    category?: string
    description?: string
}

const fallbackElevenLabsModels: ElevenLabsModel[] = [
    { model_id: 'eleven_v3', name: 'Eleven v3' },
    { model_id: 'eleven_flash_v2_5', name: 'Eleven Flash v2.5' },
    { model_id: 'eleven_turbo_v2_5', name: 'Eleven Turbo v2.5' },
    { model_id: 'eleven_multilingual_v2', name: 'Eleven Multilingual v2' },
]

const fallbackElevenLabsVoices: ElevenLabsVoice[] = [
    { voice_id: '21m00Tcm4TlvDq8ikWAM', name: 'Rachel', category: 'premade' },
]

type GeminiVoice = {
    name: string
    description: string
}

type GeminiModel = {
    model_id: string
    name: string
}

const geminiVoices: GeminiVoice[] = [
    { name: 'Zephyr', description: 'Bright' },
    { name: 'Puck', description: 'Upbeat' },
    { name: 'Charon', description: 'Informative' },
    { name: 'Kore', description: 'Firm' },
    { name: 'Fenrir', description: 'Excitable' },
    { name: 'Leda', description: 'Youthful' },
    { name: 'Orus', description: 'Firm' },
    { name: 'Aoede', description: 'Breezy' },
    { name: 'Callirrhoe', description: 'Easy-going' },
    { name: 'Autonoe', description: 'Bright' },
    { name: 'Enceladus', description: 'Breathy' },
    { name: 'Iapetus', description: 'Clear' },
    { name: 'Umbriel', description: 'Easy-going' },
    { name: 'Algieba', description: 'Smooth' },
    { name: 'Despina', description: 'Smooth' },
    { name: 'Erinome', description: 'Clear' },
    { name: 'Algenib', description: 'Gravelly' },
    { name: 'Rasalgethi', description: 'Informative' },
    { name: 'Laomedeia', description: 'Upbeat' },
    { name: 'Achernar', description: 'Soft' },
    { name: 'Alnilam', description: 'Firm' },
    { name: 'Schedar', description: 'Even' },
    { name: 'Gacrux', description: 'Mature' },
    { name: 'Pulcherrima', description: 'Forward' },
    { name: 'Achird', description: 'Friendly' },
    { name: 'Zubenelgenubi', description: 'Casual' },
    { name: 'Vindemiatrix', description: 'Gentle' },
    { name: 'Sadachbia', description: 'Lively' },
    { name: 'Sadaltager', description: 'Knowledgeable' },
    { name: 'Sulafat', description: 'Warm' },
]

const geminiModels: GeminiModel[] = [
    { model_id: 'gemini-3.1-flash-tts-preview', name: 'Gemini 3.1 Flash TTS' },
    { model_id: 'gemini-2.5-flash-preview-tts', name: 'Gemini 2.5 Flash TTS' },
    { model_id: 'gemini-2.5-pro-preview-tts', name: 'Gemini 2.5 Pro TTS' },
]

type CartesiaVoice = {
    id: string
    name: string
    description: string
    language: string
}

type CartesiaModel = {
    model_id: string
    name: string
    descKey: 'latest' | 'stable' | 'preview'
}

const cartesiaModels: CartesiaModel[] = [
    { model_id: 'sonic-3.6', name: 'Sonic 3.6', descKey: 'latest' },
    { model_id: 'sonic-3.5', name: 'Sonic 3.5', descKey: 'stable' },
    { model_id: 'sonic-3', name: 'Sonic 3', descKey: 'stable' },
    // Cartesia deprecated `sonic-latest` in favour of `sonic-preview`.
    { model_id: 'sonic-preview', name: 'Sonic Preview', descKey: 'preview' },
]

const cartesiaLanguageCodes = ['zh', 'en', 'ja', 'ko', 'fr', 'de', 'es', 'pt'] as const

const fallbackCartesiaVoices: CartesiaVoice[] = [
    {
        id: 'db6b0ed5-d5d3-463d-ae85-518a07d3c2b4',
        name: 'Skylar',
        description: 'Friendly Guide',
        language: 'en',
    },
]

const TTSManagerScreen = () => {
    const { t } = useTranslation()
    const { color, spacing, fontSize, borderRadius } = Theme.useTheme()
    const {
        voice,
        setVoice,
        enabled,
        setEnabled,
        auto,
        setAuto,
        rate,
        setRate,
        live,
        setLive,
        provider,
        setProvider,
        elevenLabsApiKey,
        setElevenLabsApiKey,
        elevenLabsVoiceId,
        setElevenLabsVoiceId,
        elevenLabsModel,
        setElevenLabsModel,
        geminiVoiceName,
        setGeminiVoiceName,
        geminiModel,
        setGeminiModel,
        cartesiaApiKey,
        setCartesiaApiKey,
        cartesiaVoiceId,
        setCartesiaVoiceId,
        cartesiaModel,
        setCartesiaModel,
        cartesiaLanguage,
        setCartesiaLanguage,
        startTTS,
        stopTTS,
        speechMode,
        setSpeechMode,
    } = useTTS()
    const geminiApiKey = useGeminiApiKey()
    const [lang, setLang] = useState(voice?.language ?? 'en-US')
    const [modelList, setModelList] = useState<Speech.Voice[]>([])
    const languageList: LanguageListItem = groupBy(modelList, 'language')
    const [testAudioText, setTestAudioText] = useState(() => i18n.t('tts.testAudio'))
    const [elevenLabsModels, setElevenLabsModels] = useState(fallbackElevenLabsModels)
    const [elevenLabsVoices, setElevenLabsVoices] = useState(fallbackElevenLabsVoices)
    const [cartesiaVoices, setCartesiaVoices] = useState(fallbackCartesiaVoices)

    const providerLabels: Record<TTSProvider, string> = {
        device: t('tts.deviceVoice'),
        elevenlabs: 'ElevenLabs',
        gemini: 'Gemini',
        cartesia: 'Cartesia',
    }

    const cartesiaLanguages = cartesiaLanguageCodes.map((code) => ({
        code,
        label: t(`tts.lang.${code}`),
    }))

    const languages = Object.keys(languageList)
        .sort()
        .map((name) => {
            return name
        })

    useEffect(() => {
        getVoices()
    }, [])

    const getVoices = (value = false) => {
        Speech.getAvailableVoicesAsync().then((list) => setModelList(list))
    }

    const getCartesiaVoices = async () => {
        if (!cartesiaApiKey.trim()) {
            Logger.warnToast(i18n.t('tts.enterCartesiaKey'))
            return
        }
        try {
            const voices: CartesiaVoice[] = []
            let cursor: string | null = null
            let hasMore = true

            while (hasMore && voices.length < 200) {
                const params = new URLSearchParams({ limit: '100' })
                if (cursor) params.set('starting_after', cursor)
                const response = await fetch(`https://api.cartesia.ai/voices?${params.toString()}`, {
                    headers: {
                        Authorization: `Bearer ${cartesiaApiKey}`,
                        'Cartesia-Version': '2026-03-01',
                    },
                })
                if (!response.ok) throw new Error(`Request failed (${response.status})`)
                const result = (await response.json()) as {
                    data?: {
                        id: string
                        name: string
                        description?: string
                        language?: string
                    }[]
                    has_more?: boolean
                    next_page?: string | null
                }
                voices.push(
                    ...(result.data ?? []).map((voice) => ({
                        id: voice.id,
                        name: voice.name,
                        description: voice.description ?? '',
                        language: voice.language ?? '',
                    }))
                )
                hasMore = !!result.has_more
                cursor = result.next_page ?? null
                if (!cursor) hasMore = false
            }

            if (voices.length) {
                setCartesiaVoices(voices)
                if (!voices.some((voice) => voice.id === cartesiaVoiceId)) {
                    setCartesiaVoiceId(voices[0].id)
                }
            } else {
                Logger.warnToast(i18n.t('tts.noCartesiaVoices'))
            }
        } catch (error) {
            Logger.errorToast(
                error instanceof Error
                    ? i18n.t('tts.cartesiaError', { message: error.message })
                    : i18n.t('tts.couldNotLoadVoices')
            )
        }
    }

    const getElevenLabsModels = async () => {
        if (!elevenLabsApiKey.trim()) {
            Logger.warnToast(i18n.t('tts.enterElevenLabsKey'))
            return
        }
        try {
            const response = await fetch('https://api.elevenlabs.io/v1/models', {
                headers: { 'xi-api-key': elevenLabsApiKey },
            })
            if (!response.ok) throw new Error(`Request failed (${response.status})`)
            const models = (await response.json()) as ElevenLabsModel[]
            const ttsModels = models.filter((model) => model.can_do_text_to_speech)
            setElevenLabsModels(ttsModels.length ? ttsModels : fallbackElevenLabsModels)
            if (
                ttsModels.length &&
                !ttsModels.some((model) => model.model_id === elevenLabsModel)
            ) {
                setElevenLabsModel(ttsModels[0].model_id)
            }
        } catch (error) {
            Logger.errorToast(
                error instanceof Error
                    ? i18n.t('tts.elevenLabsError', { message: error.message })
                    : i18n.t('tts.couldNotLoadModels')
            )
        }
    }

    const getElevenLabsVoices = async () => {
        if (!elevenLabsApiKey.trim()) {
            Logger.warnToast(i18n.t('tts.enterElevenLabsKey'))
            return
        }
        try {
            const response = await fetch('https://api.elevenlabs.io/v1/voices', {
                headers: { 'xi-api-key': elevenLabsApiKey },
            })
            if (!response.ok) throw new Error(`Request failed (${response.status})`)
            const result = (await response.json()) as { voices?: ElevenLabsVoice[] }
            const voices = result.voices ?? []
            if (voices.length) {
                setElevenLabsVoices(voices)
                if (!voices.some((voice) => voice.voice_id === elevenLabsVoiceId)) {
                    setElevenLabsVoiceId(voices[0].voice_id)
                }
            } else {
                Logger.warnToast(i18n.t('tts.noElevenLabsVoices'))
            }
        } catch (error) {
            Logger.errorToast(
                error instanceof Error
                    ? i18n.t('tts.elevenLabsError', { message: error.message })
                    : i18n.t('tts.couldNotLoadVoices')
            )
        }
    }

    return (
        <KeyboardAwareScrollView
            style={{
                marginVertical: 16,
                paddingVertical: 16,
                paddingHorizontal: 16,
            }}
            contentContainerStyle={{ rowGap: 8 }}>
            <HeaderTitle title={t('tts.title')} />
            <SectionTitle>{t('tts.settings')}</SectionTitle>

            <ThemedSwitch
                label={t('tts.enable')}
                value={enabled}
                onChangeValue={(value) => {
                    if (value) {
                        getVoices(true)
                    } else void stopTTS()
                    setEnabled(value)
                }}
            />
            <ThemedSwitch
                value={auto}
                onChangeValue={(value) => {
                    if (value) {
                        setLive(false)
                    }
                    setAuto(value)
                }}
                label={t('tts.autoAfter')}
            />

            <ThemedSwitch
                value={live}
                onChangeValue={(value) => {
                    if (value) {
                        setAuto(false)
                    }
                    setLive(value)
                }}
                label={t('tts.autoDuring')}
            />

            <ThemedSlider
                label={t('tts.speed')}
                min={0.1}
                max={2.5}
                step={0.1}
                precision={1}
                value={rate}
                onValueChange={setRate}
            />

            <SectionTitle style={{ marginTop: 8 }}>{t('tts.speechMode.title')}</SectionTitle>
            <DropdownSheet
                selected={speechMode}
                data={SPEECH_MODES}
                labelExtractor={(item) => t(`tts.speechMode.${item}`)}
                onChangeValue={(item: SpeechMode) => setSpeechMode(item)}
                modalTitle={t('tts.speechMode.title')}
                closeOnSelect
            />
            <Text style={{ color: color.text._400, paddingBottom: 4 }}>
                {t(`tts.speechMode.${speechMode}Desc`)}
            </Text>

            <SectionTitle style={{ marginTop: 8 }}>{t('tts.speechProvider')}</SectionTitle>
            <DropdownSheet
                selected={provider}
                data={['device', 'elevenlabs', 'gemini', 'cartesia'] as const}
                labelExtractor={(item) => providerLabels[item]}
                onChangeValue={setProvider}
            />

            {provider === 'elevenlabs' && (
                <>
                    <ThemedTextInput
                        label={t('tts.elevenLabsApiKey')}
                        value={elevenLabsApiKey}
                        onChangeText={setElevenLabsApiKey}
                        secureTextEntry
                        autoCapitalize="none"
                        autoCorrect={false}
                        placeholder="xi-api-key"
                    />
                    <SectionTitle>{t('tts.elevenLabsVoice')}</SectionTitle>
                    <View style={{ flexDirection: 'row', alignItems: 'center', columnGap: 8 }}>
                        <DropdownSheet
                            containerStyle={{ flex: 1 }}
                            search
                            modalTitle={t('tts.selectElevenLabsVoice')}
                            selected={elevenLabsVoices.find(
                                (voice) => voice.voice_id === elevenLabsVoiceId
                            )}
                            data={elevenLabsVoices}
                            labelExtractor={(voice) =>
                                `${voice.name}${voice.category ? ` (${voice.category})` : ''}`
                            }
                            placeholder={t('tts.selectElevenLabsVoiceShort')}
                            onChangeValue={(voice) => setElevenLabsVoiceId(voice.voice_id)}
                        />
                        <ThemedButton
                            iconName="reload"
                            iconSize={20}
                            variant="secondary"
                            onPress={() => void getElevenLabsVoices()}
                        />
                    </View>
                    <ThemedTextInput
                        label={t('tts.voiceIdOptional')}
                        description={t('tts.voiceIdManualHint')}
                        value={elevenLabsVoiceId}
                        onChangeText={setElevenLabsVoiceId}
                        autoCapitalize="none"
                        autoCorrect={false}
                        placeholder="21m00Tcm4TlvDq8ikWAM"
                    />
                    <SectionTitle>{t('tts.elevenLabsModel')}</SectionTitle>
                    <View style={{ flexDirection: 'row', alignItems: 'center', columnGap: 8 }}>
                        <DropdownSheet
                            containerStyle={{ flex: 1 }}
                            selected={elevenLabsModels.find(
                                (model) => model.model_id === elevenLabsModel
                            )}
                            data={elevenLabsModels}
                            labelExtractor={(model) => `${model.name} (${model.model_id})`}
                            placeholder={t('tts.selectElevenLabsModel')}
                            onChangeValue={(model) => setElevenLabsModel(model.model_id)}
                        />
                        <ThemedButton
                            iconName="reload"
                            iconSize={20}
                            variant="secondary"
                            onPress={() => void getElevenLabsModels()}
                        />
                    </View>
                    <ThemedButton
                        label={t('tts.testElevenLabs')}
                        variant="secondary"
                        onPress={() => startTTS(testAudioText, -1)}
                    />
                </>
            )}

            {provider === 'gemini' && (
                <>
                    <View
                        style={{
                            borderRadius: borderRadius.m,
                            borderLeftWidth: 3,
                            borderLeftColor: geminiApiKey ? color.text._400 : color.error._400,
                            backgroundColor: color.neutral._200,
                            padding: spacing.m,
                            rowGap: spacing.xs,
                        }}>
                        <Text style={{ color: color.text._200, fontSize: fontSize.s }}>
                            {t('tts.geminiKeyFromApi')}
                        </Text>
                        <Text
                            style={{
                                color: geminiApiKey ? color.text._400 : color.error._400,
                                fontSize: fontSize.s,
                            }}>
                            {geminiApiKey ? t('tts.geminiKeyFound') : t('tts.geminiKeyMissing')}
                        </Text>
                    </View>
                    <SectionTitle>{t('tts.geminiVoice')}</SectionTitle>
                    <DropdownSheet
                        search
                        modalTitle={t('tts.selectGeminiVoice')}
                        selected={geminiVoices.find((voice) => voice.name === geminiVoiceName)}
                        data={geminiVoices}
                        labelExtractor={(voice) =>
                            `${voice.name} — ${t(`tts.voiceDesc.${voice.description}`)}`
                        }
                        placeholder={t('tts.selectGeminiVoiceShort')}
                        onChangeValue={(voice) => setGeminiVoiceName(voice.name)}
                    />
                    <SectionTitle>{t('tts.geminiModel')}</SectionTitle>
                    <DropdownSheet
                        selected={geminiModels.find((model) => model.model_id === geminiModel)}
                        data={geminiModels}
                        labelExtractor={(model) => `${model.name} (${model.model_id})`}
                        placeholder={t('tts.selectGeminiModel')}
                        onChangeValue={(model) => setGeminiModel(model.model_id)}
                    />
                    <ThemedButton
                        label={t('tts.testGemini')}
                        variant="secondary"
                        onPress={() => startTTS(testAudioText, -1)}
                    />
                </>
            )}

            {provider === 'cartesia' && (
                <>
                    <ThemedTextInput
                        label={t('tts.cartesiaApiKey')}
                        value={cartesiaApiKey}
                        onChangeText={setCartesiaApiKey}
                        secureTextEntry
                        autoCapitalize="none"
                        autoCorrect={false}
                        placeholder="sk_car_..."
                    />
                    <SectionTitle>{t('tts.cartesiaVoice')}</SectionTitle>
                    <View style={{ flexDirection: 'row', alignItems: 'center', columnGap: 8 }}>
                        <DropdownSheet
                            containerStyle={{ flex: 1 }}
                            search
                            modalTitle={t('tts.selectCartesiaVoice')}
                            selected={cartesiaVoices.find((voice) => voice.id === cartesiaVoiceId)}
                            data={cartesiaVoices}
                            labelExtractor={(voice) =>
                                `${voice.name}${voice.language ? ` (${voice.language})` : ''}`
                            }
                            placeholder={t('tts.selectCartesiaVoiceShort')}
                            onChangeValue={(voice) => setCartesiaVoiceId(voice.id)}
                        />
                        <ThemedButton
                            iconName="reload"
                            iconSize={20}
                            variant="secondary"
                            onPress={() => void getCartesiaVoices()}
                        />
                    </View>
                    <ThemedTextInput
                        label={t('tts.voiceIdOptional')}
                        description={t('tts.cartesiaVoiceIdHint')}
                        value={cartesiaVoiceId}
                        onChangeText={setCartesiaVoiceId}
                        autoCapitalize="none"
                        autoCorrect={false}
                        placeholder="db6b0ed5-d5d3-463d-ae85-518a07d3c2b4"
                    />
                    <SectionTitle>{t('tts.cartesiaModel')}</SectionTitle>
                    <DropdownSheet
                        selected={cartesiaModels.find((model) => model.model_id === cartesiaModel)}
                        data={cartesiaModels}
                        labelExtractor={(model) =>
                            `${model.name} — ${t(`tts.cartesiaModelDesc.${model.descKey}`)}`
                        }
                        placeholder={t('tts.selectCartesiaModel')}
                        onChangeValue={(model) => setCartesiaModel(model.model_id)}
                    />
                    <SectionTitle>{t('tts.language')}</SectionTitle>
                    <DropdownSheet
                        selected={cartesiaLanguages.find((item) => item.code === cartesiaLanguage)}
                        data={cartesiaLanguages}
                        labelExtractor={(item) => item.label}
                        placeholder={t('tts.selectLanguageShort')}
                        onChangeValue={(item) => setCartesiaLanguage(item.code)}
                    />
                    <ThemedButton
                        label={t('tts.testCartesia')}
                        variant="secondary"
                        onPress={() => startTTS(testAudioText, -1)}
                    />
                </>
            )}

            {provider === 'device' && (
                <>
                    <SectionTitle style={{ marginTop: 8 }}>
                        {t('tts.languageCount', { count: Object.keys(languageList).length })}
                    </SectionTitle>
                    <View style={{ marginTop: 8 }}>
                        <View style={{ flexDirection: 'row', alignItems: 'center', columnGap: 8 }}>
                            <DropdownSheet
                                containerStyle={{ flex: 1 }}
                                selected={lang}
                                data={languages}
                                labelExtractor={(item) => item}
                                placeholder={t('tts.selectLanguage')}
                                onChangeValue={(item) => setLang(item)}
                            />
                            <ThemedButton
                                iconName="reload"
                                iconSize={20}
                                onPress={() => getVoices()}
                                variant="secondary"
                            />
                        </View>
                    </View>

                    <SectionTitle style={{ marginTop: 8 }}>
                        {t('tts.voicesCount', {
                            count: modelList.filter((item) => item.language === lang).length,
                        })}
                    </SectionTitle>

                    <DropdownSheet
                        style={{ marginBottom: 8 }}
                        search
                        modalTitle={t('tts.selectVoice')}
                        selected={voice}
                        data={languageList?.[lang] ?? []}
                        labelExtractor={(item) => item.identifier}
                        placeholder={t('tts.selectVoice')}
                        onChangeValue={(item) => setVoice(item)}
                    />
                    <View
                        style={{
                            flexDirection: 'row',
                            alignItems: 'center',
                            columnGap: 8,
                            backgroundColor: color.neutral._100,
                        }}>
                        <ThemedTextInput
                            value={testAudioText}
                            onChangeText={setTestAudioText}
                            style={{ color: color.text._400, fontStyle: 'italic' }}
                        />
                        <ThemedButton
                            label={t('tts.test')}
                            variant="secondary"
                            onPress={() => {
                                if (voice === undefined) {
                                    Logger.warnToast(i18n.t('tts.noSpeaker'))
                                    return
                                }
                                Speech.speak(testAudioText, {
                                    language: voice.language,
                                    voice: voice.identifier,
                                    rate: rate,
                                })
                            }}
                        />
                    </View>
                </>
            )}
        </KeyboardAwareScrollView>
    )
}

export default TTSManagerScreen
