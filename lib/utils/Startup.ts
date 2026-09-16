import * as KeepAwake from 'expo-keep-awake'
import { router } from 'expo-router'
import { setBackgroundColorAsync as setUIBackgroundColor } from 'expo-system-ui'

import { setupNotifications } from '@lib/notifications/Notifications'
import { Instructs } from '@lib/state/Instructs'
import { SamplersManager } from '@lib/state/SamplerState'

import { AppDirectory, makeDirectory } from './File'
import { AppSettings, AppSettingsDefault } from '../constants/GlobalValues'
import { Characters } from '../state/Characters'
import { Chats } from '../state/Chat'
import { Logger } from '../state/Logger'
import { mmkv } from '../storage/MMKV'
import { Theme } from '../theme/ThemeManager'

const loadNewestChat = async () => {
    Logger.info('Loading latest chat')
    const newestChat = await Chats.db.query.chatNewest()
    if (!newestChat) return
    await Characters.useCharacterStore.getState().setCard(newestChat.character_id)
    await Chats.useChatState.getState().load(newestChat.id)
}

export const loadChatOnInit = async () => {
    if (!mmkv.getBoolean(AppSettings.ChatOnStartup)) return
    await loadNewestChat()
    router.push('/screens/ChatScreen')
}

const setAppDefaultSettings = () => {
    Object.keys(AppSettingsDefault).map((item) => {
        const data = mmkv.getBoolean(item)
        if (data !== undefined) return
        mmkv.set(item, AppSettingsDefault[item as AppSettings])
    })
}

const createDefaultCard = async () => {
    if (!mmkv.getBoolean(AppSettings.CreateDefaultCard)) return
    const result = await Characters.db.query.cardList('character')
    if (result.length === 0) await Characters.createDefaultCard()
    mmkv.set(AppSettings.CreateDefaultCard, false)
}

export const generateDefaultDirectories = async () => {
    Object.values(AppDirectory).map((dir) => {
        makeDirectory(dir)
    })
}

const createDefaultUserData = async () => {
    const id = await Characters.db.mutate.createCard('User', 'user')
    Characters.useUserStore.getState().setCard(id)
}

const setDefaultUser = async () => {
    const userList = await Characters.db.query.cardList('user')
    if (!userList) {
        Logger.error(
            'User database is Invalid, this should not happen! Please report this occurence.'
        )
    } else if (userList?.length === 0) {
        Logger.warn('No Users exist, creating default Users')
        await createDefaultUserData()
    } else if (userList.length > 0 && !Characters.useUserStore.getState().card) {
        Characters.useUserStore.getState().setCard(userList[0].id)
    }
}

const setKeepAwake = async () => {
    const keepAwake = mmkv.getBoolean(AppSettings.KeepAwake)
    if (keepAwake) KeepAwake.activateKeepAwakeAsync()
    else KeepAwake.deactivateKeepAwake()
}

const setDefaultInstruct = () => {
    Instructs.db.query.instructList().then(async (list) => {
        if (!list) {
            Logger.error('Instruct database Invalid, this should not happen! Please report this!')
            return
        }

        if (list.length === 0) {
            Logger.warn('No Instruct styles exist, creating defaults')
            const id = await Instructs.generateInitialDefaults()
            await Instructs.useInstruct.getState().load(id)
        }
    })
}

export const startupApp = () => {
    console.log('[APP STARTED]: T1APT')

    // Sets default preferences
    setAppDefaultSettings()
    generateDefaultDirectories()
    setDefaultUser()
    setDefaultInstruct()

    // setup notifications
    setupNotifications()

    // Initialize the default card
    createDefaultCard()

    // set keep awake settings
    setKeepAwake()

    // Fix any missing samplers
    SamplersManager.useSamplerStore.getState().fixConfigs()

    const backgroundColor = Theme.useColorState.getState().color.neutral._100
    setUIBackgroundColor(backgroundColor)

    Logger.info('Resetting state values for startup.')
}
