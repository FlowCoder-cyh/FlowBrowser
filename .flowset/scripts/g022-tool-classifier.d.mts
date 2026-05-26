export interface G022ClassifyResult {
  action: 'allow' | 'block';
  reason: string | null;
}

export interface G022Intent {
  advisory?: 'ALLOW_ENTRY' | 'BLOCK_ENTRY' | 'NEUTRAL';
}

export function isCloseoutPath(filePath: string): boolean;

export function commandTargetsCloseout(command: string): boolean;

export function extractCommitMessage(command: string): string | null;

export function extractCommitType(message: string): string | null;

export function classifyToolForG022(
  toolName: string,
  toolInput: Record<string, unknown> | null | undefined,
  intent: G022Intent | null | undefined
): G022ClassifyResult;
