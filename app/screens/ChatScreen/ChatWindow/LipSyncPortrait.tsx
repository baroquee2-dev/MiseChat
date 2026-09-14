import { Image } from 'expo-image'
import { ReactNode, useEffect, useState } from 'react'
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native'
import { WebView, type WebViewMessageEvent } from 'react-native-webview'
import { useShallow } from 'zustand/react/shallow'

import { PcmStreamPlayer } from '@lib/audio/PcmStreamPlayer'
import { buildDailyViewerHtml } from '@lib/lemonslice/dailyViewerHtml'
import { Characters } from '@lib/state/Characters'
import { useLipSyncSession, useLipSyncSettings } from '@lib/state/LemonSlice'
import { Logger } from '@lib/state/Logger'
import {
    MOUTH_SLOTS,
    type MouthSlot,
    type MouthSpriteSet,
    useActiveMouthSprites,
} from '@lib/state/MouthSprites'

type LipSyncPortraitProps = {
    children: ReactNode
    style?: StyleProp<ViewStyle>
    radius?: number
}

/** Speech RMS mostly sits around 0.05–0.2, so these split quiet, normal and loud. */
const HALF_OPEN_LEVEL = 0.03
const OPEN_LEVEL = 0.09
/** About 16 frames a second, quick enough to read as talking without flickering. */
const FRAME_INTERVAL_MS = 60

/**
 * Swaps between the character's mouth frames with the loudness of the voice playing.
 * All frames stay mounted and only opacity changes, so switching never flashes.
 */
const MouthSpriteOverlay = ({ sprites, radius }: { sprites: MouthSpriteSet; radius: number }) => {
    const [shown, setShown] = useState<MouthSlot>('closed')

    useEffect(() => {
        const timer = setInterval(() => {
            const level = PcmStreamPlayer.currentLevel()
            const next: MouthSlot =
                level >= OPEN_LEVEL ? 'open' : level >= HALF_OPEN_LEVEL ? 'half' : 'closed'
            setShown((current) => (current === next ? current : next))
        }, FRAME_INTERVAL_MS)
        return () => clearInterval(timer)
    }, [])

    return (
        <View
            pointerEvents="none"
            style={[StyleSheet.absoluteFill, { borderRadius: radius, overflow: 'hidden' }]}>
            {MOUTH_SLOTS.map((slot) => (
                <Image
                    key={slot}
                    source={{ uri: sprites[slot] }}
                    contentFit="cover"
                    style={[StyleSheet.absoluteFill, { opacity: shown === slot ? 1 : 0 }]}
                />
            ))}
        </View>
    )
}

/**
 * Animates the portrait while the character talks: the LemonSlice video when a session
 * is live, otherwise the character's bound mouth frames when image lip sync is on.
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
    const characterId = Characters.useCharacterStore((state) => state.id)
    const sprites = useActiveMouthSprites(characterId)
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
            {!live && sprites && <MouthSpriteOverlay sprites={sprites} radius={radius} />}
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
