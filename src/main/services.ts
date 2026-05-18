/**
 * Main 프로세스 서비스 초기화 + IPC 등록.
 * Privacy / Credentials / UsageLog / Provider 통합 진입점.
 */

import { app, ipcMain, type WebContents } from 'electron'
import { join } from 'node:path'
import { promises as fs } from 'node:fs'

import {
  ConsentGate,
  DomainFilter,
  DomainPolicyStore,
  TransmissionLogger,
  defaultDomainPolicyPath,
  defaultLogFilePath,
  evaluatePrivacy,
  detectSensitiveFieldsScript,
  type ConsentState,
  type DomainFilterRule,
  type DomainFilterState,
  type DomainPolicyExport,
  type PrivacyDecision
} from '../privacy'

import {
  CredentialsStore,
  UsageLog,
  TranslationCache,
  GlossaryStore,
  UserSettingStore,
  PageResultStore,
  TabStateStore,
  defaultCredentialsPath,
  defaultUsageLogPath,
  defaultTranslationCachePath,
  defaultGlossaryPath,
  defaultUserSettingPath,
  defaultPageResultPath,
  defaultTabStatePath,
  formatGlossaryContext,
  type CredentialRecord,
  type CredentialProviderType,
  type GlossaryTerm,
  type GlossaryExport,
  type UserSettingState
} from '../storage'

import {
  OpenAIApiKeyProvider,
  CodexLoginProvider,
  DeviceCodeFlow,
  ProviderError,
  type ProviderAdapter,
  type TranslationInput,
  type TranslationOutput,
  type CodexTokenAccess,
  type TokenBundle,
  type UserCodeResult
} from '../ai'
// Sprint 015 M2-8 — retired page-translation extraction imports 제거.
//   M2-5/M2-6 페이지 번역 폐기 후 호출자 0. perception/* 모듈 자체는 M3 IndexingService 가 활용 예정.

interface DiskConsentState {
  globalConsented: boolean
  globalConsentedAt: number | null
  policyVersion: number
}

const POLICY_VERSION = 1

let consentGate!: ConsentGate
let domainFilter!: DomainFilter
let domainPolicyStore!: DomainPolicyStore
let transmissionLogger!: TransmissionLogger
let credentialsStore!: CredentialsStore
let usageLog!: UsageLog
let translationCache!: TranslationCache
let glossaryStore!: GlossaryStore
let userSettingStore!: UserSettingStore
let pageResultStore!: PageResultStore
let tabStateStore!: TabStateStore
const providers: Map<CredentialProviderType, ProviderAdapter> = new Map()

let consentStatePath!: string
let domainPolicyPath!: string

export async function initServices(): Promise<void> {
  const userDataDir = app.getPath('userData')
  consentStatePath = join(userDataDir, 'consent.json')
  domainPolicyPath = defaultDomainPolicyPath(userDataDir)

  consentGate = new ConsentGate(await loadConsentState(), POLICY_VERSION)
  const loadedDomainState = await DomainPolicyStore.loadFromDisk(domainPolicyPath)
  domainFilter = new DomainFilter(loadedDomainState)
  domainPolicyStore = new DomainPolicyStore(domainPolicyPath, domainFilter)

  transmissionLogger = new TransmissionLogger(defaultLogFilePath(userDataDir))
  await transmissionLogger.loadFromDisk()

  credentialsStore = new CredentialsStore(defaultCredentialsPath(userDataDir))
  await credentialsStore.load()

  usageLog = new UsageLog(defaultUsageLogPath(userDataDir))

  translationCache = new TranslationCache(defaultTranslationCachePath(userDataDir))
  await translationCache.load()

  glossaryStore = new GlossaryStore(defaultGlossaryPath(userDataDir))
  await glossaryStore.load()

  userSettingStore = new UserSettingStore(defaultUserSettingPath(userDataDir))
  await userSettingStore.load()

  pageResultStore = new PageResultStore(defaultPageResultPath(userDataDir))
  await pageResultStore.load()

  tabStateStore = new TabStateStore(defaultTabStatePath(userDataDir))

  registerConsentIpc()
  registerCredentialIpc()
  registerPrivacyIpc()
  registerUsageIpc()
  registerTranslateIpc()
  registerCacheIpc()
  registerGlossaryIpc()
  registerUserSettingIpc()
  registerPageResultIpc()
  registerCodexIpc()
}

