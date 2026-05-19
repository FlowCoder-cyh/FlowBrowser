/**
 * Sprint 015 M5-6 — chat IPC handler pure logic.
 *
 * `services.ts` 의 `chat:request` / `chat:list-history` IPC handler 를 pure 함수로 추출.
 * 단위 테스트 가능 — Electron `ipcMain` 의존 없음.
 *
 * 책임:
 *   1. handleChatRequest — workspace 메모리 retrieval (옵션) → ChatService.chat() → SerializedChatRow
 *   2. handleChatListHistory — AiChatHistoryStore.listByWorkspace → SerializedChatRow[]
 *
 * 의존 주입 — 호출자 (services.ts) 가 모든 의존을 lazy resolver 로 주입.
 * provider 미초기화 / search 인프라 미초기화 케이스에서 graceful error 반환.
 */

import type { ChatService } from './ChatService'
import type { AiChatHistoryStore, ChatRow, RetrievedItem } from '../storage/AiChatHistoryStore'
import type { LevelPreference } from '../storage/Database'

export type ChatRequestErrorCode =
  | 'byok_required'
  | 'chat_unsupported'
  | 'provider_error'
  | 'invalid_input'

/** ChatRow 의 IPC serializable 표현 — RetrievedItem 은 plain object 라 그대로 전달. */
export interface SerializedChatRow {
  id: string
  workspaceId: string
  pageId: string | null
  visitId: string | null
  role: 'user' | 'assistant' | 'system' | 'error'
  content: string
  retrievedItems: RetrievedItem[] | null
  /** chat_meta JSON — Markdown + 표 schema `{rows, columns, cells: [{value, sources}]}`. M5-6 후속 PR 에서 채워짐. */
  chatMeta: unknown | null
  status: 'ok' | 'pending' | 'failed' | 'aborted'
  createdAt: number
}

export type ChatRequestStatus = 'ok' | 'error'

export interface ChatRequestArgs {
  /** 현재 활성 워크스페이스 UUID. 미주입 시 default. */
  workspaceId?: string
  userMessage: string
  /** anchor — 페이지 컨텍스트 안에서의 대화 (nullable). */
  pageId?: string | null
  visitId?: string | null
  /** PromptComposer 옵션 — 사용자 수준 / 추가 지시 / 명시 retrieved items override. */
  levelPreference?: LevelPreference
  customSystemPrompt?: string
  modelHint?: string
  /** 사용자 명시 동의 시 Codex 허용 등 (KI-003). 미주입 시 ChatService 디폴트 ['openai']. */
  allowedProviders?: ReadonlyArray<'openai' | 'codex' | 'anthropic' | 'gemini' | 'local'>
}

export interface ChatRequestResponse {
  status: ChatRequestStatus
  /** 성공 시 user + assistant (또는 error) 2 메시지. */
  messages?: SerializedChatRow[]
  error?: string
  errorCode?: ChatRequestErrorCode
}

/** chat:request 의존 주입. */
export interface ChatRequestDeps {
  getActiveWorkspaceId(): string | null
  /** lazy ChatService — provider 갱신 / 인프라 미초기화 대응. */
  getChatService(opts: { allowedProviders?: ReadonlyArray<string> }): ChatService | null
  historyStore: AiChatHistoryStore | null
}

export async function handleChatRequest(
  args: ChatRequestArgs,
  deps: ChatRequestDeps
): Promise<ChatRequestResponse> {
  const workspaceId = args.workspaceId ?? deps.getActiveWorkspaceId()
  if (!workspaceId) {
    return {
      status: 'error',
      error: '워크스페이스가 초기화되지 않았습니다.',
      errorCode: 'invalid_input'
    }
  }
  if (!deps.historyStore) {
    return {
      status: 'error',
      error: '채팅 인프라가 아직 준비되지 않았습니다.',
      errorCode: 'invalid_input'
    }
  }
  const service = deps.getChatService({
    allowedProviders: args.allowedProviders
  })
  if (!service) {
    return {
      status: 'error',
      error: 'OpenAI API Key 가 등록되지 않았습니다. 설정에서 등록해 주세요.',
      errorCode: 'byok_required'
    }
  }

  const result = await service.chat({
    workspaceId,
    userMessage: args.userMessage,
    pageId: args.pageId ?? null,
    visitId: args.visitId ?? null,
    prompt: {
      levelPreference: args.levelPreference,
      customSystemPrompt: args.customSystemPrompt
    },
    modelHint: args.modelHint
  })

  if (!result.ok) {
    // 실패 — user 메시지 + error 메시지 영속된 경우 두 row 모두 반환 (UI timeline 표시)
    const messages: SerializedChatRow[] = []
    if (result.userChatId) {
      const userRow = deps.historyStore.findById(result.userChatId)
      if (userRow) messages.push(toSerialized(userRow))
    }
    if (result.assistantChatId) {
      const errorRow = deps.historyStore.findById(result.assistantChatId)
      if (errorRow) messages.push(toSerialized(errorRow))
    }
    return {
      status: 'error',
      messages: messages.length > 0 ? messages : undefined,
      error: result.error,
      errorCode: result.errorCode
    }
  }

  const userRow = deps.historyStore.findById(result.userChatId)
  const assistantRow = deps.historyStore.findById(result.assistantChatId)
  const messages: SerializedChatRow[] = []
  if (userRow) messages.push(toSerialized(userRow))
  if (assistantRow) messages.push(toSerialized(assistantRow))

  return { status: 'ok', messages }
}

export interface ChatListHistoryArgs {
  workspaceId?: string
}

export interface ChatListHistoryResponse {
  messages: SerializedChatRow[]
}

export interface ChatListHistoryDeps {
  getActiveWorkspaceId(): string | null
  historyStore: AiChatHistoryStore | null
}

export function handleChatListHistory(
  args: ChatListHistoryArgs,
  deps: ChatListHistoryDeps
): ChatListHistoryResponse {
  if (!deps.historyStore) return { messages: [] }
  const workspaceId = args.workspaceId ?? deps.getActiveWorkspaceId()
  if (!workspaceId) return { messages: [] }
  const rows = deps.historyStore.listByWorkspace(workspaceId)
  return { messages: rows.map(toSerialized) }
}

function toSerialized(row: ChatRow): SerializedChatRow {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    pageId: row.page_id,
    visitId: row.visit_id,
    role: row.role,
    content: row.content,
    retrievedItems: row.retrieved_items,
    chatMeta: row.chat_meta,
    status: row.status,
    createdAt: row.created_at
  }
}
