// The delivery email: the one that hands over the Loom, the report and the price in a single
// message, as a reply on the thread that started the conversation.
//
// THE GATE, and it remains the whole point of this file (SRT_Loom_Playbook.md): the agent refuses
// to draft until the Loom TRANSCRIPT has been pasted into the thread. Without it the timestamps and
// "the best moment of the video" come from imagination, and a prospect who clicks 3:15 and finds
// something else there stops believing the rest of it.
//
// ── The division of labour, which is the design ─────────────────────────────
// The TRANSCRIPT supplies tone, the two moments, and the exact words he used to ask for a reply.
// The REPORT supplies every figure. They are handed to the model separately and labelled that way,
// because the failure this email cannot survive is a number that does not match the PDF attached to
// it. Where they disagree, the report wins and the disagreement is flagged rather than smoothed
// over: a video that said "50 out of 100" over a report that says 40 is something Matthew needs to
// know before he hits send, not something to paper over.
//
// ── Two things this email will not do ───────────────────────────────────────
//   1. Promise customers, jobs, leads or revenue. Nothing in the pipeline measures or predicts any
//      of those. If the RECORDING made such a promise it is flagged and NOT repeated, because the
//      video is already watched and the email cannot unsay it, but it can decline to put it in
//      writing. See DELIVERY_BANNED_PROMISES.
//   2. Quote a timestamp that is not in the transcript. verifyStamp is mechanical for the same
//      reason looksLikeTranscript is.
//
// Everything stated as a rule lives in delivery-guards.ts as a pure function. A prose guard is not
// a guard.

import { callClaudeJSON } from "@/lib/claude-calls";
import {
  DELIVERY_MAX_WORDS,
  DELIVERY_REQUIRED_LINES,
  LOOM_PRICE_LABEL,
  LOOM_TEXT_NUMBER,
  ONBOARDING_WINDOW,
  PAYMENT_LINK,
} from "@/config/pitch";
import { polishBody } from "./format-guard";
import { ensureSignoff, noDashes } from "./email-assistant";
import { BLOCK_LABEL } from "./pdf-scorecard";
import {
  competitorsWhereAbsent,
  numberConflicts,
  replyPhrase,
  spokenPromises,
  verifyStamp,
  wordCount,
} from "./delivery-guards";
import type { ReportView } from "./report-view";
import type { AuditReportRow } from "./types";

