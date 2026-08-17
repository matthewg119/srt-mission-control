// Routes Slack thread replies inside an audit-report thread to the email
// assistant. Called from src/app/api/slack/events/route.ts, gated there by
// channel === AUDIT_CHANNEL_ID before this even runs — so it only ever does a
// DB lookup for genuine audit-channel thread replies, never on every message
// in the workspace. Returns false fast for a thread that isn't (yet) an audit
// report thread, so it never interferes with the many other thread lanes
// already wired in events.ts.
//
// ── The cold-outreach flow this drives ──────────────────────────────────────
// A finished audit posts an INTAKE CARD, not a finished pitch (see
// outreach-intake.ts for why). From there the thread is a small state machine
// keyed on audit_reports.outreach_stage:
//
//   awaiting_intake  free text = the answers        -> ONE email 1 draft, stage: drafted
//   drafted          free text = a revision         -> the draft is rewritten in place
//   drafted          "reveal"                       -> the hand-everything-over message
//   revealed         free text = the prospect spoke -> objection reply options
//
// Plus, at any stage: "nudge 2..5" for the pre-pitch ladder, "email 2..5" for
// the post-reveal belief ladder, "redesign <url>" / "loom <url>" to attach the
// assets the reveal needs, and "1" (or "send it") to turn the current draft into
// an Outlook DRAFT that Matthew opens and sends. Nothing is ever auto-sent.
//
// Free text means different things at different stages on purpose: at `drafted`,
// "tighter, cut the last line" is an edit to the draft, and treating it as a
// pasted prospect objection (the old behavior for all free text) produced a
// nonsense rebuttal email.

import { supabaseAdmin } from "@/lib/db";
import { slack } from "@/lib/slack-bot";
import { microsoft } from "@/lib/microsoft";
import { buildReportView, type ReportView } from "./report-view";
import { buildAliases } from "./mention-match";
import {
  draftEmailOptions,
  draftPermissionEmail,
  draftPreSellOptions,
  draftRevealMessage,
  linkWarning,
  stripAgencyLine,
  BELIEF_SEQUENCE,
  PERMISSION_CLOSE,
  PERMISSION_SEQUENCE,
  type EmailOption,
  type PreSellOption,
} from "./email-assistant";
import {
  buildIntakeQuestions,
  postIntakeCard,
  draftFromIntake,
  revisePreviousDraft,
  usefulIntakeAnswers,
  readIntakeImages,
  type IntakeImage,
} from "./outreach-intake";
import { computeBeatSheetFacts, renderPreflight } from "./loom-beatsheet";
import { buildLoomScript } from "./loom-script";
import { buildImageIdeas, formatIdeasCard } from "./image-ideas";
import { buildCallScript, buildFollowupScript, formatCallScript, formatFollowupScript, type CallMode } from "./call-script";
import { buildDreamLeadPrompt, PRESET_ALIASES, type Preset } from "./dream-lead";
import { getNicheAvatars, formatAvatarsCard, type BestAvatar, type NicheAvatars } from "./niche-avatars";
import { getIntelBrief, formatBriefMarkdown, sourceDomains } from "./intel-brief";
import { draftDeliveryEmail, looksLikeTranscript } from "./delivery-email";
import { draftNotesEmail } from "./notes-email";
import { looksLikeCallNotes } from "./notes-guards";
import { resolveReplyAnchor } from "./reply-anchor";
import { generateScorecardPDF } from "./pdf-scorecard";
import { scorecardFileName } from "./finish-report";
import { computeWeightedScore } from "./report-view";
import {
  draftWithLint,
  formatLintFindings,
  lintDraft,
  retryInstruction,
  type LintFinding,
  type LintInput,
} from "./draft-linter";
import { formatSeedLog, installSeed, readLedger, saveOffered, installedBeliefs, selectBelief } from "./seed-ledger";
import { runThreadAgent } from "./thread-agent";
import type { AuditReportRow, AuditRunRow } from "./types";

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * The command menu, printed under EVERY draft.
 *
 * It used to be a one-liner naming only "1", which meant every other command in this router
 * was undiscoverable unless you already knew it existed. Nobody memorizes a command table they
 * see once, so the full list ships with each card and this constant is the only copy of it.
 */
export const THREAD_COMMANDS = [
  "*1* Outlook draft  ·  *seed 1-3* install a pre-sell line  ·  *nudge 2-5* next touch  ·  *reveal* they said yes",
  "*loom* pick the customer, then the picture, then get the script  ·  *script* just the script again",
  "*brief* niche research  ·  *avatars* 3 worst / 3 best  ·  *image* dream-lead prompt straight up",
  "*paste the Loom transcript* = the hand-over email  ·  *paste your call notes* = the post-call email  ·  *questions* redo intake",
  "*redesign <url>* / *loom <url>* store an asset  ·  *call* follow-up phone script + a send-instead email  ·  *close* the selling script once they've seen the video  ·  *call: <context>* aims it",
  "Anything else you type, I read the thread and answer. @ me to be sure.",
].join("\n");

/** Persist the 3 options on the report row and post them to the thread as a numbered card. */
export async function postOptions(
  report: AuditReportRow,
  channel: string,
  threadTs: string,
  header: string,
  options: EmailOption[]
): Promise<void> {
  await supabaseAdmin.from("audit_reports").update({ pending_drafts: options }).eq("id", report.id);
  const body = options
    .map((o, i) => `*${i + 1}. ${o.label}*\nSubject: ${o.subject}\n\n${o.body}`)
    .join("\n\n· · ·\n\n");
  await slack.postThreadReply(
    channel,
    threadTs,
    `${header}\n\n_Reply *1*, *2*, or *3* and I'll create the Outlook draft._\n${THREAD_COMMANDS}\n\n${body}`
  );
}

/** Everything the linter needs that comes off the report row rather than out of the draft. */
function lintContext(report: AuditReportRow): Pick<LintInput, "robots" | "siteSignals" | "alreadyInstalled"> {
  return {
    robots: report.robots_check ?? null,
    siteSignals: report.site_signals ?? null,
    alreadyInstalled: installedBeliefs(readLedger(report)),
  };
}

/**
 * A refusal that shows its work.
 *
 * The findings alone are what used to post, and a live thread proved that is not enough: email 1
 * failed three times on `2 question marks aimed at the reader` because the drafter was being TOLD
 * to write the ask while the code appended a second one. No rephrasing could have satisfied both,
 * the rejected text was discarded each attempt, and nothing was logged, so from Slack it was
 * indistinguishable from a bad prompt. The draft posts under the reasons, labelled, and the
 * system_logs row is what makes a repeat diagnosable without reading scrollback.
 *
 * Precedent: buildFollowupScript() posts its last shape-valid script under a warning banner
 * rather than leaving him with nothing. Nothing ships from here either way — an Outlook draft is
 * still a separate `1`.
 */
async function postLintRefusal(
  report: AuditReportRow,
  channel: string,
  threadTs: string,
  what: string,
  gated: { findings: LintFinding[]; attempts: number }
): Promise<void> {
  await slack
    .postThreadReply(
      channel,
      threadTs,
      [
        `:no_entry: I couldn't get ${what} past the draft rules in ${gated.attempts} attempts.`,
        "",
        formatLintFindings(gated.findings),
        "",
        "Posting it below anyway so you can see what it kept producing. *Not approved* — read it before you do anything with it, or tell me how you'd rather put it and I'll redraft.",
      ].join("\n")
    )
    .catch(() => {});

  await supabaseAdmin
    .from("system_logs")
    .insert({
      event_type: "audit_draft_rejected",
      metadata: {
        report_id: report.id,
        what,
        attempts: gated.attempts,
        rules: gated.findings.map((f) => f.rule),
        details: gated.findings.map((f) => f.detail),
      },
    })
    .then(undefined, () => {});
}

/**
 * Email 1, from whatever Matthew typed.
 *
 * Shared by the `draft` command and by free text at awaiting_intake, so the two cannot drift into
 * writing the email differently.
 */
