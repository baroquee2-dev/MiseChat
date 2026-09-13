import { AntDesign } from '@expo/vector-icons'
import { Href, useRouter } from 'expo-router'
import { useTranslation } from 'react-i18next'
import { FlatList, StyleSheet, Text, TouchableOpacity } from 'react-native'
import Animated, { Easing, SlideInLeft } from 'react-native-reanimated'

import { useAppMode } from '@lib/state/AppMode'
import { Theme } from '@lib/theme/ThemeManager'

type ButtonData = {
    nameKey: string
    path: Href
    icon?: keyof typeof AntDesign.glyphMap
}

type DrawerButtonProps = {
    item: ButtonData
    index: number
}

const DrawerButton = ({ item, index }: DrawerButtonProps) => {
    const styles = useStyles()
    const router = useRouter()
    const { color } = Theme.useTheme()
    const { t } = useTranslation()
    return (
        <Animated.View
            key={index}
            entering={SlideInLeft.duration(500 + index * 30)
                .withInitialValues({ originX: index * -150 + -400 })
                .easing(Easing.out(Easing.exp))}>
            <TouchableOpacity
                style={styles.largeButton}
                onPress={() => {
                    router.push(item.path)
                }}>
                <AntDesign size={24} name={item.icon ?? 'question'} color={color.text._400} />
                <Text style={styles.largeButtonText}>{t(item.nameKey)}</Text>
            </TouchableOpacity>
        </Animated.View>
    )
}

const RouteList = () => {
    const { appMode } = useAppMode()
    const { i18n } = useTranslation()
    const paths = getPaths(appMode === 'remote')
    return (
        <FlatList
            key={i18n.language}
            showsVerticalScrollIndicator={false}
            data={paths}
            renderItem={({ item, index }) => <DrawerButton item={item} index={index} />}
            keyExtractor={(item) => item.path.toString()}
        />
    )
}

export default RouteList

const useStyles = () => {
    const { color, spacing, fontSize } = Theme.useTheme()
    return StyleSheet.create({
        largeButtonText: {
            fontSize: fontSize.xl,
            paddingVertical: spacing.l,
            paddingLeft: spacing.xl,
            color: color.text._100,
        },

        largeButton: {
            paddingLeft: spacing.xl,
            flexDirection: 'row',
            alignItems: 'center',
        },
    })
}

const getPaths = (remote: boolean): ButtonData[] => [
    {
        nameKey: 'nav.sampler',
        path: '/screens/SamplerManagerScreen',
        icon: 'control',
    },
    {
        nameKey: 'nav.aiInstructions',
        path: '/screens/FormattingManagerScreen',
        icon: 'profile',
    },
    remote
        ? {
              nameKey: 'nav.api',
              path: '/screens/ConnectionsManagerScreen',
              icon: 'link',
          }
        : {
              nameKey: 'nav.models',
              path: '/screens/ModelManagerScreen',
              icon: 'branches',
          },
    {
        nameKey: 'nav.tts',
        path: '/screens/TTSManagerScreen',
        icon: 'sound',
    },
    {
        nameKey: 'nav.settings',
        path: '/screens/AppSettingsScreen',
        icon: 'setting',
    },
    {
        nameKey: 'nav.characterMemory',
        path: '/screens/CharacterMemoryScreen' as Href,
        icon: 'book',
    },
    {
        nameKey: 'nav.lemonSlice',
        path: '/screens/LemonSliceScreen' as Href,
        icon: 'video-camera',
    },
    {
        nameKey: 'nav.logs',
        path: '/screens/LogsScreen',
        icon: 'code',
    },
    {
        nameKey: 'nav.about',
        path: '/screens/AboutScreen',
        icon: 'info-circle',
    },
]
