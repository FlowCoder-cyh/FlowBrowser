/**
 * Provider Credential 저장소.
 * G-005 / PRD §12.2: secret 자체는 앱이 보관하지 않음.
 * Electron `safeStorage` API에 위임 — macOS Keychain / Windows DPAPI.
 *
 * 본 모듈은 Main 프로세스 전용. Renderer는 IPC를 통해서만 접근.
 */

import { safeStorage } from 'electron'
import { promises as fs } from 'node:fs'
import { join, dirname } from 'node:path'

export type ProviderType = 'openai' | 'anthropic' | 'gemini' | 'deepl' | 'elevenlabs' | 'codex' | 'local'

export interface CredentialRecord {
  id: string
  providerType: ProviderType
  displayName: string
  authType: 'oauth' | 'api_key' | 'local'
  status: 'active' | 'expired' | 'invalid' | 'disabled'
  lastValidatedAt: number | null
  createdAt: number
  updatedAt: number
}

interface PersistedRecord extends CredentialRecord {
  encryptedSecret: string // base64. 평문 secret 미보관 (safeStorage 암호)
}

export class CredentialsStore {
  private records: PersistedRecord[] = []
  private loaded = false

  constructor(private storagePath: string) {}

  async load(): Promise<void> {
    try {
      const buf = await fs.readFile(this.storagePath, 'utf-8')
      const parsed = JSON.parse(buf) as PersistedRecord[]
      this.records = Array.isArray(parsed) ? parsed : []
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        this.records = []
      } else {
        throw err
      }
    }
    this.loaded = true
  }

  private ensureLoaded(): void {
    if (!this.loaded) {
      throw new Error('CredentialsStore.load() not called')
    }
  }

  list(): CredentialRecord[] {
    this.ensureLoaded()
    return this.records.map((r) => this.toPublic(r))
  }

  has(providerType: ProviderType): boolean {
    this.ensureLoaded()
    return this.records.some((r) => r.providerType === providerType && r.status === 'active')
  }

  /**
   * 신규 등록 또는 갱신.
   * secret은 safeStorage로 암호화되어 저장. 평문 secret은 반환 직후 폐기.
   */
  async upsert(args: {
    providerType: ProviderType
    displayName: string
    secret: string
    authType: 'oauth' | 'api_key' | 'local'
  }): Promise<CredentialRecord> {
    this.ensureLoaded()
    if (!safeStorage.isEncryptionAvailable()) {
      throw new Error('safeStorage encryption is not available on this OS')
    }

    const encrypted = safeStorage.encryptString(args.secret).toString('base64')
    const now = Date.now()
    const existing = this.records.find((r) => r.providerType === args.providerType)

    if (existing) {
      existing.encryptedSecret = encrypted
      existing.displayName = args.displayName
      existing.authType = args.authType
      existing.status = 'active'
      existing.updatedAt = now
      existing.lastValidatedAt = null
    } else {
      const rec: PersistedRecord = {
        id: cryptoRandomId(),
        providerType: args.providerType,
        displayName: args.displayName,
        authType: args.authType,
        status: 'active',
        lastValidatedAt: null,
        createdAt: now,
        updatedAt: now,
        encryptedSecret: encrypted
      }
      this.records.push(rec)
    }

    await this.persist()
    const rec = this.records.find((r) => r.providerType === args.providerType)!
    return this.toPublic(rec)
  }

  /**
   * 평문 secret을 호출자가 즉시 사용하고 폐기하도록 반환.
   * 메모리에 오래 보관 금지.
   */
  decryptSecret(providerType: ProviderType): string {
    this.ensureLoaded()
    const rec = this.records.find((r) => r.providerType === providerType && r.status === 'active')
    if (!rec) {
      throw new Error(`No active credential for provider: ${providerType}`)
    }
    if (!safeStorage.isEncryptionAvailable()) {
      throw new Error('safeStorage encryption is not available on this OS')
    }
    const buf = Buffer.from(rec.encryptedSecret, 'base64')
    return safeStorage.decryptString(buf)
  }

  async remove(providerType: ProviderType): Promise<boolean> {
    this.ensureLoaded()
    const before = this.records.length
    this.records = this.records.filter((r) => r.providerType !== providerType)
    if (this.records.length === before) return false
    await this.persist()
    return true
  }

  async markValidated(providerType: ProviderType, status: CredentialRecord['status']): Promise<void> {
    this.ensureLoaded()
    const rec = this.records.find((r) => r.providerType === providerType)
    if (!rec) return
    rec.status = status
    rec.lastValidatedAt = Date.now()
    rec.updatedAt = Date.now()
    await this.persist()
  }

  private async persist(): Promise<void> {
    await fs.mkdir(dirname(this.storagePath), { recursive: true })
    await fs.writeFile(this.storagePath, JSON.stringify(this.records, null, 2), 'utf-8')
  }

  private toPublic(rec: PersistedRecord): CredentialRecord {
    const { encryptedSecret: _drop, ...rest } = rec
    void _drop
    return rest
  }
}

function cryptoRandomId(): string {
  return `cred_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`
}

export function defaultCredentialsPath(userDataDir: string): string {
  return join(userDataDir, 'credentials.json')
}
