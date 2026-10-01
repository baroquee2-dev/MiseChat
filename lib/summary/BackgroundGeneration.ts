import { fetch } from 'expo/fetch'

import { SamplerID } from '@lib/constants/SamplerData'
import type { APIConfiguration, APIValues } from '@lib/engine/API/APIBuilder.types'
import { APIManager } from '@lib/engine/API/APIManagerState'
import type { Message } from '@lib/engine/API/ContextBuilder'
import { buildRequest } from '@lib/engine/API/RequestBuilder'
import { Instructs } from '@lib/state/Instructs'
import { Logger } from '@lib/state/Logger'
import { SamplersManager } from '@lib/state/SamplerState'
import { getNestedValue } from '@lib/utils/Parsing'

export type BackgroundPrompt = {
    system: string
    user: string
    maxTokens: number
    /** Defaults low, since most background jobs extract rather than write. */
    temperature?: number
    /** Shown in warning logs so a failure points at the feature that caused it. */
    label: string
}

const getRemoteFields = () => {
    const connectionState = APIManager.useConnectionsStore.getState()
    const values = connectionState.values[connectionState.activeIndex]
    const config = connectionState.getTemplates().find((item) => item.name === values?.configName)
    const instruct = Instructs.useInstruct.getState().replacedMacros()
    if (!values || !config || !instruct) return
    return { values, config, instruct }
}

const buildPrompt = (config: APIConfiguration, prompt: BackgroundPrompt): Message[] => {
    const completionType = config.request.completionType

    return [
        { role: completionType.systemRole, [completionType.contentName]: prompt.system },
        { role: completionType.userRole, [completionType.contentName]: prompt.user },
    ]
}

const getHeaders = (config: APIConfiguration, values: APIValues) => {
    if (!config.features.useKey) return {}
    return { [config.request.authHeader]: config.request.authPrefix + values.key }
}

const disableStream = (payload: unknown) => {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return payload
    return { ...(payload as Record<string, unknown>), stream: false }
}

const hasProviderError = (data: unknown) => {
    if (!data || typeof data !== 'object') return false
    const root = data as Record<string, any>
    if (root.error != null) return true
    if (Array.isArray(root.errors) && root.errors.length > 0) return true
    if (
        typeof root.message === 'string' &&
        /error|fail|invalid/i.test(root.message) &&
        !root.choices
    )
        return true
    return false
}

const extractCompletionText = (data: unknown, pattern: string | string[]) => {
    if (hasProviderError(data)) return ''

    const nested = getNestedValue(data, pattern)
    if (typeof nested === 'string' && nested.trim()) return nested

    if (!data || typeof data !== 'object') return ''

    const root = data as Record<string, any>
    const candidates = [
        root?.choices?.[0]?.message?.content,
        root?.choices?.[0]?.text,
        root?.content?.[0]?.text,
        root?.content,
        root?.output_text,
        root?.text,
        root?.response,
    ]
    for (const candidate of candidates) {
        if (typeof candidate === 'string' && candidate.trim()) return candidate
    }
    return ''
}

const generateRemote = async (prompt: BackgroundPrompt) => {
    const fields = getRemoteFields()
    if (!fields) {
        Logger.warn(`Skipping ${prompt.label} because the active connection is unavailable`)
        return
    }
    const { config, values, instruct } = fields

    const backgroundConfig: APIConfiguration = {
        ...config,
        request: { ...config.request, useStop: false },
    }
    const samplers = {
        ...SamplersManager.getCurrentSampler(),
        [SamplerID.GENERATED_LENGTH]: prompt.maxTokens,
        [SamplerID.TEMPERATURE]: prompt.temperature ?? 0.2,
        // Reasoning models otherwise inherit whatever effort the user's active
        // sampler preset has, which can silently consume the entire
        // generated-length budget on hidden reasoning and leave nothing for
        // the actual output (surfaces as "empty completion").
        [SamplerID.REASONING_EFFORT]: 'disabled' as const,
        [SamplerID.REASONING_MAX_TOKENS]: 0,
        [SamplerID.REASONING_EXCLUDE]: true,
    }
    const payload = await buildRequest({
        apiConfig: backgroundConfig,
        apiValues: values,
        samplers: samplers,
        instruct: { ...instruct, system_prompt: prompt.system },
        prompt: buildPrompt(backgroundConfig, prompt),
        stopSequence: [],
    })
    if (!payload) return

    const bodyObject =
        typeof payload === 'string' ? disableStream(JSON.parse(payload)) : disableStream(payload)

    const response = await fetch(values.endpoint, {
        method: 'POST',
        headers: {
            accept: 'application/json',
            'Content-Type': 'application/json',
            ...getHeaders(config, values),
        },
        body: JSON.stringify(bodyObject),
    })

    if (!response.ok) {
        const errorText = await response.text().catch(() => '')
        Logger.warn(
            `Skipping ${prompt.label} because the provider returned ${response.status}${
                errorText ? `: ${errorText.slice(0, 200)}` : ''
            }`
        )
        return
    }

    let data: unknown
    try {
        data = await response.json()
    } catch (error) {
        Logger.warn(`Skipping ${prompt.label} because the provider returned invalid JSON: ${error}`)
        return
    }

    if (hasProviderError(data)) {
        Logger.warn(
            `Skipping ${prompt.label} because the provider returned an error payload: ${JSON.stringify(
                data
            ).slice(0, 200)}`
        )
        return
    }

    const content = extractCompletionText(data, config.request.responseParsePattern)
    if (!content.trim()) {
        Logger.warn(`Skipping ${prompt.label} because the provider returned an empty completion`)
        return
    }
    return content
}

/**
 * Run an auxiliary (non-chat) completion against whichever backend is active.
 * Returns the raw text so each caller can apply its own cleaning.
 */
export const runBackgroundCompletion = async (prompt: BackgroundPrompt) => {
    try {
        return await generateRemote(prompt)
    } catch (error) {
        Logger.warn(`Failed to run ${prompt.label}: ${error}`)
        return
    }
}

let queue: Promise<unknown> = Promise.resolve()

/**
 * Serialize background generations. Local inference shares a single llama
 * context (and restores the chat KV cache afterwards), so overlapping jobs
 * would corrupt each other; remote providers simply prefer not to be hit twice
 * at once for the same turn.
 */
export const enqueueBackgroundJob = <T>(job: () => Promise<T>): Promise<T> => {
    const result = queue.then(job, job)
    queue = result.catch(() => {})
    return result
}
