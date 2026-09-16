import { useLiveQuery } from 'drizzle-orm/expo-sqlite'
import { useFocusEffect, usePathname } from 'expo-router'
import { useCallback, useMemo, useState } from 'react'
import { View } from 'react-native'
import Animated, { FadeIn, LinearTransition } from 'react-native-reanimated'
import { useShallow } from 'zustand/react/shallow'

import Drawer from '@components/views/Drawer'
import HeaderButton from '@components/views/HeaderButton'
import HeaderTitle from '@components/views/HeaderTitle'
import { playCharacterListSound } from '@lib/audio/playInputFocusSound'
import { Characters, CharInfo } from '@lib/state/Characters'
import { CharacterSorter } from '@lib/state/CharacterSorter'

import CharacterListHeader from './CharacterListHeader'
import CharacterListing from './CharacterListing'
import CharacterNewMenu from './CharacterNewMenu'
import CharactersEmpty from './CharactersEmpty'
import CharactersSearchEmpty from './CharactersSearchEmpty'

const PAGE_SIZE = 30

const CharacterList: React.FC = () => {
    const [nowLoading, setNowLoading] = useState(false)
    const { searchType, searchOrder, tagFilter, textFilter } = CharacterSorter.useSorterStore(
        useShallow((state) => ({
            searchType: state.searchType,
            searchOrder: state.searchOrder,
            tagFilter: state.tagFilter,
            textFilter: state.textFilter,
        }))
    )
    const [pages, setPages] = useState(3)
    const [previousLength, setPreviousLength] = useState(0)
    const { data, updatedAt } = useLiveQuery(
        Characters.db.query.cardListQueryWindow(
            'character',
            searchType,
            searchOrder,
            PAGE_SIZE * pages,
            0,
            textFilter,
            tagFilter
        ),
        [searchType, searchOrder, textFilter, tagFilter, pages]
    )

    const characterList: CharInfo[] = useMemo(() => {
        return data.map((item) => ({
            ...item,
            latestChat: item.chats[0]?.id,
            latestSwipe: item.chats[0]?.messages[0]?.swipes[0]?.swipe,
            latestName: item.chats[0]?.messages[0]?.name,
            last_modified: item.last_modified ?? 0,
            description: item.description ?? '',
            tags: item.tags.map((item) => item.tag.tag),
        }))
    }, [data])

    // do not render when not shown, optimizes some rerenders
    const path = usePathname()

    useFocusEffect(
        useCallback(() => {
            if (path !== '/') return
            playCharacterListSound()
        }, [path])
    )

    if (path !== '/') return

    return (
        <Animated.View
            entering={FadeIn.duration(220)}
            style={{ paddingTop: 16, paddingHorizontal: 8, flex: 1 }}>
            <HeaderTitle />
            <HeaderButton
                headerLeft={() => <Drawer.Button drawerID={Drawer.ID.SETTINGS} />}
                headerRight={() => (
                    <CharacterNewMenu nowLoading={nowLoading} setNowLoading={setNowLoading} />
                )}
            />

            <CharacterListHeader resultLength={characterList.length} />
            <View style={{ flex: 1 }}>
                <Animated.FlatList
                    layout={LinearTransition}
                    itemLayoutAnimation={LinearTransition}
                    showsVerticalScrollIndicator={false}
                    contentContainerStyle={{ rowGap: 18 }}
                    data={characterList}
                    keyExtractor={(item) => item.id.toString()}
                    renderItem={({ item, index }) => (
                        <CharacterListing
                            character={item}
                            nowLoading={nowLoading}
                            setNowLoading={setNowLoading}
                            index={index}
                        />
                    )}
                    onEndReachedThreshold={1}
                    onEndReached={() => {
                        if (previousLength === data.length) {
                            return
                        }
                        setPreviousLength(data.length)
                        setPages(pages + 1)
                    }}
                    windowSize={3}
                    onStartReachedThreshold={0.1}
                    onStartReached={() => {
                        if (pages !== 3) setPages(3)
                    }}
                    ListEmptyComponent={() => data.length === 0 && updatedAt && <CharactersEmpty />}
                />
            </View>

            {characterList.length === 0 && data.length !== 0 && updatedAt && (
                <CharactersSearchEmpty />
            )}
        </Animated.View>
    )
}

export default CharacterList
