/**
 * Picks the spoken lines out of a reply, so text to speech reads dialogue rather than
 * narration. Purely rule based: it keys off the same conventions the chat already
 * renders, which is what the models follow when a card asks for them.
 */

export type SpeechMode = 'all' | 'auto' | 'quotes'

export const SPEECH_MODES: SpeechMode[] = ['all', 'auto', 'quotes']

/**
 * Quote pairs that mark speech. The first four match the markdown quote plugin; the
 * corner brackets are added because Chinese cards use them and that plugin does not.
 */
const QUOTED = new RegExp(
    ['"([^"]*)"', '“([^”]*)”', '「([^」]*)」', '『([^』]*)』', '«([^»]*)»'].join('|'),
    'g'
)

/** Every character that can open speech, for picking up a line still being streamed. */
const OPENERS = '"“「『«'

/**
 * Wrappers around narration. Asterisks are matched as runs so bold markers behave,
 * and each pattern also accepts an unclosed tail, which is what a half streamed
 * sentence looks like.
 */
const NARRATION = new RegExp(
    [
        '\\*+[^*]*(?:\\*+|$)',
        '\\([^)]*(?:\\)|$)',
        '（[^）]*(?:）|$)',
        '\\[[^\\]]*(?:\\]|$)',
        '【[^】]*(?:】|$)',
    ].join('|'),
    'g'
)

const tidy = (text: string) => text.replace(/\s+/g, ' ').trim()

/** Joins what sits inside quotes, including a line the model has not closed yet. */
const quotedParts = (text: string) => {
    const parts: string[] = []
    let lastIndex = 0
    for (const match of text.matchAll(QUOTED)) {
        const inner = match.slice(1).find((group) => group !== undefined) ?? ''
        if (inner.trim()) parts.push(inner.trim())
        lastIndex = (match.index ?? 0) + match[0].length
    }

    // While streaming, the closing quote may not have arrived; speak the tail anyway
    // so the end of a line is never dropped.
    const tail = text.slice(lastIndex)
    let opened = -1
    for (const opener of OPENERS) {
        opened = Math.max(opened, tail.lastIndexOf(opener))
    }
    if (opened >= 0) {
        const trailing = tail.slice(opened + 1).trim()
        if (trailing) parts.push(trailing)
    }
    return parts
}

/**
 * The text to speak.
 *
 * - `all` keeps everything, which is what this app did before.
 * - `quotes` reads only what sits inside quotes.
 * - `auto` reads the quotes when a message has any, and otherwise drops the narration
 *   wrappers, so both common card styles work without the reader changing a setting.
 *
 * A message that turns out to be nothing but narration comes back empty and is left
 * unspoken, which is the point of the setting. Plain prose carries no wrappers to drop,
 * so it survives untouched.
 */
export const extractSpeech = (text: string, mode: SpeechMode = 'auto'): string => {
    if (mode === 'all' || !text.trim()) return text

    const quoted = quotedParts(text)
    if (quoted.length) return tidy(quoted.join(' '))
    if (mode === 'quotes') return ''

    return tidy(text.replace(NARRATION, ' '))
}