/** A transcript is a wall of timestamped lines. Anything shorter is somebody typing "transcript". */
const MIN_TRANSCRIPT_CHARS = 400;
const TIMESTAMP_RE = /(?:^|[\s(\[])(\d{1,2}:\d{2}(?::\d{2})?)/g;

/** Rule 10. Square brackets, never braces: lintDraft rule 6 rejects a surviving {placeholder}. */
export const THUMBNAIL_MARKER = "[LOOM THUMBNAIL, paste the clickable preview here]";

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
  /** Spanish, for Slack only. Never part of the email. */
  flags: string[];
}

interface ModelOut {
  subject: string;
  body: string;
  scoreStamp: string;
  priceStamp: string;
}

function reportUrl(slug: string): string {
  return `${process.env.NEXT_PUBLIC_APP_URL || "https://mission.srtagency.com"}/r/${slug}`;
}

/**
 * The figures, and only the figures. Handed to the model as the sole source of numbers.
 */
function factsBlock(report: AuditReportRow, view: ReportView, topAbsent: { name: string; count: number } | null): string {
  const blocks = view.blockStats
    .map((b) => `${BLOCK_LABEL[b.block] ?? b.block}: ${b.mentioned} of ${b.total}`)
    .join(" · ");
  const site = report.site_signals?.[0]?.detail ?? null;

  return [
    `Company: ${report.client_name ?? report.website}`,
    `Writing to: ${report.prospect_name ?? "the owner"}`,
    report.city ? `City: ${report.city}` : "",
    `Score: ${report.score ?? 0} out of 100`,
    `Appeared in ${view.totalMentioned} of ${view.totalPrompts} buyer questions`,
    `By category: ${blocks}`,
    topAbsent
      ? `Top competitor in the questions they are MISSING from: ${topAbsent.name}, in ${topAbsent.count} of those questions`
      : "No competitor was named often enough in the missing questions to quote",
    `Report link: ${reportUrl(report.slug)}`,
    `Price: ${LOOM_PRICE_LABEL}`,
    PAYMENT_LINK
      ? `Payment link, this is the next step: ${PAYMENT_LINK}`
      : `Payment link: NONE CONFIGURED. Write [LINK DE PAGO] where the link belongs.`,
    `After payment they get an invitation link, and getting started takes ${ONBOARDING_WINDOW}.`,
    `Phone for questions: ${LOOM_TEXT_NUMBER}`,
    site ? `Thing on their own site: ${site}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

/**
 * Put back anything the model dropped.
 *
 * Same move as ensurePermissionClose: these two lines are the difference between an email that
 * asks for something and one that gives something first, and a model merely ASKED to include them
 * rewrites or loses them often enough that hoping is not a strategy.
 */
function ensureRequiredLines(body: string, reportLink: string): string {
  const lower = body.toLowerCase();
  const additions: string[] = [];
  if (!lower.includes(DELIVERY_REQUIRED_LINES[0])) {
    additions.push("The full report is attached and it is yours to keep either way.");
  }
  if (!lower.includes("incognito")) {
    additions.push(`You can run any of those questions yourself in an incognito window and see the same thing: ${reportLink}`);
  }
  return additions.length ? `${body.trimEnd()}\n\n${additions.join("\n\n")}` : body;
}

export async function draftDeliveryEmail(
  report: AuditReportRow,
  view: ReportView,
  transcript: string,
  check: TranscriptCheck
): Promise<DeliveryDraft> {
  const flags: string[] = [];

  const absent = competitorsWhereAbsent(view);
  const topAbsent = absent[0] ?? null;
  const facts = factsBlock(report, view, topAbsent);

  // Rule 4, against the RECORDING. A hit here is information, not a blocker: it already happened.
  const promises = spokenPromises(transcript);
  for (const p of promises) {
    flags.push(`El video ${p.detail}${p.at ? ` en ${p.at}` : ""}: "${p.phrase}". No lo repetí en el correo.`);
  }

  // Rule 5.
  const conflicts = numberConflicts(transcript, {
    score: report.score ?? 0,
    appeared: view.totalMentioned,
    totalPrompts: view.totalPrompts,
    competitorCount: topAbsent?.count ?? null,
  });
  for (const c of conflicts) {
    flags.push(`El video dice "${c.said}"${c.at ? ` en ${c.at}` : ""} pero el reporte dice ${c.actual}. Usé el reporte.`);
  }

  // Rule 9, ADVISORY since template v2 (2026-08-16).
  //
  // The v2 close sends them to the payment link, so a video with no reply phrase in it is now the
  // normal case rather than a gap: there is nothing to confirm, the next step is the link. When the
  // recording DID name a phrase it is still honoured verbatim, because a video that said "reply
  // let's do it" and an email that says something else is the same broken promise it always was.
  const phrase = replyPhrase(transcript);

  // What DOES need flagging is a close with nowhere to send them.
  if (!PAYMENT_LINK) {
    flags.push("No hay link de pago configurado (SRT_PAYMENT_URL). Dejé [LINK DE PAGO] en el cierre.");
  }

  const { data } = await callClaudeJSON<ModelOut>({
    model: "claude-sonnet-4-6",
    system: [
      "You write the email that delivers a recorded video, the report and the price to a prospect, in one message.",
      "",
      "This is a REPLY on an existing thread. No reintroduction, no restating the pitch, no new subject.",
      "",
      "STRUCTURE:",
      "1. Open on the gap. Where they appear versus where they disappear, and that the questions they disappear from are the ones with the bigger jobs behind them. NEVER open with a question they already win.",
      "2. The competitor, named, with the count from the FIGURES below.",
      "3. The two timestamps: where the score and findings are shown, and where the price and the next step are covered.",
      "4. The report is attached and theirs to keep either way, and they can re-run any question themselves in an incognito window.",
      "5. Close: the price, the PAYMENT LINK as the next step, what happens after they pay (an invitation link, then a short onboarding), and the phone number for questions. Use the payment link exactly as given in the FIGURES, on its own line.",
      "",
      "HARD RULES:",
      `1. Under ${DELIVERY_MAX_WORDS} words. Plain text. ONE call to action.`,
      "2. EVERY number comes from the FIGURES block. The transcript is for tone and timing ONLY. If the transcript states a different number, the FIGURES are correct and you use those.",
      "3. Never promise customers, jobs, leads, calls or revenue, and never repeat such a promise from the transcript. This audit reports visibility only.",
      "4. scoreStamp and priceStamp must be timestamps that literally appear in the transcript.",
      "5. One sentence per paragraph, blank line between each.",
      "6. No em dashes. No jargon: no AEO, GEO, LLM, schema, citations, entities, algorithm, SERP. Say it the way a contractor would.",
      "7. Do not paste a raw video link. The line introducing the video must be exactly this marker on its own line:",
      `   ${THUMBNAIL_MARKER}`,
      "8. Write the subject as \"re: \" followed by the original subject if you are given one, otherwise leave subject as an empty string.",
      'Return JSON: {"subject":"...","body":"...","scoreStamp":"M:SS","priceStamp":"M:SS"}',
    ].join("\n"),
    user: [
      "FIGURES, the only source of numbers:",
      facts,
      "",
      phrase
        ? `He asked them on camera to reply with an exact phrase. Use it verbatim ALONGSIDE the payment link, do not replace one with the other: "${phrase}"`
        : "He did not ask them to reply with a phrase, which is expected. The payment link is the next step and the only call to action.",
      promises.length
        ? `\nDo NOT repeat these, he said them on camera but they are not claims we make: ${promises.map((p) => `"${p.phrase}"`).join(", ")}`
        : "",
      "",
      "TRANSCRIPT, for tone and timestamps only, never for figures:",
      transcript.slice(0, 14000),
    ]
      .filter(Boolean)
      .join("\n"),
    maxTokens: 1400,
    temperature: 0.5,
    validate: (p): p is ModelOut => {
      const o = p as Record<string, unknown>;
      return (
        !!o &&
        typeof o.subject === "string" &&
        typeof o.body === "string" &&
        typeof o.scoreStamp === "string" &&
        typeof o.priceStamp === "string" &&
        wordCount(o.body) <= DELIVERY_MAX_WORDS &&
        spokenPromises(o.body).length === 0
      );
    },
    describeInvalid: (p) => {
      const o = p as Partial<ModelOut>;
      const problems: string[] = [];
      for (const k of ["subject", "body", "scoreStamp", "priceStamp"] as const) {
        if (typeof o[k] !== "string") problems.push(`${k} was missing`);
      }
      if (typeof o.body === "string") {
        const n = wordCount(o.body);
        if (n > DELIVERY_MAX_WORDS) problems.push(`the body is ${n} words, the limit is ${DELIVERY_MAX_WORDS}`);
        const inDraft = spokenPromises(o.body);
        if (inDraft.length) {
          problems.push(`the body ${inDraft[0].detail} ("${inDraft[0].phrase}"), which this audit cannot promise. Remove it, do not soften it`);
        }
      }
      return problems.join("; ") || "it did not match the required shape";
    },
  });

  // Rule 3, verified rather than trusted. The old code snapped both stamps to the beat sheet's
  // 1:15 / 3:15 targets; the model now finds them by MEANING, which is better when it works and
  // needs checking when it does not.
  const score = verifyStamp(data.scoreStamp, check.stamps, nearestStamp(check.stamps, 75));
  const close = verifyStamp(data.priceStamp, check.stamps, nearestStamp(check.stamps, 195));
  for (const [label, v] of [["del score", score], ["del precio", close]] as const) {
    if (v.invented) flags.push(`El modelo citó ${v.invented} para el momento ${label}, y ese tiempo no existe en la transcripción. Lo cambié por ${v.stamp ?? "ninguno"}.`);
  }

  const polished = await polishBody(noDashes(data.body), { allowEmphasis: false });
  const withLines = ensureRequiredLines(polished.body, reportUrl(report.slug));

  return {
    subject: noDashes(data.subject).trim(),
    body: ensureSignoff(withLines),
    scorecardStamp: score.stamp ?? "1:15",
    closeStamp: close.stamp ?? "3:15",
    flags,
  };
}
