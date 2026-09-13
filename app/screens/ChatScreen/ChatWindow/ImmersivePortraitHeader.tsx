import { useMemo } from 'react'
import { Text, TouchableOpacity, View } from 'react-native'
import Animated from 'react-native-reanimated'

import Avatar from '@components/views/Avatar'
import { portraitEntrance } from '@lib/animations/chatAnimations'
import { useFocusedValue } from '@lib/hooks/useFocusedValue'
import { Characters } from '@lib/state/Characters'
import { useAvatarViewerStore } from '@lib/state/components/AvatarViewer'
import { Theme } from '@lib/theme/ThemeManager'

import { getImmersivePortraitSize } from './ChatFrame'
import LipSyncPortrait from './LipSyncPortrait'
import PortraitBreathing from './PortraitBreathing'

type ImmersivePortraitHeaderProps = {
    nowGenerating: boolean
}

const ImmersivePortraitHeader: React.FC<ImmersivePortraitHeaderProps> = ({ nowGenerating }) => {
    const { color, spacing, borderRadius } = Theme.useTheme()
    const setShowViewer = useAvatarViewerStore((state) => state.setShow)
    const charImageId = Characters.useCharacterStore((state) => state.card?.image_id) ?? 0
    // Apply after background so both heavy images are not swapped in one frame.
    const stableCharImageId = useFocusedValue(charImageId, 'portrait.header', {
        resumeDelayMs: 350,
    })
    const immersivePortraitSize = useMemo(getImmersivePortraitSize, [])

    return (
        <View style={{ alignItems: 'center', paddingTop: spacing.sm }}>
            {/* No key={imageId}: entrance plays on chat mount only, not on image replace. */}
            <Animated.View entering={portraitEntrance}>
                <PortraitBreathing active={nowGenerating}>
                    <TouchableOpacity onPress={() => setShowViewer(true, false)}>
                        <LipSyncPortrait radius={borderRadius.xl2}>
                            <Avatar
                                contentFit="cover"
                                style={{
                                    width: immersivePortraitSize.width,
                                    height: immersivePortraitSize.height,
                                    borderRadius: borderRadius.xl2,
                                    borderWidth: 2,
                                    borderColor: color.neutral._100 + '88',
                                }}
                                targetImage={Characters.getImageDir(stableCharImageId)}
                            />
                        </LipSyncPortrait>
                    </TouchableOpacity>
                </PortraitBreathing>
            </Animated.View>
        </View>
    )
}

export default ImmersivePortraitHeader