async function draftEmailOne(
  report: AuditReportRow,
  channel: string,
  threadTs: string,
  view: ReportView,
  rawAnswers: string,
  files: IntakeImage[] = []
): Promise<void> {
  // A pasted contact card is an answer to "their email address", so it is read INTO the answers
  // rather than handled separately. Labelled, so the drafter knows which half was typed.
  const fromImages = await readIntakeImages(files);
  const withImages = [rawAnswers.trim(), fromImages ? `From the attached screenshot:\n${fromImages}` : ""]
    .filter(Boolean)
    .join("\n\n");

  // Cleaned BEFORE it is stored, not just before it is used. This column is quoted to every later
  // drafter and to the live call brief as instructions that outrank everything generic, so a
  // stray command word kept here outlives the reply that produced it.
  const answers = usefulIntakeAnswers(withImages) ?? "";

  // Generate, lint, retry. The intake answers already outrank the generic guidance in this
  // drafter, so appending the rejection reasons to them is how attempt 2 learns what
  // attempt 1 got wrong.
  const gated = await draftWithLint(
    (attempt, previous) =>
      draftFromIntake(report, view, attempt === 0 ? answers : `${answers}\n\n${retryInstruction(previous)}`),
    (r) => ({ body: r.draft.body, subject: r.draft.subject, stage: "draft-1", ...lintContext(report) })
  );

  const result = gated.draft ?? gated.lastRejected;
  if (!result) return; // unreachable: draftWithLint always returns one of the two
  if (!gated.draft) await postLintRefusal(report, channel, threadTs, "email 1", gated);

  const { draft, extracted, removedLinks, formatNote, nameWarning } = result;

  // A rejected draft does not advance the thread. Leaving the stage at awaiting_intake is what
  // lets him answer properly and get a clean email 1, instead of landing in the revise branch
  // with a draft the linter already refused.
  if (gated.draft) {
    await supabaseAdmin
      .from("audit_reports")
      .update({
        intake_answers: answers || null,
        outreach_stage: "drafted",
        // Only overwrite with something real, so a second pass that omits the email
        // doesn't wipe the address captured on the first.
        ...(extracted.prospect_name ? { prospect_name: extracted.prospect_name } : {}),
        ...(extracted.prospect_email ? { prospect_email: extracted.prospect_email } : {}),
        ...(extracted.redesign_url ? { redesign_url: extracted.redesign_url } : {}),
      })
      .eq("id", report.id);
  }

  const captured = [
    extracted.prospect_name ? `to ${extracted.prospect_name}` : null,
    extracted.prospect_email,
    extracted.redesign_url ? "redesign link in play" : null,
  ].filter(Boolean);

  // Said out loud rather than discovered in Outlook with an empty To field.
  const missing = !extracted.prospect_email && !report.prospect_email && !report.requester_email
    ? "\n_No email address on file yet, so the Outlook draft will have an empty To. Reply with it and I'll redraft._"
    : "";

  await postSingleDraft(
    { ...report, pending_drafts: [draft] },
    channel,
    threadTs,
    `:envelope: *Email 1* · pre-pitch, one finding, one ask, no price${captured.length > 0 ? `\n_${captured.join(" · ")}_` : ""}${missing}`,
    draft,
    THREAD_COMMANDS,
    { removedLinks, formatNote, nameWarning },
    await draftPreSellOptions(report, view, {
      exclude: installedBeliefs(readLedger(report)),
      // Puts B4 first when their Google profile is strong or they bragged about it at intake.
      preferred: selectBelief(report, readLedger(report)).id,
      language: report.call_language === "es" ? "es" : "en",
    })
  );
}

/**
 * Put the chosen pre-sell line in as its own paragraph directly above the close.
 *
 * Anchored on the FIRST line of PERMISSION_CLOSE ("I recorded a 4 min video...") rather than on
 * the question mark. Anchoring on the "?" would drop the seed between the video line and the
 * ask, splitting the close in half — the give and the question have to stay adjacent, because
 * the give is what makes the question free to answer.
 *
 * Falls back to just above the sign-off for a draft that somehow has no close.
 */
function spliceSeedAboveClose(body: string, line: string): string {
  const paras = body.split(/\n\s*\n/);
  let idx = paras.findIndex((p) => p.trim() === PERMISSION_CLOSE[0]);
  if (idx < 0) idx = paras.findLastIndex((p) => p.includes("?"));
  if (idx < 0) idx = Math.max(0, paras.length - 1);
  paras.splice(idx, 0, line.trim());
  return paras.join("\n\n");
}

/** What the guards had to do to a draft, surfaced above it so it is never silent. */
interface DraftGuards {
  removedLinks?: string[];
  formatNote?: string | null;
  nameWarning?: string | null;
}

/**
 * Post ONE finished draft. Stored as a single-element pending_drafts so the existing "1"
 * picker and Outlook path work unchanged, and so a later revision has something to edit.
 *
 * Guard output goes ABOVE the draft, not below: a stripped link can leave an awkward
 * half-sentence, and that has to be read before the copy is, not after.
 */
async function postSingleDraft(
  report: AuditReportRow,
  channel: string,
  threadTs: string,
  header: string,
  draft: EmailOption,
  footer: string,
  guards: DraftGuards = {},
  preSell: PreSellOption[] = []
): Promise<void> {
  await supabaseAdmin.from("audit_reports").update({ pending_drafts: [draft] }).eq("id", report.id);
  // Remember which three lines this card offered, so a later "seed 2" knows what 2 meant.
  if (preSell.length > 0) await saveOffered(report.id, readLedger(report), preSell);
  const warnings = [
    guards.nameWarning ?? null,
    linkWarning(guards.removedLinks ?? []),
    guards.formatNote ? `:warning: ${guards.formatNote}.` : null,
  ]
    .filter(Boolean)
    .join("\n");
  await slack.postThreadReply(
    channel,
    threadTs,
    // The footer is NOT italicized here any more: it is now a multi-line command menu, and
    // Slack's mrkdwn does not carry _italics_ across a newline.
    `${header}\n${warnings ? `\n${warnings}\n` : ""}\nSubject: ${draft.subject}\n\n${draft.body}\n\n${formatPreSell(preSell)}${footer}`
  );
}

/**
 * The three pre-sell lines, printed under the draft for Matthew to paste one in above the ask.
 *
 * Deliberately NOT spliced into the draft body. Which belief to install is a read on the
 * prospect that the audit data cannot make, and a line pasted in by hand is one he has actually
 * chosen. The belief id is shown so a thread never installs the same one twice by accident.
 */
function formatPreSell(options: PreSellOption[]): string {
  if (options.length === 0) return "";
  const lines = options.map((o, i) => `*${i + 1}*  \`${o.belief}\` _${o.label}_\n${o.line}`).join("\n\n");
  return `:seedling: *Pre-sell · paste one in above the ask*\n${lines}\n\n`;
}

/** The scorecard, rendered fresh, as a Graph fileAttachment. */
async function scorecardAttachment(report: AuditReportRow): Promise<{ name: string; contentType: string; contentBytes: string }> {
  const { data: runsData } = await supabaseAdmin.from("audit_runs").select("*").eq("report_id", report.id);
  const runs = (runsData ?? []) as AuditRunRow[];
  const aliases = buildAliases(report.client_name ?? report.business_type ?? report.website, report.website);
  const view = buildReportView(report, runs, aliases);
  const pdf = generateScorecardPDF(report, view, computeWeightedScore(view));
  return {
    name: scorecardFileName(report),
    contentType: "application/pdf",
    contentBytes: pdf.toString("base64"),
  };
}

