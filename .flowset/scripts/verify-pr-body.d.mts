export function parseMatrixTable(prBody: string): Array<{ path: string; plus: number; minus: number }> | null;
export function parseTotalLine(prBody: string): { plus: number; minus: number; files: number } | null;
export function parseNumstat(numstatText: string): Array<{
  path: string;
  plus: number | null;
  minus: number | null;
  binary: boolean;
}>;
export function verifyG018(prBody: string, numstatText: string): string[];
export function verifyG021(prBody: string): string[];
