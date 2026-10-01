import { MaterialIcons } from '@expo/vector-icons'
import { randomUUID } from 'expo-crypto'
import { getDocumentAsync } from 'expo-document-picker'
import { Image } from 'expo-image'
import React, { useState } from 'react'
import { Keyboard, TextInput, TouchableOpacity, View } from 'react-native'
import { useMMKVBoolean } from 'react-native-mmkv'
import { useTranslation } from 'react-i18next'
import Animated, {
    BounceIn,
    FadeIn,
    FadeOut,
    LinearTransition,
    ZoomOut,
} from 'react-native-reanimated'
import { create } from 'zustand'
import { useShallow } from 'zustand/react/shallow'

import ThemedButton from '@components/buttons/ThemedButton'
import CameraSheet from '@components/views/CameraSheet'
import ContextMenu from '@components/views/ContextMenu'
import { XAxisOnlyTransition } from '@lib/animations/transitions'
import { AppSettings } from '@lib/constants/GlobalValues'
import { useChatLayout } from '@lib/constants/ChatLayout'
import { generateResponse } from '@lib/engine/Inference'
import { useSpeechInput } from '@lib/hooks/useSpeechInput'
import { useUnfocusTextInput } from '@lib/hooks/UnfocusTextInput'
import { playInputFocusSound, playInputSendSound } from '@lib/audio/playInputFocusSound'
import i18n from '@lib/i18n'
import { Characters } from '@lib/state/Characters'
import { Chats, useInference } from '@lib/state/Chat'
import { useChatInputTextStore } from '@lib/state/components/ChatInput'
import { useLipSyncSession } from '@lib/state/LemonSlice'
import { Logger } from '@lib/state/Logger'
import { Theme } from '@lib/theme/ThemeManager'

import ChatOptions from './ChatInputOptions'

export type Attachment = {
    uri: string
    type: 'image' | 'audio' | 'document'
    name: string
}

const AnimatedTextInput = Animated.createAnimatedComponent(TextInput)

type ChatInputHeightStoreProps = {
    height: number
    setHeight: (n: number) => void
}

export const useInputHeightStore = create<ChatInputHeightStoreProps>()((set) => ({
    height: 54,
    setHeight: (n) => set({ height: Math.ceil(n) }),
}))