function registerPageResultIpc(): void {
  // Sprint 015 M2-8 — retired page-result lookup/store IPC handlers 제거.
  //   M2-5/M2-6 페이지 번역 폐기 후 renderer 호출 0. stats/clear 는 PageCachePanel 유지.
  ipcMain.handle('pageResult:stats', () => pageResultStore.stats())
  ipcMain.handle('pageResult:clear', async (): Promise<void> => pageResultStore.clearAll())
}

// Sprint 015 M2-8 — retired page-result helper exports 제거.
//   M2-5/M2-6 폐기 후 호출자 0. M5 어댑터 제거 시 pageResultStore 인스턴스 자체 폐기.

/**
 * Sprint 009 M3 — TabStateStore 접근 헬퍼.
 */
export async function loadTabState(): Promise<
  import('../storage/TabStateStore').PersistedTabState
> {
  return tabStateStore.load()
}

export async function saveTabState(state: {
  tabs: import('../storage/TabStateStore').PersistedTabSession[]
  activeId: string | null
}): Promise<void> {
  await tabStateStore.save(state)
}

/**
 * Sprint 010 M3 — main/index.ts에서 cancelOnTabSwitch 분기에 사용.
 */
export function getUserSetting(): UserSettingState {
  return userSettingStore.getState()
}

function registerUserSettingIpc(): void {
  ipcMain.handle('userSetting:get', (): UserSettingState => userSettingStore.getState())
  ipcMain.handle(
    'userSetting:update',
    async (_event, patch: Partial<UserSettingState>): Promise<UserSettingState> =>
      userSettingStore.update(patch)
  )
}

function registerCacheIpc(): void {
  ipcMain.handle('cache:stats', () => translationCache.stats())
  ipcMain.handle('cache:clear-all', async (): Promise<void> => {
    await translationCache.clearAll()
  })
  ipcMain.handle(
    'cache:invalidate-glossary',
    async (_event, version: string): Promise<number> =>
      translationCache.invalidateByGlossaryVersion(version)
  )
}

function registerGlossaryIpc(): void {
  ipcMain.handle('glossary:list', (): GlossaryTerm[] => glossaryStore.list())

  ipcMain.handle('glossary:version', (): string => glossaryStore.getVersion())

  ipcMain.handle(
    'glossary:add',
    async (
      _event,
      args: {
        sourceTerm: string
        targetTerm: string
        description?: string
        domain?: string
        isActive?: boolean
      }
    ): Promise<{ ok: boolean; error?: string; term?: GlossaryTerm }> => {
      const prevVersion = glossaryStore.getVersion()
      const result = await glossaryStore.add(args)
      if (result.ok) {
        await translationCache.invalidateByGlossaryVersion(prevVersion)
      }
      return { ok: result.ok, error: result.error, term: result.term }
    }
  )

  ipcMain.handle(
    'glossary:update',
    async (
      _event,
      args: {
        id: string
        patch: Partial<
          Pick<GlossaryTerm, 'sourceTerm' | 'targetTerm' | 'description' | 'domain' | 'isActive'>
        >
      }
    ): Promise<{ ok: boolean; term?: GlossaryTerm }> => {
      const prevVersion = glossaryStore.getVersion()
      const result = await glossaryStore.update(args.id, args.patch)
      if (result.ok) {
        await translationCache.invalidateByGlossaryVersion(prevVersion)
      }
      return result
    }
  )

  ipcMain.handle('glossary:remove', async (_event, id: string): Promise<boolean> => {
    const prevVersion = glossaryStore.getVersion()
    const removed = await glossaryStore.remove(id)
    if (removed) {
      await translationCache.invalidateByGlossaryVersion(prevVersion)
    }
    return removed
  })

  ipcMain.handle('glossary:clear', async (): Promise<void> => {
    const prevVersion = glossaryStore.getVersion()
    await glossaryStore.clearAll()
    await translationCache.invalidateByGlossaryVersion(prevVersion)
  })

  ipcMain.handle('glossary:export', (): GlossaryExport => glossaryStore.exportTerms())

  ipcMain.handle(
    'glossary:import',
    async (
      _event,
      raw: unknown
    ): Promise<{ ok: boolean; accepted: number; rejected: number; error?: string }> => {
      const prevVersion = glossaryStore.getVersion()
      const result = await glossaryStore.importTerms(raw)
      if (result.ok) {
        await translationCache.invalidateByGlossaryVersion(prevVersion)
      }
      return result
    }
  )
}

