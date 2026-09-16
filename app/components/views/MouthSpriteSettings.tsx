import { useLiveQuery } from 'drizzle-orm/expo-sqlite'
import { getDocumentAsync } from 'expo-document-picker'
import { Image } from 'expo-image'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import { useShallow } from 'zustand/react/shallow'

import ThemedButton from '@components/buttons/ThemedButton'
import DropdownSheet from '@components/input/DropdownSheet'
import ThemedSwitch from '@components/input/ThemedSwitch'
import Alert from '@components/views/Alert'
import { getGeminiApiKey, useGeminiApiKey } from '@lib/engine/API/GeminiKey'
import { disconnectLipSync } from '@lib/lemonslice/LipSyncService'
import {
    generateMouthSprite,
    MOUTH_SPRITE_MODEL_LABEL,
    MouthSpriteBlockedError,
    prepareMouthSpriteSource,
} from '@lib/sprites/MouthSpriteGenerator'
import { Characters } from '@lib/state/Characters'
import { useLipSyncSettings } from '@lib/state/LemonSlice'
import { Logger } from '@lib/state/Logger'
import {
    deleteMouthSprites,
    isCompleteSpriteSet,
    MOUTH_SLOTS,
    type MouthSlot,
    type MouthSpriteSet,
    saveMouthSprites,
    useMouthSprites,
} from '@lib/state/MouthSprites'
import { Theme } from '@lib/theme/ThemeManager'

type CharacterOption = { id: number; name: string; image_id: number }

const CAROUSEL_ORDER: MouthSlot[] = ['closed', 'half', 'open', 'half']
const CAROUSEL_INTERVAL_MS = 130

const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error))

