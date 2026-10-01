import { useFocusEffect } from 'expo-router'
import type { NativeStackNavigationOptions } from 'expo-router'
import { useCallback, useEffect, useMemo } from 'react'
import { StyleSheet, View } from 'react-native'
import { useReanimatedKeyboardAnimation } from 'react-native-keyboard-controller'
import Animated, { FadeIn, useAnimatedStyle } from 'react-native-reanimated'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useShallow } from 'zustand/react/shallow'

import ThemedButton from '@components/buttons/ThemedButton'
import AvatarViewer from '@components/views/AvatarViewer'
import Drawer from '@components/views/Drawer'
import HeaderButton from '@components/views/HeaderButton'
import HeaderTitle from '@components/views/HeaderTitle'
import SettingsDrawer from '@components/views/SettingsDrawer'
import { playChatEnterSound } from '@lib/audio/playInputFocusSound'
import { useChatLayout } from '@lib/constants/ChatLayout'
import i18n from '@lib/i18n'
import { Characters } from '@lib/state/Characters'
import { Chats, useInference } from '@lib/state/Chat'
import { Logger } from '@lib/state/Logger'
import { Theme } from '@lib/theme/ThemeManager'
import { ChatImportSchema } from '@lib/utils/ChatSchema'
import { FileUtils } from '@lib/utils/File'
import ChatInput from '@screens/ChatScreen/ChatInput'
import ChatsDrawer from '@screens/ChatScreen/ChatsDrawer'
import ChatWindow from '@screens/ChatScreen/ChatWindow'

import ChatEditor from './ChatWindow/ChatEditor'
import ImmersiveFullscreenPortrait from './ChatWindow/layouts/ImmersiveFullscreenPortrait'

