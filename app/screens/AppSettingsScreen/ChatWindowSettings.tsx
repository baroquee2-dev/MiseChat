import React from 'react'
import { View } from 'react-native'
import { useMMKVBoolean } from 'react-native-mmkv'
import { useTranslation } from 'react-i18next'

import ThemedSwitch from '@components/input/ThemedSwitch'
import SectionTitle from '@components/text/SectionTitle'
import { useChatLayout } from '@lib/constants/ChatLayout'
import { AppSettings } from '@lib/constants/GlobalValues'

const ChatWindowSettings = () => {
    const { t } = useTranslation()
    const [autoScroll, setAutoScroll] = useMMKVBoolean(AppSettings.AutoScroll)
    const [sendOnEnter, setSendOnEnter] = useMMKVBoolean(AppSettings.SendOnEnter)
    const [saveScroll, setSaveScroll] = useMMKVBoolean(AppSettings.SaveScrollPosition)
    const { capabilities } = useChatLayout()

    return (
        <View style={{ rowGap: 8 }}>
            <SectionTitle>{t('settings.chatWindow.title')}</SectionTitle>

            <ThemedSwitch
                label={t('settings.chatWindow.autoScroll')}
                value={autoScroll}
                onChangeValue={setAutoScroll}
                description={t('settings.chatWindow.autoScrollDesc')}
            />

            <ThemedSwitch
                label={t('settings.chatWindow.sendOnEnter')}
                value={sendOnEnter}
                onChangeValue={setSendOnEnter}
                description={t('settings.chatWindow.sendOnEnterDesc')}
            />

            {capabilities.supportsScrollPersistence && (
                <ThemedSwitch
                    label={t('settings.chatWindow.saveScroll')}
                    value={saveScroll}
                    onChangeValue={setSaveScroll}
                    description={t('settings.chatWindow.saveScrollDesc')}
                />
            )}
        </View>
    )
}

export default ChatWindowSettings
