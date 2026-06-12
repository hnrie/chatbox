import type { EmbeddingModel } from 'ai'
import { CohereClient } from 'cohere-ai'
import { createModel } from '@/adapters'
import { getProviderSettings } from '@shared/models'
import type { CallChatCompletionOptions, ModelInterface } from '@shared/models/types'
import { getChatboxAPIOrigin } from '@shared/request/chatboxai_pool'
import { SessionSettingsSchema } from '@shared/types'
import { parseKnowledgeBaseModelString } from '@shared/utils/knowledge-base-model-parser'
import { cache } from '@shared/utils/cache'
import { settingsStore } from '@/stores/settingsStore'
import { ensureKnowledgeBaseDatabase } from './db'

interface EmbeddingCapableModel {
  getTextEmbeddingModel(options: CallChatCompletionOptions): EmbeddingModel
}

function getTextEmbeddingModel(model: ModelInterface): EmbeddingModel {
  const maybeGetTextEmbeddingModel = (model as unknown as Partial<EmbeddingCapableModel>).getTextEmbeddingModel
  if (typeof maybeGetTextEmbeddingModel !== 'function') {
    throw new Error(`Model ${model.modelId} does not support text embeddings`)
  }
  return maybeGetTextEmbeddingModel.call(model, {})
}

function getMergedSettings(providerId: string, modelId: string) {
  const globalSettings = settingsStore.getState().getSettings()
  return SessionSettingsSchema.parse({
    ...globalSettings,
    provider: providerId,
    modelId,
  })
}

export async function createEmbeddingProviderFromModelString(modelString: string): Promise<EmbeddingModel> {
  const parsed = parseKnowledgeBaseModelString(modelString)
  if (!parsed) {
    throw new Error(`Invalid embedding model format: ${modelString}`)
  }
  const modelSettings = getMergedSettings(parsed.providerId, parsed.modelId)
  const model = await createModel(modelSettings)
  return getTextEmbeddingModel(model)
}

export async function getEmbeddingProvider(kbId: number) {
  return cache(
    `web-kb:embedding:${kbId}`,
    async () => {
      const { db } = await ensureKnowledgeBaseDatabase()
      const rs = await db.execute({ sql: 'SELECT embedding_model FROM knowledge_base WHERE id = ?', args: [kbId] })
      const embeddingModel = rs.rows[0]?.embedding_model as string | undefined
      if (!embeddingModel) {
        throw new Error('embeddingModel not set')
      }
      return createEmbeddingProviderFromModelString(embeddingModel)
    },
    { ttl: 60_000 }
  )
}

export async function getVisionProvider(kbId: number) {
  return cache(
    `web-kb:vision:${kbId}`,
    async () => {
      const { db } = await ensureKnowledgeBaseDatabase()
      const rs = await db.execute({ sql: 'SELECT vision_model FROM knowledge_base WHERE id = ?', args: [kbId] })
      const visionModel = rs.rows[0]?.vision_model as string | undefined
      if (!visionModel) {
        return null
      }
      const parsed = parseKnowledgeBaseModelString(visionModel)
      if (!parsed) {
        throw new Error(`Invalid vision model format: ${visionModel}`)
      }
      const modelSettings = getMergedSettings(parsed.providerId, parsed.modelId)
      return { model: await createModel(modelSettings) }
    },
    { ttl: 60_000 }
  )
}

export async function getRerankProvider(kbId: number) {
  return cache(
    `web-kb:rerank:${kbId}`,
    async () => {
      const { db } = await ensureKnowledgeBaseDatabase()
      const rs = await db.execute({ sql: 'SELECT rerank_model FROM knowledge_base WHERE id = ?', args: [kbId] })
      const rerankModel = rs.rows[0]?.rerank_model as string | undefined
      if (!rerankModel) {
        return null
      }
      const parsed = parseKnowledgeBaseModelString(rerankModel)
      if (!parsed) {
        throw new Error(`Invalid rerank model format: ${rerankModel}`)
      }

      const sessionSettings = getMergedSettings(parsed.providerId, parsed.modelId)
      const { providerSetting, formattedApiHost } = getProviderSettings(sessionSettings, settingsStore.getState().getSettings())

      let apiHost = formattedApiHost
      let token = providerSetting.apiKey
      if (parsed.providerId === 'chatbox-ai') {
        apiHost = getChatboxAPIOrigin()
        token = settingsStore.getState().getSettings().licenseKey
      }

      const client = new CohereClient({
        environment: apiHost,
        token,
      })
      return { client, modelId: parsed.modelId }
    },
    { ttl: 60_000 }
  )
}
