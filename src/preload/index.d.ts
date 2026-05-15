import type {
  BrowserApi,
  ConsentApi,
  CredentialApi,
  PrivacyApi,
  UsageApi,
  CacheApi,
  GlossaryApi,
  TranslateApi,
  PopupApi
} from './index'

declare global {
  interface Window {
    browserApi: BrowserApi
    consentApi: ConsentApi
    credentialApi: CredentialApi
    privacyApi: PrivacyApi
    usageApi: UsageApi
    cacheApi: CacheApi
    glossaryApi: GlossaryApi
    translateApi: TranslateApi
    popupApi: PopupApi
  }
}

export {}
