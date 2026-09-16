import { Pressable, Text, View } from 'react-native'
import { useShallow } from 'zustand/react/shallow'

import { Chats } from '@lib/state/Chat'
import { Theme } from '@lib/theme/ThemeManager'

import { useIsImmersivePresentation, useIsVisualNovelPresentation } from '@lib/chat/ChatLayoutContext'
import ChatAttachments from './ChatAttachments'
import { useChatEditorStore } from './ChatEditor'
import ChatQuickActions, { useChatActionsState } from './ChatQuickActions'
import ChatSwipes from './ChatSwipes'
import ChatText from './ChatText'
import ChatTextLast from './ChatTextLast'
import { IMMERSIVE_CHROME } from '@lib/chat/immersiveChrome'
import { IMMERSIVE_DIALOGUE_LEFT_PADDING, getImmersiveDialogueWidth } from '@lib/chat/immersiveLayout'

type ChatTextProps = {
    index: number
    nowGenerating: boolean
    isLastMessage: boolean
    isGreeting: boolean
    historyCompact?: boolean
    toolbarExternal?: boolean
}

const ChatBubble: React.FC<ChatTextProps> = ({
    index,
    nowGenerating,
    isLastMessage,
    isGreeting,
    historyCompact = false,
    toolbarExternal = false,
}) => {
    const message = Chats.useEntryData(index)
    const isVisualNovel = useIsVisualNovelPresentation()
    const isImmersive = useIsImmersivePresentation()
    const { color, spacing, borderRadius, fontSize } = Theme.useTheme()

    const { setShowOptions } = useChatActionsState(
        useShallow((state) => ({
            setShowOptions: state.setActiveIndex,
        }))
    )

    const showEditor = useChatEditorStore((state) => state.show)
    const handleEnableEdit = () => {
        if (!nowGenerating) showEditor(index)
    }

    const hasSwipes = message?.swipes?.length > 1
    const showSwipe =
        !message.is_user &&
        isLastMessage &&
        (isVisualNovel || isImmersive || hasSwipes || !isGreeting)

    const isVisualNovelDialogue = isVisualNovel && isLastMessage && !message.is_user
    const isImmersiveDialogue = isImmersive && isLastMessage && !message.is_user
    const isVisualNovelUser = isVisualNovel && isLastMessage && message.is_user
    const isImmersiveUser = isImmersive && isLastMessage && message.is_user
    const isPresentationDialogue = isVisualNovelDialogue || isImmersiveDialogue

    const bubbleStyle = historyCompact
        ? {
              backgroundColor: isImmersive
                  ? color.neutral._100 + IMMERSIVE_CHROME.surface
                  : color.neutral._200 + '99',
              borderColor: isImmersive
                  ? color.neutral._100 + IMMERSIVE_CHROME.border
                  : color.neutral._300,
              borderWidth: 1,
              marginBottom: 2,
              paddingVertical: spacing.xs,
              paddingHorizontal: spacing.sm,
              minHeight: 28,
              borderRadius: borderRadius.s,
          }
        : isPresentationDialogue
          ? null
          : isImmersiveUser
            ? {
                  backgroundColor: color.neutral._100 + IMMERSIVE_CHROME.surface,
                  borderColor: color.neutral._100 + IMMERSIVE_CHROME.border,
                  borderWidth: 1,
                  marginBottom: 4,
                  paddingVertical: spacing.sm,
                  paddingHorizontal: spacing.m,
                  minHeight: 40,
                  borderRadius: borderRadius.m,
              }
            : isVisualNovelUser
              ? {
                    backgroundColor: color.primary._500 + '33',
                    borderColor: color.primary._500 + '55',
                    borderWidth: 1,
                    marginBottom: 4,
                    paddingVertical: spacing.sm,
                    paddingHorizontal: spacing.m,
                    minHeight: 40,
                    borderRadius: borderRadius.m,
                }
              : {
                    backgroundColor: color.neutral._200,
                    borderColor: color.neutral._200,
                    borderWidth: 1,
                    marginBottom: showSwipe ? 0 : 4,
                    paddingVertical: spacing.sm,
                    paddingHorizontal: spacing.m,
                    minHeight: 40,
                    borderRadius: borderRadius.m,
                    shadowColor: color.shadow,
                    boxShadow: [
                        {
                            offsetX: 1,
                            offsetY: 1,
                            spreadDistance: 2,
                            color: color.shadow,
                            blurRadius: 4,
                        },
                    ],
                }

    const bubbleContent = (
        <>
            {isLastMessage ? (
                <ChatTextLast
                    nowGenerating={nowGenerating}
                    index={index}
                    visualNovelDialogue={isVisualNovelDialogue}
                    immersiveDialogue={isImmersiveDialogue}
                    onBubblePress={
                        isPresentationDialogue
                            ? () => setShowOptions(nowGenerating ? undefined : index)
                            : undefined
                    }
                    onBubbleLongPress={isPresentationDialogue ? handleEnableEdit : undefined}
                />
            ) : (
                <ChatText nowGenerating={nowGenerating} index={index} />
            )}
            {!historyCompact && <ChatAttachments index={index} />}
            {!historyCompact && (
                <View
                    pointerEvents="box-none"
                    style={{
                        flexDirection: 'row',
                    }}>
                    <ChatQuickActions
                        nowGenerating={nowGenerating}
                        isLastMessage={isLastMessage}
                        index={index}
                        visualNovelDialogue={isVisualNovelDialogue}
                        immersiveDialogue={isImmersiveDialogue}
                    />
                </View>
            )}
        </>
    )

    return (
        <View>
            {showSwipe && isPresentationDialogue && !toolbarExternal && (
                <ChatSwipes
                    index={index}
                    nowGenerating={nowGenerating}
                    isGreeting={isGreeting}
                    visualNovelDialogue={isVisualNovelDialogue}
                    immersiveDialogue={isImmersiveDialogue}
                />
            )}
            {isImmersiveDialogue ? (
                <View
                    style={{
                        alignSelf: 'flex-start',
                        width: toolbarExternal ? '100%' : getImmersiveDialogueWidth(),
                        marginLeft: toolbarExternal ? 0 : IMMERSIVE_DIALOGUE_LEFT_PADDING,
                        backgroundColor: color.neutral._100 + IMMERSIVE_CHROME.surfaceStrong,
                        borderTopLeftRadius: borderRadius.l,
                        borderTopRightRadius: borderRadius.l,
                        borderBottomLeftRadius: toolbarExternal ? 0 : borderRadius.l,
                        borderBottomRightRadius: toolbarExternal ? 0 : borderRadius.l,
                        paddingTop: spacing.m,
                        paddingHorizontal: spacing.m,
                        paddingBottom: spacing.m,
                        minHeight: 40,
                    }}>
                    {bubbleContent}
                </View>
            ) : isVisualNovelDialogue ? (
                <View style={{ width: '100%', position: 'relative' }}>
                    <View
                        style={{
                            position: 'absolute',
                            top: 0,
                            left: spacing.l,
                            zIndex: 2,
                            backgroundColor: color.neutral._300 + 'f2',
                            borderColor: color.neutral._500,
                            borderWidth: 1,
                            paddingHorizontal: spacing.xl,
                            paddingVertical: spacing.sm,
                            borderRadius: borderRadius.m,
                        }}>
                        <Text
                            style={{
                                color: color.text._100,
                                fontSize: fontSize.l,
                                fontWeight: '700',
                            }}>
                            {message.name}
                        </Text>
                    </View>
                    <View
                        style={{
                            width: '100%',
                            marginTop: spacing.l,
                            backgroundColor: color.neutral._100 + 'dd',
                            borderColor: color.neutral._400,
                            borderWidth: 1,
                            borderTopLeftRadius: borderRadius.l,
                            borderTopRightRadius: borderRadius.l,
                            borderBottomLeftRadius: 0,
                            borderBottomRightRadius: 0,
                            paddingTop: spacing.xl3,
                            paddingHorizontal: spacing.l,
                            paddingBottom: spacing.l,
                            minHeight: 48,
                            overflow: 'visible',
                        }}>
                        {bubbleContent}
                    </View>
                </View>
            ) : (
                <Pressable
                    onPress={() => {
                        setShowOptions(nowGenerating ? undefined : index)
                    }}
                    style={bubbleStyle}
                    onLongPress={handleEnableEdit}>
                    {bubbleContent}
                </Pressable>
            )}
            {showSwipe && !isPresentationDialogue && (
                <ChatSwipes index={index} nowGenerating={nowGenerating} isGreeting={isGreeting} />
            )}
        </View>
    )
}

export default ChatBubble
