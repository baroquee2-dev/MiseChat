import { View } from 'react-native'
import { useTranslation } from 'react-i18next'

import ThemedButton from '@components/buttons/ThemedButton'
import SectionTitle from '@components/text/SectionTitle'
import Alert from '@components/views/Alert'
import { Characters } from '@lib/state/Characters'

const CharacterSettings = () => {
    const { t } = useTranslation()
    return (
        <View style={{ rowGap: 8 }}>
            <SectionTitle>{t('settings.character.title')}</SectionTitle>
            <ThemedButton
                label={t('settings.character.regenerateDefault')}
                variant="secondary"
                onPress={() => {
                    Alert.alert({
                        title: t('settings.character.regenerateDefaultTitle'),
                        description: t('settings.character.regenerateDefaultDesc'),
                        buttons: [
                            { label: t('common.cancel') },
                            {
                                label: t('settings.character.createDefault'),
                                onPress: async () => await Characters.createDefaultCard(),
                            },
                        ],
                    })
                }}
            />
        </View>
    )
}

export default CharacterSettings
