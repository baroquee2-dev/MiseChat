import { Paths } from 'expo-file-system'
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator'

import { Logger } from '@lib/state/Logger'
import type { MouthSlot } from '@lib/state/MouthSprites'
import { deleteFile, writeBase64File } from '@lib/utils/File'

export const MOUTH_SPRITE_MODEL = 'gemini-3.1-flash-image'
export const MOUTH_SPRITE_MODEL_LABEL = 'Gemini 3.1 Flash Image'

const GEMINI_API = 'https://generativelanguage.googleapis.com/v1beta/models'
/** Mouth frames do not need more detail than this, and smaller requests time out less. */
const MAX_INPUT_SIDE = 1536
const MAX_ATTEMPTS = 3
const RETRY_STATUSES = [429, 500, 502, 503, 504]
/** Reasons Gemini gives for refusing on content grounds, which retrying cannot change. */
const BLOCKED_REASONS = ['SAFETY', 'IMAGE_SAFETY', 'PROHIBITED_CONTENT', 'BLOCKLIST']

/** Thrown when the character image itself is what Gemini objects to. */
export class MouthSpriteBlockedError extends Error {
    constructor(detail: string) {
        super(detail)
        this.name = 'MouthSpriteBlockedError'
    }
}

const ASPECT_RATIOS: Record<string, number> = {
    '1:1': 1,
    '2:3': 2 / 3,
    '3:2': 3 / 2,
    '3:4': 3 / 4,
    '4:3': 4 / 3,
    '4:5': 4 / 5,
    '5:4': 5 / 4,
    '9:16': 9 / 16,
    '16:9': 16 / 9,
    '21:9': 21 / 9,
}

const KEEP_REST =
    'Change ONLY the mouth. Keep everything else exactly the same as the input image: ' +
    'the same art style, line art, colors, shading and lighting; the same face shape, eyes, ' +
    'eyebrows, hair, pose, clothing and background; the same framing and image size. ' +
    'Do not zoom, crop, shift, or redraw anything outside the mouth area.'

const PROMPTS: Record<MouthSlot, string> = {
    closed:
        "Edit this image so the character's mouth is fully closed, lips gently together, " +
        'with a relaxed neutral expression. ' +
        KEEP_REST,
    half:
        "Edit this image so the character's mouth is slightly open, lips parted just a little " +
        'as if softly speaking, with a thin dark gap between the lips. ' +
        KEEP_REST,
    open:
        'Edit this image so the character\'s mouth is clearly open, as if saying "ah" in ' +
        'natural conversation (not shouting), showing a little of the inside of the mouth. ' +
        KEEP_REST,
}

export type MouthSpriteSource = {
    base64: string
    width: number
    height: number
    aspectRatio: string
}

type GeminiInline = { data?: string; mimeType?: string; mime_type?: string }
type GeminiImageResponse = {
    candidates?: {
        content?: {
            parts?: { inlineData?: GeminiInline; inline_data?: GeminiInline; text?: string }[]
        }
        finishReason?: string
    }[]
    promptFeedback?: unknown
}

/** Gemini only accepts fixed ratios; the nearest one avoids cropping or padding. */
const nearestAspectRatio = (width: number, height: number) => {
    const ratio = width / height
    return Object.keys(ASPECT_RATIOS).reduce((best, name) =>
        Math.abs(Math.log(ASPECT_RATIOS[name] / ratio)) <
        Math.abs(Math.log(ASPECT_RATIOS[best] / ratio))
            ? name
            : best
    )
}

const abortError = () => {
    const error = new Error('Aborted')
    error.name = 'AbortError'
    return error
}

const wait = (ms: number, signal: AbortSignal) =>
    new Promise<void>((resolve, reject) => {
        if (signal.aborted) {
            reject(abortError())
            return
        }
        const onAbort = () => {
            clearTimeout(timer)
            reject(abortError())
        }
        const timer = setTimeout(() => {
            signal.removeEventListener('abort', onAbort)
            resolve()
        }, ms)
        signal.addEventListener('abort', onAbort)
    })

