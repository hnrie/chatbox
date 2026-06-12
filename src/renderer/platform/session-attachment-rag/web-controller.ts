import { webSessionAttachmentRagService } from '@/services/session-attachment-rag/service'
import type { SessionAttachmentRagController } from './interface'

class WebSessionAttachmentRagController implements SessionAttachmentRagController {
  create = webSessionAttachmentRagService.create
  getAttachments = webSessionAttachmentRagService.getAttachments
  retryAttachment = webSessionAttachmentRagService.retryAttachment
  rebindAttachment = webSessionAttachmentRagService.rebindAttachment
  deleteAttachment = webSessionAttachmentRagService.deleteAttachment
  deleteMessageAttachments = webSessionAttachmentRagService.deleteMessageAttachments
  deleteSessionAttachments = webSessionAttachmentRagService.deleteSessionAttachments
  cleanupOrphans = webSessionAttachmentRagService.cleanupOrphans
  getDebugSnapshot = webSessionAttachmentRagService.getDebugSnapshot
  clearAll = webSessionAttachmentRagService.clearAll
  runMaintenance = webSessionAttachmentRagService.runMaintenance
  query = webSessionAttachmentRagService.query
  readParents = webSessionAttachmentRagService.readParents
}

export default WebSessionAttachmentRagController