const ChatInput = () => {
    const { t } = useTranslation()
    const inputRef = useUnfocusTextInput()

    const { color, borderRadius, spacing } = Theme.useTheme()
    const { capabilities } = useChatLayout()
    const transparentChrome = capabilities.transparentChrome
    const chromeSurface = transparentChrome ? color.neutral._100 + '55' : color.neutral._100 + 'cc'
    const chromeBorder = transparentChrome ? color.neutral._100 + '66' : color.neutral._200
    const fieldSurface = transparentChrome ? color.neutral._100 + '44' : color.neutral._100
    const optionSurface = transparentChrome ? color.neutral._100 + '55' : color.neutral._200
    const attachmentSurface = transparentChrome ? color.neutral._100 + '44' : color.neutral._200
    const [sendOnEnter] = useMMKVBoolean(AppSettings.SendOnEnter)
    const [disableSend, setDisableSend] = useState(false)
    const [attachments, setAttachments] = useState<Attachment[]>([])
    const [hideOptions, setHideOptions] = useState(false)
    const [showCamera, setShowCamera] = useState(false)
    const { addEntry } = Chats.useEntry()
    const { nowGenerating, abortFunction } = useInference(
        useShallow((state) => ({
            nowGenerating: state.nowGenerating,
            abortFunction: state.abortFunction,
        }))
    )
    const setHeight = useInputHeightStore(useShallow((state) => state.setHeight))

    const { charName } = Characters.useCharacterStore(
        useShallow((state) => ({
            charName: state?.card?.name,
        }))
    )

    const { userName } = Characters.useUserStore(
        useShallow((state) => ({ userName: state.card?.name }))
    )

    const { newMessage, setNewMessage } = useChatInputTextStore(
        useShallow((state) => ({
            newMessage: state.text,
            setNewMessage: state.setText,
        }))
    )

    const { isListening, toggleListening, turnOffListening } = useSpeechInput((text) => {
        setHideOptions(!!text)
        setNewMessage(text)
    })

    const abortResponse = async () => {
        Logger.info(`Aborting Generation`)
        if (abortFunction) await abortFunction()
    }

    const handleSend = async () => {
        playInputSendSound()
        Keyboard.dismiss()
        turnOffListening()
        setDisableSend(true)
        try {
            if (newMessage.trim() !== '' || attachments.length > 0)
                await addEntry(
                    userName ?? '',
                    true,
                    newMessage,
                    attachments.map((item) => item.uri)
                )
            const swipeId = await addEntry(charName ?? '', false, '')
            setNewMessage('')
            setAttachments([])
            if (swipeId) generateResponse(swipeId)
        } catch (e) {
            Logger.errorToast(i18n.t('chat.failedToSend'))
            Logger.error(JSON.stringify(e))
        } finally {
            setDisableSend(false)
        }
    }

    const handlePickImage = async () => {
        const result = await getDocumentAsync({
            type: 'image/*',
            multiple: true,
            copyToCacheDirectory: true,
        })
        if (result.canceled || result.assets.length < 1) return

        const newAttachments = result.assets
            .map((item) => ({
                uri: item.uri,
                type: 'image',
                name: item.name,
            }))
            .filter((item) => !attachments.some((a) => a.name === item.name)) as Attachment[]
        setAttachments([...attachments, ...newAttachments])
    }

    return (
        <View
            onLayout={(e) => {
                setHeight(e.nativeEvent.layout.height)
            }}
            style={{
                position: 'absolute',
                width: '98%',
                alignSelf: 'center',
                bottom: 4,
                paddingVertical: spacing.sm,
                paddingHorizontal: spacing.sm,
                backgroundColor: chromeSurface,
                borderWidth: 1,
                borderColor: chromeBorder,
                boxShadow: [
                    {
                        offsetX: 1,
                        offsetY: 1,
                        color: color.shadow,
                        spreadDistance: 1,
                        blurRadius: 4,
                    },
                ],
                borderRadius: 16,
                rowGap: spacing.m,
            }}>
            <Animated.FlatList
                itemLayoutAnimation={LinearTransition}
                style={{
                    display: attachments.length > 0 ? 'flex' : 'none',
                    padding: spacing.l,
                    backgroundColor: attachmentSurface,
                    borderRadius: borderRadius.m,
                }}
                horizontal
                contentContainerStyle={{ columnGap: spacing.xl }}
                data={attachments}
                keyExtractor={(item) => item.uri}
                renderItem={({ item }) => {
                    return (
                        <Animated.View
                            entering={BounceIn}
                            exiting={ZoomOut.duration(100)}
                            style={{ alignItems: 'center', rowGap: 8 }}>
                            <Image
                                source={{ uri: item.uri }}
                                style={{
                                    width: 128,
                                    height: undefined,
                                    aspectRatio: 1,
                                    borderRadius: borderRadius.m,
                                    borderWidth: 1,
                                    borderColor: color.primary._500,
                                }}
                            />

                            <ThemedButton
                                iconName="close"
                                iconSize={20}
                                buttonStyle={{
                                    borderWidth: 0,
                                    paddingHorizontal: 2,
                                    paddingVertical: 2,
                                    position: 'absolute',
                                    alignSelf: 'flex-end',
                                    margin: -8,
                                    backgroundColor: color.neutral._500,
                                }}
                                onPress={() => {
                                    setAttachments(attachments.filter((a) => a.uri !== item.uri))
                                }}
                            />
                        </Animated.View>
                    )
                }}
            />
            <CameraSheet
                onTakePicture={(picture) => {
                    setAttachments((attachments) => [
                        ...attachments,
                        {
                            name: randomUUID().toString(),
                            uri: picture.uri,
                            type: 'image',
                        },
                    ])
                }}
                visible={showCamera}
                setVisible={setShowCamera}
            />
            <View
                style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    columnGap: spacing.m,
                }}>
                <Animated.View layout={XAxisOnlyTransition}>
                    {!hideOptions && (
                        <Animated.View
                            entering={FadeIn}
                            exiting={FadeOut}
                            style={{
                                flexDirection: 'row',
                                columnGap: 8,
                                alignItems: 'center',
                            }}>
                            <ChatOptions />
                            <ContextMenu
                                triggerIcon="paper-clip"
                                triggerIconSize={20}
                                buttons={[
                                    {
                                        label: t('chat.takePicture'),
                                        icon: 'camera',
                                        onPress: (close) => {
                                            setShowCamera(true)
                                            close()
                                        },
                                    },
                                    {
                                        label: t('chat.addImage'),
                                        icon: 'picture',
                                        onPress: async (close) => {
                                            close()
                                            handlePickImage()
                                        },
                                    },
                                ]}
                                triggerStyle={{
                                    color: color.text._400,
                                    padding: 6,
                                    backgroundColor: optionSurface,
                                    borderRadius: 16,
                                }}
                                placement="top"
                            />
                        </Animated.View>
                    )}
                    {hideOptions && (
                        <Animated.View entering={FadeIn} exiting={FadeOut}>
                            <ThemedButton
                                iconSize={18}
                                iconStyle={{
                                    color: color.text._400,
                                }}
                                buttonStyle={{
                                    padding: 5,
                                    backgroundColor: optionSurface,
                                    borderRadius: 32,
                                }}
                                variant="tertiary"
                                iconName="right"
                                onPress={() => setHideOptions(false)}
                            />
                        </Animated.View>
                    )}
                </Animated.View>
                <AnimatedTextInput
                    layout={XAxisOnlyTransition}
                    ref={inputRef}
                    style={{
                        color: color.text._100,
                        backgroundColor: fieldSurface,
                        flex: 1,
                        borderWidth: 2,
                        borderColor: color.primary._300,
                        borderRadius: borderRadius.l,
                        paddingHorizontal: spacing.m,
                        paddingVertical: spacing.m,
                    }}
                    onPress={() => {
                        setHideOptions(!!newMessage)
                    }}
                    onFocus={() => {
                        playInputFocusSound()
                    }}
                    numberOfLines={8}
                    placeholder={t('chat.messagePlaceholder')}
                    placeholderTextColor={color.text._700}
                    value={newMessage}
                    onChangeText={(text) => {
                        setHideOptions(!!text)
                        setNewMessage(text)
                        // Typing a long message must not trip the lip-sync idle disconnect.
                        useLipSyncSession.getState().markActivity()
                    }}
                    multiline
                    submitBehavior={sendOnEnter ? 'blurAndSubmit' : 'newline'}
                    onSubmitEditing={sendOnEnter ? handleSend : undefined}
                />
                <Animated.View layout={XAxisOnlyTransition}>
                    <TouchableOpacity
                        disabled={nowGenerating}
                        style={{
                            borderRadius: borderRadius.m,
                            backgroundColor: isListening
                                ? color.error._500
                                : optionSurface,
                            padding: spacing.m,
                            opacity: nowGenerating ? 0.4 : 1,
                        }}
                        onPress={() => {
                            inputRef.current?.blur()
                            toggleListening(newMessage)
                        }}>
                        <MaterialIcons
                            name={isListening ? 'mic' : 'mic-none'}
                            color={isListening ? color.neutral._100 : color.text._400}
                            size={24}
                        />
                    </TouchableOpacity>
                </Animated.View>
                <Animated.View layout={XAxisOnlyTransition}>
                    <TouchableOpacity
                        disabled={disableSend || nowGenerating}
                        style={{
                            borderRadius: borderRadius.m,
                            backgroundColor: nowGenerating ? color.error._500 : color.primary._500,
                            padding: spacing.m,
                            opacity: disableSend || nowGenerating ? 0.4 : 1,
                        }}
                        onPress={nowGenerating ? abortResponse : handleSend}>
                        <MaterialIcons
                            name={nowGenerating ? 'stop' : 'send'}
                            color={color.neutral._100}
                            size={24}
                        />
                    </TouchableOpacity>
                </Animated.View>
            </View>
        </View>
    )
}

export default ChatInput