async function loadConsentState(): Promise<ConsentState> {
  try {
    const buf = await fs.readFile(consentStatePath, 'utf-8')
    const parsed = JSON.parse(buf) as DiskConsentState
    return {
      globalConsented: !!parsed.globalConsented,
      globalConsentedAt: parsed.globalConsentedAt ?? null,
      policyVersion: parsed.policyVersion ?? POLICY_VERSION
    }
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return { globalConsented: false, globalConsentedAt: null, policyVersion: POLICY_VERSION }
    }
    throw err
  }
}

async function persistConsentState(): Promise<void> {
  await fs.writeFile(consentStatePath, JSON.stringify(consentGate.getState(), null, 2), 'utf-8')
}

function registerConsentIpc(): void {
  ipcMain.handle('consent:get', (): ConsentState => consentGate.getState())

  ipcMain.handle('consent:give', async (): Promise<ConsentState> => {
    const state = consentGate.giveGlobalConsent()
    await persistConsentState()
    return state
  })

  ipcMain.handle('consent:revoke', async (): Promise<void> => {
    consentGate.revokeGlobalConsent()
    await persistConsentState()
  })
}

function registerCredentialIpc(): void {
  ipcMain.handle('credential:list', (): CredentialRecord[] => credentialsStore.list())

  ipcMain.handle(
    'credential:save',
    async (
      _event,
      args: {
        providerType: CredentialProviderType
        displayName: string
        secret: string
        authType: 'oauth' | 'api_key' | 'local'
      }
    ): Promise<CredentialRecord> => {
      const rec = await credentialsStore.upsert(args)
      rebuildProvider(args.providerType)
      return rec
    }
  )

  ipcMain.handle(
    'credential:delete',
    async (_event, providerType: CredentialProviderType): Promise<boolean> => {
      providers.delete(providerType)
      return credentialsStore.remove(providerType)
    }
  )

  ipcMain.handle(
    'credential:validate',
    async (
      _event,
      providerType: CredentialProviderType
    ): Promise<{ ok: boolean; reason?: string }> => {
      const provider = providers.get(providerType)
      if (!provider) return { ok: false, reason: 'Provider 미초기화. credential:save 먼저.' }
      const result = await provider.validate()
      await credentialsStore.markValidated(providerType, result.ok ? 'active' : 'invalid')
      return result
    }
  )
}

