export interface PreToolUsePayload {
  tool_name?: string;
  tool_input?: Record<string, unknown> | null;
  transcript_path?: string;
  cwd?: string;
  hook_event_name?: string;
}

export interface UserUtterance {
  text: string;
  timestamp: string | null;
  uuid: string | null;
}

export interface G022GateResult {
  block: boolean;
  reason: string | null;
}

export interface ShellChecksResult {
  warnings: string[];
  blocks: string[];
}

export function resolveLatestUtterance(
  payload: PreToolUsePayload | null | undefined,
  root?: string
): UserUtterance | null;

export function evaluateG022Gate(
  payload: PreToolUsePayload | null | undefined,
  root?: string
): G022GateResult;

export function evaluateShellChecks(command: string): ShellChecksResult;
