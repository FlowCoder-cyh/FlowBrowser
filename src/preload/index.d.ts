import type {
  BrowserApi,
  CodexApi,
  TabApi,
  ConsentApi,
  CredentialApi,
  PrivacyApi,
  UsageApi,
  GlossaryApi,
  UserSettingApi,
  TranslateApi,
  PopupApi,
  SearchApi,
  ChatApi,
  NoteApi,
  HighlightApi,
  ShortcutApi,
  WorkspaceApi,
  MemoryApi
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
    glossaryApi: GlossaryApi
    userSettingApi: UserSettingApi
    translateApi: TranslateApi
    popupApi: PopupApi
    searchApi: SearchApi
    chatApi: ChatApi
    noteApi: NoteApi
    highlightApi: HighlightApi
    shortcutApi: ShortcutApi
    workspaceApi: WorkspaceApi
    memoryApi: MemoryApi
  }
}

export {}
