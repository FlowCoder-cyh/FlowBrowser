import type {
  BrowserApi,
  ConsentApi,
  CredentialApi,
  PrivacyApi,
  UsageApi,
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
    translateApi: TranslateApi
    popupApi: PopupApi
  }
}

export {}
