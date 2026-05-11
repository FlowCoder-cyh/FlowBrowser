import type { BrowserApi } from './index'

declare global {
  interface Window {
    browserApi: BrowserApi
  }
}

export {}