const ChatScreen = () => {
    const insets = useSafeAreaInsets()
    const { color } = Theme.useTheme()
    const { capabilities } = useChatLayout()
    const edgeToEdgePortrait = capabilities.fullScreenPortrait
    const nowGenerating = useInference((state) => state.nowGenerating)
    const { unloadCharacter, charId } = Characters.useCharacterStore(
        useShallow((state) => ({
            unloadCharacter: state.unloadCard,
            charId: state.id,
        }))
    )
    const userId = Characters.useUserStore(useShallow((state) => state.id))

    const { height } = useReanimatedKeyboardAnimation()
    const animatedStyle = useAnimatedStyle(() => {
        return {
            paddingBottom: -height.value - insets.bottom,
            flex: 1,
        }
    })

    const { chat, unloadChat, loadChat } = Chats.useChat()

    const { showSettings, showChats } = Drawer.useDrawerStore(
        useShallow((state) => ({
            showSettings: state.values?.[Drawer.ID.SETTINGS],
            showChats: state.values?.[Drawer.ID.CHATLIST],
        }))
    )

    const immersiveScreenOptions = useMemo((): NativeStackNavigationOptions => {
        if (edgeToEdgePortrait) {
            return {
                headerTransparent: true,
                headerStyle: { backgroundColor: 'transparent' },
                headerShadowVisible: false,
                headerTintColor: '#f5f5f5',
                statusBarStyle: 'light',
                statusBarTranslucent: true,
                contentStyle: { backgroundColor: 'transparent' },
            }
        }

        return {
            headerTransparent: false,
            headerStyle: { backgroundColor: color.neutral._100 },
            headerShadowVisible: false,
            headerTintColor: color.text._100,
            statusBarStyle: 'auto',
            statusBarTranslucent: false,
            contentStyle: { backgroundColor: color.neutral._100 },
        }
    }, [color.neutral._100, color.text._100, edgeToEdgePortrait])

    useFocusEffect(
        useCallback(() => {
            playChatEnterSound()
            // Delete replaced portrait/background files after chat Image views
            // have resumed with the latest URIs.
            const timer = setTimeout(() => Characters.flushPendingImageDeletes(), 1200)
            return () => clearTimeout(timer)
        }, [])
    )

    useEffect(() => {
        return () => {
            Characters.flushPendingImageDeletes(0)
            unloadCharacter()
            unloadChat()
        }
    }, [unloadCharacter, unloadChat])

    const handleCreateChat = async () => {
        if (charId)
            Chats.db.mutate.createChat(charId).then((chatId) => {
                if (chatId) loadChat(chatId)
            })
    }

    const handleImportChat = async () => {
        if (!charId || !userId) {
            Logger.errorToast(i18n.t('chat.importNoCharacter'))
            return
        }
        const file = await FileUtils.pickText({ type: 'application/json' })
        if (!file.success) return
        const result = ChatImportSchema.safeParse(JSON.parse(file.data))
        if (!result.success) {
            Logger.errorToast(i18n.t('chat.importFailed'))
            Logger.error('Incorrect format')
            return
        }
        const chat = result.data
        chat.character_id = charId
        chat.scroll_offset = 0
        chat.auto_summary = false
        chat.summary = ''
        chat.summary_updated_at = null
        chat.summary_turn_count = 0
        chat.summary_token_count = 0
        chat.author_note = ''
        chat.author_note_enabled = true
        delete chat.id
        chat.messages = chat.messages.map((message) => {
            delete message.id
            message.swipes = message.swipes.map((swipe) => {
                delete swipe.id
                return swipe
            })
            message.attachments = []
            return message
        })

        if (chat.user_id) {
            const userExists = await Characters.db.query.card(chat.user_id)
            if (!userExists) {
                chat.user_id = null
            }
        }

        chat.last_modified = Date.now()
        Chats.db.mutate.cloneChat(chat)
    }

    const renderHeaderButtonRight = () => {
        return (
            !showSettings && (
                <>
                    {!showChats ? (
                        <ThemedButton
                            buttonStyle={{
                                marginRight: 16,
                            }}
                            iconName="plus"
                            variant="tertiary"
                            iconSize={24}
                            onPress={handleCreateChat}
                        />
                    ) : (
                        <ThemedButton
                            buttonStyle={{
                                marginRight: 16,
                            }}
                            iconName="upload"
                            variant="tertiary"
                            iconSize={20}
                            onPress={handleImportChat}
                        />
                    )}
                    <Drawer.Button drawerID={Drawer.ID.CHATLIST} openIcon="message" />
                </>
            )
        )
    }

    const renderHeaderButtonLeft = () => {
        return !showChats && <Drawer.Button drawerID={Drawer.ID.SETTINGS} />
    }

    return (
        <Drawer.Gesture
            config={[
                {
                    drawerID: Drawer.ID.CHATLIST,
                    openDirection: 'left',
                    closeDirection: 'right',
                },
                {
                    drawerID: Drawer.ID.SETTINGS,
                    openDirection: 'right',
                    closeDirection: 'left',
                },
            ]}>
            <View style={{ flex: 1, overflow: 'hidden' }}>
                {edgeToEdgePortrait && chat && (
                    <View style={styles.edgeToEdgePortrait} pointerEvents="box-none">
                        <ImmersiveFullscreenPortrait nowGenerating={nowGenerating} />
                    </View>
                )}

                <View style={{ flex: 1, paddingBottom: insets.bottom + 4, zIndex: 1 }}>
                    <Animated.View style={animatedStyle}>
                        <HeaderTitle
                            animation="slide_from_right"
                            screenOptions={immersiveScreenOptions}
                        />
                        <HeaderButton
                            headerLeft={renderHeaderButtonLeft}
                            headerRight={renderHeaderButtonRight}
                            screenOptions={immersiveScreenOptions}
                        />
                        <View style={{ flex: 1 }}>
                            {chat && (
                                <Animated.View
                                    entering={FadeIn.duration(280).delay(80)}
                                    style={{ flex: 1 }}>
                                    <ChatWindow />
                                </Animated.View>
                            )}
                            <ChatInput />
                            <AvatarViewer />
                            <ChatEditor />
                        </View>
                    </Animated.View>

                    {/**Drawer has to be outside of the KeyboardAvoidingView */}
                    <SettingsDrawer />
                    <ChatsDrawer />
                </View>
            </View>
        </Drawer.Gesture>
    )
}

export default ChatScreen

const styles = StyleSheet.create({
    edgeToEdgePortrait: {
        ...StyleSheet.absoluteFill,
        zIndex: 0,
    },
})
