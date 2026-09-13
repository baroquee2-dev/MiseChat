import { ReactNode, useEffect, useState } from 'react'
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native'
import { WebView, type WebViewMessageEvent } from 'react-native-webview'
import { useShallow } from 'zustand/react/shallow'

import { buildDailyViewerHtml } from '@lib/lemonslice/dailyViewerHtml'
import { useLipSyncSession, useLipSyncSettings } from '@lib/state/LemonSlice'
import { Logger } from '@lib/state/Logger'

type LipSyncPortraitProps = {
    children: ReactNode
    style?: StyleProp<ViewStyle>
    radius?: number
}

/**
 * Lays the LemonSlice video over the static portrait while a session is live.
 * The portrait stays underneath and keeps the layout's size, and the video stays
 * invisible until frames arrive, so there is no blank gap while it joins.
 */
const LipSyncPortrait: React.FC<LipSyncPortraitProps> = ({ children, style, radius = 0 }) => {
    const enabled = useLipSyncSettings((state) => state.enabled)
    const { connection, viewerToken, dailyUrl } = useLipSyncSession(
        useShallow((state) => ({
            connection: state.connection,
            viewerToken: state.viewerToken,
            dailyUrl: state.dailyUrl,
        }))
    )
    const [readyFor, setReadyFor] = useState('')

    const live = enabled && connection === 'connected' && !!viewerToken && !!dailyUrl
    const ready = live && readyFor === viewerToken

    // Counted so the service knows an avatar is actually on screen to be heard.
    useEffect(() => {
        if (!live) return
        useLipSyncSession.setState((state) => ({ viewers: state.viewers + 1 }))
        return () =>
            useLipSyncSession.setState((state) => ({ viewers: Math.max(0, state.viewers - 1) }))
    }, [live])

    const handleMessage = (event: WebViewMessageEvent) => {
        let payload: { type?: string; message?: string }
        try {
            payload = JSON.parse(event.nativeEvent.data)
        } catch {
            return
        }
        if (payload.type === 'video') setReadyFor(viewerToken)
        else if (payload.type === 'left') setReadyFor('')
        else if (payload.type === 'error') Logger.warn(`[lipsync viewer] ${payload.message}`)
    }

    return (
        <View style={style}>
            {children}
            {live && (
                <View
                    pointerEvents="none"
                    style={[
                        StyleSheet.absoluteFill,
                        { borderRadius: radius, overflow: 'hidden', opacity: ready ? 1 : 0 },
                    ]}>
                    <WebView
                        key={viewerToken}
                        source={{
                            html: buildDailyViewerHtml(dailyUrl, viewerToken),
                            baseUrl: 'https://localhost',
                        }}
                        originWhitelist={['*']}
                        onMessage={handleMessage}
                        mediaPlaybackRequiresUserAction={false}
                        allowsInlineMediaPlayback
                        javaScriptEnabled
                        domStorageEnabled
                        style={styles.web}
                    />
                </View>
            )}
        </View>
    )
}

export default LipSyncPortrait

const styles = StyleSheet.create({
    web: { flex: 1, backgroundColor: 'transparent' },
})