function registerPrivacyIpc(): void {
  ipcMain.handle(
    'privacy:scan-page',
    async (
      _event,
      webContentsId: number
    ): Promise<{ hasPasswordField: boolean; hasCardField: boolean } | null> => {
      const wc = WebContentsRegistry.get(webContentsId)
      if (!wc) return null
      try {
        const result = (await wc.executeJavaScript(detectSensitiveFieldsScript())) as {
          hasPasswordField: boolean
          hasCardField: boolean
        }
        return result
      } catch {
        return null
      }
    }
  )

  ipcMain.handle('privacy:approve', (_event, domain: string): { token: string } => {
    const token = consentGate.issueApprovalToken(domain)
    return { token }
  })

  ipcMain.handle(
    'privacy:add-rule',
    async (_event, rule: DomainFilterRule): Promise<{ ok: boolean; error?: string }> => {
      const result = await domainPolicyStore.addRule(rule)
      return { ok: result.ok, error: result.error }
    }
  )

  ipcMain.handle(
    'privacy:remove-rule',
    async (_event, args: { pattern: string; type: 'blacklist' | 'whitelist' }): Promise<void> => {
      await domainPolicyStore.removeRule({ pattern: args.pattern, type: args.type })
    }
  )

  ipcMain.handle('privacy:get-rules', (): DomainFilterState => domainPolicyStore.getState())

  ipcMain.handle(
    'privacy:set-rules',
    async (_event, rules: DomainFilterRule[]): Promise<{ accepted: number; rejected: number }> =>
      domainPolicyStore.setRules(rules)
  )

  ipcMain.handle(
    'privacy:export-policy',
    (): DomainPolicyExport => domainPolicyStore.exportPolicy()
  )

  ipcMain.handle(
    'privacy:import-policy',
    async (
      _event,
      raw: unknown
    ): Promise<{ ok: boolean; accepted: number; rejected: number; error?: string }> =>
      domainPolicyStore.importPolicy(raw)
  )

  ipcMain.handle('privacy:clear-policy', async (): Promise<void> => domainPolicyStore.clearAll())

  ipcMain.handle('privacy:blocked-stats', () => transmissionLogger.getBlockedStats())
}

function registerUsageIpc(): void {
  ipcMain.handle('usage:summary', async (_event, sinceMs?: number) => usageLog.summarize(sinceMs))
  ipcMain.handle('usage:list', async (_event, sinceMs?: number) =>
    sinceMs ? usageLog.readSince(sinceMs) : usageLog.readAll()
  )
  ipcMain.handle('usage:clear-all', async (): Promise<void> => {
    await usageLog.clearAll()
  })
  ipcMain.handle(
    'usage:purge-older-than',
    async (_event, beforeMs: number): Promise<number> => usageLog.purgeOlderThan(beforeMs)
  )
}

interface TranslateArgs {
  providerType: CredentialProviderType
  input: TranslationInput
  context: {
    url: string
    hasPasswordField?: boolean
    hasCardField?: boolean
    manualApprovalToken?: string
  }
}

export interface TranslateResult {
  ok: boolean
  output?: TranslationOutput
  decision: PrivacyDecision | 'no_provider' | 'provider_error'
  reason?: string
  fromCache?: boolean
  /**
   * Sprint 003 M1: 차단 시에만 의미. true면 페이지 전체 차단 (호출자가 일괄 중단).
   * `decision !== 'blocked'` 시 undefined.
   */
  pageWideBlock?: boolean
  /**
   * Sprint 003 M1: 차단 사유 enum (UI 분기용). 차단 외에는 'none'.
   */
  blockReason?: import('../privacy/types').BlockReason
}

