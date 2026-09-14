import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { StyleSheet, Text, View } from 'react-native'
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useShallow } from 'zustand/react/shallow'

import ThemedButton from '@components/buttons/ThemedButton'
import ThemedSwitch from '@components/input/ThemedSwitch'
import ThemedTextInput from '@components/input/ThemedTextInput'
import HeaderTitle from '@components/views/HeaderTitle'
import MouthSpriteSettings from '@components/views/MouthSpriteSettings'
import { useGeminiApiKey } from '@lib/engine/API/GeminiKey'
import {
    connectLipSync,
    COST_PER_MINUTE_USD,
    disconnectLipSync,
    IDLE_LIMIT_MS,
} from '@lib/lemonslice/LipSyncService'
import { getLipSyncVoiceIssue, providerLabel } from '@lib/lemonslice/LipSyncVoice'
import { Characters } from '@lib/state/Characters'
import { useLipSyncSession, useLipSyncSettings } from '@lib/state/LemonSlice'
import { Logger } from '@lib/state/Logger'
import { useMouthSprites } from '@lib/state/MouthSprites'
import { useTTSStore } from '@lib/state/TTS'
import { Theme } from '@lib/theme/ThemeManager'

const IDLE_SECONDS = IDLE_LIMIT_MS / 1000

const LemonSliceScreen = () => {
    const { t } = useTranslation()
    const styles = useStyles()
    const { color } = Theme.useTheme()

    const settings = useLipSyncSettings(
        useShallow((state) => ({
            enabled: state.enabled,
            apiKey: state.apiKey,
            dailyUrl: state.dailyUrl,
            dailyApiKey: state.dailyApiKey,
            setEnabled: state.setEnabled,
            setApiKey: state.setApiKey,
            setDailyUrl: state.setDailyUrl,
            setDailyApiKey: state.setDailyApiKey,
        }))
    )
    const { connection, connectedAt, lastActivity } = useLipSyncSession(
        useShallow((state) => ({
            connection: state.connection,
            connectedAt: state.connectedAt,
            lastActivity: state.lastActivity,
        }))
    )
    const characterName = Characters.useCharacterStore((state) => state.card?.name)
    const voice = useTTSStore(
        useShallow((state) => ({
            provider: state.provider,
            elevenLabsApiKey: state.elevenLabsApiKey,
            cartesiaApiKey: state.cartesiaApiKey,
        }))
    )
    const geminiApiKey = useGeminiApiKey()
    const voiceIssue = getLipSyncVoiceIssue(voice, geminiApiKey)
    const voiceName = providerLabel(voice.provider)
    const [now, setNow] = useState(() => Date.now())

    useEffect(() => {
        if (connectedAt === null) return
        const timer = setInterval(() => setNow(Date.now()), 1000)
        return () => clearInterval(timer)
    }, [connectedAt])

    const handleToggle = (value: boolean) => {
        settings.setEnabled(value)
        if (!value) disconnectLipSync('feature disabled')
        // Only one kind of lip sync can drive the portrait at a time.
        else useMouthSprites.getState().setEnabled(false)
    }

    const handleConnect = async () => {
        try {
            await connectLipSync()
        } catch (error) {
            Logger.errorToast(error instanceof Error ? error.message : String(error))
        }
    }

    const connected = connection === 'connected'
    const busy = connection === 'connecting'
    const elapsedMs = connectedAt === null ? 0 : Math.max(0, now - connectedAt)
    const elapsed = `${Math.floor(elapsedMs / 60000)}:${String(
        Math.floor(elapsedMs / 1000) % 60
    ).padStart(2, '0')}`
    const cost = ((elapsedMs / 60000) * COST_PER_MINUTE_USD).toFixed(3)
    const idleLeft = Math.min(
        IDLE_SECONDS,
        Math.max(0, Math.ceil((IDLE_LIMIT_MS - (now - lastActivity)) / 1000))
    )
    const statusColor = connected
        ? color.primary._400
        : connection === 'error'
          ? color.error._400
          : color.text._400

    return (
        <SafeAreaView edges={['bottom']} style={styles.container}>
            <HeaderTitle title={t('lemonSlice.title')} />
            <KeyboardAwareScrollView contentContainerStyle={styles.body}>
                <View style={styles.badgeRow}>
                    <Text style={styles.badge}>{t('lemonSlice.experimental')}</Text>
                </View>
                <Text style={styles.hint}>{t('lemonSlice.description')}</Text>

                <ThemedSwitch
                    label={t('lemonSlice.enable')}
                    value={settings.enabled}
                    onChangeValue={handleToggle}
                />

                {settings.enabled && (
                    <>
                        <View style={styles.reminder}>
                            <Text style={styles.reminderText}>
                                {t('lemonSlice.reminder', { seconds: IDLE_SECONDS })}
                            </Text>
                        </View>

                        <ThemedTextInput
                            label={t('lemonSlice.apiKey')}
                            containerStyle={styles.field}
                            secureTextEntry
                            autoCapitalize="none"
                            autoCorrect={false}
                            editable={!connected && !busy}
                            value={settings.apiKey}
                            onChangeText={settings.setApiKey}
                        />
                        <ThemedTextInput
                            label={t('lemonSlice.dailyUrl')}
                            placeholder="https://you.daily.co/room"
                            containerStyle={styles.field}
                            autoCapitalize="none"
                            autoCorrect={false}
                            editable={!connected && !busy}
                            value={settings.dailyUrl}
                            onChangeText={settings.setDailyUrl}
                        />
                        <ThemedTextInput
                            label={t('lemonSlice.dailyApiKey')}
                            description={t('lemonSlice.dailyApiKeyDesc')}
                            containerStyle={styles.field}
                            secureTextEntry
                            autoCapitalize="none"
                            autoCorrect={false}
                            editable={!connected && !busy}
                            value={settings.dailyApiKey}
                            onChangeText={settings.setDailyApiKey}
                        />

                        <Text style={styles.hint}>
                            {characterName
                                ? t('lemonSlice.character', { name: characterName })
                                : t('lemonSlice.noCharacter')}
                        </Text>
                        <Text style={[styles.hint, !!voiceIssue && { color: color.error._400 }]}>
                            {voiceIssue === 'unsupported'
                                ? t('lemonSlice.deviceUnsupported')
                                : voiceIssue === 'missingKey'
                                  ? voice.provider === 'gemini'
                                      ? t('lemonSlice.missingGeminiKey')
                                      : t('lemonSlice.missingVoiceKey', { provider: voiceName })
                                  : t('lemonSlice.voiceNote', { provider: voiceName }) +
                                    (voice.provider === 'elevenlabs'
                                        ? t('lemonSlice.elevenLabsPlan')
                                        : '')}
                        </Text>
                        <Text style={styles.hint}>{t('lemonSlice.layoutNote')}</Text>

                        <View style={styles.row}>
                            <ThemedButton
                                label={t('lemonSlice.connect')}
                                variant={busy || connected ? 'disabled' : 'secondary'}
                                onPress={handleConnect}
                            />
                            <ThemedButton
                                label={t('lemonSlice.disconnect')}
                                variant={connected || busy ? 'critical' : 'disabled'}
                                onPress={() => disconnectLipSync('user')}
                            />
                            <Text style={[styles.status, { color: statusColor }]}>
                                {t(`lemonSlice.state.${connection}`)}
                            </Text>
                        </View>
                        {connected && (
                            <Text style={styles.meter}>
                                {t('lemonSlice.meter', {
                                    elapsed: elapsed,
                                    cost: cost,
                                    idle: idleLeft,
                                })}
                            </Text>
                        )}
                    </>
                )}

                <View style={styles.divider} />
                <MouthSpriteSettings />
            </KeyboardAwareScrollView>
        </SafeAreaView>
    )
}

