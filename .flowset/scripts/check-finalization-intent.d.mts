export interface FinalizationIntentResult {
  hasEntryIntent: boolean;
  hasFinalizationSignal: boolean;
  hasAutonomousDelegation: boolean;
  signals: Partial<Record<'종결' | '지연' | '핸드오프' | '추궁', true>>;
  advisory: 'ALLOW_ENTRY' | 'BLOCK_ENTRY' | 'NEUTRAL';
}

export function detectFinalizationIntent(utterance: string): FinalizationIntentResult;
