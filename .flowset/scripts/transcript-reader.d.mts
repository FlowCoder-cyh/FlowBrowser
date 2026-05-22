export function cwdToProjectKey(cwd: string): string;

export interface DiscoverResult {
  source: string | null;
  reason: string | null;
}

export function discoverTranscriptSource(cwd: string): DiscoverResult;

export interface DiscoverCandidatesResult {
  candidates: string[];
  reason: string | null;
}

export function discoverTranscriptSourceCandidates(cwd: string): DiscoverCandidatesResult;

export interface Utterance {
  text: string;
  timestamp: string | null;
  uuid: string | null;
}

export interface ExtractResult {
  utterances: Utterance[];
  reason: string | null;
}

export function extractRecentUserUtterances(sourcePath: string | null, n?: number): ExtractResult;
