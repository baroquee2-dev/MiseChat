/**
 * Token counts are estimated from character counts.
 *
 * Every provider tokenizes differently, and their real counts only come back with the
 * response, so an exact figure would need a separate request per provider. These numbers
 * only decide how much history fits under the context limit, so they lean high on purpose.
 */

/** CJK text averages close to one token per character. */
const CJK_PATTERN =
    /[぀-ヿ㐀-䶿一-鿿豈-﫿ｦ-ﾟ가-힯]/g
/** Other scripts average roughly four characters per token. */
const CHARS_PER_TOKEN = 4
/** Providers charge very different amounts per image; this is a deliberately high guess. */
const TOKENS_PER_IMAGE = 512

export const estimateTokenCount = (text: string, imageCount = 0) => {
    const cjkCount = text.match(CJK_PATTERN)?.length ?? 0
    const otherCount = text.length - cjkCount
    return cjkCount + Math.ceil(otherCount / CHARS_PER_TOKEN) + imageCount * TOKENS_PER_IMAGE
}

export namespace Tokenizer {
    export const getTokenCount = async (text: string, imageUrls: string[] = []) =>
        estimateTokenCount(text, imageUrls.length)

    /** Kept as a getter so callers can hold one counter for a whole context build. */
    export const getTokenizer = () => getTokenCount
}
