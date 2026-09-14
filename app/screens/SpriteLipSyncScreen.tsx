import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Image, StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useShallow } from 'zustand/react/shallow'

import ThemedButton from '@components/buttons/ThemedButton'
import ThemedSlider from '@components/input/ThemedSlider'
import ThemedTextInput from '@components/input/ThemedTextInput'
import HeaderTitle from '@components/views/HeaderTitle'
import { PcmStreamPlayer } from '@lib/audio/PcmStreamPlayer'
import { isAbort } from '@lib/audio/SpeechStreams'
import { useGeminiApiKey } from '@lib/engine/API/GeminiKey'
import { getLipSyncVoiceIssue, providerLabel, streamForLipSync } from '@lib/lemonslice/LipSyncVoice'
import { Logger } from '@lib/state/Logger'
import { type MouthSlot, spriteImageUri, useSpriteLipSync } from '@lib/state/SpriteLipSync'
import { useTTSStore } from '@lib/state/TTS'
import { runBackgroundCompletion } from '@lib/summary/BackgroundGeneration'
import { Theme } from '@lib/theme/ThemeManager'

type ChatLine = { role: 'user' | 'character'; text: string }
type TurnStatus = 'idle' | 'thinking' | 'speaking'

const SLOTS: MouthSlot[] = ['closed', 'half', 'open']
/** About 16 frames a second, quick enough to read as talking without flickering. */
const FRAME_INTERVAL_MS = 60
const HISTORY_LINES = 16
const REPLY_TOKENS = 400
const REPLY_TEMPERATURE = 0.8

