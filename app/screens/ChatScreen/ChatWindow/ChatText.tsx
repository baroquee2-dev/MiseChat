import React, { useRef } from 'react'
import { Animated, Easing, useAnimatedValue, View } from 'react-native'
import Markdown from 'react-native-markdown-display'

import { MarkdownStyle } from '@lib/markdown/Markdown'
import { Chats } from '@lib/state/Chat'

type ChatTextProps = {
    nowGenerating: boolean
    index: number
}

const ChatText: React.FC<ChatTextProps> = ({ nowGenerating, index }) => {
    const { markdown, rules, style } = MarkdownStyle.useCustomFormatting()
    const { swipeText } = Chats.useSwipeData(index)
    const viewRef = useRef<View>(null)
    const animHeight = useAnimatedValue(-1)
    const targetHeight = useRef(-1)
    const firstRender = useRef(true)

    const handleAnimateHeight = (newheight: number) => {
        animHeight.stopAnimation(() =>
            Animated.timing(animHeight, {
                toValue: newheight,
                duration: 150,
                useNativeDriver: false,
                easing: Easing.inOut((x) => x * x),
            }).start()
        )
    }

    const updateHeight = () => {
        viewRef.current?.measure((_, __, ___, measuredHeight) => {
            if (firstRender.current) {
                animHeight.setValue(measuredHeight)
                return (firstRender.current = false)
            }
            if (targetHeight.current === measuredHeight) return
            if (targetHeight.current > -1) animHeight.setValue(targetHeight.current)
            handleAnimateHeight(measuredHeight)
            targetHeight.current = measuredHeight
        })
    }

    return (
        <Animated.View style={{ overflow: 'scroll', height: animHeight }}>
            <View style={{ minHeight: 10 }} ref={viewRef} onLayout={updateHeight}>
                <Markdown mergeStyle={false} markdownit={markdown} rules={rules} style={style}>
                    {swipeText?.trim()}
                </Markdown>
            </View>
        </Animated.View>
    )
}

export default ChatText
