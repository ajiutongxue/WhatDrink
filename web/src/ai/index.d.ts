export type AIOptions = {
  signal?: AbortSignal;
  onError?: (error: Error) => void;
};

export type ParsedInput = {
  city: string | null;
  states: string[];
  avoidCats: string[];
  avoidTeas: number[];
  preferCats: string[];
  strongPreferCats: string[];
  mood: 'light' | 'strong' | 'sweet' | null;
};

export type TeaCandidate = {
  id: number;
  name: string;
  brand?: string;
  cat?: string;
  nature?: string;
  baseNature?: string;
  caffeine?: string;
  year?: number | null;
  _knowledgeSummary?: Record<string, unknown>;
  _knowledgeDetail?: Record<string, unknown>;
  [key: string]: unknown;
};

export type RecommendationContext = Record<string, unknown>;

export type DeepRecommendation = {
  primary: {
    name: string;
    tagline: string;
    narrative: string;
    reasons: string[];
    taste_note: string;
    brew_tip: string;
    best_before: string;
    pairing: string;
    _teaId: number;
  };
  alternative: {
    name: string;
    why_different: string;
    reasons: string[];
    brew_tip: string;
    _teaId?: number;
  };
  today_avoid_note: string;
};

export type CoarseCandidate = {
  tea: TeaCandidate;
  teaId: number;
  score: number;
  group: 'current_fit' | 'preference' | 'exploration';
};

export type NoteAnalysis = {
  version: 1;
  sourceUpdatedAt: number;
  analyzedAt: number;
  explicitSentiment: 'positive' | 'negative' | 'unknown';
  confidence: number;
  likedTraits: string[];
  dislikedTraits: string[];
  observations: string[];
  brewingNote: string;
  contextNotes: string;
  summary: string;
};

export class AIRequestError extends Error {
  code: string;
  status: number | null;
  purpose: string | null;
}

export function parseInputWithAI(input: string, keywordResult: ParsedInput, options?: AIOptions): Promise<ParsedInput>;
export function recommendWithAI(eligibleTeas: TeaCandidate[], context?: RecommendationContext, options?: AIOptions): Promise<DeepRecommendation | null>;
export function selectCandidatesWithAI(eligibleTeas: TeaCandidate[], context?: RecommendationContext, options?: AIOptions): Promise<{ candidates: CoarseCandidate[] } | null>;
export function generateDailyQuote(context?: Record<string, unknown>, options?: AIOptions): Promise<string | null>;
export function analyzeTastingNote(note: string, tea?: { name?: string }, context?: { sourceUpdatedAt?: number }, options?: AIOptions): Promise<NoteAnalysis | null>;
export function normalizeNoteAnalysis(parsed: Record<string, unknown>, sourceUpdatedAt?: number, now?: number): NoteAnalysis;
