import i18n from '@lib/i18n'

import { AppSettings, CLAUDE_VERSION } from '@lib/constants/GlobalValues'
import { SSEFetch } from '@lib/engine/SSEFetch'
import { useInference } from '@lib/state/Chat'
import { Logger } from '@lib/state/Logger'
import { mmkv } from '@lib/storage/MMKV'
import { getNestedValue } from '@lib/utils/Parsing'

import { APIConfiguration } from './APIBuilder.types'
import { buildContext, ContextBuilderParams } from './ContextBuilder'
import {
    buildGeminiGroundingPayload,
    getGeminiGroundingEndpoint,
    parseGeminiGroundingText,
} from './GeminiGrounding'
import { buildRequest, RequestBuilderParams } from './RequestBuilder'

export type DataOutputType = 'text' | 'reasoning' | 'tool_call'

type DataOutput = {
    type: DataOutputType
    content: string
}

export interface APIBuilderParams
    extends ContextBuilderParams,
        Omit<RequestBuilderParams, 'prompt'> {
    onData: (data: DataOutput) => void
    onEnd: (data: string) => void
    stopSequence: string[]
    stopGenerating: () => void
}

export const buildAndSendRequest = async ({
    apiConfig,
    apiValues,
    onData,
    onEnd,
    instruct,
    samplers,
    character,
    user,
    messages,
    summary,
    keyFacts,
    stopSequence,
    stopGenerating,
    chatTokenizer,
    tokenizer,
    messageLoader,
    maxLength,
    cache,
}: APIBuilderParams) => {
    try {
        let payload: any = undefined
        const bypassContextLength = mmkv.getBoolean(AppSettings.BypassContextLength)
        const prompt = await buildContext({
            apiConfig,
            apiValues,
            instruct,
            character,
            user,
            messages,
            summary,
            keyFacts,
            chatTokenizer,
            tokenizer,
            messageLoader,
            maxLength,
            cache,
            bypassContextLength,
        })
        if (prompt === undefined) {
            Logger.errorToast(i18n.t('toast.promptConstructionFailed'))
            stopGenerating()
            return
        }

        const completionType = apiConfig.request.completionType
        const useGeminiGrounding =
            apiConfig.features.useGeminiGrounding &&
            apiValues.geminiSearchGrounding &&
            completionType.type === 'chatCompletions'

        let endpoint = apiValues.endpoint
        if (useGeminiGrounding && completionType.type === 'chatCompletions') {
            if (!Array.isArray(prompt)) {
                Logger.errorToast(i18n.t('toast.geminiGroundingNeedsChat'))
                stopGenerating()
                return
            }

            payload = buildGeminiGroundingPayload(
                prompt,
                completionType.contentName,
                samplers,
                stopSequence
            )
            const groundingEndpoint = getGeminiGroundingEndpoint(apiConfig, apiValues)
            if (!groundingEndpoint) {
                Logger.errorToast(i18n.t('toast.geminiModelResolveFailed'))
                stopGenerating()
                return
            }
            endpoint = groundingEndpoint
            Logger.info(`Using Gemini grounding: ${endpoint}`)
        } else {
            payload = await buildRequest({
                apiConfig,
                apiValues,
                samplers,
                instruct,
                prompt,
                stopSequence,
            })
        }

        if (!payload) {
            Logger.errorToast(i18n.t('toast.payloadConstructionFailed'))
            stopGenerating()
            return
        }

        if (typeof payload !== 'string') {
            payload = JSON.stringify(payload)
        }

        let header: any = {}
        if (apiConfig.features.useKey) {
            const anthropicVersion =
                apiConfig.name === 'Claude' ? { 'anthropic-version': CLAUDE_VERSION } : {}

            if (useGeminiGrounding) {
                header = {
                    'x-goog-api-key': apiValues.key,
                }
            } else {
                header = {
                    ...anthropicVersion,
                    [apiConfig.request.authHeader]: apiConfig.request.authPrefix + apiValues.key,
                }
            }
        }

        const response = responses[apiConfig.request.requestType]

        const replaceStrings = constructReplaceStrings(stopSequence)

        const parseOutput = (event: any, pattern: string | string[], type: DataOutputType) => {
            try {
                const data = getNestedValue(
                    typeof event === 'string' ? JSON.parse(event) : event,
                    pattern
                ) as string | null
                const text = data?.replaceAll(replaceStrings, '') ?? ''
                if (text) onData({ content: text, type: type })
                return !!text?.trim()
            } catch (e) {
                Logger.error(JSON.stringify(e))
            }
            return false
        }

        const parseGeminiOutput = (event: any) => {
            try {
                const text = parseGeminiGroundingText(event).replaceAll(replaceStrings, '')
                if (text) onData({ content: text, type: 'text' })
                return !!text?.trim()
            } catch (e) {
                Logger.error(JSON.stringify(e))
            }
            return false
        }

        const patternMapping: { pattern: string | string[]; type: DataOutputType }[] = [
            { type: 'text', pattern: apiConfig.request.responseParsePattern },
        ]
        const reasonPattern = apiConfig.request.reasoningParsePattern

        if (reasonPattern) {
            patternMapping.push({ type: 'reasoning', pattern: reasonPattern })
        }

        return response({
            endpoint: endpoint,
            payload: payload,
            onEvent: (event) => {
                if (useGeminiGrounding) {
                    parseGeminiOutput(event)
                    return
                }

                for (const pattern of patternMapping) {
                    if (parseOutput(event, pattern.pattern, pattern.type)) break
                }
            },
            onEnd: onEnd,
            header: header,
            stopGenerating: stopGenerating,
        })
    } catch (e) {
        Logger.errorToast(i18n.t('toast.completionFailed', { error: e }))
        stopGenerating()
    }
}

type KeyHeader = {
    [key: string]: string
}

type SenderParams = {
    endpoint: string
    payload: string
    header: KeyHeader
    onEnd: (data: string) => void
    onEvent: (event: any) => void
    stopGenerating: () => void
}

const readableStreamResponse = async (senderParams: SenderParams) => {
    const sse = new SSEFetch()

    const closeStream = () => {
        Logger.debug('Running Close Stream')
        senderParams.onEnd('')
        senderParams.stopGenerating()
    }

    sse.setOnEvent((data) => {
        try {
            const a = JSON.parse(data)
            if (a?.error) {
                Logger.errorToast(i18n.t('toast.sseError'))
                Logger.error(data)
                useInference.getState().markGenerationFailed()
            }
        } catch {}
        senderParams.onEvent(data)
    })

    sse.setOnError(() => {
        Logger.errorToast(i18n.t('toast.generationFailed'))
        useInference.getState().markGenerationFailed()
        closeStream()
    })

    sse.setOnClose(() => {
        Logger.info('Stream Closed')
        closeStream()
    })

    sse.start({
        endpoint: senderParams.endpoint,
        body: senderParams.payload,
        method: 'POST',
        headers: {
            accept: 'application/json',
            'Content-Type': 'application/json',
            ...senderParams.header,
        },
    })

    return () => sse.abort()
}

const constructReplaceStrings = (stopSequence: string[]) => {
    const replace = RegExp(
        stopSequence.map((item) => item.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join(`|`),
        'g'
    )
    return replace
}

const responses: Record<
    APIConfiguration['request']['requestType'],
    (params: SenderParams) => Promise<() => void> | (() => void)
> = {
    stream: readableStreamResponse,
}
