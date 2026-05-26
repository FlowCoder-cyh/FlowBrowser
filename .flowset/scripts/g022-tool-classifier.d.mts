export interface G022ClassifyResult {
  action: 'allow' | 'block';
  reason: string | null;
}

export interface G022Intent {
  advisory?: 'ALLOW_ENTRY' | 'BLOCK_ENTRY' | 'NEUTRAL';
}

export function isCloseoutPath(filePath: string, root?: string): boolean;

export function shellWriteTargetsCloseout(sub: string, root?: string): boolean;

export function extractCommitMessage(command: string): string | null;

export function extractCommitType(message: string): string | null;

export function classifyToolForG022(
  toolName: string,
  toolInput: Record<string, unknown> | null | undefined,
  intent: G022Intent | null | undefined,
  root?: string
): G022ClassifyResult;
