import { useLiveQuery } from 'drizzle-orm/expo-sqlite'
import { useMemo, useState } from 'react'
import { Text, View } from 'react-native'
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller'
import Markdown from 'react-native-markdown-display'
import { useMMKVBoolean } from 'react-native-mmkv'
import { useTranslation } from 'react-i18next'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useShallow } from 'zustand/react/shallow'

import DropdownSheet from '@components/input/DropdownSheet'
import StringArrayEditor from '@components/input/StringArrayEditor'
import ThemedCheckbox from '@components/input/ThemedCheckbox'
import ThemedSwitch from '@components/input/ThemedSwitch'
import ThemedTextInput from '@components/input/ThemedTextInput'
import SectionTitle from '@components/text/SectionTitle'
import Accordion from '@components/views/Accordion'
import Alert from '@components/views/Alert'
import ContextMenu from '@components/views/ContextMenu'
import HeaderTitle from '@components/views/HeaderTitle'
import InputSheet from '@components/views/InputSheet'
import { AppSettings } from '@lib/constants/GlobalValues'
import useAutosave from '@lib/hooks/AutoSave'
import { useTextFilterStore } from '@lib/hooks/TextFilter'
import i18n from '@lib/i18n'
import { MarkdownStyle } from '@lib/markdown/Markdown'
import { InstructFormats, Instructs } from '@lib/state/Instructs'
import { Logger } from '@lib/state/Logger'
import { Theme } from '@lib/theme/ThemeManager'
import { saveStringToDownload } from '@lib/utils/File'

const autoformatterExamples = [
    '*<No Formatting>*',
    'Some action, "Some speech"',
    '*Some action* Some speech',
    '*Some action* "Some speech"',
]