/** Turn the chosen stored option into an Outlook draft and confirm with the open-in-Outlook link. */
async function createOutlookDraftFromPick(report: AuditReportRow, channel: string, threadTs: string, pick: number): Promise<void> {
  const drafts = report.pending_drafts ?? [];
  const chosen = drafts[pick - 1];
  if (!chosen) {
    await slack.postThreadReply(
      channel,
      threadTs,
      `I don't have option ${pick} queued in this thread.\n\n${THREAD_COMMANDS}`
    );
    return;
  }
  try {
    // prospect_email (the cold prospect, captured at intake) before requester_email (the
    // person who requested a public free audit). A cold /audit run only ever has the former,
    // and before it existed those drafts opened with an empty To.
    const to = report.prospect_email ?? report.requester_email ?? undefined;
    // Outlook renders Matthew's signature block under the body, so the plain-text agency line
    // would print the agency twice. He deletes it by hand every time; do it here instead.
    const outlookBody = stripAgencyLine(chosen.body);
    const htmlBody = `<div style="white-space:pre-wrap;font-family:'Segoe UI',Arial,sans-serif;font-size:14px;line-height:1.5">${escapeHtml(outlookBody)}</div>`;

    // The scorecard is regenerated here rather than stored on the row: it is derived from the
    // runs, so a fresh render can never disagree with the report the email links to.
    const attachments = chosen.attachScorecard ? [await scorecardAttachment(report)] : undefined;

    const draft = chosen.replyToMessageId
      ? await microsoft.createReplyDraft({ messageId: chosen.replyToMessageId, html: htmlBody, to, attachments })
      : await microsoft.createDraft({ to, subject: chosen.subject, body: htmlBody, attachments });

    const noRecipient = to ? "" : "\nNo recipient on file, so add the To address in Outlook before sending.";
    const threaded = chosen.replyToMessageId ? ", as a reply on the original thread" : "";
    const attached = attachments ? ", scorecard attached" : "";
    await slack.postThreadReply(
      channel,
      threadTs,
      `:envelope_with_arrow: Outlook draft created${drafts.length > 1 ? ` for option ${pick}` : ""} (${chosen.label})${to ? ` to ${to}` : ""}${threaded}${attached}. <${draft.webLink}|Open in Outlook>${noRecipient}`
    );
  } catch (e) {
    await slack.postThreadReply(channel, threadTs, `:warning: Couldn't create the Outlook draft: ${(e as Error).message}`).catch(() => {});
  }
}

/** Store a redesign or Loom URL for the reveal message to pick up. */
async function attachAsset(
  report: AuditReportRow,
  channel: string,
  threadTs: string,
  field: "redesign_url" | "loom_url",
  url: string
): Promise<void> {
  await supabaseAdmin.from("audit_reports").update({ [field]: url }).eq("id", report.id);
  const what = field === "redesign_url" ? "Redesign concept" : "Loom";
  await slack.postThreadReply(
    channel,
    threadTs,
    `:paperclip: ${what} saved. It stays out of the pre-pitch emails and goes into the reveal, so reply *reveal* once they say yes.`
  );
}

/** Post the intake card again (also the recovery path when a thread's state got confusing). */
async function restartIntake(report: AuditReportRow, channel: string, threadTs: string, view: ReportView): Promise<void> {
  const questions = await buildIntakeQuestions(report, view);
  await postIntakeCard(report, channel, threadTs, questions);
}

/** Slack wraps pasted URLs as <url> or <url|label>; unwrap before storing one. */
function unwrapSlackUrl(raw: string): string {
  const m = raw.match(/^<([^|>]+)(?:\|[^>]*)?>$/);
  return (m ? m[1] : raw).trim();
}

// ── The `loom` wizard ────────────────────────────────────────────────────────
// Three steps, because each one is a decision that changes the next. Who the recording is aimed
// at decides what the picture shows, and the picture decides how the script opens. Asking all
// three at once produced what it produced before: a beat sheet that said "run `image`" and left
// the operator to go find the avatars behind a second command he never ran.

/**
 * Pull a per-recording price, start window and name out of `loom Fran, $499, 45 days`.
 *
 * The name is whatever is left once the price and the window have been taken out, and only when
 * that remainder looks like a name: one or two words, letters only. That keeps `loom` bare and
 * `loom $349, 45 days` working exactly as before, and means a typo lands as "no name given"
 * rather than as a stranger's name read out on camera.
 */
function parseLoomOverrides(rest: string): { price: string | null; window: string | null; name: string | null } {
  const rawPrice = rest.match(/\$\s?[\d,]+(?:\s*\/\s*(?:mo|month|monthly))?/i)?.[0]?.trim() ?? null;
  const window = rest.match(/\d+\s*(?:to|-|–)\s*\d+\s*days?|\b\d+\s*days?\b/i)?.[0]?.trim() ?? null;

  let remainder = rest;
  for (const part of [rawPrice, window]) if (part) remainder = remainder.replace(part, " ");
  remainder = remainder.replace(/[,;]/g, " ").trim();

  // A word that is obviously a command is not a name. Nothing here is a `loom` subcommand today,
  // but `avatars fresh` exists, so `loom fresh` is the kind of thing that gets typed by analogy,
  // and the cost of guessing wrong is a video that opens "Hey fresh,".
  const NOT_A_NAME = /^(?:fresh|again|new|redo|retry|help|please|ok|okay|cancel|stop|script|es|en)$/i;
  const looksLikeName = /^[a-z][a-z'.-]*(?:\s+[a-z][a-z'.-]*)?$/i.test(remainder) && !NOT_A_NAME.test(remainder);

  // `[\d,]+` swallows the separator in `loom $349, 45 days`, and the price is read out loud and
  // printed on the invoice line, so "$349," is not a cosmetic problem.
  const price = rawPrice?.replace(/[,\s]+$/, "") || null;

  return { price, window, name: looksLikeName ? remainder : null };
}

/** The niche's avatar set, or null when it can't be built. */
async function nicheSet(report: AuditReportRow, view: ReportView): Promise<NicheAvatars | null> {
  try {
    const result = await getNicheAvatars(report, view);
    return result.avatars;
  } catch (e) {
    console.error("[loom] avatars failed:", (e as Error).message);
    return null;
  }
}

/**
 * The stand-in customer, for when the niche set cannot be built.
 *
 * `buildDreamLeadPrompt` with no avatarHint already derives one from the money questions this
 * business is ABSENT from (dream-lead.ts, `absentMoneyQuestions`) — that was the behaviour before
 * the wizard existed and it is sound. Reusing it means a failed niche set costs the three-way
 * CHOICE, not the recording, which is the whole point: a dead end here leaves him with a
 * pre-flight and no way to reach the picture or the script.
 */
async function derivedAvatar(report: AuditReportRow, view: ReportView): Promise<BestAvatar | null> {
  const built = await buildDreamLeadPrompt(report, view);
  if (!built.ok) return null;
  return {
    label: built.variables.avatar,
    ticket: built.variables.ticketSignal,
    whyHighRoi: "Derived from the buyer questions this business is missing from.",
    aiQuestion: built.variables.avatarQuestion,
  };
}

/**
 * Who this recording is aimed at: the customer picked from the menu, or the derived stand-in.
 *
 * The whole set comes back alongside the pick, because the script's opening line names two
 * customers to attract AND two to avoid, and the ones to avoid only exist in `worst`. On the
 * derived path there is no set, so the script says nothing about who to avoid.
 */
async function resolveLoomAvatar(
  report: AuditReportRow,
  view: ReportView
): Promise<{ avatar: BestAvatar; index: number | null; avatars: NicheAvatars | null } | null> {
  const state = report.loom_state;
  if (state?.derivedAvatar) return { avatar: state.derivedAvatar, index: null, avatars: null };
  if (!state?.avatarIndex) return null;
  const set = await nicheSet(report, view);
  return set ? { avatar: set.best[state.avatarIndex - 1], index: state.avatarIndex, avatars: set } : null;
}

/**
 * The follow-up / closing CALL script, plus the paste block for the SRT Call Coach extension.
 *
 * Posted as TWO messages rather than one. The coach notes are a copy target, not something to
 * read: Slack puts a copy button on a fenced block, and burying that block under ten sections of
 * script means scrolling past the whole card to reach it every time he dials.
 */
