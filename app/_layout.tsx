import { SplashScreen, Stack } from 'expo-router'
import { setOptions } from 'expo-splash-screen'
import {
    NotoSansSC_300Light,
    NotoSansSC_400Regular,
    NotoSansSC_500Medium,
    NotoSansSC_600SemiBold,
    NotoSansSC_700Bold,
    NotoSansSC_800ExtraBold,
    NotoSansSC_900Black,
    useFonts,
} from '@expo-google-fonts/noto-sans-sc'
import { useEffect } from 'react'
import { GestureHandlerRootView } from 'react-native-gesture-handler'
import { KeyboardProvider } from 'react-native-keyboard-controller'

import { AlertProvider } from '@components/views/Alert'
import { PortalHost } from '@components/views/Portal'
import '@lib/i18n'
import { useDialogueFontsStore } from '@lib/state/DialogueFonts'
import { LiteLLMModels } from '@lib/state/LiteLLMModels'
import { Theme } from '@lib/theme/ThemeManager'

SplashScreen.preventAutoHideAsync()
setOptions({
    fade: true,
    duration: 350,
})

const Layout = () => {
    const { color } = Theme.useTheme()
    const setFontsReady = useDialogueFontsStore((state) => state.setReady)
    const [fontsLoaded] = useFonts({
        NotoSansSC_300Light,
        NotoSansSC_400Regular,
        NotoSansSC_500Medium,
        NotoSansSC_600SemiBold,
        NotoSansSC_700Bold,
        NotoSansSC_800ExtraBold,
        NotoSansSC_900Black,
    })

    useEffect(() => {
        if (fontsLoaded) setFontsReady(true)
    }, [fontsLoaded, setFontsReady])

    LiteLLMModels.useDailyRefresh()
    return (
        <GestureHandlerRootView style={{ flex: 1 }}>
            <KeyboardProvider>
                <AlertProvider />
                <Stack
                    screenOptions={{
                        headerBackButtonDisplayMode: 'minimal',
                        headerStyle: { backgroundColor: color.neutral._100 },
                        headerTitleStyle: { color: color.text._100 },
                        headerTintColor: color.text._100,
                        contentStyle: { backgroundColor: color.neutral._100 },
                        headerShadowVisible: false,
                        headerTitleAlign: 'center',
                        statusBarStyle: 'auto',
                    }}>
                    <Stack.Screen name="index" options={{ animation: 'fade' }} />
                </Stack>
                <PortalHost />
            </KeyboardProvider>
        </GestureHandlerRootView>
    )
}

export default Layout
