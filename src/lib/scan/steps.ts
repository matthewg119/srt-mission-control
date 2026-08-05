// The step list + wire shape for /scan, in a module with NO server imports.
//
// This file exists so the client bundle can have them. session.ts pulls in
// supabaseAdmin and node:crypto, and importing SCAN_STEPS from there dragged all
// of it into the browser build (129 kB of it). Anything the run view needs at
// runtime belongs here; anything that touches the database belongs in session.ts.

export const SCAN_STEPS = [
  { key: "research", label: "Research your business" },
  { key: "classify", label: "Identify your competitors" },
  { key: "questions", label: "Write the buyer questions" },
  { key: "engines", label: "Ask ChatGPT" },
  { key: "score", label: "Score the answers" },
  { key: "report", label: "Build your report" },
] as const;

export type ScanStepKey = (typeof SCAN_STEPS)[number]["key"];

export type ScanSessionStatus = "researching" | "running" | "done" | "failed";

export interface ScanStatusPayload {
  sessionId: string;
  domain: string;
  status: ScanSessionStatus;
  /** 1-based index of the step currently working. 7 once everything is done. */
  activeStep: number;
  error: string | null;
  /** Populated the moment the audit_reports row exists (steps 1-3 data). */
  business: {
    name: string | null;
    type: string | null;
    city: string | null;
    persona: string | null;
    isLocal: boolean;
  } | null;
  competitors: Array<{ name: string; domain?: string }>;
  prompts: Array<{ block: string; prompt: string }>;
  /** Live counter for step 4: engine calls recorded so far, out of TOTAL_PROMPTS. */
  engine: { done: number; total: number };
  /** Only once status is done. Deliberately carries NO slug: /r/[slug] is unauthenticated,
   *  so the report URL is issued by /api/scan/[id]/claim, never by the public status poll. */
  result: { score: number | null; total: number } | null;
  /** True once someone has traded an email for it. */
  claimed: boolean;
}