/** Encodes the character image once, so all three frames start from the same input. */
export const prepareMouthSpriteSource = async (uri: string): Promise<MouthSpriteSource> => {
    const original = await ImageManipulator.manipulate(uri).renderAsync()
    const { width, height } = original
    const context = ImageManipulator.manipulate(uri)
    const scaled =
        Math.max(width, height) > MAX_INPUT_SIDE
            ? context.resize(
                  width >= height ? { width: MAX_INPUT_SIDE } : { height: MAX_INPUT_SIDE }
              )
            : context
    const rendered = await scaled.renderAsync()
    const saved = await rendered.saveAsync({ format: SaveFormat.PNG, base64: true })
    if (!saved.base64) throw new Error('Could not encode the character image')
    return {
        base64: saved.base64,
        width: width,
        height: height,
        aspectRatio: nearestAspectRatio(width, height),
    }
}

const extractImage = (data: GeminiImageResponse) => {
    const candidate = data.candidates?.[0]
    const texts: string[] = []
    for (const part of candidate?.content?.parts ?? []) {
        const inline = part.inlineData ?? part.inline_data
        if (inline?.data) {
            return { data: inline.data, mimeType: inline.mimeType ?? inline.mime_type ?? '' }
        }
        if (part.text) texts.push(part.text)
    }
    const details = [
        candidate?.finishReason ? `finishReason=${candidate.finishReason}` : '',
        data.promptFeedback ? `promptFeedback=${JSON.stringify(data.promptFeedback)}` : '',
        texts.length ? texts.join(' ').slice(0, 200) : '',
    ].filter(Boolean)
    const detail = details.join('; ')
    const blockReason = (data.promptFeedback as { blockReason?: string } | undefined)?.blockReason
    if (blockReason || BLOCKED_REASONS.includes(candidate?.finishReason ?? '')) {
        throw new MouthSpriteBlockedError(detail || 'blocked by content policy')
    }
    throw new Error(`Gemini returned no image${detail ? ` (${detail})` : ''}`)
}

const requestFrame = async (
    source: MouthSpriteSource,
    prompt: string,
    apiKey: string,
    signal: AbortSignal
) => {
    const body = JSON.stringify({
        contents: [
            {
                parts: [
                    { inline_data: { mime_type: 'image/png', data: source.base64 } },
                    { text: prompt },
                ],
            },
        ],
        generationConfig: {
            responseModalities: ['TEXT', 'IMAGE'],
            imageConfig: { aspectRatio: source.aspectRatio },
        },
    })

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
        const response = await fetch(`${GEMINI_API}/${MOUTH_SPRITE_MODEL}:generateContent`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
            body: body,
            signal: signal,
        })
        if (RETRY_STATUSES.includes(response.status) && attempt < MAX_ATTEMPTS) {
            Logger.warn(`Mouth sprite request got ${response.status}, retrying (${attempt})`)
            await wait(5000 * attempt, signal)
            continue
        }
        if (!response.ok) {
            const detail = await response.text().catch(() => '')
            throw new Error(`Gemini ${response.status}: ${detail.slice(0, 300)}`)
        }
        try {
            return extractImage((await response.json()) as GeminiImageResponse)
        } catch (error) {
            // A refusal on content grounds is settled; only an empty answer is worth another try.
            if (error instanceof MouthSpriteBlockedError) throw error
            // The model occasionally answers in text only; another try usually draws.
            if (attempt === MAX_ATTEMPTS) throw error
            Logger.warn(`${error}, retrying (${attempt})`)
        }
    }
    throw new Error('Gemini returned no image')
}

/**
 * Draws one mouth frame from the prepared source and returns a cache file URI.
 * The result is resized to the source's size so every frame lines up with the portrait.
 */
export const generateMouthSprite = async (
    source: MouthSpriteSource,
    slot: MouthSlot,
    apiKey: string,
    signal: AbortSignal
): Promise<string> => {
    const image = await requestFrame(source, PROMPTS[slot], apiKey, signal)
    const extension = /jpe?g/i.test(image.mimeType) ? 'jpg' : 'png'
    const raw = `${Paths.cache.uri}mouth-raw-${slot}-${Date.now()}.${extension}`
    await writeBase64File(raw, image.data)
    try {
        const rendered = await ImageManipulator.manipulate(raw)
            .resize({ width: source.width, height: source.height })
            .renderAsync()
        const saved = await rendered.saveAsync({ format: SaveFormat.PNG })
        return saved.uri
    } finally {
        deleteFile(raw)
    }
}