export async function executeTranslateRequest(args: TranslateArgs): Promise<TranslateResult> {
  const domain = extractDomain(args.context.url)

  // Sprint 007 M1 — privacyFilterEnabled false 시 domain 차단 우회.
  // 단, password/card 본문 패턴은 항상 적용 (G-004 안전 정책 무력화 금지).
  const userSetting = userSettingStore.getState()
  const evalDomains = userSetting.privacyFilterEnabled ? domainFilter : new DomainFilter()
  const evalContext = userSetting.privacyFilterEnabled
    ? {
        url: args.context.url,
        domain,
        hasPasswordField: args.context.hasPasswordField ?? false,
        hasCardField: args.context.hasCardField ?? false,
        manualApprovalToken: args.context.manualApprovalToken
      }
    : {
        url: args.context.url,
        domain,
        hasPasswordField: args.context.hasPasswordField ?? false,
        hasCardField: args.context.hasCardField ?? false
      }

  const evaluation = evaluatePrivacy({
    context: evalContext,
    text: args.input.sourceText,
    consent: consentGate,
    domains: evalDomains
  })

  if (evaluation.decision === 'blocked') {
    transmissionLogger.recordBlock({
      timestamp: Date.now(),
      url: args.context.url,
      domain,
      decision: 'blocked',
      feature: 'translation',
      reason: evaluation.reason
    })
    return {
      ok: false,
      decision: 'blocked',
      reason: evaluation.reason,
      pageWideBlock: evaluation.pageWideBlock,
      blockReason: evaluation.blockReason
    }
  }

  // Sprint 005 M2 — 활성 용어집 추출. explanation/summary는 의역이라 적용 안 함.
  const applyGlossary =
    args.input.requestType !== 'explanation' && args.input.requestType !== 'summary'
  const glossaryVersion = applyGlossary ? glossaryStore.getVersion() : 'default'
  const glossaryTerms: GlossaryTerm[] = applyGlossary
    ? glossaryStore.getActiveForDomain(domain || null)
    : []
  const glossaryContext = formatGlossaryContext(glossaryTerms)

  // Cache lookup (Privacy Filter 통과 후, Provider 호출 전).
  // Sprint 005 M1: 캐시 키에 requestType 포함 → explanation/summary도 정상 캐싱.
  // Sprint 005 M2: glossaryVersion이 키의 일부 → 용어집 mutation 시 자동 invalidation.
  const cached = await translationCache.lookup({
    sourceText: args.input.sourceText,
    sourceLanguage: args.input.sourceLanguage,
    targetLanguage: args.input.targetLanguage,
    providerType: args.providerType,
    requestType: args.input.requestType,
    glossaryVersion
  })
  if (cached) {
    return {
      ok: true,
      decision: evaluation.decision,
      fromCache: true,
      output: {
        translatedText: cached.translatedText,
        modelUsed: `${args.providerType}/cache`,
        inputTokens: 0,
        outputTokens: 0,
        estimatedCostUsd: 0,
        durationMs: 0
      }
    }
  }

  const usageFeature: import('../storage').Feature = featureFromRequestType(args.input.requestType)

  const provider = providers.get(args.providerType)
  if (!provider) {
    return {
      ok: false,
      decision: 'no_provider',
      reason: `Provider 미초기화: ${args.providerType}. 설정에서 등록해 주세요.`
    }
  }

  try {
    const inputWithGlossary = glossaryContext
      ? {
          ...args.input,
          context: {
            ...(args.input.context ?? {}),
            surroundingText: [args.input.context?.surroundingText, glossaryContext]
              .filter(Boolean)
              .join('\n\n')
          }
        }
      : args.input
    const output = await provider.translate(inputWithGlossary)
    await translationCache.store({
      sourceText: args.input.sourceText,
      sourceLanguage: args.input.sourceLanguage,
      targetLanguage: args.input.targetLanguage,
      providerType: args.providerType,
      requestType: args.input.requestType,
      glossaryVersion,
      translatedText: output.translatedText,
      domain,
      isSubtitle: args.input.requestType === 'subtitle'
    })
    await usageLog.append({
      providerId: provider.info.providerType,
      feature: usageFeature,
      inputTokens: output.inputTokens,
      outputTokens: output.outputTokens,
      audioSeconds: 0,
      estimatedCostUsd: output.estimatedCostUsd,
      domain,
      privacyDecision: evaluation.decision,
      status: 'success'
    })
    await transmissionLogger.append({
      timestamp: Date.now(),
      url: args.context.url,
      domain,
      decision: evaluation.decision,
      feature: usageFeature,
      providerId: provider.info.providerType
    })
    return { ok: true, output, decision: evaluation.decision }
  } catch (err) {
    const errorCode = err instanceof ProviderError ? err.code : 'unknown'
    await usageLog.append({
      providerId: provider.info.providerType,
      feature: usageFeature,
      inputTokens: 0,
      outputTokens: 0,
      audioSeconds: 0,
      estimatedCostUsd: 0,
      domain,
      privacyDecision: evaluation.decision,
      status: 'failed',
      errorCode
    })
    return {
      ok: false,
      decision: 'provider_error',
      reason: err instanceof Error ? err.message : String(err)
    }
  }
}

