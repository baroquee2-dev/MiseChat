import { useCallback, useEffect, useMemo, useRef } from 'react'
import { Pressable, View, Animated, Easing, useAnimatedValue } from 'react-native'
import { ScrollView } from 'react-native-gesture-handler'
import Markdown from 'react-native-markdown-display'
import { useShallow } from 'zustand/react/shallow'

import AnimatedEllipsis from '@components/text/AnimatedEllipsis'
import { MarkdownStyle } from '@lib/markdown/Markdown'
import { Chats, useInference } from '@lib/state/Chat'

import { useInputHeightStore } from '../ChatInput'
import { getImmersiveDialogueMaxHeight as getVisualNovelDialogueMaxHeight } from './ChatFrame'
import { getImmersiveDialogueMaxHeight } from '@lib/chat/immersiveLayout'

type ChatTextProps = {
    nowGenerating: boolean
    index: number
    visualNovelDialogue?: boolean
    immersiveDialogue?: boolean
    onBubblePress?: () => void
    onBubbleLongPress?: () => void
}

const ChatTextLast: React.FC<ChatTextProps> = ({
    nowGenerating,
    index,
    visualNovelDialogue = false,
    immersiveDialogue = false,
    onBubblePress,
    onBubbleLongPress,
}) => {
    const { markdown, rules, style } = MarkdownStyle.useCustomFormatting()

    const { swipeText, swipeId } = Chats.useSwipeData(index)
    const { buffer } = Chats.useBuffer()

    const viewRef = useRef<View>(null)
    const scrollRef = useRef<ScrollView>(null)
    const currentSwipeId = useInference((state) => state.currentSwipeId)
    const animHeight = useAnimatedValue(-1)
    const targetHeight = useRef(-1)
    const firstRender = useRef(true)
    const inputHeight = useInputHeightStore(useShallow((state) => state.height))
    const immersiveMaxHeight = useMemo(
        () =>
            immersiveDialogue
                ? getImmersiveDialogueMaxHeight(inputHeight)
                : getVisualNovelDialogueMaxHeight(inputHeight),
        [immersiveDialogue, inputHeight]
    )

    const updateHeight = useCallback(() => {
        viewRef.current?.measure((_, __, ___, measuredHeight) => {
            if (firstRender.current) {
                firstRender.current = false
                animHeight.setValue(measuredHeight)
                return
            }
            const showPadding = nowGenerating && buffer.data
            const overflowPadding = showPadding ? 12 : 0
            const newHeight = measuredHeight + overflowPadding

            if (targetHeight.current === newHeight) return
            if (targetHeight.current > -1) animHeight.setValue(targetHeight.current)

            animHeight.stopAnimation(() =>
                Animated.timing(animHeight, {
                    toValue: newHeight,
                    duration: 300 * Math.max(1, Math.abs(newHeight - targetHeight.current) / 1000),
                    useNativeDriver: false,
                    easing: Easing.inOut((x) => x * x),
                }).start()
            )
            targetHeight.current = newHeight
        })
    }, [animHeight, buffer.data, nowGenerating])

    useEffect(() => {
        if (!nowGenerating && !firstRender.current) {
            setTimeout(() => updateHeight(), 400)
        }
    }, [nowGenerating, updateHeight])

    const displayText =
        nowGenerating && swipeId === currentSwipeId ? buffer.data.trim() : swipeText?.trim()

    const markdownContent = (
        <>
            {swipeId === currentSwipeId && nowGenerating && buffer.data === '' && <AnimatedEllipsis />}
            <Markdown mergeStyle={false} markdownit={markdown} rules={rules} style={style}>
                {displayText}
            </Markdown>
        </>
    )

    if (visualNovelDialogue || immersiveDialogue) {
        return (
            <ScrollView
                ref={scrollRef}
                style={
                    immersiveDialogue
                        ? { maxHeight: immersiveMaxHeight, flexGrow: 0 }
                        : { height: immersiveMaxHeight }
                }
                nestedScrollEnabled
                scrollEnabled
                showsVerticalScrollIndicator
                keyboardShouldPersistTaps="handled">
                <Pressable
                    unstable_pressDelay={120}
                    onPress={onBubblePress}
                    onLongPress={onBubbleLongPress}>
                    {markdownContent}
                </Pressable>
            </ScrollView>
        )
    }

    return (
        <Animated.View style={{ overflow: 'scroll', height: animHeight }}>
            <View style={{ minHeight: 10 }} ref={viewRef} onLayout={updateHeight}>
                {markdownContent}
            </View>
        </Animated.View>
    )
}

export default ChatTextLast
