// The delivery email: the one that actually hands over the Loom, same day they say yes.
//
// THE GATE, and it is the whole point of this file (SRT_Loom_Playbook.md): the agent refuses to
// draft this until the Loom TRANSCRIPT has been pasted into the thread. Without it the email
// quotes timestamps and "the best moment of the video" from imagination, and a prospect who
// clicks 3:15 and finds something else there stops believing the rest. With it, the two
// timestamps are read off what was actually said.
//
// The two moments the playbook wants quoted:
//   ~1:15  the scorecard, "at 1:15 I show your AI Visibility Score"
//   ~3:15  the close,     "at 3:15, exactly how we close the gap, and what it costs"
//
// Those are the TARGET times. What ships in the email is what the transcript actually shows,
// because a recording never lands exactly on the beat sheet.

import { callClaudeJSON } from "@/lib/claude-calls";
import { polishBody } from "./format-guard";
import { ensureSignoff, noDashes } from "./email-assistant";
import type { AuditReportRow } from "./types";

/** A transcript is a wall of timestamped lines. Anything shorter is somebody typing "transcript". */
const MIN_TRANSCRIPT_CHARS = 400;
const TIMESTAMP_RE = /(?:^|[\s(\[])(\d{1,2}:\d{2}(?::\d{2})?)/g;

export interface TranscriptCheck {
  ok: boolean;
  /** Why it was refused, written to be posted as-is. */
  reason: string | null;
  /** Distinct timestamps found, in order of appearance. */
  stamps: string[];
}

/**
 * Is this actually a Loom transcript?
 *
 * Deliberately mechanical rather than clever: length plus a spread of timestamps. A model asked
 * "does this look like a transcript" would say yes to a confident-sounding paragraph, and the
 * entire value of the gate is that it cannot be talked into passing.
 */
export function looksLikeTranscript(text: string): TranscriptCheck {
  const stamps = [...new Set([...text.matchAll(TIMESTAMP_RE)].map((m) => m[1]))];
  if (text.trim().length < MIN_TRANSCRIPT_CHARS) {
    return {
      ok: false,
      reason: `That's ${text.trim().length} characters, and a 4-minute transcript runs a few thousand. Paste the whole thing from Loom.`,
      stamps,
    };
  }
  if (stamps.length < 3) {
    return {
      ok: false,
      reason: "I can't find timestamps in that. Copy the transcript from Loom with timestamps on, so the email can quote real moments.",
      stamps,
    };
  }
  return { ok: true, reason: null, stamps };
}

function toSeconds(stamp: string): number {
  const parts = stamp.split(":").map((n) => parseInt(n, 10));
  return parts.length === 3 ? parts[0] * 3600 + parts[1] * 60 + parts[2] : parts[0] * 60 + parts[1];
}

/** The real stamp nearest a target, so a video that ran long still quotes a moment that exists. */
export function nearestStamp(stamps: string[], targetSeconds: number): string | null {
  if (!stamps.length) return null;
  return [...stamps].sort((a, b) => Math.abs(toSeconds(a) - targetSeconds) - Math.abs(toSeconds(b) - targetSeconds))[0];
}

export interface DeliveryDraft {
  subject: string;
  body: string;
  scorecardStamp: string;
  closeStamp: string;
}

export async function draftDeliveryEmail(
  report: AuditReportRow,
  transcript: string,
  check: TranscriptCheck
): Promise<DeliveryDraft> {
  // 1:15 and 3:15 are the beat sheet's targets; snap each to a timestamp that genuinely appears
  // in this recording rather than quoting a moment the video may not have.
  const scorecardStamp = nearestStamp(check.stamps, 75) ?? "1:15";
  const closeStamp = nearestStamp(check.stamps, 195) ?? "3:15";

  const { data } = await callClaudeJSON<{ subject: string; body: string }>({
    model: "claude-sonnet-4-6",
    system: [
      "You write the email that delivers a 4-minute video to a prospect who just said yes to receiving it.",
      "",
      "This is a reply in an existing thread, so no reintroduction and no restating the pitch. They already agreed. The job is to hand it over and get out of the way.",
      "",
      "Structure:",
      "1. One line: here it is.",
      `2. The two timestamps, using EXACTLY these: "${scorecardStamp}" for their score, and "${closeStamp}" for how the gap gets closed and what it costs.`,
      "3. One line naming the single strongest moment in the transcript, in the prospect's terms.",
      "4. The scorecard is attached and theirs to keep either way.",
      "5. No new ask beyond watching it.",
      "",
      "HARD RULES:",
      "1. Use ONLY the two timestamps given above. Never invent a third.",
      "2. Everything you describe must actually be in the transcript below. If the video never said it, it does not go in the email.",
      "3. One sentence per paragraph, blank line between each.",
      "4. No em dashes. No jargon: no AEO, GEO, LLM, schema, citations, entities, algorithm, SERP.",
      "5. Under 130 words.",
      "Return JSON: {\"subject\":\"...\",\"body\":\"...\"}",
    ].join("\n"),
    user: [
      `Business: ${report.client_name ?? report.website}`,
      `Writing to: ${report.prospect_name ?? "the owner"}`,
      `Subject should stay on the existing thread: "${report.client_name ?? "your business"} + ChatGPT"`,
      "",
      "Loom transcript:",
      transcript.slice(0, 12000),
    ].join("\n"),
    maxTokens: 900,
    temperature: 0.5,
    validate: (p): p is { subject: string; body: string } => {
      const o = p as Record<string, unknown>;
      return !!o && typeof o.subject === "string" && typeof o.body === "string";
    },
  });

  const polished = await polishBody(noDashes(data.body), { allowEmphasis: false });
  return {
    subject: noDashes(data.subject).trim(),
    body: ensureSignoff(polished.body),
    scorecardStamp,
    closeStamp,
  };
}
