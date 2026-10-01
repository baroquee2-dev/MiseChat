import { SamplerID } from '@lib/constants/SamplerData'
import { APIConfiguration, APIValues } from '@lib/engine/API/APIBuilder.types'
import { APIManager } from '@lib/engine/API/APIManagerState'
import { LiteLLMModels } from '@lib/state/LiteLLMModels'
import { SamplersManager } from '@lib/state/SamplerState'
import { getNestedValue } from '@lib/utils/Parsing'

export const useContextLimit = (): number => {
    const sampler = SamplersManager.useCurrentSampler()
    const samplerLimit = sampler?.data?.[SamplerID.CONTEXT_LENGTH] ?? 4096
    const { apiValue, apiConfig } = APIManager.useActiveValueTemplate()

    return resolveContextLimit(apiConfig, apiValue, samplerLimit)
}

/**
 * Non-hook equivalent of `useContextLimit`, for use outside React render
 * (e.g. store actions). Additionally clamps the result to LiteLLM's known
 * context window for the selected model when available, since the
 * configured/reported context length is not always trustworthy (users can
 * set it too high, and providers don't always report it correctly).
 */
export const getContextLimit = (): number => {
    const samplerLimit = SamplersManager.getCurrentSampler()?.[SamplerID.CONTEXT_LENGTH] ?? 4096

    const connectionState = APIManager.useConnectionsStore.getState()
    const apiValue = connectionState.values[connectionState.activeIndex]
    const apiConfig = connectionState
        .getTemplates()
        .find((item) => item.name === apiValue?.configName)
    const resolvedLimit = resolveContextLimit(apiConfig, apiValue, samplerLimit)

    if (!apiConfig || !apiValue) return resolvedLimit
    const modelName = getModelNameValue(apiConfig, apiValue)
    const verifiedLimit = LiteLLMModels.getMaxContextWindow(apiConfig.name, modelName)
    return verifiedLimit ? Math.min(resolvedLimit, verifiedLimit) : resolvedLimit
}

const resolveContextLimit = (
    apiConfig: APIConfiguration | undefined,
    apiValue: APIValues | undefined,
    samplerLimit: number
): number => {
    if (apiConfig?.model.useModelContextLength && apiConfig && apiValue) {
        const hasContextLimitField = apiConfig.request.samplerFields.some(
            (item) => item.samplerID === SamplerID.GENERATED_LENGTH
        )

        const modelLength = getModelContextLength(apiConfig, apiValue)

        if (modelLength) {
            if (hasContextLimitField) return Math.min(samplerLimit, modelLength)
            return modelLength
        }
    }
    return samplerLimit
}

const getModelContextLength = (config: APIConfiguration, values: APIValues): number | undefined => {
    const keys = config.model.contextSizeParser.split('.')
    const result = keys.reduce((acc, key) => acc?.[key], values.model)
    return Number.isInteger(result) ? result : undefined
}

const getModelNameValue = (config: APIConfiguration, values: APIValues): string | undefined => {
    if (config.features.multipleModels || !values.model) return undefined
    const raw = getNestedValue(values.model, config.model.nameParser)
    return typeof raw === 'string' ? raw : undefined
}
