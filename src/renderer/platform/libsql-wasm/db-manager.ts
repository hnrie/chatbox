import type { Client } from '@libsql/client'
import { getLogger } from '@/lib/utils'
import { createWasmLibsqlClient } from './create-client'
import { WasmVectorStore } from './vector-store'

const log = getLogger('libsql-wasm:db-manager')

const KB_DB = 'chatbox_kb.db'
const SESSION_RAG_DB = 'chatbox_session_rag.db'
const SESSION_RAG_VECTOR_DB = 'chatbox_session_rag_vectors.db'

type KnowledgeBaseHandle = {
  db: Client
  vectorStore: WasmVectorStore
}

type SessionAttachmentRagHandle = {
  db: Client
  vectorStore: WasmVectorStore
}

let knowledgeBaseHandle: Promise<KnowledgeBaseHandle> | null = null
let sessionAttachmentRagHandle: Promise<SessionAttachmentRagHandle> | null = null

async function openKnowledgeBase(): Promise<KnowledgeBaseHandle> {
  const client = await createWasmLibsqlClient(`file:${KB_DB}`)
  log.info('[WASM] Knowledge base database opened')
  return { db: client, vectorStore: new WasmVectorStore(client) }
}

async function openSessionAttachmentRag(): Promise<SessionAttachmentRagHandle> {
  const db = await createWasmLibsqlClient(`file:${SESSION_RAG_DB}`)
  const vectorClient = await createWasmLibsqlClient(`file:${SESSION_RAG_VECTOR_DB}`)
  log.info('[WASM] Session attachment RAG databases opened')
  return { db, vectorStore: new WasmVectorStore(vectorClient) }
}

export async function getKnowledgeBaseDatabase(): Promise<KnowledgeBaseHandle> {
  if (!knowledgeBaseHandle) {
    knowledgeBaseHandle = openKnowledgeBase()
  }
  return knowledgeBaseHandle
}

export async function getSessionAttachmentRagDatabase(): Promise<SessionAttachmentRagHandle> {
  if (!sessionAttachmentRagHandle) {
    sessionAttachmentRagHandle = openSessionAttachmentRag()
  }
  return sessionAttachmentRagHandle
}

export async function resetWasmDatabasesForTests() {
  knowledgeBaseHandle = null
  sessionAttachmentRagHandle = null
}
