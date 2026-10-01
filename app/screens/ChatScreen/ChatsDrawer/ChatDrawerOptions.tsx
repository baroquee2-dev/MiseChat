import React, { ReactNode, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useRouter } from 'expo-router'
import { useShallow } from 'zustand/react/shallow'

import Alert from '@components/views/Alert'
import ContextMenu from '@components/views/ContextMenu'
import Drawer from '@components/views/Drawer'
import InputSheet from '@components/views/InputSheet'
import i18n from '@lib/i18n'
import { Characters } from '@lib/state/Characters'
import { Chats } from '@lib/state/Chat'
import { Logger } from '@lib/state/Logger'
import { saveStringToDownload } from '@lib/utils/File'

type ChatEditPopupProps = {
    item: Awaited<ReturnType<typeof Chats.db.query.chatListQuery>>[0]
    children: ReactNode
    onPress: () => void
}

const ChatEditPopup: React.FC<ChatEditPopupProps> = ({ item, children, onPress }) => {
    const { t } = useTranslation()
    const router = useRouter()
    const [showRename, setShowRename] = useState<boolean>(false)
    const setShow = Drawer.useDrawerStore((state) => state.setShow)

    const { charName, charId } = Characters.useCharacterStore(
        useShallow((state) => ({
            charId: state.id,
            charName: state.card?.name,
        }))
    )
    const exportCharName = charName ?? t('common.unknown')

    const { userId, userName } = Characters.useUserStore(
        useShallow((state) => ({
            userId: state.id,
            userName: state.card?.name,
        }))
    )

    const { deleteChat, loadChat, chatId, unloadChat } = Chats.useChat()

    const handleDeleteChat = (close: () => void) => {
        Alert.alert({
            title: t('chat.deleteChatTitle'),
            description: t('chat.deleteChatDesc', { name: item.name }),
            buttons: [
                { label: t('common.cancel') },
                {
                    label: t('chat.deleteChatConfirm'),
                    onPress: async () => {
                        await deleteChat(item.id)
                        if (charId && chatId === item.id) {
                            const returnedChatId = await Chats.db.query.chatNewestId(charId)
                            const chatId = returnedChatId
                                ? returnedChatId
                                : await Chats.db.mutate.createChat(charId)
                            chatId && (await loadChat(chatId))
                        } else if (item.id === chatId) {
                            Logger.errorToast(i18n.t('chat.createDefaultChatFailed'))
                            unloadChat()
                        }
                        close()
                    },
                    type: 'warning',
                },
            ],
        })
    }

    const handleCloneChat = (close: () => void) => {
        Alert.alert({
            title: t('chat.cloneChatTitle'),
            description: t('chat.cloneChatDesc', { name: item.name }),
            buttons: [
                { label: t('common.cancel') },
                {
                    label: t('chat.cloneChatConfirm'),
                    onPress: async () => {
                        await Chats.db.mutate.cloneChatFromId(item.id)
                        close()
                    },
                },
            ],
        })
    }

    const handleExportChat = async (close: () => void) => {
        const name = `Chatlogs-${exportCharName}-${item.id}.json`.replaceAll(' ', '_')
        const chat = await Chats.db.query.chat(item.id)
        if (chat) {
            try {
                await saveStringToDownload(JSON.stringify(chat), name, 'utf8')
                Logger.infoToast(i18n.t('chat.exportSaved', { name }))
            } catch (e) {
                Logger.errorToast(i18n.t('chat.exportFailed'))
                Logger.error(`${e}`)
            }
        } else {
            Logger.errorToast(i18n.t('chat.chatUndefined'))
        }
        close()
    }

    const handleLinkUser = async (close: () => void) => {
        if (userId === item.user_id) {
            Logger.warnToast(i18n.t('chat.userAlreadySet'))
            close()
            return
        }
        if (!userId) {
            Logger.errorToast(i18n.t('chat.noCurrentUser'))
            close()
            return
        }
        await Chats.db.mutate.updateUser(item.id, userId)
        Logger.infoToast(i18n.t('chat.linkedToUser', { name: userName }))
        close()
    }

    return (
        <>
            <InputSheet
                title={t('chat.renameChat')}
                visible={showRename}
                setVisible={setShowRename}
                onConfirm={async (text) => {
                    await Chats.db.mutate.renameChat(item.id, text)
                }}
                verifyText={(text) => (text.length === 0 ? t('chat.nameEmpty') : '')}
                defaultValue={item.name}
            />
            <ContextMenu
                placement="right"
                longPress
                onPress={onPress}
                buttons={[
                    {
                        label: t('common.rename'),
                        icon: 'edit',
                        onPress: (close) => {
                            setShowRename(true)
                            close()
                        },
                    },
                    {
                        label: t('authorNote.title'),
                        icon: 'flag' as const,
                        onPress: (close: () => void) => {
                            setShow(Drawer.ID.CHATLIST, false)
                            close()
                            router.push({
                                pathname: '/screens/ChatAuthorNoteScreen',
                                params: {
                                    chatId: String(item.id),
                                    chatName: item.name,
                                },
                            })
                        },
                    },
                    ...(item.summary?.trim()
                        ? [
                              {
                                  label: t('chat.editSummary'),
                                  icon: 'book' as const,
                                  onPress: (close: () => void) => {
                                      setShow(Drawer.ID.CHATLIST, false)
                                      close()
                                      router.push({
                                          pathname: '/screens/ChatSummaryEditorScreen',
                                          params: {
                                              chatId: String(item.id),
                                              chatName: item.name,
                                          },
                                      })
                                  },
                              },
                          ]
                        : []),
                    {
                        label: t('keyFacts.edit'),
                        icon: 'tags' as const,
                        onPress: (close: () => void) => {
                            setShow(Drawer.ID.CHATLIST, false)
                            close()
                            router.push({
                                pathname: '/screens/ChatKeyFactsEditorScreen',
                                params: {
                                    chatId: String(item.id),
                                    chatName: item.name,
                                },
                            })
                        },
                    },
                    {
                        label: t('common.delete'),
                        icon: 'delete',
                        variant: 'warning' as const,
                        onPress: handleDeleteChat,
                    },
                    {
                        label: t('common.more'),
                        submenu: [
                            {
                                label: t('common.export'),
                                icon: 'download',
                                onPress: handleExportChat,
                            },
                            {
                                label: t('common.clone'),
                                icon: 'copy',
                                onPress: handleCloneChat,
                            },
                            {
                                label: t('chat.linkUser'),
                                icon: 'user',
                                onPress: handleLinkUser,
                            },
                        ],
                    },
                ]}>
                {children}
            </ContextMenu>
        </>
    )
}

export default ChatEditPopup
