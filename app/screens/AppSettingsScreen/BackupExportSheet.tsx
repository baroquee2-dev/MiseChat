import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Text, View } from 'react-native'

import ThemedButton from '@components/buttons/ThemedButton'
import ThemedCheckbox from '@components/input/ThemedCheckbox'
import BottomSheet from '@components/views/BottomSheet'
import { Theme } from '@lib/theme/ThemeManager'
import { type BackupScope, FULL_BACKUP_SCOPE, isEmptyScope } from '@lib/utils/BackupScope'

type BackupExportSheetProps = {
    visible: boolean
    setVisible: (visible: boolean) => void
    onConfirm: (scope: BackupScope) => void
}

/**
 * Picks what goes into a backup. The options are a hierarchy, so ticking a nested
 * option also ticks the one it depends on, and clearing an option clears whatever
 * would be left dangling underneath it.
 */
const BackupExportSheet: React.FC<BackupExportSheetProps> = ({
    visible,
    setVisible,
    onConfirm,
}) => {
    const { t } = useTranslation()
    const { color, fontSize, spacing } = Theme.useTheme()
    // The sheet is mounted only while open, so every open starts from everything ticked.
    const [scope, setScope] = useState<BackupScope>(FULL_BACKUP_SCOPE)

    const setCharacters = (value: boolean) =>
        setScope((current) => ({
            ...current,
            characters: value,
            chats: value && current.chats,
            attachments: value && current.attachments,
        }))

    const setChats = (value: boolean) =>
        setScope((current) => ({
            ...current,
            characters: current.characters || value,
            chats: value,
            attachments: value && current.attachments,
        }))

    const setAttachments = (value: boolean) =>
        setScope((current) => ({
            ...current,
            characters: current.characters || value,
            chats: current.chats || value,
            attachments: value,
        }))

    const setSettings = (value: boolean) =>
        setScope((current) => ({
            ...current,
            settings: value,
            apiKeys: value && current.apiKeys,
        }))

    const setApiKeys = (value: boolean) =>
        setScope((current) => ({
            ...current,
            settings: current.settings || value,
            apiKeys: value,
        }))

    const nested = { paddingLeft: spacing.xl2 }

    return (
        <BottomSheet visible={visible} setVisible={setVisible}>
            <View style={{ rowGap: spacing.m }}>
                <Text style={{ color: color.text._100, fontSize: fontSize.l }}>
                    {t('settings.database.exportScopeTitle')}
                </Text>
                <Text style={{ color: color.text._400 }}>
                    {t('settings.database.exportScopeDesc')}
                </Text>

                <View>
                    <ThemedCheckbox
                        label={t('settings.database.scopeCharacters')}
                        value={scope.characters}
                        onChangeValue={setCharacters}
                    />
                    <ThemedCheckbox
                        label={t('settings.database.scopeChats')}
                        value={scope.chats}
                        onChangeValue={setChats}
                        style={nested}
                    />
                    <ThemedCheckbox
                        label={t('settings.database.scopeAttachments')}
                        value={scope.attachments}
                        onChangeValue={setAttachments}
                        style={nested}
                    />
                </View>

                <View>
                    <ThemedCheckbox
                        label={t('settings.database.scopeSettings')}
                        value={scope.settings}
                        onChangeValue={setSettings}
                    />
                    <ThemedCheckbox
                        label={t('settings.database.scopeApiKeys')}
                        value={scope.apiKeys}
                        onChangeValue={setApiKeys}
                        style={nested}
                    />
                </View>

                {scope.apiKeys && (
                    <Text style={{ color: color.error._300 }}>
                        {t('settings.database.scopeApiKeysWarning')}
                    </Text>
                )}

                <View style={{ flexDirection: 'row', columnGap: spacing.m }}>
                    <ThemedButton
                        label={t('common.cancel')}
                        variant="tertiary"
                        onPress={() => setVisible(false)}
                    />
                    <ThemedButton
                        label={t('common.export')}
                        variant={isEmptyScope(scope) ? 'disabled' : 'primary'}
                        onPress={() => {
                            setVisible(false)
                            onConfirm(scope)
                        }}
                    />
                </View>
            </View>
        </BottomSheet>
    )
}

export default BackupExportSheet
