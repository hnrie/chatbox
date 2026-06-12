import type { FileMeta, KnowledgeBaseProviderMode } from '@shared/types'
import type { DocumentParserConfig } from '@shared/types/settings'
import { webKnowledgeBaseService } from '@/services/knowledge-base/service'
import type { KnowledgeBaseController } from './interface'

class WebKnowledgeBaseController implements KnowledgeBaseController {
  list = webKnowledgeBaseService.list
  create = webKnowledgeBaseService.create
  delete = webKnowledgeBaseService.delete
  listFiles = webKnowledgeBaseService.listFiles
  countFiles = webKnowledgeBaseService.countFiles
  listFilesPaginated = webKnowledgeBaseService.listFilesPaginated
  deleteFile = webKnowledgeBaseService.deleteFile
  retryFile = webKnowledgeBaseService.retryFile
  pauseFile = webKnowledgeBaseService.pauseFile
  resumeFile = webKnowledgeBaseService.resumeFile
  search = webKnowledgeBaseService.search
  update = webKnowledgeBaseService.update
  getFilesMeta = webKnowledgeBaseService.getFilesMeta
  readFileChunks = webKnowledgeBaseService.readFileChunks
  testMineruConnection = webKnowledgeBaseService.testMineruConnection

  async uploadFile(kbId: number, file: FileMeta) {
    await webKnowledgeBaseService.uploadFile(kbId, file)
  }
}

export default WebKnowledgeBaseController
