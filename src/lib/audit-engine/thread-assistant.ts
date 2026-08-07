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
import { buildIntakeQuestions, postIntakeCard, draftFromIntake, revisePreviousDraft } from "./outreach-intake";
import { computeBeatSheetFacts, renderPreflight } from "./loom-beatsheet";
import { buildLoomScript } from "./loom-script";
import { buildImageIdeas, formatIdeasCard } from "./image-ideas";
import { buildCallScript, buildFollowupScript, detectMode, formatCallScript, formatFollowupScript, type CallMode } from "./call-script";
import { buildDreamLeadPrompt, PRESET_ALIASES, type Preset } from "./dream-lead";
import { getNicheAvatars, formatAvatarsCard, type BestAvatar, type NicheAvatars } from "./niche-avatars";
import { getIntelBrief, formatBriefMarkdown, sourceDomains } from "./intel-brief";
import { draftDeliveryEmail, looksLikeTranscript } from "./delivery-email";
import { resolveReplyAnchor } from "./reply-anchor";
import { generateScorecardPDF } from "./pdf-scorecard";
import { scorecardFileName } from "./finish-report";
import { computeWeightedScore } from "./report-view";
import {
  draftWithLint,
  formatLintFindings,
  lintDraft,
  retryInstruction,
  type LintInput,
} from "./draft-linter";
import { formatSeedLog, installSeed, readLedger, saveOffered, installedBeliefs, selectBelief } from "./seed-ledger";
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
  "*delivery* + transcript = hand-over email  ·  *redesign <url>* / *loom <url>* store an asset  ·  *questions* redo intake",
  "*call* the phone script for wherever they are  ·  *followup* / *close* force which one  ·  *call: <context>* aims it",
  "Anything else you type edits the draft.",
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
  forcedMode: CallMode | null
): Promise<void> {
  const mode = forcedMode ?? detectMode(report);

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
      "After recording, paste the transcript here and reply `delivery` for the hand-over email.",
    ].join("\n")
  );
}

export async function handleAuditThreadReply(args: { channel: string; threadTs: string; text: string }): Promise<boolean> {
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
    // The VERB picks the script. `call` reads the stage off the row, which is what he types
    // day to day; `followup` and `close` force it, for the cases the row cannot know about
    // (he sent the video by hand, or they replied to the email and the row hasn't caught up).
    // Guessing wrong in the closing direction is the expensive one: a seven-close card quoting
    // price handling at someone who has only ever seen one cold email.
    const callCmd = text.match(/^(call|followup|follow[ -]?up|closing|close)\s*(?::\s*(.+))?\??$/i);
    if (callCmd) {
      const verb = callCmd[1].toLowerCase().replace(/[ -]/g, "");
      const forced: CallMode | null =
        verb === "followup" ? "followup" : verb === "close" || verb === "closing" ? "closing" : null;
      await postCallScript(report, args.channel, args.threadTs, view, callCmd[2] ?? "", forced);
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
    if (deliveryMatch) {
      const pasted = deliveryMatch[1]?.trim() ?? "";
      const stored = report.loom_transcript ?? "";
      const transcript = pasted.length > stored.length ? pasted : stored;

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
        terms ? "" : "Offer terms defaulted, reply `reveal $299/mo, setup waived` to change them.",
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

    // --- Free text: meaning depends on where the thread is ----------------------
    if (report.outreach_stage === "awaiting_intake") {
      // Generate, lint, retry. The intake answers already outrank the generic guidance in this
      // drafter, so appending the rejection reasons to them is how attempt 2 learns what
      // attempt 1 got wrong.
      const gated = await draftWithLint(
        (attempt, previous) =>
          draftFromIntake(report, view, attempt === 0 ? text : `${text}\n\n${retryInstruction(previous)}`),
        (r) => ({ body: r.draft.body, subject: r.draft.subject, stage: "draft-1", ...lintContext(report) })
      );
      if (!gated.draft) {
        await slack.postThreadReply(
          args.channel,
          args.threadTs,
          `:no_entry: I couldn't get email 1 past the draft rules in ${gated.attempts} attempts, so I'm not posting it.\n\n${formatLintFindings(gated.findings)}\n\nTell me how you'd rather put it and I'll redraft.`
        );
        return true;
      }
      const { draft, extracted, removedLinks, formatNote, nameWarning } = gated.draft;
      await supabaseAdmin
        .from("audit_reports")
        .update({
          intake_answers: text,
          outreach_stage: "drafted",
          // Only overwrite with something real, so a second pass that omits the email
          // doesn't wipe the address captured on the first.
          ...(extracted.prospect_name ? { prospect_name: extracted.prospect_name } : {}),
          ...(extracted.prospect_email ? { prospect_email: extracted.prospect_email } : {}),
          ...(extracted.redesign_url ? { redesign_url: extracted.redesign_url } : {}),
        })
        .eq("id", report.id);

      const captured = [
        extracted.prospect_name ? `to ${extracted.prospect_name}` : null,
        extracted.prospect_email,
        extracted.redesign_url ? "redesign link in play" : null,
      ].filter(Boolean);

      await postSingleDraft(
        { ...report, pending_drafts: [draft] },
        args.channel,
        args.threadTs,
        `:envelope: *Email 1* · pre-pitch, one finding, one ask, no price${captured.length > 0 ? `\n_${captured.join(" · ")}_` : ""}`,
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
      return true;
    }

    if (report.outreach_stage === "drafted") {
      const previous = (report.pending_drafts ?? [])[0];
      if (previous) {
        const { draft: revised, removedLinks, formatNote, nameWarning } = await revisePreviousDraft(report, view, previous, text);
        await postSingleDraft(
          report,
          args.channel,
          args.threadTs,
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
    }

    // Default (and everything after the reveal): treat it as the prospect talking.
    const options = await draftEmailOptions(report, view, { kind: "objection", prospectSaid: text });
    await postOptions(report, args.channel, args.threadTs, `✉️ Reply drafts · 3 options:`, options);
  } catch (e) {
    await slack.postThreadReply(args.channel, args.threadTs, `⚠️ Couldn't draft that: ${(e as Error).message}`).catch(() => {});
  }

  return true;
}
