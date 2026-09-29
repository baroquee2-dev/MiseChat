import { useLocalSearchParams, useRouter } from 'expo-router'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'

import ThemedButton from '@components/buttons/ThemedButton'
import ThemedSwitch from '@components/input/ThemedSwitch'
import ThemedTextInput from '@components/input/ThemedTextInput'
import HeaderTitle from '@components/views/HeaderTitle'
import { Chats } from '@lib/state/Chat'
import { Logger } from '@lib/state/Logger'
import { Theme } from '@lib/theme/ThemeManager'

/**
 * Editor for one chat's author's note, which the app calls 劇情作弊器.
 *
 * The depth it is injected at and the role it takes are fixed in the context builder:
 * those are the two knobs other front ends expose, and neither is a decision this
 * app's readers should have to make.
 */

/** Ready made lines, because an empty box does not tell anyone what belongs in it. */
const SUGGESTION_KEYS = ['pace', 'scene', 'person', 'tone'] as const

const SOFT_LIMIT = 200

const ChatAuthorNoteScreen = () => {
    const { t } = useTranslation()
    const styles = useStyles()
    const router = useRouter()
    const params = useLocalSearchParams<{ chatId?: string; chatName?: string }>()
    const chatId = Number(params.chatId)
    const chatName = typeof params.chatName === 'string' ? params.chatName : ''

    const [text, setText] = useState('')
    const [enabled, setEnabled] = useState(true)
    const [loading, setLoading] = useState(true)
    const [saving, setSaving] = useState(false)

    useEffect(() => {
        let cancelled = false
        const load = async () => {
            if (!Number.isFinite(chatId) || chatId <= 0) {
                Logger.errorToast(t('authorNote.missingChat'))
                router.back()
                return
            }
            const chat = await Chats.db.query.chatExists(chatId)
            if (cancelled) return
            if (!chat) {
                Logger.errorToast(t('authorNote.missingChat'))
                router.back()
                return
            }
            setText(chat.author_note ?? '')
            setEnabled(chat.author_note_enabled ?? true)
            setLoading(false)
        }
        load()
        return () => {
            cancelled = true
        }
    }, [chatId, router, t])

    const save = async (value: string, message: string) => {
        if (saving) return
        setSaving(true)
        try {
            await Chats.useChatState.getState().setAuthorNote(chatId, value, enabled)
            Logger.infoToast(message)
            router.back()
        } catch (error) {
            Logger.errorToast(t('authorNote.saveFailed'))
            Logger.error(`${error}`)
        } finally {
            setSaving(false)
        }
    }

    const addSuggestion = (suggestion: string) => {
        setText((current) => {
            const trimmed = current.trim()
            if (!trimmed) return suggestion
            if (trimmed.includes(suggestion)) return current
            return `${trimmed}\n${suggestion}`
        })
    }

    const busy = loading || saving

    return (
        <SafeAreaView edges={['bottom']} style={styles.container}>
            <HeaderTitle title={t('authorNote.title')} />
            <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
                {!!chatName && (
                    <Text style={styles.chatName} numberOfLines={2}>
                        {chatName}
                    </Text>
                )}
                <Text style={styles.hint}>{t('authorNote.hint')}</Text>
                <Text style={styles.equivalent}>{t('authorNote.equivalent')}</Text>

                <ThemedSwitch
                    label={t('authorNote.toggle')}
                    description={
                        text.trim()
                            ? t(enabled ? 'authorNote.enabled' : 'authorNote.disabled')
                            : t('authorNote.emptyHint')
                    }
                    value={enabled && !!text.trim()}
                    onChangeValue={(value) => {
                        setEnabled(value)
                        // Switching on an empty note changes nothing, so say why
                        if (value && !text.trim()) Logger.infoToast(t('authorNote.emptyHint'))
                    }}
                />

                <ThemedTextInput
                    multiline
                    scrollEnabled
                    value={text}
                    onChangeText={setText}
                    editable={!busy}
                    placeholder={t('authorNote.placeholder')}
                    containerStyle={styles.inputContainer}
                    style={styles.input}
                />
                <Text style={[styles.counter, text.length > SOFT_LIMIT && styles.counterOver]}>
                    {text.length} / {SOFT_LIMIT}
                </Text>

                <Text style={styles.suggestionLabel}>{t('authorNote.suggestions')}</Text>
                <View style={styles.suggestions}>
                    {SUGGESTION_KEYS.map((key) => {
                        const suggestion = t(`authorNote.suggestion.${key}`)
                        return (
                            <Pressable
                                key={key}
                                disabled={busy}
                                onPress={() => addSuggestion(suggestion)}
                                style={styles.chip}>
                                <Text style={styles.chipText}>{suggestion}</Text>
                            </Pressable>
                        )
                    })}
                </View>
            </ScrollView>

            <View style={styles.actions}>
                <ThemedButton
                    label={t('authorNote.clear')}
                    iconName="delete"
                    variant={busy || !text.trim() ? 'disabled' : 'critical'}
                    onPress={() => save('', t('authorNote.cleared'))}
                />
                <ThemedButton
                    label={t('common.save')}
                    iconName="check"
                    variant={busy ? 'disabled' : 'secondary'}
                    onPress={() => save(text, t('authorNote.saved'))}
                />
            </View>
        </SafeAreaView>
    )
}

export default ChatAuthorNoteScreen

const useStyles = () => {
    const { color, spacing, fontSize, borderRadius } = Theme.useTheme()
    return StyleSheet.create({
        container: {
            flex: 1,
            backgroundColor: color.neutral._100,
        },
        body: {
            paddingHorizontal: spacing.xl,
            paddingTop: spacing.l,
            paddingBottom: spacing.xl,
        },
        chatName: {
            color: color.text._100,
            fontSize: fontSize.l,
            marginBottom: spacing.s,
        },
        hint: {
            color: color.text._400,
            marginBottom: spacing.s,
        },
        // For readers who know the term from other front ends
        equivalent: {
            color: color.text._500,
            fontSize: fontSize.s,
            marginBottom: spacing.l,
        },
        inputContainer: {
            marginBottom: 0,
        },
        input: {
            minHeight: 140,
            textAlignVertical: 'top',
        },
        counter: {
            alignSelf: 'flex-end',
            color: color.text._500,
            fontSize: fontSize.s,
            marginTop: spacing.s,
        },
        counterOver: {
            color: color.error._400,
        },
        suggestionLabel: {
            color: color.text._400,
            marginTop: spacing.l,
            marginBottom: spacing.s,
        },
        suggestions: {
            flexDirection: 'row',
            flexWrap: 'wrap',
            gap: spacing.s,
        },
        chip: {
            paddingHorizontal: spacing.m,
            paddingVertical: spacing.s,
            borderRadius: borderRadius.l,
            borderWidth: 1,
            borderColor: color.primary._500,
            backgroundColor: color.neutral._200,
        },
        chipText: {
            color: color.text._200,
        },
        actions: {
            flexDirection: 'row',
            justifyContent: 'space-between',
            paddingHorizontal: spacing.xl,
            paddingVertical: spacing.l,
        },
    })
}
