import { reloadAppAsync } from 'expo'
import { getDocumentAsync } from 'expo-document-picker'
import React, { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Text, View } from 'react-native'

import ThemedButton from '@components/buttons/ThemedButton'
import SectionTitle from '@components/text/SectionTitle'
import Alert from '@components/views/Alert'
import i18n from '@lib/i18n'
import { Logger } from '@lib/state/Logger'
import { Theme } from '@lib/theme/ThemeManager'
import { exportAppBackup, importAppBackup, readBackupManifest } from '@lib/utils/Backup'
import { type BackupScope } from '@lib/utils/BackupScope'
import appConfig from 'app.config'

import BackupExportSheet from './BackupExportSheet'

const appVersion = appConfig.expo.version

const exportDB = async (scope: BackupScope) => {
    try {
        await exportAppBackup(appVersion, scope)
        Logger.infoToast(i18n.t('settings.database.downloadSuccess'))
    } catch (e) {
        Logger.errorToast(i18n.t('settings.database.copyFailed', { error: e }))
    }
}

/** Lists what a backup carries, so a destructive restore is not a guess. */
const describeScope = (scope: BackupScope | undefined) => {
    if (!scope) return i18n.t('settings.database.scopeLegacy')
    const parts = [
        scope.characters && i18n.t('settings.database.scopeCharacters'),
        scope.chats && i18n.t('settings.database.scopeChats'),
        scope.attachments && i18n.t('settings.database.scopeAttachments'),
        scope.settings && i18n.t('settings.database.scopeSettings'),
        scope.apiKeys && i18n.t('settings.database.scopeApiKeys'),
    ].filter((part) => typeof part === 'string')
    return parts.length ? parts.join(i18n.t('settings.database.scopeSeparator')) : ''
}

const importDB = async (uri: string, name: string) => {
    const copyDB = async () => {
        try {
            await importAppBackup(uri, name)
            reloadAppAsync()
        } catch (e) {
            Logger.errorToast(i18n.t('settings.database.copyFailed', { error: e }))
        }
    }

    const dbAppVersion = name.split('-')?.[0]
    if (dbAppVersion !== appVersion) {
        Alert.alert({
            title: i18n.t('settings.database.versionWarningTitle'),
            description: i18n.t('settings.database.versionWarningDesc', {
                dbVersion: dbAppVersion,
                appVersion: appVersion,
            }),
            buttons: [
                { label: i18n.t('common.cancel') },
                {
                    label: i18n.t('settings.database.importAnyways'),
                    onPress: copyDB,
                    type: 'warning',
                },
            ],
        })
    } else copyDB()
}

const DatabaseSettings = () => {
    const { t } = useTranslation()
    const { color, spacing } = Theme.useTheme()
    const [exportVisible, setExportVisible] = useState(false)

    const confirmImport = async (uri: string, name: string) => {
        let contents = ''
        try {
            contents = describeScope((await readBackupManifest(uri, name))?.scope)
        } catch (e) {
            Logger.errorToast(t('settings.database.copyFailed', { error: e }))
            return
        }
        Alert.alert({
            title: t('settings.database.importTitle'),
            description: t('settings.database.importDesc', { contents }),
            buttons: [
                { label: t('common.cancel') },
                {
                    label: t('common.import'),
                    onPress: () => importDB(uri, name),
                    type: 'warning',
                },
            ],
        })
    }

    return (
        <View style={{ rowGap: 8 }}>
            <SectionTitle>{t('settings.database.title')}</SectionTitle>

            <Text
                style={{
                    color: color.text._500,
                    paddingBottom: spacing.xs,
                    marginBottom: spacing.m,
                }}>
                {t('settings.database.warning')}
            </Text>

            {exportVisible && (
                <BackupExportSheet
                    visible={exportVisible}
                    setVisible={setExportVisible}
                    onConfirm={exportDB}
                />
            )}

            <ThemedButton
                label={t('settings.database.export')}
                variant="secondary"
                onPress={() => setExportVisible(true)}
            />

            <ThemedButton
                label={t('settings.database.import')}
                variant="secondary"
                onPress={async () => {
                    getDocumentAsync({
                        type: ['application/zip', 'application/x-zip-compressed', 'application/*'],
                    }).then(async (result) => {
                        if (result.canceled) return
                        await confirmImport(result.assets[0].uri, result.assets[0].name)
                    })
                }}
            />
        </View>
    )
}

export default DatabaseSettings
