import { CHATBOX_BUILD_PLATFORM, CHATBOX_BUILD_TARGET } from '@/variables'
import DesktopPlatform from './desktop_platform'
import type { Platform } from './interfaces'
import MobilePlatform from './mobile_platform'
import TestPlatform from './test_platform'
import WebPlatform from './web_platform'

function initPlatform(): Platform {
  // 测试环境使用 TestPlatform
  if (process.env.NODE_ENV === 'test') {
    return new TestPlatform()
  }
  if (CHATBOX_BUILD_TARGET === 'mobile_app') {
    return new MobilePlatform()
  }
  if (CHATBOX_BUILD_PLATFORM === 'web' || process.env.DEV_WEB_ONLY === 'true') {
    return new WebPlatform()
  }
  if (typeof window !== 'undefined' && window.electronAPI) {
    return new DesktopPlatform(window.electronAPI)
  }
  return new WebPlatform()
}

export default initPlatform()