const FormattingManager = () => {
    const { t } = useTranslation()
    const markdownStyle = MarkdownStyle.useMarkdownStyle()
    const autoformatterData = useMemo(
        () => [
            { label: t('instruct.formatDisabled'), example: autoformatterExamples[0] },
            { label: t('instruct.formatPlainQuote'), example: autoformatterExamples[1] },
            { label: t('instruct.formatAsteriskPlain'), example: autoformatterExamples[2] },
            { label: t('instruct.formatAsteriskQuote'), example: autoformatterExamples[3] },
        ],
        [t]
    )
    const { currentInstruct, loadInstruct, setCurrentInstruct } = Instructs.useInstruct(
        useShallow((state) => ({
            currentInstruct: state.data,
            loadInstruct: state.load,
            setCurrentInstruct: state.setData,
        }))
    )
    const { currentFormat, loadFormat, setCurrentFormat } = InstructFormats.useFormat(
        useShallow((state) => ({
            currentFormat: state.data,
            loadFormat: state.load,
            setCurrentFormat: state.setData,
        }))
    )
    const instructID = currentInstruct?.id
    const formatID = currentFormat?.id
    const { color, spacing, borderRadius } = Theme.useTheme()
    const { data: styleList = [] } = useLiveQuery(Instructs.db.query.instructListQuery())
    const { data: formatList = [] } = useLiveQuery(InstructFormats.db.query.formatListQuery())
    const selectedStyle = styleList.filter((item) => item.id === instructID)?.[0]
    const selectedFormat = formatList.filter((item) => item.id === formatID)?.[0]
    const [showNewInstruct, setShowNewInstruct] = useState(false)
    const [showNewFormat, setShowNewFormat] = useState(false)
    const { textFilter, setTextFilter, sendFilteredText, setSendFilteredText } = useTextFilterStore(
        useShallow((state) => ({
            sendFilteredText: state.sendFilteredText,
            setSendFilteredText: state.setSendFilteredText,
            textFilter: state.filter,
            setTextFilter: state.setFilter,
        }))
    )

    const handleSaveInstruct = () => {
        if (currentInstruct && instructID)
            Instructs.db.mutate.updateInstruct(instructID, currentInstruct)
    }

    const handleSaveFormat = () => {
        if (currentFormat && formatID)
            InstructFormats.db.mutate.updateFormat(formatID, currentFormat)
    }

    const handleRegenerateDefaults = () => {
        Alert.alert({
            title: t('instruct.regenerateTitle'),
            description: t('instruct.regenerateDesc'),
            buttons: [
                { label: t('common.cancel') },
                {
                    label: t('instruct.regenerateConfirm'),
                    onPress: async () => {
                        await Instructs.generateInitialDefaults()
                    },
                },
            ],
        })
    }

    const handleRegenerateFormats = () => {
        Alert.alert({
            title: t('instruct.regenerateFormatTitle'),
            description: t('instruct.regenerateFormatDesc'),
            buttons: [
                { label: t('common.cancel') },
                {
                    label: t('instruct.regenerateFormatConfirm'),
                    onPress: async () => {
                        await InstructFormats.generateInitialDefaults()
                    },
                },
            ],
        })
    }

    const handleExportPreset = async () => {
        if (!instructID) return
        const name = (currentInstruct?.name ?? 'Default') + '.json'
        await saveStringToDownload(JSON.stringify(currentInstruct), name, 'utf8')
        Logger.infoToast(i18n.t('instruct.savedToDownloads', { name }))
    }

    const handleExportFormat = async () => {
        if (!formatID) return
        const name = (currentFormat?.name ?? 'Default') + '.json'
        await saveStringToDownload(JSON.stringify(currentFormat), name, 'utf8')
        Logger.infoToast(i18n.t('instruct.savedToDownloads', { name }))
    }

    const handleDeletePreset = () => {
        if (styleList.length === 1) {
            Logger.warnToast(i18n.t('instruct.cannotDeleteLast'))
            return
        }

        Alert.alert({
            title: t('instruct.deleteTitle'),
            description: t('instruct.deleteDesc', { name: currentInstruct?.name }),
            buttons: [
                { label: t('common.cancel') },
                {
                    label: t('instruct.deleteConfirm'),
                    onPress: async () => {
                        if (!instructID) return
                        const leftover = styleList.filter((item) => item.id !== instructID)
                        if (leftover.length === 0) {
                            Logger.warnToast(i18n.t('instruct.cannotDeleteLastShort'))
                            return
                        }
                        Instructs.db.mutate.deleteInstruct(instructID)
                        loadInstruct(leftover[0].id)
                    },
                    type: 'warning',
                },
            ],
        })
    }

    const handleDeleteFormat = () => {
        if (formatList.length === 1) {
            Logger.warnToast(i18n.t('instruct.cannotDeleteLastFormat'))
            return
        }

        Alert.alert({
            title: t('instruct.deleteFormatTitle'),
            description: t('instruct.deleteFormatDesc', { name: currentFormat?.name }),
            buttons: [
                { label: t('common.cancel') },
                {
                    label: t('instruct.deleteFormatConfirm'),
                    onPress: async () => {
                        if (!formatID) return
                        const leftover = formatList.filter((item) => item.id !== formatID)
                        if (leftover.length === 0) {
                            Logger.warnToast(i18n.t('instruct.cannotDeleteLastFormatShort'))
                            return
                        }
                        InstructFormats.db.mutate.deleteFormat(formatID)
                        loadFormat(leftover[0].id)
                    },
                    type: 'warning',
                },
            ],
        })
    }

    const styleMenu = () => (
        <ContextMenu
            triggerIcon="setting"
            triggerIconSize={22}
            placement="bottom"
            buttons={[
                {
                    label: t('instruct.createConfig'),
                    icon: 'file-add',
                    onPress: (close) => {
                        setShowNewInstruct(true)
                        close()
                    },
                },
                {
                    label: t('instruct.exportConfig'),
                    icon: 'download',
                    onPress: (close) => {
                        handleExportPreset()
                        close()
                    },
                },
                {
                    label: t('instruct.deleteConfig'),
                    icon: 'delete',
                    onPress: (close) => {
                        handleDeletePreset()
                        close()
                    },
                    variant: 'warning',
                },
                {
                    label: t('instruct.regenerateDefault'),
                    icon: 'reload',
                    onPress: (close) => {
                        handleRegenerateDefaults()
                        close()
                    },
                },
            ]}
        />
    )

    const formatMenu = () => (
        <ContextMenu
            triggerIcon="setting"
            triggerIconSize={22}
            placement="bottom"
            buttons={[
                {
                    label: t('instruct.createFormat'),
                    icon: 'file-add',
                    onPress: (close) => {
                        setShowNewFormat(true)
                        close()
                    },
                },
                {
                    label: t('instruct.exportFormat'),
                    icon: 'download',
                    onPress: (close) => {
                        handleExportFormat()
                        close()
                    },
                },
                {
                    label: t('instruct.deleteFormat'),
                    icon: 'delete',
                    onPress: (close) => {
                        handleDeleteFormat()
                        close()
                    },
                    variant: 'warning',
                },
                {
                    label: t('instruct.regenerateDefaultFormats'),
                    icon: 'reload',
                    onPress: (close) => {
                        handleRegenerateFormats()
                        close()
                    },
                },
            ]}
        />
    )

    useAutosave({ data: currentInstruct, onSave: () => handleSaveInstruct(), interval: 1000 })
    useAutosave({ data: currentFormat, onSave: () => handleSaveFormat(), interval: 1000 })

    if (currentInstruct && currentFormat)
        return (
            <SafeAreaView
                edges={['bottom']}
                style={{
                    marginVertical: spacing.xl,
                    flex: 1,
                }}>
                <HeaderTitle title={t('instruct.title')} />
                <View>
                    <InputSheet
                        title={t('instruct.newPreset')}
                        visible={showNewInstruct}
                        setVisible={setShowNewInstruct}
                        verifyText={(text) =>
                            styleList.some((item) => item.name === text)
                                ? t('instruct.configExists')
                                : ''
                        }
                        onConfirm={(text) => {
                            if (styleList.some((item) => item.name === text)) {
                                Logger.warnToast(i18n.t('instruct.configNameExists'))
                                return
                            }
                            if (!currentInstruct) return

                            Instructs.db.mutate
                                .createInstruct({ ...currentInstruct, name: text })
                                .then(async (newid) => {
                                    Logger.infoToast(i18n.t('instruct.configCreated'))
                                    await loadInstruct(newid)
                                })
                        }}
                    />
                    <InputSheet
                        title={t('instruct.newFormatPreset')}
                        visible={showNewFormat}
                        setVisible={setShowNewFormat}
                        verifyText={(text) =>
                            formatList.some((item) => item.name === text)
                                ? t('instruct.formatExists')
                                : ''
                        }
                        onConfirm={(text) => {
                            if (formatList.some((item) => item.name === text)) {
                                Logger.warnToast(i18n.t('instruct.formatNameExists'))
                                return
                            }
                            if (!currentFormat) return

                            InstructFormats.db.mutate
                                .createFormat({ ...currentFormat, name: text })
                                .then(async (newid) => {
                                    Logger.infoToast(i18n.t('instruct.formatCreated'))
                                    await loadFormat(newid)
                                })
                        }}
                    />
                </View>

                <View
                    style={{
                        paddingHorizontal: spacing.xl,
                        marginTop: spacing.xl,
                        paddingBottom: spacing.l,
                        flexDirection: 'row',
                        alignItems: 'center',
                        columnGap: spacing.m,
                    }}>
                    <DropdownSheet
                        containerStyle={{ flex: 1 }}
                        selected={selectedStyle}
                        data={styleList}
                        labelExtractor={(item) => item.name}
                        onChangeValue={(item) => {
                            if (item.id === instructID) return
                            loadInstruct(item.id)
                        }}
                        modalTitle={t('instruct.selectConfig')}
                        search
                    />
                    {styleMenu()}
                </View>

                <KeyboardAwareScrollView
                    showsVerticalScrollIndicator={false}
                    style={{
                        flex: 1,
                        marginTop: 16,
                    }}
                    contentContainerStyle={{
                        rowGap: spacing.xl,
                        paddingHorizontal: spacing.xl,
                    }}>
                    <SectionTitle>{t('instruct.instructionFields')}</SectionTitle>
                    <ThemedTextInput
                        label={t('instruct.systemPrompt')}
                        value={currentInstruct.system_prompt}
                        onChangeText={(text) => {
                            setCurrentInstruct({
                                ...currentInstruct,
                                system_prompt: text,
                            })
                        }}
                        numberOfLines={5}
                        multiline
                    />

                    <Accordion label={t('instruct.advancedSettings')}>
                        <View style={{ rowGap: spacing.xl }}>
                            <View style={{ rowGap: 8 }}>
                                <SectionTitle>{t('instruct.textFormatter')}</SectionTitle>
                                <Text
                                    style={{
                                        color: color.text._400,
                                    }}>
                                    {t('instruct.textFormatterDesc')}
                                </Text>
                                <View
                                    style={{
                                        backgroundColor: color.neutral._300,
                                        marginTop: spacing.m,
                                        paddingHorizontal: spacing.xl2,
                                        alignItems: 'center',
                                        borderRadius: borderRadius.m,
                                    }}>
                                    <Markdown
                                        markdownit={MarkdownStyle.Rules}
                                        rules={MarkdownStyle.RenderRules}
                                        style={markdownStyle}>
                                        {autoformatterData[currentInstruct.format_type].example}
                                    </Markdown>
                                </View>
                                <View>
                                    {autoformatterData.map((item, index) => (
                                        <ThemedCheckbox
                                            key={item.label}
                                            label={item.label}
                                            value={currentInstruct.format_type === index}
                                            onChangeValue={(b) => {
                                                if (b)
                                                    setCurrentInstruct({
                                                        ...currentInstruct,
                                                        format_type: index,
                                                    })
                                            }}
                                        />
                                    ))}
                                </View>
                            </View>

                            <View style={{ rowGap: spacing.m }}>
                                <SectionTitle>{t('instruct.hiddenText')}</SectionTitle>
                                <Text
                                    style={{
                                        color: color.text._400,
                                    }}>
                                    {t('instruct.hiddenTextDesc')}
                                </Text>

                                <StringArrayEditor value={textFilter} setValue={setTextFilter} />

                                <ThemedSwitch
                                    label={t('instruct.sendFiltered')}
                                    description={t('instruct.sendFilteredDesc')}
                                    value={sendFilteredText}
                                    onChangeValue={setSendFilteredText}
                                />
                            </View>
                        </View>
                    </Accordion>

                    <Accordion label={t('instruct.expertSettings')}>
                        <View style={{ rowGap: spacing.xl }}>
                            <View
                                style={{
                                    flexDirection: 'row',
                                    alignItems: 'center',
                                    columnGap: spacing.m,
                                }}>
                                <DropdownSheet
                                    containerStyle={{ flex: 1 }}
                                    selected={selectedFormat}
                                    data={formatList}
                                    labelExtractor={(item) => item.name}
                                    onChangeValue={(item) => {
                                        if (item.id === formatID) return
                                        loadFormat(item.id)
                                    }}
                                    modalTitle={t('instruct.selectFormat')}
                                    search
                                />
                                {formatMenu()}
                            </View>

                            <ThemedTextInput
                                label={t('instruct.systemPromptFormat')}
                                value={currentFormat.system_prompt_format}
                                onChangeText={(text) => {
                                    setCurrentFormat({
                                        ...currentFormat,
                                        system_prompt_format: text,
                                    })
                                }}
                                numberOfLines={3}
                                multiline
                            />
                            <View style={{ flexDirection: 'row', columnGap: spacing.m }}>
                                <ThemedTextInput
                                    label={t('instruct.systemPrefix')}
                                    value={currentFormat.system_prefix}
                                    onChangeText={(text) => {
                                        setCurrentFormat({
                                            ...currentFormat,
                                            system_prefix: text,
                                        })
                                    }}
                                    numberOfLines={5}
                                    multiline
                                />
                                <ThemedTextInput
                                    label={t('instruct.systemSuffix')}
                                    value={currentFormat.system_suffix}
                                    onChangeText={(text) => {
                                        setCurrentFormat({
                                            ...currentFormat,
                                            system_suffix: text,
                                        })
                                    }}
                                    numberOfLines={5}
                                    multiline
                                />
                            </View>
                            <View style={{ flexDirection: 'row', columnGap: spacing.m }}>
                                <ThemedTextInput
                                    label={t('instruct.inputPrefix')}
                                    value={currentFormat.input_prefix}
                                    onChangeText={(text) => {
                                        setCurrentFormat({
                                            ...currentFormat,
                                            input_prefix: text,
                                        })
                                    }}
                                    numberOfLines={5}
                                    multiline
                                />
                                <ThemedTextInput
                                    label={t('instruct.inputSuffix')}
                                    value={currentFormat.input_suffix}
                                    onChangeText={(text) => {
                                        setCurrentFormat({
                                            ...currentFormat,
                                            input_suffix: text,
                                        })
                                    }}
                                    numberOfLines={5}
                                    multiline
                                />
                            </View>
                            <View style={{ flexDirection: 'row', columnGap: spacing.m }}>
                                <ThemedTextInput
                                    label={t('instruct.outputPrefix')}
                                    value={currentFormat.output_prefix}
                                    onChangeText={(text) => {
                                        setCurrentFormat({
                                            ...currentFormat,
                                            output_prefix: text,
                                        })
                                    }}
                                    numberOfLines={5}
                                    multiline
                                />
                                <ThemedTextInput
                                    label={t('instruct.outputSuffix')}
                                    value={currentFormat.output_suffix}
                                    onChangeText={(text) => {
                                        setCurrentFormat({
                                            ...currentFormat,
                                            output_suffix: text,
                                        })
                                    }}
                                    numberOfLines={5}
                                    multiline
                                />
                            </View>

                            <View style={{ flexDirection: 'row' }}>
                                <ThemedTextInput
                                    label={t('instruct.lastOutputPrefix')}
                                    value={currentFormat.last_output_prefix}
                                    onChangeText={(text) => {
                                        setCurrentFormat({
                                            ...currentFormat,
                                            last_output_prefix: text,
                                        })
                                    }}
                                    numberOfLines={5}
                                    multiline
                                />
                            </View>

                            <StringArrayEditor
                                containerStyle={{}}
                                label={t('instruct.stopSequence')}
                                value={
                                    currentFormat.stop_sequence
                                        ? currentFormat.stop_sequence.split(',')
                                        : []
                                }
                                setValue={(data) => {
                                    setCurrentFormat({
                                        ...currentFormat,
                                        stop_sequence: data.join(','),
                                    })
                                }}
                                replaceNewLine="\n"
                            />

                            <View>
                                <ThemedCheckbox
                                    label={t('instruct.useCommonStop')}
                                    value={currentFormat.use_common_stop}
                                    onChangeValue={(b) => {
                                        setCurrentFormat({
                                            ...currentFormat,
                                            use_common_stop: b,
                                        })
                                    }}
                                />
                                <ThemedCheckbox
                                    label={t('instruct.wrapNewline')}
                                    value={currentFormat.wrap}
                                    onChangeValue={(b) => {
                                        setCurrentFormat({
                                            ...currentFormat,
                                            wrap: b,
                                        })
                                    }}
                                />
                                <ThemedCheckbox
                                    label={t('instruct.includeNames')}
                                    value={currentFormat.names}
                                    onChangeValue={(b) => {
                                        setCurrentFormat({
                                            ...currentFormat,
                                            names: b,
                                        })
                                    }}
                                />
                                <ThemedCheckbox
                                    label={t('instruct.removeThinkTags')}
                                    value={currentFormat.hide_think_tags}
                                    onChangeValue={(b) => {
                                        setCurrentFormat({
                                            ...currentFormat,
                                            hide_think_tags: b,
                                        })
                                    }}
                                />
                            </View>
                        </View>
                    </Accordion>
                </KeyboardAwareScrollView>
            </SafeAreaView>
        )
}

export default FormattingManager
