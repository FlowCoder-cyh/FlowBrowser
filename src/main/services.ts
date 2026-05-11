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
  TransmissionLogger,
  defaultLogFilePath,
  evaluatePrivacy,
  detectSensitiveFieldsScript,
  type ConsentState,
  type DomainFilterRule,
  type DomainFilterState,
  type PrivacyDecision
} from '../privacy'

import {
  CredentialsStore,
  UsageLog,
  TranslationCache,
  defaultCredentialsPath,
  defaultUsageLogPath,
  defaultTranslationCachePath,
  type CredentialRecord,
  type CredentialProviderType
} from '../storage'

import {
  OpenAIApiKeyProvider,
  ProviderError,
  type ProviderAdapter,
  type TranslationInput,
  type TranslationOutput
} from '../ai'

interface DiskConsentState {
  globalConsented: boolean
  globalConsentedAt: number | null
  policyVersion: number
}

const POLICY_VERSION = 1

let consentGate!: ConsentGate
let domainFilter!: DomainFilter
let transmissionLogger!: TransmissionLogger
let credentialsStore!: CredentialsStore
let usageLog!: UsageLog
let translationCache!: TranslationCache
const providers: Map<CredentialProviderType, ProviderAdapter> = new Map()

let consentStatePath!: string
let domainStatePath!: string

export async function initServices(): Promise<void> {
  const userDataDir = app.getPath('userData')
  consentStatePath = join(userDataDir, 'consent.json')
  domainStatePath = join(userDataDir, 'domain-filter.json')

  consentGate = new ConsentGate(await loadConsentState(), POLICY_VERSION)
  domainFilter = new DomainFilter(await loadDomainState())

  transmissionLogger = new TransmissionLogger(defaultLogFilePath(userDataDir))
  await transmissionLogger.loadFromDisk()

  credentialsStore = new CredentialsStore(defaultCredentialsPath(userDataDir))
  await credentialsStore.load()

  usageLog = new UsageLog(defaultUsageLogPath(userDataDir))

  translationCache = new TranslationCache(defaultTranslationCachePath(userDataDir))
  await translationCache.load()

  registerConsentIpc()
  registerCredentialIpc()
  registerPrivacyIpc()
  registerUsageIpc()
  registerTranslateIpc()
  registerCacheIpc()
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

async function loadDomainState(): Promise<DomainFilterState> {
  try {
    const buf = await fs.readFile(domainStatePath, 'utf-8')
    const parsed = JSON.parse(buf) as DomainFilterState
    return { userRules: Array.isArray(parsed.userRules) ? parsed.userRules : [] }
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return { userRules: [] }
    throw err
  }
}

async function persistDomainState(): Promise<void> {
  await fs.writeFile(domainStatePath, JSON.stringify(domainFilter.getState(), null, 2), 'utf-8')
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

  ipcMain.handle('credential:save', async (
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
  })

  ipcMain.handle('credential:delete', async (
    _event,
    providerType: CredentialProviderType
  ): Promise<boolean> => {
    providers.delete(providerType)
    return credentialsStore.remove(providerType)
  })

  ipcMain.handle('credential:validate', async (
    _event,
    providerType: CredentialProviderType
  ): Promise<{ ok: boolean; reason?: string }> => {
    const provider = providers.get(providerType)
    if (!provider) return { ok: false, reason: 'Provider 미초기화. credential:save 먼저.' }
    const result = await provider.validate()
    await credentialsStore.markValidated(providerType, result.ok ? 'active' : 'invalid')
    return result
  })
}

function registerPrivacyIpc(): void {
  ipcMain.handle('privacy:scan-page', async (
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
  })

  ipcMain.handle('privacy:approve', (
    _event,
    domain: string
  ): { token: string } => {
    const token = consentGate.issueApprovalToken(domain)
    return { token }
  })

  ipcMain.handle('privacy:add-rule', async (
    _event,
    rule: DomainFilterRule
  ): Promise<void> => {
    domainFilter.addUserRule(rule)
    await persistDomainState()
  })

  ipcMain.handle('privacy:remove-rule', async (
    _event,
    args: { pattern: string; type: 'blacklist' | 'whitelist' }
  ): Promise<void> => {
    domainFilter.removeUserRule(args.pattern, args.type)
    await persistDomainState()
  })

  ipcMain.handle('privacy:get-rules', (): DomainFilterState => domainFilter.getState())

  ipcMain.handle('privacy:blocked-stats', () => transmissionLogger.getBlockedStats())
}

function registerUsageIpc(): void {
  ipcMain.handle('usage:summary', async (_event, sinceMs?: number) =>
    usageLog.summarize(sinceMs)
  )
  ipcMain.handle('usage:list', async (_event, sinceMs?: number) =>
    sinceMs ? usageLog.readSince(sinceMs) : usageLog.readAll()
  )
  ipcMain.handle('usage:clear-all', async (): Promise<void> => {
    await usageLog.clearAll()
  })
  ipcMain.handle('usage:purge-older-than', async (_event, beforeMs: number): Promise<number> =>
    usageLog.purgeOlderThan(beforeMs)
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
}

export async function executeTranslateRequest(args: TranslateArgs): Promise<TranslateResult> {
  const domain = extractDomain(args.context.url)

  const evaluation = evaluatePrivacy({
    context: {
      url: args.context.url,
      domain,
      hasPasswordField: args.context.hasPasswordField ?? false,
      hasCardField: args.context.hasCardField ?? false,
      manualApprovalToken: args.context.manualApprovalToken
    },
    text: args.input.sourceText,
    consent: consentGate,
    domains: domainFilter
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
    return { ok: false, decision: 'blocked', reason: evaluation.reason }
  }

  // Cache lookup (Privacy Filter 통과 후, Provider 호출 전)
  const cached = await translationCache.lookup({
    sourceText: args.input.sourceText,
    sourceLanguage: args.input.sourceLanguage,
    targetLanguage: args.input.targetLanguage,
    providerType: args.providerType,
    glossaryVersion: undefined
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

  const provider = providers.get(args.providerType)
  if (!provider) {
    return {
      ok: false,
      decision: 'no_provider',
      reason: `Provider 미초기화: ${args.providerType}. 설정에서 등록해 주세요.`
    }
  }

  try {
    const output = await provider.translate(args.input)
    await translationCache.store({
      sourceText: args.input.sourceText,
      sourceLanguage: args.input.sourceLanguage,
      targetLanguage: args.input.targetLanguage,
      providerType: args.providerType,
      translatedText: output.translatedText,
      domain,
      isSubtitle: args.input.requestType === 'subtitle'
    })
    await usageLog.append({
      providerId: provider.info.providerType,
      feature: 'translation',
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
      feature: 'translation',
      providerId: provider.info.providerType
    })
    return { ok: true, output, decision: evaluation.decision }
  } catch (err) {
    const errorCode = err instanceof ProviderError ? err.code : 'unknown'
    await usageLog.append({
      providerId: provider.info.providerType,
      feature: 'translation',
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
  ipcMain.handle('translate:request', async (_event, args: TranslateArgs): Promise<TranslateResult> => {
    return executeTranslateRequest(args)
  })
}

function rebuildProvider(providerType: CredentialProviderType): void {
  if (providerType === 'openai') {
    providers.set(
      'openai',
      new OpenAIApiKeyProvider(() => credentialsStore.decryptSecret('openai'))
    )
  }
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
