import { AntDesign, Ionicons } from '@expo/vector-icons'
import { useRouter } from 'expo-router'
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import Animated from 'react-native-reanimated'
import { useTranslation } from 'react-i18next'

import Drawer from '@components/views/Drawer'
import { drawerItemEntrance } from '@lib/animations/chatAnimations'
import { Chats } from '@lib/state/Chat'
import { Theme } from '@lib/theme/ThemeManager'

import ChatEditPopup from './ChatDrawerOptions'

type ListItem = Awaited<ReturnType<typeof Chats.db.query.chatListQuery>>[0]

type ChatDrawerItemProps = {
    item: ListItem
    onLoad: (id: number) => void
    index: number
    keyFactCount: number
}

const ChatDrawerItem: React.FC<ChatDrawerItemProps> = ({ item, onLoad, index, keyFactCount }) => {
    const { t } = useTranslation()
    const styles = useStyles()
    const router = useRouter()
    const { spacing, color } = Theme.useTheme()
    const date = new Date(item.last_modified ?? 0)
    const { chatId } = Chats.useChat()
    const setShow = Drawer.useDrawerStore((state) => state.setShow)
    const hasSummary = !!item.summary?.trim()
    // Written but switched off is as good as absent, so the badge stays hidden
    const hasAuthorNote = !!item.author_note?.trim() && !!item.author_note_enabled
    const isActive = item.id === chatId

    const openEditor = (
        pathname:
            | '/screens/ChatSummaryEditorScreen'
            | '/screens/ChatKeyFactsEditorScreen'
            | '/screens/ChatAuthorNoteScreen'
    ) => {
        setShow(Drawer.ID.CHATLIST, false)
        router.push({
            pathname: pathname,
            params: {
                chatId: String(item.id),
                chatName: item.name,
            },
        })
    }

    return (
        <Animated.View entering={drawerItemEntrance(index)} style={styles.wrapper}>
            <View style={[styles.card, isActive && styles.cardActive]}>
                <ChatEditPopup item={item} onPress={() => onLoad(item.id)}>
                    <View style={styles.chatBody}>
                        <Text style={styles.title}>{item.name}</Text>
                        <View style={styles.metaRow}>
                            <View style={styles.metaGroup}>
                                <Ionicons name="chatbox" size={18} color={color.text._400} />
                                <Text style={styles.metaText}>{item.entryCount}</Text>
                            </View>
                            <View style={styles.metaGroup}>
                                <Text style={styles.metaText}>{date.toLocaleDateString()}</Text>
                                <Text style={styles.metaText}>{date.toLocaleTimeString()}</Text>
                            </View>
                        </View>
                    </View>
                </ChatEditPopup>

                {hasSummary && (
                    <TouchableOpacity
                        style={styles.summaryAction}
                        onPress={() => openEditor('/screens/ChatSummaryEditorScreen')}
                        accessibilityRole="button"
                        accessibilityLabel={t('chat.editSummary')}>
                        <View style={styles.summaryBadge}>
                            <AntDesign name="profile" size={14} color={color.primary._200} />
                            <Text style={styles.summaryBadgeText}>{t('chat.summaryBadge')}</Text>
                        </View>
                        <View style={styles.summaryActionLabel}>
                            <Text style={styles.summaryActionText}>{t('chat.editSummary')}</Text>
                            <AntDesign name="edit" size={14} color={color.primary._400} />
                        </View>
                    </TouchableOpacity>
                )}

                {hasAuthorNote && (
                    <TouchableOpacity
                        style={styles.summaryAction}
                        onPress={() => openEditor('/screens/ChatAuthorNoteScreen')}
                        accessibilityRole="button"
                        accessibilityLabel={t('authorNote.title')}>
                        <View style={styles.summaryBadge}>
                            <AntDesign name="flag" size={14} color={color.primary._200} />
                            <Text style={styles.summaryBadgeText}>{t('authorNote.active')}</Text>
                        </View>
                        <View style={styles.summaryActionLabel}>
                            <Text style={styles.summaryActionText}>{t('common.edit')}</Text>
                            <AntDesign name="edit" size={14} color={color.primary._400} />
                        </View>
                    </TouchableOpacity>
                )}

                {keyFactCount > 0 && (
                    <TouchableOpacity
                        style={styles.summaryAction}
                        onPress={() => openEditor('/screens/ChatKeyFactsEditorScreen')}
                        accessibilityRole="button"
                        accessibilityLabel={t('keyFacts.edit')}>
                        <View style={styles.summaryBadge}>
                            <AntDesign name="tags" size={14} color={color.primary._200} />
                            <Text style={styles.summaryBadgeText}>
                                {`${t('keyFacts.badge')} ${keyFactCount}`}
                            </Text>
                        </View>
                        <View style={styles.summaryActionLabel}>
                            <Text style={styles.summaryActionText}>{t('keyFacts.edit')}</Text>
                            <AntDesign name="edit" size={14} color={color.primary._400} />
                        </View>
                    </TouchableOpacity>
                )}
            </View>
        </Animated.View>
    )
}

export default ChatDrawerItem

const useStyles = () => {
    const { color, spacing, borderWidth, borderRadius, fontSize } = Theme.useTheme()

    return StyleSheet.create({
        wrapper: {
            marginBottom: spacing.m,
        },
        card: {
            borderRadius: borderRadius.m,
            borderWidth: borderWidth.m,
            borderColor: color.neutral._100,
            overflow: 'hidden',
        },
        cardActive: {
            borderColor: color.primary._500,
        },
        chatBody: {
            paddingHorizontal: spacing.l,
            paddingVertical: spacing.m,
        },
        title: {
            color: color.text._100,
            fontSize: fontSize.l,
        },
        metaRow: {
            flexDirection: 'row',
            alignItems: 'center',
            marginTop: spacing.l,
            justifyContent: 'space-between',
        },
        metaGroup: {
            flexDirection: 'row',
            alignItems: 'center',
            columnGap: spacing.s,
        },
        metaText: {
            color: color.text._400,
            fontSize: fontSize.s,
        },
        summaryAction: {
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'space-between',
            paddingHorizontal: spacing.l,
            paddingVertical: spacing.m,
            borderTopWidth: StyleSheet.hairlineWidth,
            borderTopColor: color.neutral._300,
            backgroundColor: color.neutral._200,
        },
        summaryBadge: {
            flexDirection: 'row',
            alignItems: 'center',
            columnGap: spacing.s,
            paddingHorizontal: spacing.m,
            paddingVertical: spacing.s,
            borderRadius: borderRadius.m,
            backgroundColor: color.primary._800,
        },
        summaryBadgeText: {
            color: color.primary._200,
            fontSize: fontSize.s,
            fontWeight: '600',
        },
        summaryActionLabel: {
            flexDirection: 'row',
            alignItems: 'center',
            columnGap: spacing.s,
        },
        summaryActionText: {
            color: color.primary._400,
            fontSize: fontSize.s,
            fontWeight: '600',
        },
    })
}
