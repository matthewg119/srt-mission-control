// Shared TypeScript types for the Coaching Studio feature.
// API routes and components import from here so the shape stays consistent
// across /api/coaching-studio/* and /components/coaching-studio/*.

export interface CoachingCategory {
  id: string;
  name: string;
  description: string | null;
  color: string;
  sort_order: number;
  created_at: string;
}

// A single playbook entry. Mirrors the shape the Chrome extension expects
// (see /live call coach srt/extension/src/lib/types.ts) plus DB metadata.
export interface CoachingPlaybookEntry {
  id: string;
  trigger: string;
  category: string;
  suggestions: string[];
  context: string | null;
  source: string; // 'manual' | 'auto-learned' | 'legacy-import' | 'import'
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

// The legacy JSONB shape that the extension + /api/call-coach/playbook still
// serves. We rebuild this from coaching_playbook_entries via the sync function.
export interface LegacyPlaybookEntry {
  trigger: string;
  category: string;
  suggestions: string[];
  context: string;
  source: string;
}

// Call session as surfaced by the Coaching Studio Call Library.
// Joins call_coach_sessions with call_coach_users (rep name) and transcript count.
export interface CoachingSession {
  id: string;
  user_id: string;
  started_at: string;
  ended_at: string | null;
  duration_seconds: number | null;
  suggestions_shown: number | null;
  suggestions_clicked: number | null;
  total_entries: number | null;
  // Coaching Studio columns
  title: string | null;
  contact_name: string | null;
  business_name: string | null;
  outcome: string | null;
  analysis_status: 'pending' | 'analyzing' | 'complete' | 'failed';
  analysis_result: CallAnalysis | null;
  score: number | null;
  notes: string | null;
  // Joined fields
  rep_name?: string;
  transcript_count?: number;
}

// A single line of the transcript saved by the extension.
export interface TranscriptEntry {
  id: string;
  session_id: string;
  user_id: string;
  speaker: 'rep' | 'merchant' | 'unknown';
  text: string;
  timestamp_ms: number;
  sequence_num: number;
  created_at: string;
}

// Phase 2 — AI-generated analysis of a call.
export interface CallAnalysis {
  overallScore: number;
  phases: Array<{
    name: string;
    startIndex: number;
    endIndex: number;
    score: number;
  }>;
  exchanges: Array<{
    merchantStatement: string;
    merchantSequenceNum: number;
    optimalResponse: string;
    actualResponse: string;
    repSequenceNum: number;
    adherenceScore: number;
    playbookTrigger: string | null;
    note: string;
  }>;
  missedTriggers: Array<{
    trigger: string;
    merchantStatement: string;
    sequenceNum: number;
    suggestedResponse: string;
  }>;
  deviations: Array<{
    description: string;
    sequenceNum: number;
    severity: 'minor' | 'moderate' | 'critical';
  }>;
  recommendations: string[];
  qualification: Record<string, string | null>;
}