/**
 * Sprint 004 M2/M3 — requestType → UsageLog feature 매핑.
 */
function featureFromRequestType(
  requestType: import('../ai/types').RequestType
): import('../storage').Feature {
  if (requestType === 'explanation') return 'explanation'
  if (requestType === 'summary') return 'summary'
  return 'translation'
}

// Sprint 015 M2-8 — retired WebContents extraction helper exports 제거.
//   M2-5/M2-6 페이지 번역 폐기 후 호출자 0. M3 IndexingService 가 perception/PageNodeExtractor 와 ParagraphExtractor 모듈을 직접 import 활용.

/**
 * 외부 페이지(WebContentsView)에서 민감 필드를 스캔한다.
 * 본문 카드 패턴은 sourceText에 대해 evaluatePrivacy 안에서 별도로 평가됨.
 */
export async function scanWebContentsFields(
  webContentsId: number
): Promise<{ hasPasswordField: boolean; hasCardField: boolean }> {
  const wc = WebContentsRegistry.get(webContentsId)
  if (!wc) return { hasPasswordField: false, hasCardField: false }
  try {
    const scan = (await wc.executeJavaScript(detectSensitiveFieldsScript())) as {
      hasPasswordField: boolean
      hasCardField: boolean
    }
    return {
      hasPasswordField: !!scan?.hasPasswordField,
      hasCardField: !!scan?.hasCardField
    }
  } catch {
    return { hasPasswordField: false, hasCardField: false }
  }
}

function registerTranslateIpc(): void {
  ipcMain.handle(
    'translate:request',
    async (_event, args: TranslateArgs): Promise<TranslateResult> => {
      return executeTranslateRequest(args)
    }
  )
}

function rebuildProvider(providerType: CredentialProviderType): void {
  if (providerType === 'openai') {
    providers.set(
      'openai',
      new OpenAIApiKeyProvider(() => credentialsStore.decryptSecret('openai'))
    )
  }
  if (providerType === 'codex') {
    providers.set('codex', new CodexLoginProvider({ tokenAccess: makeCodexTokenAccess() }))
  }
}

/**
 * Sprint 014 M2 — Codex 토큰 묶음을 CredentialsStore (safeStorage 암호화) 위에 JSON으로 저장.
 * G-005 OS Keychain 위임.
 */
function makeCodexTokenAccess(): CodexTokenAccess {
  return {
    get(): TokenBundle {
      const raw = credentialsStore.decryptSecret('codex')
      const parsed = JSON.parse(raw) as TokenBundle
      return parsed
    },
    update(bundle: TokenBundle): void {
      // 비동기 upsert 트리거 (CodexLoginProvider는 fire-and-forget으로 호출). 다음 get은 갱신된 값.
      void credentialsStore.upsert({
        providerType: 'codex',
        displayName: 'Codex Login (Experimental)',
        authType: 'oauth',
        secret: JSON.stringify(bundle)
      })
    }
  }
}

/**
 * Sprint 014 M2 — Codex 로그인 세션 상태. main process에서 폴링 진행 관리.
 */
type CodexLoginStatus = 'idle' | 'pending' | 'success' | 'expired' | 'denied' | 'error'

interface CodexLoginSession {
  status: CodexLoginStatus
  deviceAuthId?: string
  userCode?: string
  verificationUrl?: string
  intervalSec?: number
  startedAt?: number
  errorReason?: string
}

let codexLoginSession: CodexLoginSession = { status: 'idle' }
let codexPollTimer: NodeJS.Timeout | null = null

function clearCodexPolling(): void {
  if (codexPollTimer) {
    clearTimeout(codexPollTimer)
    codexPollTimer = null
  }
}

