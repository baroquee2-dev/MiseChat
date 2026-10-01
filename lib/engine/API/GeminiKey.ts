import { APIManager, type APIManagerValue } from './APIManagerState'

const GEMINI_HOST = 'generativelanguage.googleapis.com'
const GEMINI_TEMPLATE = 'Google AI Studio'

const isGeminiConnection = (value: APIManagerValue) =>
    value.configName === GEMINI_TEMPLATE ||
    !!value.endpoint?.includes(GEMINI_HOST) ||
    !!value.modelEndpoint?.includes(GEMINI_HOST)

const hasGeminiKey = (value?: APIManagerValue): value is APIManagerValue =>
    !!value && isGeminiConnection(value) && !!value.key?.trim()

/**
 * Gemini voice reuses the key from API settings instead of asking for it a second time.
 * The connection currently used for chat wins; otherwise the first Gemini connection with a key.
 */
export const findGeminiApiKey = (values: APIManagerValue[], activeIndex: number): string => {
    const active = values[activeIndex]
    const match = hasGeminiKey(active) ? active : values.find((value) => hasGeminiKey(value))
    return match?.key.trim() ?? ''
}

export const getGeminiApiKey = () => {
    const { values, activeIndex } = APIManager.useConnectionsStore.getState()
    return findGeminiApiKey(values, activeIndex)
}

export const useGeminiApiKey = () =>
    APIManager.useConnectionsStore((state) => findGeminiApiKey(state.values, state.activeIndex))
