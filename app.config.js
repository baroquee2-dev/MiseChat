const IS_DEV = process.env.APP_VARIANT === 'development'
const APP_ICON = './assets/images/app-icon.png'
const APP_PACKAGE = IS_DEV ? 'com.baroquee2.misechat.dev' : 'com.baroquee2.misechat'

module.exports = {
    expo: {
        name: IS_DEV ? 'MiseChat (DEV)' : 'MiseChat',
        newArchEnabled: true,
        slug: 'MiseChat',
        version: '0.1.0',
        orientation: 'default',
        icon: APP_ICON,
        scheme: 'misechat',
        userInterfaceStyle: 'automatic',
        assetBundlePatterns: ['**/*'],
        ios: {
            icon: {
                dark: APP_ICON,
                light: APP_ICON,
                tinted: APP_ICON,
            },
            supportsTablet: true,
            package: APP_PACKAGE,
            bundleIdentifier: APP_PACKAGE,
        },
        android: {
            adaptiveIcon: {
                foregroundImage: APP_ICON,
                monochromeImage: APP_ICON,
                backgroundColor: '#000',
            },
            edgeToEdgeEnabled: true,
            package: APP_PACKAGE,
            userInterfaceStyle: 'dark',
            permissions: [
                'android.permission.FOREGROUND_SERVICE',
                'android.permission.WAKE_LOCK',
                'android.permission.FOREGROUND_SERVICE_DATA_SYNC',
            ],
        },
        web: {
            bundler: 'metro',
            output: 'static',
            favicon: APP_ICON,
        },
        plugins: [
            [
                'expo-asset',
                {
                    assets: [
                        './assets/characters/EnglishSample.png',
                        './assets/characters/JapaneseSample.png',
                        './assets/characters/ChineseSample.png',
                        './assets/models/llama3tokenizer.gguf',
                        './assets/images/default-chat-background.png',
                    ],
                },
            ],
            [
                'expo-build-properties',
                {
                    android: {
                        largeHeap: true,
                        usesCleartextTraffic: true,
                        enableProguardInReleaseBuilds: true,
                        enableShrinkResourcesInReleaseBuilds: true,
                        useLegacyPackaging: true,
                        extraProguardRules: '-keep class com.rnllama.** { *; }',
                    },
                },
            ],
            [
                'expo-splash-screen',
                {
                    backgroundColor: '#000000',
                    image: APP_ICON,
                    imageWidth: 200,
                },
            ],
            [
                'expo-notifications',
                {
                    icon: APP_ICON,
                },
            ],
            './expo-build-plugins/gradlejvm.plugin.js',
            [
                './expo-build-plugins/androidattributes.plugin.js',
                {
                    'android:largeHeap': true,
                },
            ],
            [
                'expo-camera',
                {
                    cameraPermission: 'Allow MiseChat to access your camera',
                },
            ],
            ['expo-sqlite', { withSQLiteVecExtension: true }],
            [
                'expo-speech-recognition',
                {
                    microphonePermission:
                        'Allow MiseChat to use the microphone for voice input.',
                },
            ],
            'expo-localization',
            'expo-audio',
            [
                // Used only for in-app streaming TTS playback, so none of the
                // background-audio machinery or the FFmpeg decoders are needed.
                'react-native-audio-api',
                {
                    iosBackgroundMode: false,
                    androidForegroundService: false,
                    androidPermissions: [],
                    disableFFmpeg: true,
                },
            ],
            'expo-router',
            'expo-font',
            'expo-image',
            './expo-build-plugins/bgactions.plugin.js',
            './expo-build-plugins/usercert.plugin.js',
            './expo-build-plugins/rnllama.plugin.js',
            './expo-build-plugins/copyhtp.plugin.js',
        ],
        experiments: {
            typedRoutes: true,
            reactCompiler: true,
        },
        extra: {
            router: {
                origin: false,
            },
            eas: {
                projectId: 'd588a96a-5eb0-457a-85bc-e21acfdc60e9',
            },
        },
    },
}