async function pollCodexLoop(
  flow: DeviceCodeFlow,
  deviceAuthId: string,
  userCode: string,
  intervalSec: number,
  deadlineMs: number
): Promise<void> {
  const tick = async (): Promise<void> => {
    if (codexLoginSession.deviceAuthId !== deviceAuthId) return // 새 세션 시작됨, 종료
    if (Date.now() > deadlineMs) {
      codexLoginSession = { status: 'expired', errorReason: '15분 시간 초과' }
      return
    }
    const result = await flow.pollOnce(deviceAuthId, userCode)
    if (codexLoginSession.deviceAuthId !== deviceAuthId) return // 중간 취소
    if (result.status === 'pending') {
      codexPollTimer = setTimeout(() => void tick(), intervalSec * 1000)
      return
    }
    if (result.status === 'success') {
      try {
        const tokens = await flow.exchangeTokens({
          authorizationCode: result.authorizationCode,
          codeVerifier: result.codeVerifier
        })
        await credentialsStore.upsert({
          providerType: 'codex',
          displayName: 'Codex Login (Experimental)',
          authType: 'oauth',
          secret: JSON.stringify(tokens)
        })
        rebuildProvider('codex')
        // Sprint 014 M3-5 핫픽스 — 로그인 성공 시 defaultProviderId 자동 'codex' 전환.
        // openai credential이 없을 때만 자동 전환 (있으면 사용자 명시 선택 유지).
        try {
          if (!credentialsStore.has('openai')) {
            await userSettingStore.update({ defaultProviderId: 'codex' })
          }
        } catch {
          // 자동 전환 실패는 로그인 자체엔 영향 없음
        }
        codexLoginSession = { status: 'success' }
      } catch (err) {
        codexLoginSession = {
          status: 'error',
          errorReason: `토큰 교환 실패: ${err instanceof Error ? err.message : String(err)}`
        }
      }
      return
    }
    // error / denied / timeout
    codexLoginSession = {
      status: result.status === 'denied' ? 'denied' : 'error',
      errorReason: result.reason ?? '폴링 오류'
    }
  }
  await tick()
}

function registerCodexIpc(): void {
  const flow = new DeviceCodeFlow()
  ipcMain.handle('codex:start-login', async (): Promise<UserCodeResult> => {
    clearCodexPolling()
    const uc = await flow.requestUserCode()
    const deadlineMs = Date.now() + 15 * 60 * 1000
    codexLoginSession = {
      status: 'pending',
      deviceAuthId: uc.deviceAuthId,
      userCode: uc.userCode,
      verificationUrl: uc.verificationUrl,
      intervalSec: uc.interval,
      startedAt: Date.now()
    }
    // 폴링 시작 (fire-and-forget)
    void pollCodexLoop(flow, uc.deviceAuthId, uc.userCode, uc.interval, deadlineMs)
    return uc
  })

  ipcMain.handle('codex:poll-status', (): { status: CodexLoginStatus; errorReason?: string } => {
    return { status: codexLoginSession.status, errorReason: codexLoginSession.errorReason }
  })

  ipcMain.handle('codex:cancel-login', (): void => {
    clearCodexPolling()
    codexLoginSession = { status: 'idle' }
  })

  ipcMain.handle('codex:logout', async (): Promise<boolean> => {
    clearCodexPolling()
    const removed = await credentialsStore.remove('codex')
    providers.delete('codex')
    codexLoginSession = { status: 'idle' }
    return removed
  })

  ipcMain.handle('codex:status', (): 'active' | 'expired' | 'none' => {
    if (!credentialsStore.has('codex')) return 'none'
    const rec = credentialsStore.list().find((r) => r.providerType === 'codex')
    return rec?.status === 'active' ? 'active' : 'expired'
  })
}

export function rebuildAllProviders(): void {
  for (const rec of credentialsStore.list()) {
    if (rec.status === 'active') {
      rebuildProvider(rec.providerType)
    }
  }
}

export function extractDomain(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase()
  } catch {
    return ''
  }
}

export const WebContentsRegistry = new (class {
  private map = new Map<number, WebContents>()
  register(wc: WebContents): void {
    this.map.set(wc.id, wc)
    wc.once('destroyed', () => this.map.delete(wc.id))
  }
  get(id: number): WebContents | undefined {
    return this.map.get(id)
  }
})()