export default LemonSliceScreen

const useStyles = () => {
    const { color, spacing, fontSize, borderRadius } = Theme.useTheme()
    return StyleSheet.create({
        container: { flex: 1, backgroundColor: color.neutral._100 },
        body: { paddingHorizontal: spacing.xl, paddingVertical: spacing.l, rowGap: spacing.l },
        badgeRow: { flexDirection: 'row' },
        badge: {
            color: color.error._300,
            borderColor: color.error._400,
            borderWidth: 1,
            borderRadius: borderRadius.m,
            paddingHorizontal: spacing.m,
            paddingVertical: spacing.xs,
            fontSize: fontSize.s,
            fontWeight: '600',
        },
        hint: { color: color.text._400, fontSize: fontSize.s },
        reminder: {
            borderRadius: borderRadius.m,
            borderLeftWidth: 3,
            borderLeftColor: color.error._400,
            backgroundColor: color.neutral._200,
            padding: spacing.m,
        },
        reminderText: { color: color.text._200, fontSize: fontSize.s },
        field: { flex: 0 },
        row: { flexDirection: 'row', alignItems: 'center', columnGap: spacing.m },
        status: { fontSize: fontSize.s, fontWeight: '600' },
        meter: { color: color.text._300, fontSize: fontSize.s, fontFamily: 'monospace' },
        divider: { height: 1, backgroundColor: color.neutral._300 },
    })
}