async function postCallScript(
  report: AuditReportRow,
  channel: string,
  threadTs: string,
  view: ReportView,
  extraContext: string,
  mode: CallMode
): Promise<void> {
  if (mode === "followup") {
    const { facts, script, warnings } = await buildFollowupScript(report, view, extraContext);
    const { script: card, notes } = formatFollowupScript(facts, script, warnings);
    await slack.postThreadReply(channel, threadTs, card);
    await slack.postThreadReply(channel, threadTs, notes);
    return;
  }

  const { facts, script, warnings } = await buildCallScript(report, view, extraContext);
  const { script: card, notes } = formatCallScript(facts, script, warnings);
  await slack.postThreadReply(channel, threadTs, card);
  await slack.postThreadReply(channel, threadTs, notes);
}

/** Step 1: the prompts to paste, what not to say, and the three customers to choose between. */
async function startLoomWizard(
  report: AuditReportRow,
  channel: string,
  threadTs: string,
  view: ReportView,
  runs: AuditRunRow[],
  rest: string
): Promise<void> {
  const { facts, refusal } = await computeBeatSheetFacts(report, view, runs);
  if (!facts) {
    await slack.postThreadReply(channel, threadTs, `:warning: ${refusal}`);
    return;
  }

  const overrides = parseLoomOverrides(rest);
  const carry = {
    price: overrides.price ?? undefined,
    window: overrides.window ?? undefined,
    greetName: overrides.name ?? undefined,
  };
  await slack.postThreadReply(channel, threadTs, renderPreflight(view, facts));

  let result;
  try {
    result = await getNicheAvatars(report, view);
  } catch (e) {
    // Skip the menu rather than stopping. One customer, derived from the audit, and straight on
    // to the picture — he still gets everything he needs to record.
    const fallback = await derivedAvatar(report, view);
    if (!fallback) {
      await slack.postThreadReply(
        channel,
        threadTs,
        `:warning: I have the prompts and the pre-flight, but I can't build a customer for this one: ${(e as Error).message}\n\nReply \`avatars fresh\` to retry the niche set.`
      );
      return;
    }
    await slack.postThreadReply(
      channel,
      threadTs,
      [
        `:warning: The 3-worst / 3-best set failed to build, so there is nothing to choose between: ${(e as Error).message}`,
        `Carrying on with the customer derived from the questions they're missing. Reply \`avatars fresh\` later if you want the full set.`,
      ].join("\n")
    );
    const ideas = await buildImageIdeas(report, fallback);
    await supabaseAdmin
      .from("audit_reports")
      .update({
        loom_state: {
          ...carry,
          stage: "image",
          derivedAvatar: fallback,
          ideas: ideas.map((i) => ({ preset: i.preset, label: i.label, line: i.line })),
        },
      })
      .eq("id", report.id);
    await slack.postThreadReply(channel, threadTs, formatIdeasCard(ideas, fallback, null));
    return;
  }

  await supabaseAdmin
    .from("audit_reports")
    .update({ loom_state: { ...carry, stage: "avatar" } })
    .eq("id", report.id);

  await slack.postThreadReply(
    channel,
    threadTs,
    formatAvatarsCard(
      result,
      report,
      [
        `:dart: *Who are we recording for?*`,
        `Reply *1*, *2* or *3* and I'll show you six ways to picture that customer, then write the script.`,
        overrides.price || overrides.window
          ? `_This run: ${[overrides.price, overrides.window].filter(Boolean).join(", ")}._`
          : null,
      ]
        .filter(Boolean)
        .join("\n")
    )
  );
}

/** Steps 2 and 3: the digit means the customer, then the picture. */
async function advanceLoomWizard(
  report: AuditReportRow,
  channel: string,
  threadTs: string,
  view: ReportView,
  runs: AuditRunRow[],
  n: number
): Promise<void> {
  const state = report.loom_state;

  // Step 2: pick the customer, offer the six pictures.
  if (state?.stage === "avatar") {
    const set = await nicheSet(report, view);
    if (!set) {
      await slack.postThreadReply(channel, threadTs, ":warning: I couldn't rebuild the customer set for this niche. Reply `loom` to start again and I'll carry on without the menu.");
      return;
    }
    if (n > 3) {
      await slack.postThreadReply(channel, threadTs, "There are three customers to choose from. Reply *1*, *2* or *3*.");
      return;
    }
    const avatar = set.best[n - 1];
    const ideas = await buildImageIdeas(report, avatar);
    await supabaseAdmin
      .from("audit_reports")
      .update({
        loom_state: {
          ...state,
          stage: "image",
          avatarIndex: n,
          ideas: ideas.map((i) => ({ preset: i.preset, label: i.label, line: i.line })),
        },
      })
      .eq("id", report.id);
    await slack.postThreadReply(channel, threadTs, formatIdeasCard(ideas, avatar, n));
    return;
  }

  // Step 3: pick the picture, get the prompt and the script.
  const idea = state?.ideas?.[n - 1];
  const resolved = await resolveLoomAvatar(report, view);
  if (!idea || !resolved) {
    await slack.postThreadReply(channel, threadTs, "I've lost track of which options those were. Reply `loom` to start again.");
    return;
  }
  const { avatar, index: avatarIndex } = resolved;

  const built = await buildDreamLeadPrompt(report, view, idea.preset as Preset, avatar);
  if (!built.ok) {
    // The menu is left standing on purpose: a refusal here is about THIS preset, and another
    // one may well build. Clearing it would make him restart the whole wizard to find that out.
    await slack.postThreadReply(channel, threadTs, `:warning: ${built.reason}\n\nPick a different one, or reply \`loom\` to start again.`);
    return;
  }

  const v = built.variables;
  await slack.postThreadReply(
    channel,
    threadTs,
    [
      `:framed_picture: *${idea.label}* · for ${avatarIndex ? `customer #${avatarIndex}, ` : ""}${avatar.label}`,
      `*Ticket signal:* ${v.ticketSignal}`,
      `*They ask AI:* "${v.avatarQuestion}"`,
      "",
      "Paste this straight into Higgsfield or ChatGPT image mode. Regenerate until every word on screen is spelled right.",
      "",
      "```",
      built.prompt,
      "```",
      "",
      ":warning: On camera this is the TARGET, never a result: _\"this is the exact kind of inquiry we point at your phone.\"_ Never present it as a lead that already came in.",
    ].join("\n")
  );

  // Release the digits back to the email picker, but keep the avatar so `script` still works.
  await supabaseAdmin
    .from("audit_reports")
    .update({ loom_state: { ...state, stage: "done", ideas: undefined } })
    .eq("id", report.id);

  await postLoomScript(report, channel, threadTs, view, runs, resolved, {
    price: state?.price,
    window: state?.window,
    greetName: state?.greetName,
  });
}

/** Build the read-aloud script and upload it as a .txt. */
async function postLoomScript(
  report: AuditReportRow,
  channel: string,
  threadTs: string,
  view: ReportView,
  runs: AuditRunRow[],
  resolved: { avatar: BestAvatar; index: number | null; avatars: NicheAvatars | null } | null,
  overrides: { price?: string; window?: string; greetName?: string } = {}
): Promise<void> {
  if (!resolved) {
    await slack.postThreadReply(
      channel,
      threadTs,
      "I don't know who this recording is aimed at yet. Reply `loom` and pick the customer first."
    );
    return;
  }

  const { facts, refusal } = await computeBeatSheetFacts(report, view, runs);
  if (!facts) {
    await slack.postThreadReply(channel, threadTs, `:warning: ${refusal}`);
    return;
  }

  const greetName = overrides.greetName ?? report.loom_state?.greetName ?? null;
  const script = await buildLoomScript(report, view, facts, resolved.avatar, {
    price: overrides.price ?? report.loom_state?.price ?? null,
    window: overrides.window ?? report.loom_state?.window ?? null,
    avatars: resolved.avatars,
    greetName,
  });

  // Whether it opens on a name is the first thing to check, so say which one it used. On a cold
  // /audit run there is no contact row and this is blank until he types it.
  const named = greetName ?? report.prospect_name ?? report.requester_name ?? null;

  await slack.uploadFile(channel, script.fileName, Buffer.from(script.text, "utf8"), "text/plain", threadTs);
  await slack.postThreadReply(
    channel,
    threadTs,
    [
      `:page_facing_up: *The script* · read it out loud, paste the screenshots over the top.`,
      `Aimed at ${resolved.index ? `customer #${resolved.index}, ` : ""}${resolved.avatar.label}. Target 4 minutes.`,
      named
        ? `Opens on *${named}*. Wrong name? Reply \`loom <name>\` and I'll rebuild it.`
        : `:warning: No name on this one, so it opens on the trade instead. Reply \`loom <name>\` to fix that.`,
      "",
      "Reply `script` to rebuild it, or `loom` to start over with a different customer.",
      "After recording, just paste the transcript here (with timestamps on) and the hand-over email drafts itself.",
      "Then `call` for the follow-up phone script, and `close` once they've watched it.",
    ].join("\n")
  );
}

