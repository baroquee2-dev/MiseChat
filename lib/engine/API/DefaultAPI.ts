import { SamplerID } from '@lib/constants/SamplerData'

import { APIConfiguration } from './APIBuilder.types'

export const defaultTemplates: APIConfiguration[] = [
    // OPENAI
    {
        version: 1,
        name: 'OpenAI',

        defaultValues: {
            endpoint: 'https://api.openai.com/v1/chat/completions',
            modelEndpoint: 'https://api.openai.com/v1/models',
            prefill: '',
            firstMessage: '',
            key: '',
            model: undefined,
        },

        features: {
            usePrefill: false,
            useFirstMessage: false,
            useKey: true,
            useModel: true,
            multipleModels: false,
        },

        request: {
            requestType: 'stream',
            samplerFields: [
                { externalName: 'max_context_length', samplerID: SamplerID.CONTEXT_LENGTH },
                { externalName: 'max_completion_tokens', samplerID: SamplerID.GENERATED_LENGTH },
                { externalName: 'stream', samplerID: SamplerID.STREAMING },
                { externalName: 'temperature', samplerID: SamplerID.TEMPERATURE },
                { externalName: 'top_p', samplerID: SamplerID.TOP_P },
                { externalName: 'presence_penalty', samplerID: SamplerID.PRESENCE_PENALTY },
                { externalName: 'frequency_penalty', samplerID: SamplerID.FREQUENCY_PENALTY },
                { externalName: 'seed', samplerID: SamplerID.SEED },
            ],
            completionType: {
                type: 'chatCompletions',
                userRole: 'user',
                systemRole: 'system',
                assistantRole: 'assistant',
                contentName: 'content',
                supportsAudio: true,
                supportsImages: true,
            },
            authHeader: 'Authorization',
            authPrefix: 'Bearer ',
            responseParsePattern: 'choices.0.delta.content',
            reasoningParsePattern: ['choices.0.delta.reasoning'],
            useStop: true,
            stopKey: 'stop',
            stopSequenceLimit: 5,
            promptKey: 'messages',
            removeLength: true,
        },

        payload: {
            type: 'openai',
        },

        model: {
            useModelContextLength: false,
            nameParser: 'id',
            contextSizeParser: '',
            modelListParser: 'data',
        },

        ui: {
            editableCompletionPath: false,
            editableModelPath: false,
            selectableModel: false,
            display: {
                name: 'OpenAI',
                priority: 10100,
                icon: 'openai',
                link: 'https://developers.openai.com/api/reference/overview',
            },
        },
    },
    // xAI (Grok)
    {
        version: 1,
        name: 'XAI',

        defaultValues: {
            endpoint: 'https://api.x.ai/v1/chat/completions',
            modelEndpoint: 'https://api.x.ai/v1/models',
            prefill: '',
            firstMessage: '',
            key: '',
            model: undefined,
        },

        features: {
            usePrefill: false,
            useFirstMessage: false,
            useKey: true,
            useModel: true,
            multipleModels: false,
        },

        request: {
            requestType: 'stream',
            samplerFields: [
                { externalName: 'max_context_length', samplerID: SamplerID.CONTEXT_LENGTH },
                { externalName: 'max_completion_tokens', samplerID: SamplerID.GENERATED_LENGTH },
                { externalName: 'stream', samplerID: SamplerID.STREAMING },
                { externalName: 'temperature', samplerID: SamplerID.TEMPERATURE },
                { externalName: 'top_p', samplerID: SamplerID.TOP_P },
                { externalName: 'presence_penalty', samplerID: SamplerID.PRESENCE_PENALTY },
                { externalName: 'frequency_penalty', samplerID: SamplerID.FREQUENCY_PENALTY },
                { externalName: 'seed', samplerID: SamplerID.SEED },
            ],
            completionType: {
                type: 'chatCompletions',
                userRole: 'user',
                systemRole: 'system',
                assistantRole: 'assistant',
                contentName: 'content',
                supportsImages: true,
            },
            authHeader: 'Authorization',
            authPrefix: 'Bearer ',
            responseParsePattern: 'choices.0.delta.content',
            reasoningParsePattern: [
                'choices.0.delta.reasoning',
                'choices.0.delta.reasoning_content',
            ],
            useStop: true,
            stopKey: 'stop',
            stopSequenceLimit: 8,
            promptKey: 'messages',
            removeLength: true,
        },

        payload: {
            type: 'openai',
        },

        model: {
            useModelContextLength: false,
            nameParser: 'id',
            contextSizeParser: '',
            modelListParser: 'data',
        },

        ui: {
            editableCompletionPath: false,
            editableModelPath: false,
            selectableModel: true,
            display: {
                name: 'xAI',
                priority: 10095,
                icon: 'xai',
                link: 'https://docs.x.ai/',
            },
        },
    },
    // Claude
    {
        version: 1,
        name: 'Claude',

        defaultValues: {
            endpoint: 'https://api.anthropic.com/v1/messages',
            modelEndpoint: 'https://api.anthropic.com/v1/models',
            prefill: '',
            firstMessage: '',
            key: '',
            model: undefined,
        },

        features: {
            useKey: true,
            useModel: true,
            usePrefill: true,
            useFirstMessage: false,
            multipleModels: false,
        },

        request: {
            requestType: 'stream',
            samplerFields: [
                { externalName: 'max_context_length', samplerID: SamplerID.CONTEXT_LENGTH },
                { externalName: 'max_tokens', samplerID: SamplerID.GENERATED_LENGTH },
                { externalName: 'stream', samplerID: SamplerID.STREAMING },
                { externalName: 'temperature', samplerID: SamplerID.TEMPERATURE },
                { externalName: 'top_p', samplerID: SamplerID.TOP_P },
                { externalName: 'top_k', samplerID: SamplerID.TOP_K },
            ],
            completionType: {
                type: 'chatCompletions',
                userRole: 'user',
                systemRole: 'system',
                assistantRole: 'assistant',
                contentName: 'content',
                supportsAudio: true,
                supportsImages: true,
            },
            authHeader: 'x-api-key',
            authPrefix: '',
            responseParsePattern: 'delta.text',
            useStop: true,
            stopKey: 'stop_sequences',
            promptKey: 'messages',
            removeLength: true,
        },

        payload: {
            type: 'claude',
        },

        model: {
            useModelContextLength: false,
            nameParser: 'id',
            contextSizeParser: '',
            modelListParser: 'data',
        },

        ui: {
            editableCompletionPath: true,
            editableModelPath: false,
            selectableModel: true,
            display: {
                name: 'Claude',
                link: 'https://platform.claude.com/docs/en/home',
                priority: 10090,
                icon: 'claude',
            },
        },
    },
    // Cohere
    {
        version: 1,
        name: 'Cohere',

        defaultValues: {
            endpoint: 'https://api.cohere.com/v2/chat',
            modelEndpoint: 'https://api.cohere.com/v1/models',
            prefill: '',
            firstMessage: '',
            key: '',
            model: undefined,
        },

        features: {
            useKey: true,
            useModel: true,
            usePrefill: false,
            useFirstMessage: false,
            multipleModels: false,
        },

        request: {
            requestType: 'stream',
            samplerFields: [
                { externalName: 'max_context_length', samplerID: SamplerID.CONTEXT_LENGTH },
                { externalName: 'max_tokens', samplerID: SamplerID.GENERATED_LENGTH },
                { externalName: 'stream', samplerID: SamplerID.STREAMING },
                { externalName: 'temperature', samplerID: SamplerID.TEMPERATURE },
                { externalName: 'p', samplerID: SamplerID.TOP_P },
                { externalName: 'k', samplerID: SamplerID.TOP_K },
                { externalName: 'presence_penalty', samplerID: SamplerID.PRESENCE_PENALTY },
                { externalName: 'frequency_penalty', samplerID: SamplerID.FREQUENCY_PENALTY },
                { externalName: 'seed', samplerID: SamplerID.SEED },
            ],
            completionType: {
                type: 'chatCompletions',
                userRole: 'user',
                systemRole: 'system',
                assistantRole: 'assistant',
                contentName: 'content',
            },
            authHeader: 'Authorization',
            authPrefix: 'Bearer ',
            responseParsePattern: 'delta.message.content.text',
            useStop: true,
            stopKey: 'stop_sequences',
            promptKey: 'messages',
            removeLength: true,
            removeSeedifNegative: true,
        },

        payload: {
            type: 'openai',
        },

        model: {
            useModelContextLength: true,
            nameParser: 'name',
            contextSizeParser: 'context_length',
            modelListParser: 'models',
        },

        ui: {
            editableCompletionPath: false,
            editableModelPath: false,
            selectableModel: true,
            display: {
                name: 'Cohere',
                link: 'https://docs.cohere.com/',
                priority: 10050,
                icon: 'cohere',
            },
        },
    },
    // Open Router
    {
        version: 1,
        name: 'Open Router',

        defaultValues: {
            endpoint: 'https://openrouter.ai/api/v1/chat/completions',
            modelEndpoint: 'https://openrouter.ai/api/v1/models',
            prefill: '',
            firstMessage: '',
            key: '',
            model: undefined,
        },

        features: {
            useKey: true,
            useModel: true,
            usePrefill: false,
            useFirstMessage: false,
            multipleModels: false,
        },

        request: {
            requestType: 'stream',
            samplerFields: [
                { externalName: 'max_context_length', samplerID: SamplerID.CONTEXT_LENGTH },
                { externalName: 'max_tokens', samplerID: SamplerID.GENERATED_LENGTH },
                { externalName: 'stream', samplerID: SamplerID.STREAMING },
                { externalName: 'temperature', samplerID: SamplerID.TEMPERATURE },
                { externalName: 'presence_penalty', samplerID: SamplerID.PRESENCE_PENALTY },
                { externalName: 'frequency_penalty', samplerID: SamplerID.FREQUENCY_PENALTY },
                { externalName: 'top_p', samplerID: SamplerID.TOP_P },
                { externalName: 'top_k', samplerID: SamplerID.TOP_K },
                { externalName: 'exclude', samplerID: SamplerID.REASONING_EXCLUDE },
                { externalName: 'effort', samplerID: SamplerID.REASONING_EFFORT },
                { externalName: 'max_tokens', samplerID: SamplerID.REASONING_MAX_TOKENS },
                { externalName: 'seed', samplerID: SamplerID.SEED },
            ],
            completionType: {
                type: 'chatCompletions',
                userRole: 'user',
                systemRole: 'system',
                assistantRole: 'assistant',
                contentName: 'content',
                supportsAudio: true,
                supportsImages: true,
            },
            authHeader: 'Authorization',
            authPrefix: 'Bearer ',
            responseParsePattern: 'choices.0.delta.content',
            reasoningParsePattern: 'choices.0.delta.reasoning',
            useStop: true,
            stopKey: 'stop',
            promptKey: 'messages',
            removeLength: true,
            removeSeedifNegative: true,
        },

        payload: {
            type: 'openai',
        },

        model: {
            useModelContextLength: true,
            nameParser: 'id',
            contextSizeParser: 'context_length',
            modelListParser: 'data',
        },

        ui: {
            editableCompletionPath: false,
            editableModelPath: false,
            selectableModel: true,
            display: {
                name: 'Open Router',
                link: 'https://openrouter.ai/',
                priority: 10070,
                icon: 'openrouter',
            },
        },
    },
    // Google AI Studio
    {
        version: 1,
        name: 'Google AI Studio',

        defaultValues: {
            endpoint: 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions',
            modelEndpoint: 'https://generativelanguage.googleapis.com/v1beta/openai/models',
            prefill: '',
            firstMessage: '',
            key: '',
            model: undefined,
            geminiSearchGrounding: false,
        },

        features: {
            usePrefill: false,
            useFirstMessage: false,
            useKey: true,
            useModel: true,
            multipleModels: false,
            useGeminiGrounding: true,
        },

        request: {
            requestType: 'stream',
            samplerFields: [
                { externalName: 'max_context_length', samplerID: SamplerID.CONTEXT_LENGTH },
                { externalName: 'max_tokens', samplerID: SamplerID.GENERATED_LENGTH },
                { externalName: 'stream', samplerID: SamplerID.STREAMING },
                { externalName: 'temperature', samplerID: SamplerID.TEMPERATURE },
                { externalName: 'top_p', samplerID: SamplerID.TOP_P },
                // { externalName: 'presence_penalty', samplerID: SamplerID.PRESENCE_PENALTY }, //not supported by gemini models
            ],
            completionType: {
                type: 'chatCompletions',
                userRole: 'user',
                systemRole: 'system',
                assistantRole: 'assistant',
                contentName: 'content',
                supportsAudio: true,
                supportsImages: true,
            },
            authHeader: 'Authorization',
            authPrefix: 'Bearer ',
            responseParsePattern: 'choices.0.delta.content',
            useStop: true,
            stopKey: 'stop',
            promptKey: 'messages',
            removeLength: true,
            stopSequenceLimit: 5,
        },

        payload: {
            type: 'openai',
        },

        model: {
            useModelContextLength: false,
            nameParser: 'id',
            contextSizeParser: '',
            modelListParser: 'data',
        },

        ui: {
            editableCompletionPath: false,
            editableModelPath: false,
            selectableModel: true,
            display: {
                name: 'Google AI Studio',
                link: 'https://aistudio.google.com',
                priority: 10070,
                icon: 'googleai',
            },
        },
    },
    // Chat Completions
    {
        version: 1,
        name: 'Chat Completions',

        defaultValues: {
            endpoint: 'https://api.openai.com/v1/chat/completions',
            modelEndpoint: 'https://api.openai.com/v1/models',
            prefill: '',
            firstMessage: '',
            key: '',
            model: undefined,
        },

        features: {
            usePrefill: false,
            useFirstMessage: false,
            useKey: true,
            useModel: true,
            multipleModels: false,
        },

        request: {
            requestType: 'stream',
            samplerFields: [
                { externalName: 'max_context_length', samplerID: SamplerID.CONTEXT_LENGTH },
                { externalName: 'max_tokens', samplerID: SamplerID.GENERATED_LENGTH },
                { externalName: 'stream', samplerID: SamplerID.STREAMING },
                { externalName: 'temperature', samplerID: SamplerID.TEMPERATURE },
                { externalName: 'top_p', samplerID: SamplerID.TOP_P },
                { externalName: 'presence_penalty', samplerID: SamplerID.PRESENCE_PENALTY },
                { externalName: 'frequency_penalty', samplerID: SamplerID.FREQUENCY_PENALTY },
                { externalName: 'seed', samplerID: SamplerID.SEED },
            ],
            completionType: {
                type: 'chatCompletions',
                userRole: 'user',
                systemRole: 'system',
                assistantRole: 'assistant',
                contentName: 'content',
            },
            authHeader: 'Authorization',
            authPrefix: 'Bearer ',
            responseParsePattern: 'choices.0.delta.content',
            reasoningParsePattern: [
                'choices.0.delta.reasoning_content',
                'choices.0.delta.reasoning',
            ],
            useStop: true,
            stopKey: 'stop',
            promptKey: 'messages',
            removeLength: true,
        },

        payload: {
            type: 'openai',
        },

        model: {
            useModelContextLength: false,
            nameParser: 'id',
            contextSizeParser: '',
            modelListParser: 'data',
        },

        ui: {
            editableCompletionPath: true,
            editableModelPath: true,
            selectableModel: true,
            display: {
                priority: 300,
                description:
                    'Generic Chat Completions format for various apps (llama.cpp server, LM Studio, vLLM, etc)',
            },
        },
    },

    // Chat Completions Vision/Audio
    {
        version: 1,
        name: 'Chat Completions (Vision/Audio)',

        defaultValues: {
            endpoint: 'https://api.openai.com/v1/chat/completions',
            modelEndpoint: 'https://api.openai.com/v1/models',
            prefill: '',
            firstMessage: '',
            key: '',
            model: undefined,
        },

        features: {
            usePrefill: false,
            useFirstMessage: false,
            useKey: true,
            useModel: true,
            multipleModels: false,
        },

        request: {
            requestType: 'stream',
            samplerFields: [
                { externalName: 'max_context_length', samplerID: SamplerID.CONTEXT_LENGTH },
                { externalName: 'max_tokens', samplerID: SamplerID.GENERATED_LENGTH },
                { externalName: 'stream', samplerID: SamplerID.STREAMING },
                { externalName: 'temperature', samplerID: SamplerID.TEMPERATURE },
                { externalName: 'top_p', samplerID: SamplerID.TOP_P },
                { externalName: 'presence_penalty', samplerID: SamplerID.PRESENCE_PENALTY },
                { externalName: 'frequency_penalty', samplerID: SamplerID.FREQUENCY_PENALTY },
                { externalName: 'seed', samplerID: SamplerID.SEED },
            ],
            completionType: {
                type: 'chatCompletions',
                userRole: 'user',
                systemRole: 'system',
                assistantRole: 'assistant',
                contentName: 'content',
                supportsAudio: true,
                supportsImages: true,
            },
            authHeader: 'Authorization',
            authPrefix: 'Bearer ',
            responseParsePattern: 'choices.0.delta.content',
            useStop: true,
            stopKey: 'stop',
            promptKey: 'messages',
            removeLength: true,
        },

        payload: {
            type: 'openai',
        },

        model: {
            useModelContextLength: false,
            nameParser: 'id',
            contextSizeParser: '',
            modelListParser: 'data',
        },

        ui: {
            editableCompletionPath: true,
            editableModelPath: true,
            selectableModel: true,
            display: {
                priority: 200,
                description: 'Generic Chat Completions with vision support',
            },
        },
    },
]
