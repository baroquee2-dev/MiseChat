import { StyleSheet, TouchableOpacity, View } from 'react-native'
import Animated from 'react-native-reanimated'

import Avatar from '@components/views/Avatar'
import { portraitEntrance } from '@lib/animations/chatAnimations'
import { IMMERSIVE_PORTRAIT_ZOOM } from '@lib/chat/immersiveLayout'
import { useFocusedValue } from '@lib/hooks/useFocusedValue'
import { Characters } from '@lib/state/Characters'
import { useAvatarViewerStore } from '@lib/state/components/AvatarViewer'

import LipSyncPortrait from '../LipSyncPortrait'
import PortraitBreathing from '../PortraitBreathing'

type ImmersiveFullscreenPortraitProps = {
    nowGenerating: boolean
}

const ImmersiveFullscreenPortrait: React.FC<ImmersiveFullscreenPortraitProps> = ({
    nowGenerating,
}) => {
    const setShowViewer = useAvatarViewerStore((state) => state.setShow)
    const charImageId = Characters.useCharacterStore((state) => state.card?.image_id) ?? 0
    const stableCharImageId = useFocusedValue(charImageId, 'portrait.fullscreen', {
        resumeDelayMs: 350,
    })

    return (
        <View style={styles.layer} pointerEvents="box-none">
            {/* No key={imageId}: entrance plays on chat mount only, not on image replace. */}
            <Animated.View entering={portraitEntrance} style={styles.layer}>
                <PortraitBreathing active={nowGenerating} style={styles.layer}>
                    <TouchableOpacity
                        activeOpacity={0.95}
                        style={[styles.layer, styles.portraitZoom]}
                        onPress={() => setShowViewer(true, false)}>
                        <LipSyncPortrait style={styles.layer}>
                            <Avatar
                                contentFit="cover"
                                style={styles.layer}
                                targetImage={Characters.getImageDir(stableCharImageId)}
                            />
                        </LipSyncPortrait>
                    </TouchableOpacity>
                </PortraitBreathing>
            </Animated.View>
        </View>
    )
}

export default ImmersiveFullscreenPortrait

const styles = StyleSheet.create({
    layer: {
        ...StyleSheet.absoluteFill,
    },
    portraitZoom: {
        transform: [{ scale: IMMERSIVE_PORTRAIT_ZOOM }],
    },
})
