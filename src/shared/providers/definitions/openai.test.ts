import { describe, expect, it, vi } from 'vitest'
import type { SentryScope } from '../../utils/sentry_adapter'
import type { ModelDependencies } from '../../types/adapters'
import type { CreateModelConfig } from '../types'
import OpenAI from './models/openai'
import { openaiProvider } from './openai'

const mockScope: SentryScope = {
  setTag: vi.fn(),
  setExtra: vi.fn(),
})

function createDependencies(): ModelDependencies {
  return {
    request: {
      fetchWithOptions: vi.fn(),
      apiRequest: vi.fn(),
    },
    storage: {
      saveImage: vi.fn(),
      getImage: vi.fn(),
    },
    sentry: {
      captureException: vi.fn(),
      withScope: vi.fn((callback: (scope: SentryScope) => void) => callback(mockScope)),
    },
    getRemoteConfig: vi.fn(),
    platformType: 'web',
  }
}

function createConfig(useProxy?: boolean): CreateModelConfig {
  return {
    settings: {
      provider: 'openai',
      modelId: 'gpt-4o-mini',
      stream: true,
    },
    globalSettings: {
      injectDefaultMetadata: true,
    },
    config: {
      uuid: 'test-user',
    },
    dependencies: createDependencies(),
    providerSetting: {
      apiKey: 'test-api-key',
      apiHost: 'https://api.openai.com',
      useProxy,
    },
    formattedApiHost: 'https://api.openai.com',
    formattedApiPath: '/v1/chat/completions',
    model: {
      modelId: 'gpt-4o-mini',
      type: 'chat',
    },
    effectiveApiKey: 'test-api-key',
  } as unknown as CreateModelConfig
}

describe('openaiProvider', () => {
  it('passes provider proxy setting to the chat-completions model', () => {
    const model = openaiProvider.createModel(createConfig(true))

    expect(model).toBeInstanceOf(OpenAI)
    expect((model as OpenAI).options.useProxy).toBe(true)
  })

  it('defaults proxy setting to false for existing configurations', () => {
    const model = openaiProvider.createModel(createConfig(undefined))

    expect(model).toBeInstanceOf(OpenAI)
    expect((model as OpenAI).options.useProxy).toBe(false)
  })
}