/** Replies are voiced as-is, so actions, asides and reasoning must not be read aloud. */
const toSpoken = (text: string) =>
    text
        .replace(/<think>[\s\S]*?<\/think>/gi, ' ')
        .replace(/\*[^*]*\*/g, ' ')
        .replace(/[（(][^）)]*[）)]/g, ' ')
        .replace(/[`_#>~]/g, '')
        .replace(/\s+/g, ' ')
        .trim()

const SpriteLipSyncScreen = () => {
    const { t } = useTranslation()
    const styles = useStyles()

    const settings = useSpriteLipSync(
        useShallow((state) => ({
            images: state.images,
            character: state.character,
            halfThreshold: state.halfThreshold,
            openThreshold: state.openThreshold,
            pickImage: state.pickImage,
            setCharacter: state.setCharacter,
            setHalfThreshold: state.setHalfThreshold,
            setOpenThreshold: state.setOpenThreshold,
        }))
    )
    const voice = useTTSStore(
        useShallow((state) => ({
            provider: state.provider,
            elevenLabsApiKey: state.elevenLabsApiKey,
            cartesiaApiKey: state.cartesiaApiKey,
        }))
    )
    const geminiApiKey = useGeminiApiKey()
    const voiceIssue = getLipSyncVoiceIssue(voice, geminiApiKey)

    const [messages, setMessages] = useState<ChatLine[]>([])
    const [input, setInput] = useState('')
    const [status, setStatus] = useState<TurnStatus>('idle')
    const [mouth, setMouth] = useState<{ slot: MouthSlot; level: number }>({
        slot: 'closed',
        level: 0,
    })
    const playerRef = useRef<PcmStreamPlayer | null>(null)
    const turnRef = useRef<AbortController | null>(null)

    useEffect(() => {
        if (status !== 'speaking') return
        const timer = setInterval(() => {
            const level = playerRef.current?.level() ?? 0
            const slot: MouthSlot =
                level >= settings.openThreshold
                    ? 'open'
                    : level >= settings.halfThreshold
                      ? 'half'
                      : 'closed'
            setMouth((current) =>
                current.slot === slot && Math.abs(current.level - level) < 0.005
                    ? current
                    : { slot: slot, level: level }
            )
        }, FRAME_INTERVAL_MS)
        return () => clearInterval(timer)
    }, [status, settings.halfThreshold, settings.openThreshold])

    // Leaving the page must not leave a reply talking in the background.
    useEffect(
        () => () => {
            turnRef.current?.abort()
            playerRef.current?.stop()
        },
        []
    )

    const voiceMessage =
        voiceIssue === 'unsupported'
            ? t('spriteLipSync.voiceUnsupported')
            : voiceIssue === 'missingKey'
              ? voice.provider === 'gemini'
                  ? t('lemonSlice.missingGeminiKey')
                  : t('spriteLipSync.voiceMissingKey', { provider: providerLabel(voice.provider) })
              : ''

    /** A missing frame borrows the nearest smaller mouth, so two images still animate. */
    const visibleSlot = (slot: MouthSlot): MouthSlot => {
        const order: MouthSlot[] =
            slot === 'open'
                ? ['open', 'half', 'closed']
                : slot === 'half'
                  ? ['half', 'closed']
                  : ['closed']
        return order.find((candidate) => settings.images[candidate]) ?? 'closed'
    }
    const shown = visibleSlot(mouth.slot)
    const hasImage = SLOTS.some((slot) => settings.images[slot])

    const endTurn = () => {
        turnRef.current = null
        setStatus('idle')
        setMouth({ slot: 'closed', level: 0 })
    }

    const stopTurn = () => {
        turnRef.current?.abort()
        playerRef.current?.stop()
        playerRef.current = null
        endTurn()
    }

    const speak = async (text: string, turn: AbortController) => {
        const tts = useTTSStore.getState()
        // Cartesia applies the speed while synthesising; the others are sped up at playback.
        const playbackRate = tts.provider === 'cartesia' ? 1 : Math.min(tts.rate, 2)
        const holder: { player: PcmStreamPlayer | null } = { player: null }
        try {
            await streamForLipSync(text, tts, turn.signal, (pcm, sampleRate) => {
                if (!holder.player) {
                    holder.player = new PcmStreamPlayer(sampleRate, playbackRate)
                    playerRef.current = holder.player
                }
                holder.player.push(pcm)
            })
            holder.player?.end()
            await holder.player?.done
        } catch (error) {
            holder.player?.stop()
            if (!isAbort(error)) {
                const detail = error instanceof Error ? error.message : String(error)
                Logger.errorToast(`${providerLabel(tts.provider)}: ${detail}`)
            }
        } finally {
            if (playerRef.current === holder.player) playerRef.current = null
        }
    }

    const send = async () => {
        const text = input.trim()
        if (!text || status !== 'idle') return
        if (SLOTS.some((slot) => !settings.images[slot])) {
            Logger.errorToast(t('spriteLipSync.missingImages'))
            return
        }
        if (!settings.character.trim()) {
            Logger.errorToast(t('spriteLipSync.missingCharacter'))
            return
        }
        if (voiceMessage) {
            Logger.errorToast(voiceMessage)
            return
        }

        const history: ChatLine[] = [...messages, { role: 'user', text: text }]
        setMessages(history)
        setInput('')
        setStatus('thinking')
        const turn = new AbortController()
        turnRef.current = turn

        const transcript = history
            .slice(-HISTORY_LINES)
            .map(
                (line) =>
                    `${line.role === 'user' ? t('spriteLipSync.userLabel') : t('spriteLipSync.characterLabel')}: ${line.text}`
            )
            .join('\n')
        const reply = await runBackgroundCompletion({
            system: `${settings.character.trim()}\n\n${t('spriteLipSync.replyInstruction')}`,
            user: t('spriteLipSync.historyPrompt', {
                history: transcript,
                interpolation: { escapeValue: false },
            }),
            maxTokens: REPLY_TOKENS,
            temperature: REPLY_TEMPERATURE,
            label: 'mouth sprite test reply',
        })
        // Stopped while the reply was being written.
        if (turnRef.current !== turn) return

        const spoken = toSpoken(reply ?? '')
        if (!spoken) {
            Logger.errorToast(t('spriteLipSync.generationFailed'))
            endTurn()
            return
        }
        setMessages([...history, { role: 'character', text: spoken }])
        setStatus('speaking')
        await speak(spoken, turn)
        if (turnRef.current === turn) endTurn()
    }

    const statusText =
        status === 'thinking'
            ? t('spriteLipSync.thinking')
            : status === 'speaking'
              ? t('spriteLipSync.speaking')
              : ''

    return (
        <SafeAreaView edges={['bottom']} style={styles.container}>
            <HeaderTitle title={t('spriteLipSync.title')} />
            <KeyboardAwareScrollView contentContainerStyle={styles.body}>
                <Text style={styles.hint}>{t('spriteLipSync.description')}</Text>

                <View style={styles.stage}>
                    {SLOTS.map((slot) => {
                        const uri = spriteImageUri(settings.images[slot])
                        if (!uri) return null
                        // All frames stay mounted and only opacity changes, so switching never flashes.
                        return (
                            <Image
                                key={slot}
                                source={{ uri: uri }}
                                resizeMode="contain"
                                style={[
                                    StyleSheet.absoluteFill,
                                    { opacity: shown === slot ? 1 : 0 },
                                ]}
                            />
                        )
                    })}
                    {!hasImage && (
                        <Text style={styles.hint}>{t('spriteLipSync.missingImages')}</Text>
                    )}
                </View>
                <Text style={styles.meter}>
                    {t('spriteLipSync.level', { level: mouth.level.toFixed(3) })}
                    {statusText ? `  ${statusText}` : ''}
                </Text>

                <View style={styles.slotRow}>
                    {SLOTS.map((slot) => {
                        const uri = spriteImageUri(settings.images[slot])
                        return (
                            <TouchableOpacity
                                key={slot}
                                style={styles.slot}
                                disabled={status !== 'idle'}
                                onPress={() => void settings.pickImage(slot)}>
                                {uri ? (
                                    <Image
                                        source={{ uri: uri }}
                                        resizeMode="contain"
                                        style={styles.slotImage}
                                    />
                                ) : (
                                    <Text style={styles.hint}>{t('spriteLipSync.pick')}</Text>
                                )}
                                <Text style={styles.slotLabel}>{t(`spriteLipSync.${slot}`)}</Text>
                            </TouchableOpacity>
                        )
                    })}
                </View>

                <ThemedTextInput
                    label={t('spriteLipSync.character')}
                    value={settings.character}
                    onChangeText={settings.setCharacter}
                    placeholder={t('spriteLipSync.characterPlaceholder')}
                    numberOfLines={4}
                    editable={status === 'idle'}
                    containerStyle={styles.field}
                />

                <ThemedSlider
                    label={t('spriteLipSync.halfThreshold')}
                    min={0}
                    max={0.3}
                    step={0.005}
                    precision={3}
                    value={settings.halfThreshold}
                    onValueChange={settings.setHalfThreshold}
                />
                <ThemedSlider
                    label={t('spriteLipSync.openThreshold')}
                    min={0}
                    max={0.3}
                    step={0.005}
                    precision={3}
                    value={settings.openThreshold}
                    onValueChange={settings.setOpenThreshold}
                />

                {!!voiceMessage && <Text style={styles.error}>{voiceMessage}</Text>}

                {messages.map((line, index) => (
                    <View
                        key={index}
                        style={[
                            styles.bubble,
                            line.role === 'user' ? styles.userBubble : styles.characterBubble,
                        ]}>
                        <Text style={styles.bubbleText}>{line.text}</Text>
                    </View>
                ))}

                <View style={styles.inputRow}>
                    <ThemedTextInput
                        value={input}
                        onChangeText={setInput}
                        placeholder={t('spriteLipSync.inputPlaceholder')}
                        editable={status === 'idle'}
                        onSubmitEditing={() => void send()}
                    />
                    {status === 'idle' ? (
                        <ThemedButton
                            label={t('spriteLipSync.send')}
                            variant={input.trim() ? 'primary' : 'disabled'}
                            onPress={() => void send()}
                        />
                    ) : (
                        <ThemedButton
                            label={t('spriteLipSync.stop')}
                            variant="critical"
                            onPress={stopTurn}
                        />
                    )}
                </View>
                {status === 'idle' && messages.length > 0 && (
                    <ThemedButton
                        label={t('spriteLipSync.clear')}
                        variant="secondary"
                        onPress={() => setMessages([])}
                    />
                )}
            </KeyboardAwareScrollView>
        </SafeAreaView>
    )
}

export default SpriteLipSyncScreen

const useStyles = () => {
    const { color, spacing, fontSize, borderRadius } = Theme.useTheme()
    return StyleSheet.create({
        container: { flex: 1, backgroundColor: color.neutral._100 },
        body: { paddingHorizontal: spacing.xl, paddingVertical: spacing.l, rowGap: spacing.l },
        hint: { color: color.text._400, fontSize: fontSize.s },
        error: { color: color.error._400, fontSize: fontSize.s },
        stage: {
            height: 320,
            borderRadius: borderRadius.m,
            backgroundColor: color.neutral._200,
            overflow: 'hidden',
            alignItems: 'center',
            justifyContent: 'center',
        },
        meter: { color: color.text._300, fontSize: fontSize.s, fontFamily: 'monospace' },
        slotRow: { flexDirection: 'row', columnGap: spacing.m },
        slot: {
            flex: 1,
            height: 120,
            borderRadius: borderRadius.m,
            borderWidth: 1,
            borderColor: color.neutral._400,
            alignItems: 'center',
            justifyContent: 'center',
            padding: spacing.xs,
            rowGap: spacing.xs,
        },
        slotImage: { width: '100%', flex: 1 },
        slotLabel: { color: color.text._200, fontSize: fontSize.s },
        field: { flex: 0 },
        bubble: {
            borderRadius: borderRadius.m,
            paddingHorizontal: spacing.m,
            paddingVertical: spacing.xs,
            maxWidth: '85%',
        },
        userBubble: { alignSelf: 'flex-end', backgroundColor: color.neutral._300 },
        characterBubble: { alignSelf: 'flex-start', backgroundColor: color.neutral._200 },
        bubbleText: { color: color.text._100 },
        inputRow: { flexDirection: 'row', alignItems: 'center', columnGap: spacing.m },
    })
}