/** Image lip sync settings: pick a character, prepare its three mouth frames, bind them. */
const MouthSpriteSettings = () => {
    const { t } = useTranslation()
    const styles = useStyles()
    const { color } = Theme.useTheme()

    const { enabled, bindings, setEnabled } = useMouthSprites(
        useShallow((state) => ({
            enabled: state.enabled,
            bindings: state.bindings,
            setEnabled: state.setEnabled,
        }))
    )
    const geminiApiKey = useGeminiApiKey()
    const { data: characters } = useLiveQuery(
        Characters.db.query.cardListQuery('character', 'modified')
    )
    const currentId = Characters.useCharacterStore((state) => state.id)

    const [selectedId, setSelectedId] = useState<number | undefined>(currentId)
    const [draft, setDraft] = useState<Partial<MouthSpriteSet>>(() =>
        currentId !== undefined ? { ...useMouthSprites.getState().bindings[currentId] } : {}
    )
    const [generating, setGenerating] = useState<Partial<Record<MouthSlot, boolean>>>({})
    const [saving, setSaving] = useState(false)
    const [previewing, setPreviewing] = useState(false)
    const [frame, setFrame] = useState(0)
    const generationRef = useRef<AbortController | null>(null)

    // Leaving the page cancels a generation still in flight.
    useEffect(() => () => generationRef.current?.abort(), [])

    useEffect(() => {
        if (!previewing) return
        const timer = setInterval(
            () => setFrame((index) => (index + 1) % CAROUSEL_ORDER.length),
            CAROUSEL_INTERVAL_MS
        )
        return () => clearInterval(timer)
    }, [previewing])

    const selected: CharacterOption | undefined = characters.find(
        (character) => character.id === selectedId
    )
    const binding = selectedId !== undefined ? bindings[selectedId] : undefined
    const frames = isCompleteSpriteSet(draft) ? draft : undefined
    const generatingAny = MOUTH_SLOTS.some((slot) => generating[slot])
    const busy = generatingAny || saving
    const dirty = !!frames && MOUTH_SLOTS.some((slot) => frames[slot] !== binding?.[slot])

    const handleToggle = (value: boolean) => {
        setEnabled(value)
        // Only one kind of lip sync can drive the portrait at a time.
        if (value && useLipSyncSettings.getState().enabled) {
            useLipSyncSettings.getState().setEnabled(false)
            disconnectLipSync('image lip sync enabled')
        }
    }

    const selectCharacter = (character: CharacterOption) => {
        generationRef.current?.abort()
        generationRef.current = null
        setGenerating({})
        setPreviewing(false)
        setSelectedId(character.id)
        setDraft({ ...useMouthSprites.getState().bindings[character.id] })
    }

    const pickImage = async (slot: MouthSlot) => {
        if (busy) return
        const result = await getDocumentAsync({ type: 'image/*', copyToCacheDirectory: true })
        if (result.canceled) return
        setDraft((current) => ({ ...current, [slot]: result.assets[0].uri }))
    }

    const generate = async (character: CharacterOption) => {
        const apiKey = getGeminiApiKey()
        if (!apiKey) {
            Logger.errorToast(t('mouthSprites.missingGeminiKey'))
            return
        }
        generationRef.current?.abort()
        const controller = new AbortController()
        generationRef.current = controller
        setPreviewing(false)
        setGenerating({ closed: true, half: true, open: true })

        const source = await prepareMouthSpriteSource(
            Characters.getImageDir(character.image_id)
        ).catch((error: unknown) => {
            Logger.errorToast(t('mouthSprites.sourceFailed', { error: errorText(error) }))
            return null
        })
        if (!source) {
            if (generationRef.current === controller) setGenerating({})
            return
        }

        // The three frames are independent, so they are drawn at the same time.
        const results = await Promise.allSettled(
            MOUTH_SLOTS.map(async (slot) => {
                try {
                    const uri = await generateMouthSprite(source, slot, apiKey, controller.signal)
                    if (generationRef.current === controller) {
                        setDraft((current) => ({ ...current, [slot]: uri }))
                    }
                } finally {
                    if (generationRef.current === controller) {
                        setGenerating((current) => ({ ...current, [slot]: false }))
                    }
                }
            })
        )
        if (generationRef.current !== controller) return
        generationRef.current = null

        const failures = results.flatMap((result, index) =>
            result.status === 'rejected' ? [{ slot: MOUTH_SLOTS[index], error: result.reason }] : []
        )
        failures.forEach(({ slot, error }) => {
            Logger.warn(`Mouth sprite ${slot} failed: ${errorText(error)}`)
        })
        // Content refusals hit all three frames for the same reason, so say it once.
        const blocked = failures.some(({ error }) => error instanceof MouthSpriteBlockedError)
        if (blocked) {
            Logger.errorToast(t('mouthSprites.blockedBySafety'))
        } else {
            failures.forEach(({ slot, error }) => {
                Logger.errorToast(
                    t('mouthSprites.generateFailed', {
                        slot: t(`mouthSprites.${slot}`),
                        error: errorText(error),
                    })
                )
            })
        }
        if (failures.length === 0) Logger.infoToast(t('mouthSprites.generateDone'))
    }

    const confirmGenerate = () => {
        if (!selected || busy || !geminiApiKey) return
        Alert.alert({
            title: t('mouthSprites.generateTitle'),
            description: t('mouthSprites.generateDesc', {
                name: selected.name,
                model: MOUTH_SPRITE_MODEL_LABEL,
            }),
            buttons: [
                { label: t('common.cancel') },
                {
                    label: t('mouthSprites.generateConfirm'),
                    onPress: () => void generate(selected),
                },
            ],
        })
    }

    const save = async () => {
        if (!selected || !frames || !dirty || busy) return
        setSaving(true)
        try {
            setDraft(await saveMouthSprites(selected.id, frames))
            Logger.infoToast(t('mouthSprites.saved', { name: selected.name }))
        } catch (error) {
            Logger.error(`Failed to bind mouth sprites: ${errorText(error)}`)
            Logger.errorToast(t('mouthSprites.saveFailed'))
        } finally {
            setSaving(false)
        }
    }

    const remove = () => {
        if (!selected || busy) return
        Alert.alert({
            title: t('mouthSprites.removeTitle'),
            description: t('mouthSprites.removeDesc', { name: selected.name }),
            buttons: [
                { label: t('common.cancel') },
                {
                    label: t('mouthSprites.removeConfirm'),
                    onPress: () => {
                        deleteMouthSprites(selected.id)
                        setDraft({})
                        setPreviewing(false)
                        Logger.infoToast(t('mouthSprites.removed'))
                    },
                },
            ],
        })
    }

    return (
        <View style={styles.section}>
            <ThemedSwitch
                label={t('mouthSprites.enable')}
                value={enabled}
                onChangeValue={handleToggle}
            />
            <Text style={styles.hint}>{t('mouthSprites.description')}</Text>

            {enabled && (
                <>
                    <Text style={styles.hint}>{t('mouthSprites.voiceNote')}</Text>

                    {characters.length === 0 ? (
                        <Text style={styles.hint}>{t('mouthSprites.noCharacters')}</Text>
                    ) : (
                        <DropdownSheet
                            search
                            modalTitle={t('mouthSprites.selectCharacter')}
                            placeholder={t('mouthSprites.selectCharacter')}
                            data={characters}
                            selected={selected}
                            labelExtractor={(character) =>
                                bindings[character.id]
                                    ? `${character.name}（${t('mouthSprites.configured')}）`
                                    : character.name
                            }
                            onChangeValue={selectCharacter}
                        />
                    )}

                    {selected && (
                        <>
                            <View style={styles.slotRow}>
                                {MOUTH_SLOTS.map((slot) => (
                                    <TouchableOpacity
                                        key={slot}
                                        style={styles.slot}
                                        disabled={busy}
                                        onPress={() => void pickImage(slot)}>
                                        {generating[slot] ? (
                                            <ActivityIndicator color={color.primary._400} />
                                        ) : draft[slot] ? (
                                            <Image
                                                source={{ uri: draft[slot] }}
                                                contentFit="contain"
                                                style={styles.slotImage}
                                            />
                                        ) : (
                                            <Text style={styles.hint}>
                                                {t('mouthSprites.pick')}
                                            </Text>
                                        )}
                                        <Text style={styles.slotLabel}>
                                            {t(`mouthSprites.${slot}`)}
                                        </Text>
                                    </TouchableOpacity>
                                ))}
                            </View>

                            <ThemedButton
                                label={
                                    generatingAny
                                        ? t('mouthSprites.generating')
                                        : t('mouthSprites.generate')
                                }
                                variant={busy || !geminiApiKey ? 'disabled' : 'secondary'}
                                onPress={confirmGenerate}
                            />
                            <Text style={[styles.hint, !geminiApiKey && styles.error]}>
                                {geminiApiKey
                                    ? t('mouthSprites.generateCost', {
                                          model: MOUTH_SPRITE_MODEL_LABEL,
                                      })
                                    : t('mouthSprites.missingGeminiKey')}
                            </Text>

                            {frames ? (
                                <>
                                    {previewing && (
                                        <View style={styles.stage}>
                                            {MOUTH_SLOTS.map((slot) => (
                                                <Image
                                                    key={slot}
                                                    source={{ uri: frames[slot] }}
                                                    contentFit="contain"
                                                    style={[
                                                        StyleSheet.absoluteFill,
                                                        {
                                                            opacity:
                                                                CAROUSEL_ORDER[frame] === slot
                                                                    ? 1
                                                                    : 0,
                                                        },
                                                    ]}
                                                />
                                            ))}
                                        </View>
                                    )}
                                    <View style={styles.row}>
                                        <ThemedButton
                                            label={
                                                previewing
                                                    ? t('mouthSprites.stopPreview')
                                                    : t('mouthSprites.preview')
                                            }
                                            variant="secondary"
                                            onPress={() => setPreviewing((value) => !value)}
                                        />
                                        <ThemedButton
                                            label={t('mouthSprites.save')}
                                            variant={busy || !dirty ? 'disabled' : 'primary'}
                                            onPress={() => void save()}
                                        />
                                    </View>
                                    {dirty && (
                                        <Text style={styles.warning}>
                                            {t('mouthSprites.unsaved')}
                                        </Text>
                                    )}
                                </>
                            ) : (
                                <Text style={styles.hint}>{t('mouthSprites.needsAll')}</Text>
                            )}

                            {binding && (
                                <ThemedButton
                                    label={t('mouthSprites.remove')}
                                    variant={busy ? 'disabled' : 'critical'}
                                    onPress={remove}
                                />
                            )}
                        </>
                    )}
                </>
            )}
        </View>
    )
}

export default MouthSpriteSettings

const useStyles = () => {
    const { color, spacing, fontSize, borderRadius } = Theme.useTheme()
    return StyleSheet.create({
        section: { rowGap: spacing.l },
        hint: { color: color.text._400, fontSize: fontSize.s },
        error: { color: color.error._400 },
        warning: { color: color.error._300, fontSize: fontSize.s },
        slotRow: { flexDirection: 'row', columnGap: spacing.m },
        slot: {
            flex: 1,
            height: 140,
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
        stage: {
            height: 320,
            borderRadius: borderRadius.m,
            backgroundColor: color.neutral._200,
            overflow: 'hidden',
        },
        row: { flexDirection: 'row', alignItems: 'center', columnGap: spacing.m },
    })
}
