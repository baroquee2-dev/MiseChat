import { ImageManipulator, SaveFormat } from 'expo-image-manipulator'

const LEMONSLICE_SESSIONS = 'https://lemonslice.com/api/liveai/sessions'
const DAILY_TOKENS = 'https://api.daily.co/v1/meeting-tokens'

/**
 * Bytes in ~100ms of mono PCM16 at the given rate, as the docs recommend. Kept a
 * multiple of 6: even so no 16-bit sample straddles two chunks, and divisible by
 * three so every chunk base64-encodes without padding.
 */
export const chunkBytesFor = (sampleRate: number) =>
    Math.max(6, Math.floor((sampleRate * 0.1 * 2) / 6) * 6)

const readError = async (response: Response) => {
    const body = await response.text().catch(() => '')
    return `${response.status}${body ? `: ${body.slice(0, 300)}` : ''}`
}

export interface LemonSliceSession {
    session_id: string
    websocket_address: string
    control_url?: string
}

/**
 * The image is supplied per session — there is no avatar object to create or
 * manage, which is the whole reason this path is worth using.
 */
export const createSession = async (params: {
    apiKey: string
    dailyUrl: string
    dailyToken: string
    imageUrl?: string
    imageBase64?: string
}): Promise<LemonSliceSession> => {
    const body: Record<string, unknown> = {
        transport_type: 'websocket-daily',
        daily_properties: {
            daily_url: params.dailyUrl,
            daily_token: params.dailyToken,
        },
    }
    if (params.imageUrl) body.agent_image_url = params.imageUrl
    else if (params.imageBase64) body.agent_image_base64 = params.imageBase64
    else throw new Error('No character image provided')

    const response = await fetch(LEMONSLICE_SESSIONS, {
        method: 'POST',
        headers: { 'X-API-Key': params.apiKey, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
    })
    if (!response.ok) throw new Error(`LemonSlice session failed ${await readError(response)}`)

    const session = (await response.json()) as LemonSliceSession
    if (!session?.websocket_address) throw new Error('LemonSlice returned no websocket_address')
    return session
}

/**
 * Character-card art is often a multi-megabyte PNG, and base64 adds another
 * third on top — enough to trip LemonSlice's request size limit (413
 * FUNCTION_PAYLOAD_TOO_LARGE). A talking head does not need that resolution.
 */
const MAX_IMAGE_WIDTH = 768
const IMAGE_QUALITY = 0.85

export const prepareImageBase64 = async (uri: string) => {
    const rendered = await ImageManipulator.manipulate(uri)
        .resize({ width: MAX_IMAGE_WIDTH })
        .renderAsync()
    const result = await rendered.saveAsync({
        compress: IMAGE_QUALITY,
        format: SaveFormat.JPEG,
        base64: true,
    })
    if (!result.base64) throw new Error('Image encoding produced no base64')
    return { base64: result.base64, width: result.width, height: result.height }
}

/** The Daily room name is the last path segment of the room URL. */
export const roomNameOf = (dailyUrl: string) =>
    dailyUrl.trim().replace(/\/+$/, '').split('/').pop() ?? ''

/**
 * LemonSlice requires daily_token even for public rooms — it is a schema-level
 * field, so a token has to be minted regardless of room privacy.
 */
export const mintDailyToken = async (dailyApiKey: string, dailyUrl: string) => {
    const room = roomNameOf(dailyUrl)
    if (!room) throw new Error('Could not read a room name from the Daily URL')

    const response = await fetch(DAILY_TOKENS, {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${dailyApiKey}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({ properties: { room_name: room, is_owner: true } }),
    })
    if (!response.ok) throw new Error(`Daily token failed ${await readError(response)}`)

    const token = ((await response.json()) as { token?: string })?.token
    if (!token) throw new Error('Daily returned no token')
    return token
}

const BASE64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

/** React Native has no Buffer and no dependable btoa for binary input. */
export const encodeBase64 = (bytes: Uint8Array) => {
    let output = ''
    for (let i = 0; i < bytes.length; i += 3) {
        const a = bytes[i]
        const b = bytes[i + 1]
        const c = bytes[i + 2]
        output += BASE64_ALPHABET[a >> 2]
        output += BASE64_ALPHABET[((a & 3) << 4) | ((b ?? 0) >> 4)]
        output += b === undefined ? '=' : BASE64_ALPHABET[((b & 15) << 2) | ((c ?? 0) >> 6)]
        output += c === undefined ? '=' : BASE64_ALPHABET[c & 63]
    }
    return output
}
