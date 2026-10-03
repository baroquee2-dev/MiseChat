import { ChatEntry } from '@lib/state/Chat'
import { Logger } from '@lib/state/Logger'

/**
 * Keyword retrieval over one chat's own history, scored with BM25.
 *
 * The whole chat is already in memory, so this needs no index, no table and no
 * triggers to keep in sync. A few thousand messages score in a handful of
 * milliseconds, which is well inside the budget of a request that is about to
 * wait seconds on a model. If chats ever grow past that, the replacement is an
 * FTS5 virtual table — the shape of this module would not change.
 */

export type RetrievedMessage = {
    name: string
    text: string
    order: number
}

/** Standard BM25 constants: term saturation, and how hard length is punished. */
const K1 = 1.2
const B = 0.75

/**
 * A cheap floor, not the real rule: the newest messages are certainly in the
 * context already, so there is no point scoring them. How far the raw history
 * actually reaches is only known once the context is assembled, so the context
 * builder drops whatever else overlaps.
 */
const RECENT_EXCLUSION = 20

const MAX_RESULTS = 4

/**
 * Roughly one hit on a term rare enough to mean something. Below this the match
 * is usually a common word that happens to appear, which is worse than nothing:
 * it spends context and tells the model to dwell on something irrelevant.
 */
const MIN_SCORE = 1

/** Keeps one strong result from dragging in three weak ones behind it. */
const RELATIVE_FLOOR = 0.3

/** Long queries otherwise drown their own rare terms in filler. */
const MAX_QUERY_TERMS = 24

/** Retrieved lines compete with real history for the same context budget. */
const SNIPPET_LENGTH = 220

const CJK = /[㐀-䶿一-鿿豈-﫿぀-ヿ가-힯]/
const ALPHANUMERIC = /[a-z0-9]/

/**
 * Chinese has no spaces, so there is nothing to split on. Rather than carry a
 * dictionary, every adjacent pair of characters becomes a term: 「酒館裡」 yields
 * 酒館 and 館裡, and a query for 酒館 then matches. Bigrams that straddle a word
 * boundary are mostly harmless — they match nothing, so they score nothing.
 */
const tokenize = (text: string): string[] => {
    const lower = text.toLowerCase()
    const terms: string[] = []
    let index = 0

    while (index < lower.length) {
        const char = lower[index]

        if (CJK.test(char)) {
            let end = index
            while (end < lower.length && CJK.test(lower[end])) end++
            const run = lower.slice(index, end)
            if (run.length === 1) {
                terms.push(run)
            } else {
                for (let i = 0; i < run.length - 1; i++) terms.push(run.slice(i, i + 2))
            }
            index = end
            continue
        }

        if (ALPHANUMERIC.test(char)) {
            let end = index
            while (end < lower.length && ALPHANUMERIC.test(lower[end])) end++
            const word = lower.slice(index, end)
            // Single letters carry no signal and match everywhere
            if (word.length > 1) terms.push(word)
            index = end
            continue
        }

        index++
    }

    return terms
}

const activeSwipe = (entry: ChatEntry) => entry.swipes[entry.swipe_id]?.swipe ?? ''

const snippet = (text: string) => {
    const collapsed = text.replace(/\s+/g, ' ').trim()
    if (collapsed.length <= SNIPPET_LENGTH) return collapsed
    return collapsed.slice(0, SNIPPET_LENGTH).trimEnd() + '…'
}

/**
 * Finds the messages in `messages` most relevant to `query`.
 *
 * Scoring is BM25 over this chat alone, which is what makes it work without a
 * stopword list: 「的」 appears in every message, so its inverse document
 * frequency collapses to nothing, while a name that shows up three times in two
 * hundred messages scores heavily. The corpus being per-chat also means a term
 * is judged rare relative to this story, not to Chinese at large.
 */
export const searchChatHistory = (messages: ChatEntry[], query: string): RetrievedMessage[] => {
    const queryTerms = [...new Set(tokenize(query))].slice(0, MAX_QUERY_TERMS)
    if (queryTerms.length === 0) return []

    const candidates = messages.slice(0, Math.max(0, messages.length - RECENT_EXCLUSION))
    if (candidates.length === 0) return []

    const documents = candidates.map((entry) => {
        const text = activeSwipe(entry)
        const terms = tokenize(text)
        const frequencies = new Map<string, number>()
        for (const term of terms) frequencies.set(term, (frequencies.get(term) ?? 0) + 1)
        const length = terms.length
        return { entry, text, length, frequencies }
    })

    const nonEmpty = documents.filter((document) => document.length > 0)
    if (nonEmpty.length === 0) return []

    const totalLength = nonEmpty.reduce((sum, document) => sum + document.length, 0)
    const averageLength = totalLength / nonEmpty.length
    const count = nonEmpty.length

    const idf = new Map<string, number>()
    for (const term of queryTerms) {
        const documentFrequency = nonEmpty.filter((document) =>
            document.frequencies.has(term)
        ).length
        if (documentFrequency === 0) continue
        idf.set(term, Math.log(1 + (count - documentFrequency + 0.5) / (documentFrequency + 0.5)))
    }
    if (idf.size === 0) return []

    const scored = nonEmpty
        .map((document) => {
            let score = 0
            for (const [term, weight] of idf) {
                const frequency = document.frequencies.get(term)
                if (!frequency) continue
                const normalization =
                    frequency + K1 * (1 - B + (B * document.length) / averageLength)
                score += (weight * (frequency * (K1 + 1))) / normalization
            }
            return { document, score }
        })
        .filter((item) => item.score >= MIN_SCORE)
        .sort((a, b) => b.score - a.score)

    if (scored.length === 0) return []

    const floor = scored[0].score * RELATIVE_FLOOR
    return scored
        .filter((item) => item.score >= floor)
        .slice(0, MAX_RESULTS)
        // Oldest first, so the model reads them as a timeline rather than a ranking
        .sort((a, b) => a.document.entry.order - b.document.entry.order)
        .map((item) => ({
            name: item.document.entry.name,
            text: snippet(item.document.text),
            order: item.document.entry.order,
        }))
}

/**
 * The query is whatever the user just said. The trailing entry is the empty one
 * waiting to be generated into, so the search starts behind it.
 */
export const retrieveForLatestTurn = (messages: ChatEntry[]): RetrievedMessage[] => {
    const lastUserEntry = [...messages].reverse().find((entry) => entry.is_user)
    const query = lastUserEntry ? activeSwipe(lastUserEntry) : ''
    if (!query.trim()) return []
    const results = searchChatHistory(messages, query)
    const searchable = Math.max(0, messages.length - RECENT_EXCLUSION)
    Logger.info(`Keyword retrieval: ${results.length} matches from ${searchable} older messages`)
    return results
}
