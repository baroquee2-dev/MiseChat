import { AntDesign } from '@expo/vector-icons'
import { useRouter } from 'expo-router'
import { useLiveQuery } from 'drizzle-orm/expo-sqlite'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { FlatList, Text, TouchableOpacity, View } from 'react-native'
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller'
import { useMMKVBoolean } from 'react-native-mmkv'
import { SafeAreaView } from 'react-native-safe-area-context'

import ThemedSwitch from '@components/input/ThemedSwitch'
import Avatar from '@components/views/Avatar'
import BottomSheet from '@components/views/BottomSheet'
import Drawer from '@components/views/Drawer'
import HeaderTitle from '@components/views/HeaderTitle'
import { openChatForCharacter } from '@lib/chat/openChatForCharacter'
import { AppSettings } from '@lib/constants/GlobalValues'
import { Characters } from '@lib/state/Characters'
import { Logger } from '@lib/state/Logger'
import { Theme } from '@lib/theme/ThemeManager'

const CharacterMemoryScreen = () => {
    const { t } = useTranslation()
    const router = useRouter()
    const { color, spacing, fontSize, borderRadius } = Theme.useTheme()
    const [autoSummary, setAutoSummary] = useMMKVBoolean(AppSettings.AutoSummary)
    const [autoExtractKeyFacts, setAutoExtractKeyFacts] = useMMKVBoolean(
        AppSettings.AutoExtractKeyFacts
    )
    const [showCharacterSheet, setShowCharacterSheet] = useState(false)

    const { data } = useLiveQuery(Characters.db.query.charactersWithSummary(), [])
    const charactersWithChats = useMemo(
        () => (data ?? []).filter((item) => item.chats.length > 0),
        [data]
    )

    const handleSelectCharacter = async (character: { id: number; name: string }) => {
        Logger.info(`Selected character for memory management: ${character.name} (${character.id})`)
        setShowCharacterSheet(false)
        const opened = await openChatForCharacter(character.id)
        if (!opened) return
        router.replace('/screens/ChatScreen')
        Drawer.useDrawerStore.getState().setShow(Drawer.ID.CHATLIST, true)
    }

    return (
        <SafeAreaView edges={['bottom']} style={{ flex: 1 }}>
            <HeaderTitle title={t('nav.characterMemory')} />
            <KeyboardAwareScrollView style={{ paddingHorizontal: 16 }}>
                <ThemedSwitch
                    label={t('chat.autoSummary')}
                    description={t('memory.autoSummaryDesc')}
                    value={autoSummary}
                    onChangeValue={setAutoSummary}
                />

                <ThemedSwitch
                    label={t('memory.autoExtractKeyFacts')}
                    description={t('memory.autoExtractKeyFactsDesc')}
                    value={autoExtractKeyFacts}
                    onChangeValue={setAutoExtractKeyFacts}
                />

                <View style={{ marginTop: spacing.xl2, marginBottom: spacing.m }}>
                    <TouchableOpacity
                        activeOpacity={0.7}
                        style={{
                            flexDirection: 'row',
                            alignItems: 'center',
                            backgroundColor: color.neutral._200,
                            borderRadius: borderRadius.xl,
                            padding: spacing.l,
                            shadowColor: color.shadow,
                            boxShadow: [
                                {
                                    offsetX: 0,
                                    offsetY: 4,
                                    spreadDistance: 0,
                                    color: color.shadow,
                                    blurRadius: 10,
                                },
                            ],
                        }}
                        onPress={() => setShowCharacterSheet(true)}>
                        <View
                            style={{
                                width: 44,
                                height: 44,
                                borderRadius: borderRadius.l,
                                backgroundColor: `${color.primary._500}22`,
                                justifyContent: 'center',
                                alignItems: 'center',
                                marginRight: spacing.m,
                            }}>
                            <AntDesign name="book" size={22} color={color.primary._500} />
                        </View>
                        <View style={{ flex: 1 }}>
                            <Text
                                style={{
                                    fontSize: fontSize.l,
                                    fontWeight: '600',
                                    color: color.text._100,
                                }}>
                                {t('memory.contentManagement')}
                            </Text>
                            <Text
                                style={{
                                    fontSize: fontSize.s,
                                    color: color.text._300,
                                    marginTop: spacing.xs,
                                    lineHeight: Math.round(fontSize.s * 1.4),
                                }}>
                                {t('memory.contentManagementDesc')}
                            </Text>
                        </View>
                        <AntDesign name="right" size={18} color={color.text._300} />
                    </TouchableOpacity>
                </View>
            </KeyboardAwareScrollView>

            <BottomSheet visible={showCharacterSheet} setVisible={setShowCharacterSheet}>
                <Text
                    style={{
                        fontSize: fontSize.xl,
                        fontWeight: '600',
                        color: color.text._100,
                        marginBottom: spacing.m,
                    }}>
                    {t('memory.selectCharacter')}
                </Text>
                <FlatList
                    data={charactersWithChats}
                    keyExtractor={(item) => item.id.toString()}
                    renderItem={({ item }) => (
                        <TouchableOpacity
                            style={{
                                flexDirection: 'row',
                                alignItems: 'center',
                                gap: spacing.m,
                                paddingVertical: spacing.m,
                            }}
                            onPress={() => handleSelectCharacter(item)}>
                            <Avatar
                                targetImage={Characters.getImageDir(item.image_id)}
                                style={{
                                    width: 48,
                                    height: 48,
                                    borderRadius: borderRadius.m,
                                    backgroundColor: color.neutral._200,
                                }}
                            />
                            <Text
                                style={{
                                    fontSize: fontSize.l,
                                    color: color.text._100,
                                }}
                                numberOfLines={1}>
                                {item.name}
                            </Text>
                        </TouchableOpacity>
                    )}
                    ItemSeparatorComponent={() => (
                        <View
                            style={{
                                height: 1,
                                backgroundColor: color.neutral._200,
                            }}
                        />
                    )}
                    ListEmptyComponent={() => (
                        <Text
                            style={{
                                textAlign: 'center',
                                color: color.text._300,
                                paddingVertical: spacing.xl,
                            }}>
                            {t('memory.empty')}
                        </Text>
                    )}
                />
            </BottomSheet>
        </SafeAreaView>
    )
}

export default CharacterMemoryScreen
