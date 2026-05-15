import type {
  BrowserApi,
  ConsentApi,
  CredentialApi,
  PrivacyApi,
  UsageApi,
  CacheApi,
  PageResultApi,
  GlossaryApi,
  UserSettingApi,
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
    pageResultApi: PageResultApi
    glossaryApi: GlossaryApi
    userSettingApi: UserSettingApi
    translateApi: TranslateApi
    popupApi: PopupApi
  }
}

export {}
