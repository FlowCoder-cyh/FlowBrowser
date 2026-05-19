import type {
  BrowserApi,
  CodexApi,
  TabApi,
  ConsentApi,
  CredentialApi,
  PrivacyApi,
  UsageApi,
  CacheApi,
  PageResultApi,
  GlossaryApi,
  UserSettingApi,
  TranslateApi,
  PopupApi,
  SearchApi,
  ChatApi,
  ShortcutApi
} from './index'

declare global {
  interface Window {
    browserApi: BrowserApi
    codexApi: CodexApi
    tabApi: TabApi
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
    searchApi: SearchApi
    chatApi: ChatApi
    shortcutApi: ShortcutApi
  }
}

export {}