export async function handleAuditThreadReply(args: {
  channel: string;
  threadTs: string;
  text: string;
  /** Images pasted with the reply. Read only where they can mean something: the intake answers. */
  files?: IntakeImage[];
  /** True when Matthew @mentioned the bot. Always routes to the agent, whatever the stage. */
  isMention?: boolean;
  /** ts of this message, so the agent's history does not include the message it is answering. */
  messageTs?: string | null;
}): Promise<boolean> {
  const { data: reportData } = await supabaseAdmin
    .from("audit_reports")
    .select("*")
    .eq("slack_thread_ts", args.threadTs)
    .maybeSingle();

  if (!reportData) return false; // not an audit thread — let other handlers run
  const report = reportData as AuditReportRow;

  if (report.status !== "done") {
    await slack.postThreadReply(args.channel, args.threadTs, "⏳ This audit hasn't finished running yet — I'll have the scorecard and the intake questions once it's done.");
    return true;
  }

  const text = args.text.trim();

  // What a bare digit MEANS in this thread. The `loom` wizard posts a numbered menu and the
  // number is the command, so while one is pending it wins over the email picker below. The
  // state is cleared to "done" once the image is chosen, and digits go straight back to meaning
  // the Outlook draft. Same precedent as drop-studio.ts, where a digit is read against job.stage.
  const loomPending = report.loom_state?.stage === "avatar" || report.loom_state?.stage === "image";

  // "1" / "2" / "3" / "send it" → create the Outlook draft from what's queued.
  const pickMatch = text.match(/^([123])$/);
  if (pickMatch && !loomPending) {
    await createOutlookDraftFromPick(report, args.channel, args.threadTs, parseInt(pickMatch[1], 10));
    return true;
  }
  if (/^(send it|send that|draft it|do it|outlook)\.?$/i.test(text)) {
    await createOutlookDraftFromPick(report, args.channel, args.threadTs, 1);
    return true;
  }

  const { data: runsData } = await supabaseAdmin.from("audit_runs").select("*").eq("report_id", report.id);
  const runs = (runsData ?? []) as AuditRunRow[];
  const aliases = buildAliases(report.client_name ?? report.business_type ?? report.website, report.website);
  const view = buildReportView(report, runs, aliases);

  try {
    // --- Attach the assets the reveal needs -------------------------------------
    // The URL is required to LOOK like one. It used to be \S+, which meant `loom $499` stored
    // "$499" as the recording's URL and silently ate the price override below.
    const assetMatch = text.match(/^(redesign|loom)\s+(<?https?:\/\/\S+)$/i);
    if (assetMatch) {
      const field = assetMatch[1].toLowerCase() === "redesign" ? "redesign_url" : "loom_url";
      await attachAsset(report, args.channel, args.threadTs, field, unwrapSlackUrl(assetMatch[2]));
      return true;
    }

    // --- The Loom wizard, step 1: the prompts, the pre-flight, pick the customer ---
    // Deliberately AFTER the asset match above, so "loom <url>" still stores the video.
    const loomMatch = text.match(/^(?:loom|beat sheet|beatsheet|guion|guión)\b\s*([^?]*)\??$/i);
    if (loomMatch) {
      await startLoomWizard(report, args.channel, args.threadTs, view, runs, loomMatch[1] ?? "");
      return true;
    }

    // --- The Loom wizard, steps 2 and 3: the digits ------------------------------
    const loomPick = loomPending ? text.match(/^([1-6])$/) : null;
    if (loomPick) {
      await advanceLoomWizard(report, args.channel, args.threadTs, view, runs, parseInt(loomPick[1], 10));
      return true;
    }

    // --- Abandon a half-finished wizard ------------------------------------------
    // Without this, walking away mid-wizard leaves the menu pending forever and a "1" typed
    // days later to make an Outlook draft silently picks a customer instead.
    if (loomPending && /^(cancel|nevermind|never mind|stop)\??$/i.test(text)) {
      await supabaseAdmin.from("audit_reports").update({ loom_state: null }).eq("id", report.id);
      await slack.postThreadReply(args.channel, args.threadTs, "Dropped the loom menu. *1* means the Outlook draft again.");
      return true;
    }

    // --- Rebuild the script without redoing the wizard ---------------------------
    // Note there is no `guion` alias here: `guion` is one of the loom triggers above and would
    // never reach this line.
    //
    // `script Fran` takes the name too, because the name is the one thing likely to be wrong on
    // the first build (a cold /audit run has no contact row) and making him redo all three wizard
    // steps to fix a greeting is how he ends up recording it wrong instead.
    const scriptCmd = text.match(/^(?:script|full script)(?:\s+([a-z][a-z'.-]*(?:\s+[a-z][a-z'.-]*)?))?\??$/i);
    if (scriptCmd) {
      const greetName = scriptCmd[1]?.trim();
      if (greetName && report.loom_state) {
        await supabaseAdmin
          .from("audit_reports")
          .update({ loom_state: { ...report.loom_state, greetName } })
          .eq("id", report.id);
      }
      await postLoomScript(report, args.channel, args.threadTs, view, runs, await resolveLoomAvatar(report, view), {
        greetName,
      });
      return true;
    }

    // --- The call script ---------------------------------------------------------
    // Context has to come after a COLON, and that is not a style choice. The bare-word form is
    // exact for the same reason: at `revealed`, free text is the PROSPECT talking, and "call me
    // next quarter" is one of the most common things a prospect says. A `call\s+(.*)` pattern
    // would eat that stall and hand back a script instead of the objection reply it needs.
    //
    // The VERB picks the script, and nothing else does. `call` is ALWAYS the follow-up; `close`
    // is the only thing that produces a selling script.
    //
    // This used to auto-escalate to closing once a `loom_url` existed, and that was wrong twice
    // over. A stored recording proves the video was MADE, not watched, so it opened selling to
    // people who never pressed play. And it made one word mean a gentle follow-up on Monday and a
    // price conversation on Thursday, which is not a thing to discover with the phone ringing.
    // The follow-up card branches on the video instead, and its yes branch says to type `close`.
    const callCmd = text.match(/^(call|followup|follow[ -]?up|closing|close)\s*(?::\s*(.+))?\??$/i);
    if (callCmd) {
      const verb = callCmd[1].toLowerCase().replace(/[ -]/g, "");
      const mode: CallMode = verb === "close" || verb === "closing" ? "closing" : "followup";
      await postCallScript(report, args.channel, args.threadTs, view, callCmd[2] ?? "", mode);
      return true;
    }

    // --- Redo the intake --------------------------------------------------------
    if (/^(questions|intake|restart intake|ask me)\??$/i.test(text)) {
      await restartIntake(report, args.channel, args.threadTs, view);
      return true;
    }

    // --- Stage 1: the pre-pitch ladder ------------------------------------------
    const nudgeMatch = text.match(/^nudge\s+(\d+)$/i);
    if (nudgeMatch) {
      const step = parseInt(nudgeMatch[1], 10);
      const touch = PERMISSION_SEQUENCE.find((t) => t.n === step);
      const draft = await draftPermissionEmail(report, view, step, report.intake_answers);
      if (!draft.subject) {
        // draftPermissionEmail puts its "no such step" explanation in the body.
        await slack.postThreadReply(args.channel, args.threadTs, draft.body);
        return true;
      }
      await postSingleDraft(
        report,
        args.channel,
        args.threadTs,
        `:envelope: Nudge ${step}${touch ? ` · ${touch.day} · ${touch.name}` : ""} (no links, no price, one ask):`,
        { label: `Nudge ${step}`, subject: draft.subject, body: draft.body },
        THREAD_COMMANDS,
        { removedLinks: draft.removedLinks, formatNote: draft.formatNote },
        await draftPreSellOptions(report, view, {
          exclude: installedBeliefs(readLedger(report)),
          // Puts B4 first when their Google profile is strong or they bragged about it at intake.
          preferred: selectBelief(report, readLedger(report)).id,
          language: report.call_language === "es" ? "es" : "en",
        })
      );
      return true;
    }

    // --- The delivery email, gated on the transcript ----------------------------
    // The playbook rule: no transcript, no draft. Two forms are accepted — `delivery` on its own
    // (which looks for a transcript already pasted in the thread) and the transcript pasted with
    // the word `delivery` on the first line.
    const deliveryMatch = text.match(/^(?:delivery|entrega|deliver)\b\s*([\s\S]*)$/i);

    // A bare pasted transcript IS the command. Recording the Loom and then pasting the transcript
    // is the natural next move, and having to remember to type `delivery` above it is a rule the
    // thread can enforce for itself. Without this the paste falls through to the stage branches
    // below, where at `drafted` it reads as an instruction to revise the draft and at `revealed`
    // as the prospect talking: both spend a Claude call producing nonsense from a transcript.
    //
    // Safe to route on because looksLikeTranscript is MECHANICAL, not a judgement: 400+ characters
    // AND three or more distinct timestamps. No draft revision ("tighter, cut the last line") and
    // no pasted objection can clear that bar, which is the same property that makes it a
    // trustworthy gate on the email itself.
    const bareCheck = deliveryMatch ? null : looksLikeTranscript(text);
    const barePaste = bareCheck?.ok ? text : null;

    // A near miss gets told why instead of being silently rewritten as a draft edit. The usual
    // cause is copying from Loom with timestamps turned off, and the recovery is one click, but
    // only if he finds out that is what happened. Requires at least one stamp so a genuinely long
    // instruction never lands here.
    if (bareCheck && !bareCheck.ok && bareCheck.stamps.length >= 1 && text.length >= 400) {
      await slack.postThreadReply(
        args.channel,
        args.threadTs,
        `:no_entry: That looks like a transcript, but ${bareCheck.reason}\n\n_If you meant to edit the draft instead, say it in a line or two._`
      );
      return true;
    }

    if (deliveryMatch || barePaste) {
      const pasted = barePaste ?? deliveryMatch?.[1]?.trim() ?? "";
      const stored = report.loom_transcript ?? "";
      const transcript = pasted.length > stored.length ? pasted : stored;

      if (barePaste) {
        await slack.postThreadReply(
          args.channel,
          args.threadTs,
          ":memo: Got the transcript. Drafting the delivery email."
        );
      }

      if (!transcript) {
        await slack.postThreadReply(
          args.channel,
          args.threadTs,
          [
            ":no_entry: I won't draft the delivery email without the Loom transcript.",
            "",
            "Not a technicality: the email quotes two timestamps and the strongest moment of the video. Without the transcript I'd be inventing both, and a prospect who clicks 3:15 and finds something else there stops believing the rest of it.",
            "",
            "Paste the transcript here (Loom · ⋯ · Copy transcript) and I'll draft it.",
          ].join("\n")
        );
        return true;
      }

      const check = looksLikeTranscript(transcript);
      if (!check.ok) {
        await slack.postThreadReply(args.channel, args.threadTs, `:no_entry: ${check.reason}`);
        return true;
      }

      if (pasted && pasted !== stored) {
        await supabaseAdmin.from("audit_reports").update({ loom_transcript: pasted }).eq("id", report.id);
      }

      const anchor = await resolveReplyAnchor(report);
      const draft = await draftDeliveryEmail(report, view, transcript, check);
      const flags = [...draft.flags];

      // Rule 1 wants a reply on the original thread. Without an anchor it still goes out, as a new
      // message, said out loud rather than discovered later in Outlook.
      if (!anchor) {
        flags.push(
          "No encontré el correo original en Outlook, así que esto sale como mensaje nuevo y no como respuesta en el hilo. Revisa el asunto antes de enviar."
        );
      }

      const subject = anchor?.subject ? `re: ${anchor.subject.replace(/^re:\s*/i, "")}` : draft.subject;

      await postSingleDraft(
        report,
        args.channel,
        args.threadTs,
        [
          `:inbox_tray: *Delivery* · ${draft.scorecardStamp} (score) and ${draft.closeStamp} (price), both read off the transcript`,
          anchor
            ? `_Replies on the existing thread (found via ${anchor.source}). Outlook writes the Re: line itself._`
            : `_No thread found, this will go as a new message._`,
        ].join("\n"),
        {
          label: "Delivery",
          subject,
          body: draft.body,
          replyToMessageId: anchor?.messageId,
          attachScorecard: true,
        },
        THREAD_COMMANDS
      );

      await slack.postThreadReply(
        args.channel,
        args.threadTs,
        flags.length
          ? [":warning: *FLAGS*", ...flags.map((f) => `• ${f}`)].join("\n")
          : ":warning: *FLAGS*\nSin flags."
      );
      return true;
    }

    // --- The niche intel brief (A-E, G). Reddit-first, cached per niche ---------
    const briefMatch = text.match(/^brief\s*(fresh|new|regenerate)?$/i);
    if (briefMatch) {
      await slack.postThreadReply(
        args.channel,
        args.threadTs,
        `:mag: Researching ${report.business_type ?? "this niche"} on Reddit. This takes a minute.`
      );
      const result = await getIntelBrief(report, { force: !!briefMatch[1] });
      const md = formatBriefMarkdown(result, report);
      const b = result.brief;
      await slack.uploadFile(
        args.channel,
        `intel-brief-${result.nicheKey.replace(/[^a-z0-9]+/gi, "-")}.md`,
        Buffer.from(md, "utf8"),
        "text/markdown",
        args.threadTs
      );
      // Where it read matters now that Reddit is unreachable and the source rule is a blocklist
      // rather than an allowlist. A brief built from trade press must not read like owner talk.
      const domains = sourceDomains(b);
      await slack.postThreadReply(
        args.channel,
        args.threadTs,
        [
          `:brain: *Intel brief · ${report.business_type ?? result.nicheKey}*${result.cached ? ` _(reused, ${result.ageDays}d old)_` : ""}`,
          `Loudest pain: *"${b.pains[0]?.says ?? "n/a"}"*`,
          b.horrorStories[0] ? `Best cold-open hook: _${b.horrorStories[0].hook}_` : null,
          b.objections[0] ? `They'll be afraid of: "${b.objections[0].fear}"` : null,
          domains.length
            ? `_Quotes came from: ${domains.join(", ")}._`
            : "_No quoted source survived, so treat the stories as the market pattern only._",
          "",
          "`avatars` for the 3 worst / 3 best · `brief fresh` to re-research.",
        ]
          .filter(Boolean)
          .join("\n")
      );
      return true;
    }

    // --- 3 worst / 3 best / the pick, cached per niche --------------------------
    const avatarsMatch = text.match(/^avatars?\s*(fresh|new|regenerate)?$/i);
    if (avatarsMatch) {
      const result = await getNicheAvatars(report, view, { force: !!avatarsMatch[1] });
      await slack.postThreadReply(args.channel, args.threadTs, formatAvatarsCard(result, report));
      return true;
    }

    // --- The dream-lead image prompt (page 1 of the doc, and the Loom cold open) -
    const dreamMatch = text.match(
      /^(?:dreamlead|dream lead|image)\s*([1-3])?\s*(phone|inbox|form|split|booking|order|crm|dashboard|text|sms)?$/i
    );
    if (dreamMatch) {
      const override = dreamMatch[2] ? PRESET_ALIASES[dreamMatch[2].toLowerCase()] : undefined;
      // Which of the niche's three best customers this picture is of. Defaults to the pick.
      const avatars = await getNicheAvatars(report, view).catch(() => null);
      const wanted = dreamMatch[1] ? parseInt(dreamMatch[1], 10) : avatars?.avatars.pick;
      const hint = avatars && wanted ? avatars.avatars.best[wanted - 1] : undefined;
      const built = await buildDreamLeadPrompt(report, view, override, hint);
      if (!built.ok) {
        await slack.postThreadReply(args.channel, args.threadTs, `:warning: ${built.reason}`);
        return true;
      }
      const v = built.variables;
      await slack.postThreadReply(
        args.channel,
        args.threadTs,
        [
          `:framed_picture: *Dream lead* · \`${built.preset}\` _(${built.presetWhy})_`,
          hint ? `_From the niche set: best customer #${wanted}, ${hint.label}._` : "_Derived from the questions they're missing. Run \`avatars\` first for the full 3 worst / 3 best._",
          `*Avatar:* ${v.avatar}`,
          `*Ticket signal:* ${v.ticketSignal}`,
          `*They ask AI:* "${v.avatarQuestion}"`,
          "",
          "Paste into ChatGPT image mode. Regenerate until every word on screen is spelled right, then use it as page 1 of the doc and the first thing on screen in the Loom.",
          "",
          "```",
          built.prompt,
          "```",
          "",
          ":warning: On camera this is the TARGET, never a result: _\"this is the exact kind of inquiry we point at your phone.\"_ Never present it as a lead that already came in.",
          `Other presets: \`image phone\` · \`image inbox\` · \`image split\` · \`image booking\` · \`image crm\` · \`image text\``,
          `Or reply \`loom\` to pick the customer and the picture together, and get the script with it.`,
        ].join("\n")
      );
      return true;
    }

    // --- Install one of the offered pre-sell lines ------------------------------
    const seedMatch = text.match(/^seed\s+([1-9]\d*)$/i);
    if (seedMatch) {
      const pick = parseInt(seedMatch[1], 10);
      const ledger = readLedger(report);
      const chosen = ledger.offered[pick - 1];
      const current = (report.pending_drafts ?? [])[0];

      if (!chosen) {
        await slack.postThreadReply(
          args.channel,
          args.threadTs,
          `I don't have pre-sell line ${pick} for this thread. Redraft and I'll offer three fresh ones.`
        );
        return true;
      }
      if (!current) {
        await slack.postThreadReply(args.channel, args.threadTs, "There's no draft queued here to put that line into.");
        return true;
      }

      const seeded = { ...current, body: spliceSeedAboveClose(current.body, chosen.line) };
      // Lint against the ledger as it stands BEFORE the install, or rule 7 would fire on the
      // very belief being installed.
      const check = lintDraft({
        body: seeded.body,
        subject: seeded.subject,
        stage: "draft-1",
        installs: [chosen.belief],
        ...lintContext(report),
      });
      if (!check.ok) {
        await slack.postThreadReply(
          args.channel,
          args.threadTs,
          `:no_entry: Adding ${chosen.belief} there breaks the draft rules, so I left it alone.\n\n${formatLintFindings(check.findings)}`
        );
        return true;
      }

      const installed = await installSeed(report, pick, "draft 1");
      if (!installed) {
        await slack.postThreadReply(args.channel, args.threadTs, `Couldn't record that seed. Try redrafting.`);
        return true;
      }
      await supabaseAdmin.from("audit_reports").update({ pending_drafts: [seeded] }).eq("id", report.id);
      await slack.postThreadReply(
        args.channel,
        args.threadTs,
        `:seedling: *${chosen.belief} installed* · ${chosen.label}\n\nSubject: ${seeded.subject}\n\n${seeded.body}\n\n${THREAD_COMMANDS}`
      );
      await slack.postThreadReply(
        args.channel,
        args.threadTs,
        formatSeedLog(installed.ledger.installed[installed.ledger.installed.length - 1], installed.ledger)
      );
      return true;
    }

    // --- Stage 2: they said yes -------------------------------------------------
    const revealMatch = text.match(/^(?:reveal|yes|they said yes|he said yes|she said yes|they're in|send everything)\b[,:]?\s*(.*)$/i);
    if (revealMatch) {
      const terms = revealMatch[1]?.trim() || null;
      const draft = await draftRevealMessage(report, view, terms);
      await supabaseAdmin.from("audit_reports").update({ outreach_stage: "revealed" }).eq("id", report.id);
      const missing = [
        report.redesign_url ? null : "no redesign link saved (`redesign <url>`)",
        report.loom_url ? null : "no Loom saved (`loom <url>`)",
      ].filter(Boolean);
      const footer = [
        THREAD_COMMANDS,
        missing.length > 0 ? `Not included: ${missing.join(", ")}.` : "",
        terms ? "" : "Offer terms defaulted to both tiers, reply `reveal Core only` or `reveal $499/mo, setup waived` to change them.",
      ]
        .filter(Boolean)
        .join(" ");
      await postSingleDraft(
        report,
        args.channel,
        args.threadTs,
        ":unlock: *Reveal* · everything at once, links and price allowed here:",
        { label: "Reveal", subject: draft.subject, body: draft.body },
        footer
      );
      return true;
    }

    // --- Stage 3: the post-reveal belief ladder (unchanged) ---------------------
    const emailMatch = text.match(/^email\s+(\d+)$/i);
    if (emailMatch) {
      const step = parseInt(emailMatch[1], 10);
      const belief = BELIEF_SEQUENCE.find((b) => b.n === step);
      const options = await draftEmailOptions(report, view, { kind: "sequence", step });
      const note =
        report.outreach_stage && report.outreach_stage !== "revealed"
          ? "\n_Heads up: this ladder assumes they've already seen the report. Before the reveal, use `nudge 2` instead._"
          : "";
      await postOptions(report, args.channel, args.threadTs, `✉️ Email ${step}${belief ? ` — ${belief.name}` : ""} · 3 options:${note}`, options);
      return true;
    }

    // --- `draft` — write email 1 now --------------------------------------------
    // A COMMAND, not intake answers (2026-08-10). The picker above catches `draft it`, but bare
    // `draft` matched nothing and fell through to the free-text branch, where at awaiting_intake
    // the word itself was stored as the answers and quoted to the drafter as instructions that
    // OUTRANK the generic guidance. `draft pelase jossana guerrero` did the same with a typo, and
    // "jossana" became the prospect's name on the row. The verb now does what it says at any
    // stage, and anything after it is the answers.
    const draftMatch = text.match(/^draft\b[:,]?\s*([\s\S]*)$/i);
    if (draftMatch) {
      await draftEmailOne(report, args.channel, args.threadTs, view, draftMatch[1].trim(), args.files);
      return true;
    }

    // --- Free text: meaning depends on where the thread is ----------------------
    // At awaiting_intake the four questions are on screen and free text is genuinely the answers,
    // so that fast path stays. An @mention overrides it: he is talking to the bot, not answering.
    if (report.outreach_stage === "awaiting_intake" && !args.isMention) {
      await draftEmailOne(report, args.channel, args.threadTs, view, text, args.files);
      return true;
    }

    // --- Call notes pasted in: the post-call email -------------------------------
    //
    // A block of jotted notes after a phone call IS the command, the same way a pasted transcript
    // is. Nothing else in the thread produces that shape, and typing a word above it every time is
    // a rule the thread can enforce for itself.
    //
    // ‼️ PLACEMENT IS LOAD-BEARING, IN BOTH DIRECTIONS.
    //
    // BELOW the awaiting_intake branch, because there a long multi-line paste is the intake answers
    // and nothing else: you cannot have notes from a call with someone you have not emailed yet.
    // Moving this above it would eat email 1 for every prospect whose intake answers ran long.
    //
    // ABOVE runAgentTurn, obviously, but that is the branch it is taking messages FROM, so the gate
    // has to be something a model could not argue its way past. looksLikeCallNotes is mechanical
    // for exactly that reason, and it exempts anything carrying an @mention: a message addressed to
    // the assistant is never notes, which is also the recovery when this reads something wrong.
    const notesCheck = looksLikeCallNotes(text);
    if (notesCheck.ok) {
      await slack.postThreadReply(
        args.channel,
        args.threadTs,
        [
          ":memo: Reading that as call notes. Drafting the email that asks for the yes on the Loom.",
          "_If you meant to talk to me instead, @ me._",
        ].join("\n")
      );

      // Stored verbatim BEFORE the draft, so a generation that fails still leaves the notes on the
      // row for the next attempt and for the live call brief. Same reasoning as loom_transcript.
      await supabaseAdmin
        .from("audit_reports")
        .update({ call_notes: text, call_notes_at: new Date().toISOString() })
        .eq("id", report.id);

      const gated = await draftWithLint(
        (attempt, previous) =>
          draftNotesEmail(report, view, text, attempt === 0 ? "" : retryInstruction(previous)),
        (r) => ({ body: r.draft.body, subject: r.draft.subject, stage: "draft-1", ...lintContext(report) })
      );

      const result = gated.draft ?? gated.lastRejected;
      if (!result) return true; // unreachable: draftWithLint always returns one of the two
      if (!gated.draft) await postLintRefusal(report, args.channel, args.threadTs, "the post-call email", gated);

      const anchor = await resolveReplyAnchor(report);
      const flags = [...result.flags];
      if (!anchor) {
        flags.push(
          "No encontré el correo original en Outlook, así que esto sale como mensaje nuevo y no como respuesta en el hilo. Revisa el asunto antes de enviar."
        );
      }

      await postSingleDraft(
        report,
        args.channel,
        args.threadTs,
        [
          ":telephone_receiver: *Post-call* · written from your notes, one ask: can I send the video",
          anchor
            ? `_Replies on the existing thread (found via ${anchor.source}). Outlook writes the Re: line itself._`
            : `_No thread found, this will go as a new message._`,
        ].join("\n"),
        {
          ...result.draft,
          subject: anchor?.subject ? `re: ${anchor.subject.replace(/^re:\s*/i, "")}` : result.draft.subject,
          replyToMessageId: anchor?.messageId,
        },
        THREAD_COMMANDS,
        { removedLinks: result.removedLinks, formatNote: result.formatNote },
        await draftPreSellOptions(report, view, {
          exclude: installedBeliefs(readLedger(report)),
          preferred: selectBelief(report, readLedger(report)).id,
          language: report.call_language === "es" ? "es" : "en",
        })
      );

      await slack.postThreadReply(
        args.channel,
        args.threadTs,
        flags.length
          ? [":warning: *FLAGS*", ...flags.map((f) => `• ${f}`)].join("\n")
          : ":warning: *FLAGS*\nSin flags."
      );
      return true;
    }

    // --- Everything else reasons ------------------------------------------------
    //
    // What used to be here was two fall-throughs: at `drafted`, revise email 1 in place; anywhere
    // else, treat the message as the prospect talking and write an objection reply. Between them
    // they ate every question, every out-of-band instruction and every request for a different
    // artifact, because neither could do anything except produce the email it was built for.
    //
    // The revision path is not gone. It is `edit_draft` behaviour the agent chooses when he is
    // actually editing a draft, which is a decision that needs to read the last few messages.
    return await runAgentTurn(report, args, view);
  } catch (e) {
    await slack.postThreadReply(args.channel, args.threadTs, `⚠️ Couldn't draft that: ${(e as Error).message}`).catch(() => {});
  }

  return true;
}

/**
 * Hand the message to the reasoning agent, with a visible placeholder while it thinks.
 *
 * Runs take 20 to 60 seconds because the agent reads Outlook, the report and sometimes the CRM
 * before answering. Slack's own 3 second retry is already neutralised at the top of the events
 * route; the placeholder is for the human, who otherwise watches a thread do nothing for a minute
 * and types the message again.
 */
async function runAgentTurn(
  report: AuditReportRow,
  args: { channel: string; threadTs: string; text: string; messageTs?: string | null },
  view: ReportView
): Promise<boolean> {
  const placeholder = (await slack
    .postThreadReply(args.channel, args.threadTs, ":brain: _thinking..._")
    .catch(() => null)) as { ts?: string } | null;

  const say = async (text: string) => {
    if (placeholder?.ts) await slack.updateMessage(args.channel, placeholder.ts, text).catch(() => {});
    else await slack.postThreadReply(args.channel, args.threadTs, text).catch(() => {});
  };

  try {
    const { reply } = await runThreadAgent({
      report,
      channel: args.channel,
      threadTs: args.threadTs,
      messageTs: args.messageTs ?? null,
      text: args.text.replace(/<@[A-Z0-9]+>/g, "").trim(),
    });
    await say(reply || "_(nothing to say to that)_");
  } catch (e) {
    const msg = (e as Error)?.message ?? String(e);
    console.error("[audit-thread] agent failed:", msg);
    // The old objection-reply fall-through is the honest fallback ONLY after the reveal, where a
    // free-text message really is likely to be the prospect talking. Before that it would answer
    // an objection nobody made, which is the behaviour this whole change exists to remove.
    if (report.outreach_stage === "revealed") {
      try {
        const options = await draftEmailOptions(report, view, { kind: "objection", prospectSaid: args.text });
        await say(`⚠️ I couldn't reason that through (${msg}), so here are reply drafts treating it as the prospect talking:`);
        await postOptions(report, args.channel, args.threadTs, `✉️ Reply drafts · 3 options:`, options);
        return true;
      } catch {
        /* fall through to the plain error below */
      }
    }
    await say(`⚠️ I couldn't work that out: ${msg}`);
  }
  return true;
}

/**
 * The old in-place revision of the queued draft.
 *
 * Kept as its own function because it is still the right move when he IS editing a draft; it was
 * only wrong as the default for anything he typed. Reachable from the agent, not from a fall-through.
 */
export async function reviseQueuedDraft(
  report: AuditReportRow,
  channel: string,
  threadTs: string,
  view: ReportView,
  text: string
): Promise<boolean> {
  const previous = (report.pending_drafts ?? [])[0];
  if (!previous) return false; // nothing queued to edit; the caller says so.

  // Lint-gated like the creation path (2026-08-10). It called ensurePermissionClose() but
  // was not gated, so the SAME body was rejected when written and accepted when revised.
  const gated = await draftWithLint(
    (attempt, findings) =>
      revisePreviousDraft(report, view, previous, attempt === 0 ? text : `${text}\n\n${retryInstruction(findings)}`),
    (r) => ({ body: r.draft.body, subject: r.draft.subject, stage: "draft-1", ...lintContext(report) })
  );
  const result = gated.draft ?? gated.lastRejected;
  if (!result) return true; // unreachable: one of the two is always set
  const { draft: revised, removedLinks, formatNote, nameWarning } = result;
  if (!gated.draft) await postLintRefusal(report, channel, threadTs, "the revision", gated);
  await postSingleDraft(
    report,
    channel,
    threadTs,
    `:pencil2: *${revised.label}* · revised:`,
    revised,
    THREAD_COMMANDS,
    { removedLinks, formatNote, nameWarning },
    await draftPreSellOptions(report, view, {
      exclude: installedBeliefs(readLedger(report)),
      // Puts B4 first when their Google profile is strong or they bragged about it at intake.
      preferred: selectBelief(report, readLedger(report)).id,
      language: report.call_language === "es" ? "es" : "en",
    })
  );
  return true;
}
