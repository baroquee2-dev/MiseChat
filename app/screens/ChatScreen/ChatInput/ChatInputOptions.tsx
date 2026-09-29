import { Ionicons } from '@expo/vector-icons'
import { useRouter } from 'expo-router'
import { useTranslation } from 'react-i18next'
import { StyleSheet } from 'react-native'

import ContextMenu from '@components/views/ContextMenu'
import Drawer from '@components/views/Drawer'
import { Chats } from '@lib/state/Chat'
import { Logger } from '@lib/state/Logger'
import { Theme } from '@lib/theme/ThemeManager'

const ChatOptions = () => {
    const router = useRouter()
    const styles = useStyles()
    const { t } = useTranslation()

    const setShow = Drawer.useDrawerStore((state) => state.setShow)
    const { chat, chatId } = Chats.useChat()
    const note = chat?.author_note?.trim() ?? ''
    // Written but switched off, or switched on with nothing written, both read as off
    const noteActive = !!note && !!chat?.author_note_enabled

    const setShowChat = (b: boolean) => {
        setShow(Drawer.ID.CHATLIST, b)
    }

    return (
        <ContextMenu
            buttons={[
                {
                    onPress: (close) => {
                        close()
                        router.back()
                    },
                    label: t('chat.mainMenu'),
                    icon: 'backward',
                },
                {
                    onPress: (close) => {
                        close()
                        router.push('/screens/CharacterEditorScreen')
                    },
                    label: t('chat.editCharacter'),
                    icon: 'edit',
                },
                {
                    onPress: (close) => {
                        setShowChat(true)
                        close()
                    },
                    label: t('chat.chatHistory'),
                    icon: 'paper-clip',
                },
                // Only offered with a chat open, since the note belongs to one chat
                ...(chatId
                    ? [
                          {
                              // The label opens the editor, the lamp beside it flips the switch
                              onPress: (close: () => void) => {
                                  close()
                                  router.push({
                                      pathname: '/screens/ChatAuthorNoteScreen' as const,
                                      params: {
                                          chatId: String(chatId),
                                          chatName: chat?.name ?? '',
                                      },
                                  })
                              },
                              label: t('authorNote.title'),
                              icon: 'flag' as const,
                              status: noteActive,
                              onStatusPress: () => {
                                  const next = !noteActive
                                  // Switching on an empty note does nothing, so say why
                                  if (next && !note) {
                                      Logger.infoToast(t('authorNote.emptyHint'))
                                      return
                                  }
                                  Chats.useChatState.getState().setAuthorNote(chatId, note, next)
                                  Logger.infoToast(
                                      t(next ? 'authorNote.turnedOn' : 'authorNote.turnedOff')
                                  )
                              },
                          },
                      ]
                    : []),
            ]}
            placement="top">
            <Ionicons name="caret-up" style={styles.optionsButton} size={24} />
        </ContextMenu>
    )
}

export default ChatOptions

const useStyles = () => {
    const { color } = Theme.useTheme()

    return StyleSheet.create({
        optionsButton: {
            color: color.text._500,
            padding: 4,
            backgroundColor: color.neutral._200,
            borderRadius: 16,
        },
    })
}
