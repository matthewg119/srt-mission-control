// The follow-up / closing CALL script, for the moment Matthew actually dials.
//
// Everything else in this folder produces something WRITTEN: the permission email, the reveal,
// the belief ladder, the Loom script that gets read at a camera. `call` is the one command whose
// output is spoken live, into a phone, with a person on the other end who can interrupt. That
// changes what it has to be: bullets, one breath per line, and a branch ready for whatever they
// say back. Nobody reads a paragraph while a prospect is waiting.
//
// ── The split that matters ──────────────────────────────────────────────────────
// TWO things come back and they are generated in different ways ON PURPOSE:
//
//   the SCRIPT       written by Claude, because wording a close for this business is writing
//   the COACH NOTES  built in CODE by buildCoachNotes(), because it is a data brief
//
// The notes block is what gets pasted into the SRT Call Coach extension, where it becomes the
// grounding context for every live suggestion for the rest of the call. If a model wrote the
// numbers in it, one hallucinated figure would propagate into everything the coach said for the
// next forty minutes, and it would sound authoritative doing it. So the numbers are assembled
// from `audit_runs` by hand and the model never touches them.
//
// ── What it refuses to do ───────────────────────────────────────────────────────
// Same no-fabrication rule as run-prompts.ts and report-view.ts, applied to speech. A number that
// is not in `facts` may not be spoken, because the prospect has the report open and can count.
// There is also NO GUARANTEE on this offer, so no close may imply one, and no close may ever
// suggest funding this personally. Those are in HARD_LINES and they are not negotiable by a
// free-text instruction typed into the thread.

import { callClaudeJSON, camelizeKeys } from "@/lib/claude-calls";
import { LOOM_PRICE_LABEL, LOOM_START_WINDOW } from "@/config/pitch";
import { noDashes } from "./email-assistant";
import { getNicheAvatars, type BestAvatar, type NicheAvatars, type WorstCustomer } from "./niche-avatars";
import { computeWeightedScore, type ReportView } from "./report-view";
import { readLedger } from "./seed-ledger";
import type { AuditReportRow } from "./types";

/**
 * Which call this is, and it is NOT a cosmetic switch.
 *
 *   followup  they have had email 1 and nothing else. No video, no price, no reveal. The job of
 *             the call is to earn "yes, send it" and to get them to REPLY to that email while he
 *             is still on the phone. Closing here would be pitching a price to someone who has
 *             not seen the work.
 *   closing   they have seen everything. One obstacle gets removed, then paperwork.
 *
 * The failure this exists to prevent is real and was hit on the first live run: `call` produced a
 * seven-close closing script for a prospect who had only ever received email 1, complete with
 * price objection handling for a price nobody had quoted.
 */
export type CallMode = "followup" | "closing";

/**
 * The three commands, and the handoff between them.
 *
 *   loom    writes the recording: the beat sheet, the customer, the script.
 *   call    the follow-up phone script. ALWAYS the follow-up, never the close.
 *   close   the selling script, and the only thing that produces one.
 *
 * `call` deliberately does NOT escalate itself once a Loom exists. It branches instead: when the
 * video has gone out, the card opens on "did you get through it", and the yes branch hands off to
 * `close` rather than trying to be both. Auto-escalating on `loom_url` was the earlier behaviour
 * and it was wrong twice over. A stored recording says the video was MADE, not that anyone watched
 * it, so it would open selling to someone who never pressed play; and it made the same word mean a
 * gentle follow-up on Monday and a price conversation on Thursday, which is not something you want
 * to discover with the phone already ringing.
 */

/** How many objection branches the CLOSING script carries. Seven is the whole map in
 *  closing-brain.md: four circumstance stalls, two other-people, one self. Fewer leaves a live
 *  gap; more starts inventing objections nobody in this vertical actually says. */
const CLOSE_COUNT = 7;

/** How many stalls the FOLLOWUP script carries. Permission-stage stalls are a shorter, different
 *  list: nobody says "let me talk to my partner" about a free video. */
const PUSHBACK_COUNT = 5;

/** The permission-stage stalls, fixed for the same reason OBJECTIONS is. */
const PUSHBACKS = [
  { key: "notinterested", label: "Not interested", angle: "Do not sell. This is a free video about their own business. Ask one honest question that costs them nothing to answer." },
  { key: "sendemail", label: "Just send me an email", angle: "He already did, that is what the call is about. Turn it into the reply move: pull it up now, reply, and it goes out immediately." },
  { key: "whoisthis", label: "Who is this / what is this about", angle: "Straight answer in one line, no pitch. Name the business, name what was run, name what came back." },
  { key: "allset", label: "We're all set / we already do SEO", angle: "Do not attack the incumbent. Different surface: this is what the AI answer says when nobody clicks a link. Ask what they have been told about ChatGPT specifically." },
  { key: "howmuch", label: "How much is it", angle: "DO NOT QUOTE A PRICE ON THIS CALL. Nothing is being sold yet. The video is free and theirs to keep. Deflect honestly: let them see the work first, then price is a real conversation." },
] as const;

/** Max spoken words in one line. Past this it cannot be said in one breath and gets read aloud
 *  badly, which is worse than not having the line. Enforced as a warning, not a rejection. */
const MAX_SPOKEN_WORDS = 25;

/** The seven objections, fixed. They are NOT model-chosen: a fixed set means the card always has
 *  the same shape, so mid-call he can jump to "number 5" without reading the labels. */
const OBJECTIONS = [
  { key: "price", bucket: "circumstances", label: "Too expensive", angle: "Value gap, not price height. Reframe to what the gap costs them every month it keeps running." },
  { key: "budget", bucket: "circumstances", label: "Not in the budget right now", angle: "Smaller scope, NEVER a lower price. Name the reduced scope concretely. Ask which budget it would come from and when that resets." },
  { key: "cheaper", bucket: "circumstances", label: "Someone does it cheaper / we have an SEO guy", angle: "If we were the same price, who would you pick and why. Cheap optimizes for volume, which is how they end up with more of the customer that loses them money. They are buying targeting, not traffic." },
  { key: "busy", bucket: "circumstances", label: "Too busy right now", angle: "Busy is the reason, not the objection. Priorities not time: what is ahead of this. They will be busy next quarter too." },
  { key: "partner", bucket: "other people", label: "I need to talk to my partner / boss", angle: "What would they specifically push back on, that is the real objection. What if they say no. Get them on the next call. Book the date before hanging up." },
  { key: "burned", bucket: "other people", label: "We tried an agency and it didn't work", angle: "Do not defend the industry. Ask what specifically happened. Differentiate on mechanism, never on adjectives." },
  { key: "think", bucket: "self", label: "Let me think about it", angle: "What is the piece you would be thinking about. What would make this a no. Decisions need information, not time." },
] as const;

/**
 * Three genuinely different ways to open, so he can read the first two seconds and pick.
 *
 * Divergent by ANGLE, not by wording. Three polite variations of the same sentence are a
 * decoration; these open on three different things (a gift, a finding, a straight question) and
 * fail in three different ways, so if one gets a flat "not interested" the next call has somewhere
 * else to go.
 *
 * The redesign opener is only offered when a redesign actually exists. It is the strongest one
 * available because it leads with something already built and free, which is the only opener that
 * costs the listener nothing to say yes to.
 */
function openerAngles(f: CallFacts): Array<{ key: string; label: string; angle: string }> {
  const redesign = {
    key: "redesign",
    label: "The free site",
    angle:
      "Lead with the redesign that already exists and is theirs free, no strings, use it or don't. Ask if they saw it. This opens on a gift, not a pitch, so there is nothing to say no to. Do NOT paste the URL into the spoken line, he says it, not reads it.",
  };
  const finding = {
    key: "finding",
    label: "The finding",
    angle:
      "Lead with what came back when the engines were asked. Use the real absent count and, if there is one, the competitor that came back instead. One number, said plainly, then stop talking.",
  };
  const direct = {
    key: "direct",
    label: "Straight up",
    angle:
      "No hook, no cleverness. Say who he is, say he sent something, ask if it landed. This is the one that works on people who hate being sold to, and it is the only opener that survives a prospect who has already screened two calls today.",
  };
  const curiosity = {
    key: "curiosity",
    label: "The question",
    angle:
      "Open on a question about THEIR business that only someone who looked would ask, using their real buyer language from the absent prompts. Earns the next thirty seconds instead of asking for them.",
  };

  return f.redesignUrl ? [redesign, finding, direct] : [finding, direct, curiosity];
}

/** Non-negotiable. Stated to the model, and the last three are re-checked in code by lintScript. */
const HARD_LINES = [
  "NEVER invent a number. You may only speak figures that appear in FACTS below. The prospect has the report open and can count.",
  "There is NO GUARANTEE on this offer. Never say risk-free, money-back, guaranteed results, or 'if it doesn't work you don't pay'. Month to month is not a guarantee and must not be dressed up as one.",
  "Never promise customers, jobs, leads or revenue. We report VISIBILITY and nothing else. 'You will get more calls' is a banned claim.",
  "Never suggest a personal credit card, a retirement account, a personal loan, or selling anything personal. If it cannot come out of the business the deal is too big: offer a smaller scope or walk.",
  "No fake scarcity, no invented deadlines, no made-up case studies, no other clients' names or results.",
  "No em dashes anywhere.",
];

/** The doctrine, from closing-brain.md. This is the part that makes it a closing call rather than
 *  a second pitch. */
const MECHANICS = [
  "The pitch ALREADY HAPPENED. They got the audit, the email and the video. Never re-pitch, never re-explain the offer, never introduce a new feature or a new price. This call removes one obstacle and then does paperwork.",
  "Sit on the same side of the table. You are not arguing, you are helping them make a decision they already want to make.",
  "Repeat their words back before responding. Acknowledge or agree, never disagree, then reframe. A reframe is not a disagreement.",
  "Ask permission before getting blunt: 'can I be straight with you for a sec'. Then wait.",
  "ISOLATE BEFORE YOU ANSWER. Always run the box: 'if that weren't an issue, would you be a yes? anything else?' Do not answer an objection before you have that yes, or you solve one thing and they produce another.",
  "At most TWO responses per obstacle. A third reads as pressure. If two angles don't move it, the obstacle is real, so respect it.",
  "Never drop the price. If they ask for a discount the answer is a smaller scope, not a smaller number.",
  "The moment they say yes, STOP SELLING and go straight to logistics.",
  "A clean no is a real outcome, not a failure. 'Yes but later' is the thing to break.",
];

interface CloseBranch {
  key: string;
  /** Exactly two. Each is one spoken line. */
  responses: string[];
  /** The bracketed instruction for re-boxing and re-asking after the two lines. */
  rebox: string;
}

interface Opener {
  /** Which of the three angles this is. Fixed keys so the card is always numbered the same. */
  key: string;
  lines: string[];
}

interface Pushback {
  key: string;
  responses: string[];
  rebox: string;
}

interface FollowupScript {
  openers: Opener[];
  /** Only when the video has gone out. Empty otherwise, and the section is not rendered. */
  videoAsk: string;
  ifWatched: string[];
  ifNotWatched: string[];
  ifLater: string[];
  why: string[];
  flow: string[];
  replyMove: string[];
  pushback: Pushback[];
  voicemail: string[];
  textMessage: string[];
  /** The send-instead-of-dial option: same job as the call, three lines, no pitch. */
  followupEmail: { subject: string; body: string };
  dontSay: string[];
}

interface CallScript {
  open: string[];
  videoAsk: string;
  ifWatched: string[];
  ifNotWatched: string[];
  ifLater: string[];
  surface: string[];
  ask: string[];
  closes: CloseBranch[];
  yesButLater: string[];
  onYes: string[];
  onNo: string[];
  voicemail: string[];
  textMessage: string[];
  dontSay: string[];
}

/**
 * Everything true about this prospect, pulled from what is already persisted.
 *
 * Assembled once and handed to BOTH the model and buildCoachNotes, so the script and the brief
 * that grounds the live coach can never disagree about a number. Recomputing per consumer is how
 * the Loom pre-flight and the Loom script once ended up naming different prompts, which is why
 * computeBeatSheetFacts is shared the same way.
 */
interface CallFacts {
  prospect: string | null;
  company: string;
  businessType: string | null;
  city: string | null;
  buyerPersona: string | null;
  score: number;
  organicAppeared: number;
  organicTotal: number;
  /** Organic prompts they are absent from. The gap, in buyer language. */
  absentPrompts: string[];
  /** Who owns the answers instead of them, with the run count behind each name. */
  competitors: Array<{ name: string; count: number }>;
  icp: BestAvatar | null;
  antiIcp: WorstCustomer | null;
  isReposition: boolean;
  price: string;
  startWindow: string;
  /** What they have already been sent, so the call never repeats it. */
  seen: string[];
  /** The free redesign, when one was built. Drives the strongest available opener. */
  redesignUrl: string | null;
  loomUrl: string | null;
  installedBeliefs: string[];
  intakeAnswers: string | null;
  reportUrl: string | null;
  language: "en" | "es";
}

function pctText(appeared: number, total: number): string {
  if (total <= 0) return "no organic prompts measured";
  return `${appeared} of ${total}`;
}

/**
 * The avatar the call must talk about.
 *
 * Order is load-bearing. When the Loom wizard already picked a customer, the video they watched
 * was ABOUT that customer, so the call has to name the same one. Switching to a freshly generated
 * pick would mean the call contradicts the recording they just sat through, which reads as either
 * a bait and switch or a rep who does not remember his own video.
 *
 * Falls back to a fresh niche set, then to nothing. A missing avatar costs the ICP framing, not
 * the call, so this never throws: same precedent as the Loom wizard refusing to dead-end on a
 * failed avatar set.
 */
async function resolveAvatars(
  report: AuditReportRow,
  view: ReportView
): Promise<{ icp: BestAvatar | null; antiIcp: WorstCustomer | null; isReposition: boolean }> {
  const derived = report.loom_state?.derivedAvatar;
  let set: NicheAvatars | null = null;
  try {
    set = (await getNicheAvatars(report, view)).avatars;
  } catch (e) {
    console.error("[call-script] avatars unavailable:", (e as Error)?.message);
  }

  // The derived stand-in wins over a fresh set for the same reason as above: it is what the
  // recording used. It has no matching worst-customer, so the anti-ICP falls back to the set.
  if (derived) {
    return { icp: derived, antiIcp: set?.worst?.[0] ?? null, isReposition: false };
  }
  if (!set) return { icp: null, antiIcp: null, isReposition: false };

  const picked = report.loom_state?.avatarIndex ?? set.pick;
  return {
    icp: set.best[picked - 1] ?? set.best[0] ?? null,
    antiIcp: set.worst[0] ?? null,
    isReposition: set.isReposition,
  };
}

/** What they have already received, so the call opens where the conversation actually is. */
function whatTheySaw(report: AuditReportRow): string[] {
  const seen: string[] = [];
  if (report.outreach_stage === "revealed") seen.push("the full reveal: report link, price, everything");
  else if (report.outreach_stage === "drafted") seen.push("the permission email, no price yet");
  if (report.loom_url) seen.push("the Loom video");
  if (report.redesign_url) seen.push("the free redesign concept");
  if (report.requester_email) seen.push("they asked for the audit themselves, this is not cold");
  return seen;
}

export async function buildCallFacts(report: AuditReportRow, view: ReportView): Promise<CallFacts> {
  const weighted = computeWeightedScore(view);
  const { icp, antiIcp, isReposition } = await resolveAvatars(report, view);

  return {
    prospect: report.prospect_name ?? report.loom_state?.greetName ?? report.requester_name ?? null,
    company: report.client_name ?? report.business_type ?? report.website,
    businessType: report.business_type,
    city: report.city,
    buyerPersona: report.buyer_persona,
    score: weighted.score,
    organicAppeared: weighted.organicAppeared,
    organicTotal: weighted.organicTotal,
    absentPrompts: view.prompts.filter((p) => !p.isBranded && !p.appeared).map((p) => p.prompt),
    competitors: view.mostRecommended.slice(0, 5),
    icp,
    antiIcp,
    isReposition,
    // A per-recording override belongs to the whole conversation, not just the video: if the Loom
    // said $499 then $499 is the price on this call, and quoting the default would contradict it.
    price: report.loom_state?.price ?? LOOM_PRICE_LABEL,
    startWindow: report.loom_state?.window ?? LOOM_START_WINDOW,
    seen: whatTheySaw(report),
    redesignUrl: report.redesign_url,
    loomUrl: report.loom_url,
    installedBeliefs: readLedger(report).installed.map((i) => i.belief),
    intakeAnswers: report.intake_answers,
    reportUrl: report.slug ? `https://mission.srtagency.com/r/${report.slug}` : null,
    language: report.call_language === "es" ? "es" : "en",
  };
}

/** The FACTS block. The ONLY numbers the model is allowed to speak. */
function factsPrompt(f: CallFacts): string {
  const lines: string[] = [
    `Business: ${f.company}${f.businessType ? ` (${f.businessType})` : ""}${f.city ? ` in ${f.city}` : ""}`,
    f.prospect ? `Person on the call: ${f.prospect}` : "Person on the call: name unknown, do NOT invent one and do NOT use a placeholder",
    f.buyerPersona ? `Who buys from them: ${f.buyerPersona}` : "",
    "",
    `AI visibility score: ${f.score} out of 100`,
    `They appear in ${pctText(f.organicAppeared, f.organicTotal)} buyer questions that never name them`,
    f.competitors.length
      ? `Who the engines recommend instead: ${f.competitors.map((c) => `${c.name} (cited ${c.count}x)`).join(", ")}`
      : "No competitor was recommended often enough to name. Do NOT name one.",
    "",
    f.absentPrompts.length
      ? `Buyer questions they are ABSENT from (the gap, quote these verbatim, they are real buyer language):\n${f.absentPrompts.slice(0, 12).map((p) => `- ${p}`).join("\n")}`
      : "",
    "",
    f.icp
      ? `THE CUSTOMER WE POINT AT (the ICP): ${f.icp.label}. Ticket: ${f.icp.ticket}. Why it is worth it: ${f.icp.whyHighRoi}. They ask AI: "${f.icp.aiQuestion}"`
      : "No ICP available. Talk about the gap and the questions, do NOT invent a customer type.",
    f.antiIcp
      ? `THE CUSTOMER THAT COSTS THEM MONEY (the anti-ICP): ${f.antiIcp.label}. ${f.antiIcp.whyItHurts}. ${f.antiIcp.economics}`
      : "",
    f.isReposition ? "NOTE: this pick repositions the business into work it does not currently present as doing. That reposition IS the angle." : "",
    "",
    `Price: ${f.price}. Realistic first movement: ${f.startWindow}.`,
    "THERE IS NO GUARANTEE. No trial, no refund promise, no performance guarantee.",
    "",
    f.seen.length ? `What they have already seen: ${f.seen.join("; ")}` : "Nothing has been sent yet beyond the first email.",
    f.installedBeliefs.length
      ? `Angles ALREADY used in writing, do not repeat them as if new: ${f.installedBeliefs.join(", ")}`
      : "",
    f.intakeAnswers ? `Matthew's own notes on this prospect, these OUTRANK everything generic above:\n${f.intakeAnswers}` : "",
  ];
  return lines.filter((l) => l !== "").join("\n");
}

function validate(p: unknown): p is CallScript {
  const o = p as CallScript;
  return (
    !!o &&
    Array.isArray(o.open) &&
    o.open.length > 0 &&
    typeof o.videoAsk === "string" &&
    o.videoAsk.length > 0 &&
    Array.isArray(o.closes) &&
    o.closes.length === CLOSE_COUNT &&
    o.closes.every((c) => Array.isArray(c.responses) && c.responses.length === 2 && typeof c.rebox === "string") &&
    Array.isArray(o.onYes) &&
    o.onYes.length > 0
  );
}

function describeInvalid(p: unknown): string {
  if (!p || typeof p !== "object") return "the response was not a JSON object";
  const o = p as Partial<CallScript>;
  const problems: string[] = [];
  if (!Array.isArray(o.open) || o.open.length === 0) problems.push("open was missing or empty");
  if (typeof o.videoAsk !== "string" || !o.videoAsk) problems.push("videoAsk was missing");
  if (!Array.isArray(o.closes)) problems.push("closes was missing or not an array");
  else {
    if (o.closes.length !== CLOSE_COUNT) problems.push(`closes had ${o.closes.length} entries, expected exactly ${CLOSE_COUNT}, one per objection key in order`);
    const bad = o.closes.filter((c) => !Array.isArray(c?.responses) || c.responses.length !== 2);
    if (bad.length) problems.push(`${bad.length} close(s) did not have exactly 2 responses; two is the maximum, a third reads as pressure`);
  }
  if (!Array.isArray(o.onYes) || o.onYes.length === 0) problems.push("onYes was missing or empty");
  return problems.join("; ") || "it did not match the required shape";
}

/** Every section that is rendered as a list. Defaulted rather than validated: a script missing
 *  its voicemail is still a script worth dialing, but `bullets(undefined)` is a crash, and both
 *  lintScript and formatCallScript spread these. */
const LIST_SECTIONS = [
  "open", "ifWatched", "ifNotWatched", "ifLater", "surface", "ask",
  "yesButLater", "onYes", "onNo", "voicemail", "textMessage", "dontSay",
] as const;

/** Models drift to snake_case, and the objection order is easier to repair than to reject. */
function coerce(p: unknown): unknown {
  const o = camelizeKeys(p) as Record<string, unknown>;
  if (!o || typeof o !== "object") return o;

  // A section the model skipped becomes an empty list, and a section it wrote as one string
  // becomes a one-item list. Both are near-misses of exactly the kind coerce exists for: the
  // alternative is discarding a complete seven-close script over a missing voicemail.
  for (const key of LIST_SECTIONS) {
    if (o[key] === undefined || o[key] === null) o[key] = [];
    else if (typeof o[key] === "string") o[key] = [o[key]];
    else if (!Array.isArray(o[key])) o[key] = [];
    else o[key] = (o[key] as unknown[]).filter((l): l is string => typeof l === "string");
  }
  if (typeof o.videoAsk !== "string") o.videoAsk = "";

  if (Array.isArray(o.closes)) {
    const cleaned = (o.closes as CloseBranch[]).map((c) => ({
      ...c,
      responses: Array.isArray(c?.responses) ? c.responses.filter((r): r is string => typeof r === "string") : [],
      rebox: typeof c?.rebox === "string" ? c.rebox : "",
    }));
    // Re-sort into OBJECTIONS order so the card is always numbered the same way, whatever order
    // the model emitted. Mid-call he jumps to "number 5" without reading the labels, so the
    // numbering has to be stable across every prospect.
    const byKey = new Map(cleaned.map((c) => [String(c?.key ?? "").toLowerCase(), c]));
    const ordered = OBJECTIONS.map((obj) => byKey.get(obj.key)).filter(Boolean);
    o.closes = ordered.length === CLOSE_COUNT ? ordered : cleaned;
  }
  return o;
}

/**
 * Lines that are too long to say, and hard-line violations that survived the prompt.
 *
 * Reported above the script rather than rejecting it. A prose guard is not a guard, but a script
 * with one over-long line is still usable and refusing to post it would leave him with nothing to
 * dial on. The guarantee and personal-funding checks are the exception worth shouting about, so
 * they are flagged separately and prominently.
 */
function lintSpoken(spoken: string[], opts: { noPrice?: boolean } = {}): string[] {
  const warnings: string[] = [];

  const longLines = spoken.filter((l) => l.split(/\s+/).length > MAX_SPOKEN_WORDS);
  if (longLines.length) {
    warnings.push(`:warning: ${longLines.length} line(s) run past ${MAX_SPOKEN_WORDS} words. Cut them down before dialing, they cannot be said in one breath.`);
  }

  const all = spoken.join(" ").toLowerCase();
  const guarantee = ["risk-free", "risk free", "money-back", "money back", "guarantee", "guaranteed", "refund", "if it doesn't work you don't pay"];
  const hits = guarantee.filter((g) => all.includes(g));
  if (hits.length) {
    warnings.push(`:rotating_light: GUARANTEE LANGUAGE in the script (${hits.join(", ")}). There is no guarantee on this offer. Do NOT say these lines.`);
  }
  const personal = ["personal credit card", "personal card", "401k", "401(k)", "retirement", "personal loan", "home equity"];
  const personalHits = personal.filter((g) => all.includes(g));
  if (personalHits.length) {
    warnings.push(`:rotating_light: The script suggests funding this personally (${personalHits.join(", ")}). Never say this. Offer a smaller scope or walk.`);
  }

  // Follow-up stage only. Quoting a number to someone who has not seen the work is the fastest
  // way to turn a free video into a sales call, and it is the one thing this stage cannot undo.
  if (opts.noPrice) {
    const priced = spoken.filter((l) => /\$\s?\d|\bper month\b|\ba month\b|\bmonthly fee\b|\bretainer\b/i.test(l));
    if (priced.length) {
      warnings.push(`:rotating_light: A PRICE is quoted on a follow-up call (${priced.length} line(s)). Nothing is being sold yet. Cut it, the video is free.`);
    }
  }

  // The reach claim the audit cannot back. "In front of 500 more people" is not measured anywhere
  // in this pipeline, and it is exactly the kind of number a prospect asks you to show your work on.
  const reach = spoken.filter((l) => /in front of\s+[\d,]+|\b[\d,]{3,}\s+(more\s+)?(people|customers|buyers|homeowners|searches|views|impressions)\b/i.test(l));
  if (reach.length) {
    warnings.push(`:rotating_light: An audience/reach number is claimed (${reach.length} line(s)). Nothing measures that. Use the absent-question count instead.`);
  }
  return warnings;
}

/**
 * Which call this is, from what the row actually knows.
 *
 * `revealed` means they said yes to the video and got the price, the report and everything else,
 * so the next call is a close. A stored `loom_url` means the recording exists and went out. Any
 * other state means the only thing they have is email 1, and the call is a follow-up.
 */
/** Has the recording actually gone out? Decides whether the call opens on a video gate or on the
 *  reply move. A `loom_url` means it exists and was handed over; it does NOT mean they watched it,
 *  which is exactly the question the gate asks. */
export function videoHasGoneOut(f: CallFacts): boolean {
  return Boolean(f.loomUrl) || f.seen.some((s) => s.toLowerCase().includes("loom") || s.toLowerCase().includes("reveal"));
}

function validateFollowup(p: unknown): p is FollowupScript {
  const o = p as FollowupScript;
  return (
    !!o &&
    Array.isArray(o.openers) &&
    o.openers.length === 3 &&
    o.openers.every((x) => Array.isArray(x?.lines) && x.lines.length > 0) &&
    Array.isArray(o.replyMove) &&
    o.replyMove.length > 0 &&
    Array.isArray(o.flow) &&
    o.flow.length > 0 &&
    Array.isArray(o.pushback) &&
    o.pushback.length === PUSHBACK_COUNT
  );
}

function describeInvalidFollowup(p: unknown): string {
  if (!p || typeof p !== "object") return "the response was not a JSON object";
  const o = p as Partial<FollowupScript>;
  const problems: string[] = [];
  if (!Array.isArray(o.openers)) problems.push("openers was missing or not an array");
  else if (o.openers.length !== 3) problems.push(`openers had ${o.openers.length}, expected exactly 3, one per key given`);
  else if (!o.openers.every((x) => Array.isArray(x?.lines) && x.lines.length > 0)) problems.push("every opener needs a non-empty lines array");
  if (!Array.isArray(o.flow) || o.flow.length === 0) problems.push("flow was missing or empty");
  if (!Array.isArray(o.replyMove) || o.replyMove.length === 0) problems.push("replyMove was missing or empty, and it is the most important section on the card");
  if (!Array.isArray(o.pushback)) problems.push("pushback was missing");
  else if (o.pushback.length !== PUSHBACK_COUNT) problems.push(`pushback had ${o.pushback.length}, expected exactly ${PUSHBACK_COUNT}, one per key given`);
  return problems.join("; ") || "it did not match the required shape";
}

const FOLLOWUP_LISTS = [
  "why", "flow", "replyMove", "voicemail", "textMessage", "dontSay",
  "ifWatched", "ifNotWatched", "ifLater",
] as const;

function coerceFollowup(p: unknown): unknown {
  const o = camelizeKeys(p) as Record<string, unknown>;
  if (!o || typeof o !== "object") return o;
  if (typeof o.videoAsk !== "string") o.videoAsk = "";
  const email = o.followupEmail as { subject?: unknown; body?: unknown } | undefined;
  o.followupEmail = {
    subject: typeof email?.subject === "string" ? email.subject : "",
    body: typeof email?.body === "string" ? email.body : "",
  };
  for (const key of FOLLOWUP_LISTS) {
    if (o[key] === undefined || o[key] === null) o[key] = [];
    else if (typeof o[key] === "string") o[key] = [o[key]];
    else if (!Array.isArray(o[key])) o[key] = [];
    else o[key] = (o[key] as unknown[]).filter((l): l is string => typeof l === "string");
  }
  if (Array.isArray(o.openers)) {
    o.openers = (o.openers as Opener[]).map((x) => ({
      ...x,
      lines: Array.isArray(x?.lines) ? x.lines.filter((l): l is string => typeof l === "string") : [],
    }));
  }
  if (Array.isArray(o.pushback)) {
    o.pushback = (o.pushback as Pushback[]).map((x) => ({
      ...x,
      responses: Array.isArray(x?.responses) ? x.responses.filter((r): r is string => typeof r === "string") : [],
      rebox: typeof x?.rebox === "string" ? x.rebox : "",
    }));
  }
  return o;
}

/** Every spoken line on a follow-up card, for the linter. */
function followupSpoken(s: FollowupScript): string[] {
  return [
    ...s.openers.flatMap((o) => o.lines),
    ...s.ifWatched, ...s.ifNotWatched, ...s.ifLater,
    ...s.why, ...s.flow, ...s.replyMove, ...s.voicemail, ...s.textMessage,
    ...s.pushback.flatMap((p) => p.responses),
    // The email goes through the same guards as the speech. A price or a reach claim is no more
    // acceptable written down, and this one is sent rather than improvised, so it lasts longer.
    s.followupEmail.body,
  ].filter((l) => typeof l === "string" && !l.trim().startsWith("["));
}

export async function buildFollowupScript(
  report: AuditReportRow,
  view: ReportView,
  extraContext: string
): Promise<{ facts: CallFacts; script: FollowupScript; warnings: string[] }> {
  const facts = await buildCallFacts(report, view);
  const angles = openerAngles(facts);
  const videoSent = videoHasGoneOut(facts);

  const { data } = await callClaudeJSON<FollowupScript>({
    model: "claude-sonnet-4-6",
    system: [
      "You write the bullet card a rep reads off his phone while dialing a prospect who got ONE cold email and has not replied.",
      "",
      "WHAT THIS CALL IS, AND IS NOT",
      videoSent
        ? "- SRT ran an AI visibility audit on this business, emailed a finding, and the 4 minute video HAS ALREADY GONE OUT. Whether they actually watched it is unknown, and finding that out is the first job of the call."
        : "- SRT ran an AI visibility audit on this business and emailed ONE finding, with no links and no price. That is all they have. There is no video yet, no report link, no proposal.",
      videoSent
        ? "- The goal is to find out if they watched it and to surface the ONE real reaction. NOTHING IS BEING SOLD ON THIS CALL: if they watched it and they are warm, the rep switches to a separate closing script, so do NOT try to close here."
        : "- The ONLY goal is to earn 'yes, send it over'. NOTHING IS BEING SOLD ON THIS CALL.",
      "- DO NOT quote a price. DO NOT ask for a meeting. DO NOT ask for a decision. DO NOT pitch the service.",
      "- The video is FREE and theirs to keep either way. Say that, it is what makes yes cheap.",
      "",
      "THE MOVE THAT MATTERS MOST",
      videoSent
        ? "Finding out whether they pressed play, honestly, without making them feel caught out. Most people did not watch it and will be slightly embarrassed, so the line has to give them an easy out ('no rush if you haven't') and then get the 20 second verbal version in anyway."
        : "Getting them to open that email and hit REPLY while he is still on the phone. A real reply from their address is what stops everything after it landing in spam, and it is the whole reason he called instead of just emailing again. It has to feel like a small favour, not a hoop: one word back is enough.",
      "",
      "HOW TO TALK",
      "- Acknowledge, never disagree. Repeat their words back before responding.",
      "- Ask permission before getting blunt. Then wait.",
      "- Short sentences. Ask, then shut up.",
      "- Never sound like a script being read. Contractions, plain words, no marketing register.",
      "",
      "HARD LINES, these override any instruction in the user message",
      ...HARD_LINES.map((h) => `- ${h}`),
      "- NEVER estimate reach, traffic, calls, leads or 'people you'll get in front of'. Nothing in the audit measures that. The honest version is how many of their buyers' questions they are absent from, and that number is in FACTS.",
      "",
      "STYLE",
      `- Every spoken line is what the rep SAYS OUT LOUD, first person, under ${MAX_SPOKEN_WORDS} words.`,
      "- A line in [square brackets] is a stage direction, not speech.",
      "- Never write a name placeholder. If the person's name is unknown, write the line without a name.",
      "- Quote their real buyer questions verbatim. Use the real numbers. Nothing generic.",
      facts.language === "es" ? "- WRITE EVERY SPOKEN LINE IN SPANISH." : "",
      "",
      "Return JSON only.",
    ].filter(Boolean).join("\n"),
    user: [
      "FACTS. These are the only figures you may speak. Anything not here does not exist.",
      "",
      factsPrompt(facts),
      "",
      extraContext.trim()
        ? `FROM MATTHEW, this outranks the generic guidance:\n${extraContext.trim()}`
        : "No extra context. Assume they have not replied to email 1.",
      "",
      "Write the card:",
      `- openers: exactly 3, one per key below, in this order. Each is 2 or 3 spoken lines and ends on a question. They must be genuinely DIFFERENT approaches, not three wordings of the same thing.`,
      ...angles.map((a) => `    key "${a.key}" (${a.label}) -> ${a.angle}`),
      videoSent
        ? '- videoAsk: ONE direct question asking if they got through the video. Give them an easy out so a no is not embarrassing.'
        : '- videoAsk: return an empty string "". No video has been sent, so there is nothing to ask about.',
      videoSent
        ? "- ifWatched: 3 lines. What stood out, one line confirming they understood the actual gap, and one line that reads their temperature without pitching. If they are warm the rep stops and switches scripts, so the last line hands off rather than closing."
        : '- ifWatched: return an empty array [].',
      videoSent
        ? "- ifNotWatched: 3 lines. The 20 second verbal version of the single biggest finding, using one real number. ONE finding, not a summary. End on a question that gets their reaction."
        : '- ifNotWatched: return an empty array [].',
      videoSent
        ? "- ifLater: 2 lines treating 'I'll watch it later' as the stall it is, getting the real reaction now, and pinning a specific day and time to speak again."
        : '- ifLater: return an empty array [].',
      "- why: 3 or 4 bullets. The twenty second version of what was found and why it matters to them, in their language. One real number. This is what he says after the opener lands.",
      "- flow: 5 or 6 lines showing the actual ORDER the conversation should go, opener to ask, each line either what he says or a [stage direction]. This is the spine of the call, so it has to read as one continuous conversation and not a list of tactics.",
      "- replyMove: 4 lines. THE MOST IMPORTANT SECTION. (1) the ask to pull up the email and reply right now, framed as a favour and explicitly tiny, one word is fine. (2) what he says while they are hunting for it, including where to look if they can't find it. (3) what he says the moment they reply. (4) the fallback if they will not do it on the phone, which is a specific time he will call back, never an open ended 'I'll follow up'.",
      `- pushback: exactly ${PUSHBACK_COUNT} entries, one per key below, in this order. Each has TWO spoken responses worded for THIS business and a 'rebox' bracketed line on how to get back to the ask.`,
      ...PUSHBACKS.map((p) => `    key "${p.key}" = "${p.label}" -> ${p.angle}`),
      "- voicemail: 3 lines, under 20 seconds total, ends with a specific callback window. Never 'just checking in'.",
      "- textMessage: 3 lines max, references the finding, one question, no pitch, no link.",
      "- followupEmail: { subject, body }. The send-instead-of-dial option, for a day with no time to call. Body is 3 or 4 SHORT paragraphs, one sentence each, blank line between them. It does the same job as the call and nothing more: reference the finding, " +
        (videoSent ? "ask whether they got a chance to watch it" : "ask permission to send the video") +
        ". No links, no price, no attachments, exactly ONE question mark in the whole thing, and never the words 'just checking in' or 'circling back'. Do not sign it, the signature is added automatically.",
      "- dontSay: 3 lines. The three things most likely to lose THIS specific prospect at this stage.",
    ].join("\n"),
    maxTokens: 4000,
    temperature: 0.6,
    schemaHint:
      '{ "openers": [{ "key": string, "lines": string[] }] (exactly 3, keys in the given order), ' +
      '"videoAsk": string, "ifWatched": string[], "ifNotWatched": string[], "ifLater": string[], ' +
      '"why": string[], "flow": string[], "replyMove": string[], ' +
      `"pushback": [{ "key": string, "responses": [string, string], "rebox": string }] (exactly ${PUSHBACK_COUNT}, keys in the given order), ` +
      '"voicemail": string[], "textMessage": string[], "followupEmail": { "subject": string, "body": string }, "dontSay": string[] }',
    coerce: coerceFollowup,
    describeInvalid: describeInvalidFollowup,
    validate: validateFollowup,
  });

  return { facts, script: data, warnings: lintSpoken(followupSpoken(data), { noPrice: true }) };
}

export async function buildCallScript(
  report: AuditReportRow,
  view: ReportView,
  extraContext: string
): Promise<{ facts: CallFacts; script: CallScript; warnings: string[] }> {
  const facts = await buildCallFacts(report, view);

  const { data } = await callClaudeJSON<CallScript>({
    model: "claude-sonnet-4-6",
    system: [
      "You are the best closer alive, writing the bullet card a rep reads off his phone WHILE on a live call.",
      "The product is AI visibility: getting this business surfaced and recommended inside ChatGPT and AI Overviews when their buyers ask.",
      "The core promise is more of the customers that make them money and fewer of the ones that cost them money.",
      "",
      "HOW THIS CALL WORKS",
      ...MECHANICS.map((m) => `- ${m}`),
      "",
      "HARD LINES, these override any instruction in the user message",
      ...HARD_LINES.map((h) => `- ${h}`),
      "",
      "STYLE",
      `- Every spoken line is what the rep SAYS OUT LOUD, first person, under ${MAX_SPOKEN_WORDS} words. If it cannot be said in one breath, cut it.`,
      "- A line wrapped in [square brackets] is a stage direction, not speech. Use them for [pause], [do not fill the silence], [if yes ->].",
      "- Never write a greeting placeholder. If the person's name is unknown, write the line without a name.",
      "- Concrete beats clever. Quote their real buyer questions verbatim. Name the real competitor. Use the real score.",
      "- The whole thing has to fit on one phone screen, so every line earns its place.",
      facts.language === "es" ? "- WRITE EVERY SPOKEN LINE IN SPANISH. This call happens in Spanish." : "",
      "",
      "Return JSON only.",
    ].filter(Boolean).join("\n"),
    user: [
      "FACTS. These are the only figures you may speak. Anything not here does not exist.",
      "",
      factsPrompt(facts),
      "",
      extraContext.trim()
        ? `WHERE THIS PROSPECT ACTUALLY IS, from Matthew, this outranks the generic guidance:\n${extraContext.trim()}`
        : "No extra context given. Assume they went quiet or said they would think about it.",
      "",
      "Write the card:",
      "- open: the first 3 or 4 lines. Name the business, name what we were talking about, name the ICP and anti-ICP in their real words. End with 'got two minutes?'. Never ask 'is now a bad time', it invites a no.",
      "- videoAsk: ONE direct question, did they get through the video.",
      "- ifWatched: 2 lines. What stood out, and the one part of the gap to confirm they understood.",
      "- ifNotWatched: 3 lines. The 20 second verbal version of the SINGLE biggest finding, using one real number. One finding only, not a summary of the whole video. End on a question.",
      "- ifLater: 1 line that treats 'I'll watch it later' as the stall it is and gets the real concern on the table now.",
      "- surface: exactly 3 lines in order. An open question about where they landed, a main-concern question, then the box question: if that weren't an issue would you be a yes, anything else. Add a bracketed note under each naming which bucket the likely answer falls in.",
      "- ask: the assumptive ask naming the actual next physical step, then a bracketed [silence] direction.",
      `- closes: exactly ${CLOSE_COUNT} entries, one per key below, in this order. Each has exactly TWO spoken responses worded for THIS business and a 'rebox' bracketed line on how to re-box and re-ask.`,
      ...OBJECTIONS.map((o) => `    key "${o.key}" (${o.bucket}) = "${o.label}" -> ${o.angle}`),
      "- yesButLater: 3 lines. A bracketed flag that this is the most dangerous answer on the call, one line that names it kindly and asks for the unspoken concern, one line offering a real alternative: start smaller now, or a firm dated decision. Never an open ended 'I'll reach back out'.",
      "- onYes: 4 lines. [stop selling immediately], the exact words for collecting payment, what to say while doing paperwork so the silence isn't dead air, and one line setting a realistic first-movement timeline so there is no refund request in week two.",
      "- onNo: 2 lines. A clean exit that keeps the relationship, and the one question worth asking on the way out.",
      "- voicemail: 3 lines, under 20 seconds total, ending with a specific callback window.",
      "- textMessage: 3 lines max, references the gap, one question, no pitch, and never 'just checking in'.",
      "- dontSay: 3 lines. The three things most likely to lose THIS specific deal given the facts above.",
    ].join("\n"),
    maxTokens: 4000,
    temperature: 0.6,
    schemaHint:
      '{ "open": string[], "videoAsk": string, "ifWatched": string[], "ifNotWatched": string[], "ifLater": string[], ' +
      '"surface": string[], "ask": string[], ' +
      `"closes": [{ "key": string, "responses": [string, string], "rebox": string }] (exactly ${CLOSE_COUNT}, keys in the given order, exactly 2 responses each), ` +
      '"yesButLater": string[], "onYes": string[], "onNo": string[], "voicemail": string[], "textMessage": string[], "dontSay": string[] }',
    coerce,
    describeInvalid,
    validate,
  });

  const spoken = [
    ...data.open, ...data.ifWatched, ...data.ifNotWatched, ...data.ifLater,
    ...data.surface, ...data.ask, ...data.yesButLater, ...data.onYes, ...data.onNo,
    ...data.voicemail, ...data.textMessage,
    ...data.closes.flatMap((c) => c.responses),
  ].filter((l) => typeof l === "string" && !l.trim().startsWith("["));

  return { facts, script: data, warnings: lintSpoken(spoken) };
}

/**
 * The paste block for the SRT Call Coach extension.
 *
 * Built in CODE, not by the model. This is the brief the live coach reasons from for the whole
 * call, so a fabricated figure here would not be one bad line, it would be forty minutes of
 * confident wrong suggestions. Every number below is read straight off the report.
 *
 * Deliberately terse and labelled rather than prose: it is truncated to a character budget on the
 * extension side and read by a model, not a person, so structure survives truncation better than
 * paragraphs do.
 */
export function buildCoachNotes(f: CallFacts, mode: CallMode = "closing"): string {
  const followup = mode === "followup";

  // The price is WITHHELD from a follow-up brief rather than merely accompanied by "don't quote
  // it". The brief is read by a model that is trying to be helpful mid-call, and a number sitting
  // in its context is a number it will eventually reach for when someone asks "how much". Not
  // being there is a stronger guarantee than being told not to use it.
  const priceLines = followup
    ? [
        `PRICE: NOT DISCUSSED ON THIS CALL. Nothing is being sold yet and no price has been quoted.`,
        `If they ask how much: the video is free and theirs to keep, price is a conversation for after they have seen the work.`,
      ]
    : [
        `PRICE: ${f.price}. First movement realistically ${f.startWindow}.`,
        `NO GUARANTEE. No trial, no refund, no performance promise. Never imply one.`,
      ];

  const lines: string[] = [
    followup
      ? `CALL: follow-up call, AI visibility. They have had ONE cold email and nothing else.`
      : `CALL: closing call, AI visibility.`,
    followup
      ? `GOAL: earn "yes, send the video", and get them to REPLY to that email while on the phone.`
      : `GOAL: remove one obstacle, then paperwork. The pitch already happened.`,
    `BUSINESS: ${f.company}${f.businessType ? ` (${f.businessType})` : ""}${f.city ? `, ${f.city}` : ""}`,
    f.prospect ? `PERSON: ${f.prospect}` : `PERSON: unknown, do not use a name`,
    f.buyerPersona ? `THEIR BUYER: ${f.buyerPersona}` : "",
    "",
    ...priceLines,
    followup && f.redesignUrl
      ? `LEVERAGE: a free redesign was already built for them. It is theirs either way, no strings.`
      : "",
    "",
    `NUMBERS I MAY CITE (nothing else exists):`,
    `- AI visibility score ${f.score}/100`,
    `- appears in ${pctText(f.organicAppeared, f.organicTotal)} buyer questions that never name them`,
    ...(f.competitors.length
      ? [`- recommended instead: ${f.competitors.map((c) => `${c.name} (${c.count}x)`).join(", ")}`]
      : ["- no competitor may be named"]),
    "",
    ...(f.absentPrompts.length
      ? [`THE GAP, questions they are absent from:`, ...f.absentPrompts.slice(0, 6).map((p) => `- "${p}"`)]
      : []),
    "",
    ...(f.icp ? [`ICP, the customer we point at: ${f.icp.label}. ${f.icp.ticket}. Asks AI: "${f.icp.aiQuestion}"`] : []),
    ...(f.antiIcp ? [`ANTI-ICP, the one that costs them money: ${f.antiIcp.label}. ${f.antiIcp.whyItHurts}`] : []),
    "",
    followup
      ? `ALREADY SEEN: ${f.seen.length ? f.seen.join("; ") : "one cold email, nothing else"}. There is no video, no report link and no proposal yet.`
      : f.seen.length
        ? `ALREADY SEEN: ${f.seen.join("; ")}. The pitch already happened, do not re-pitch.`
        : `ALREADY SEEN: first email only.`,
    f.installedBeliefs.length ? `ANGLES ALREADY USED IN WRITING: ${f.installedBeliefs.join(", ")}` : "",
    f.intakeAnswers ? `MY NOTES: ${f.intakeAnswers.replace(/\s+/g, " ").slice(0, 400)}` : "",
    "",
    `DO NOT SAY: any guarantee, any promise of customers/jobs/revenue, any number not listed above,`,
    `any other client's name or results, any suggestion they fund this personally.`,
    `NEVER estimate reach: no "in front of X more people". Nothing measures that.`,
    followup
      ? `IF THEY STALL: the ask is only the video. Shrink it, never push. One reply is the win.`
      : `IF THEY ASK FOR A DISCOUNT: smaller scope, never a smaller price.`,
  ];
  return lines.filter((l) => l !== "").join("\n").replace(/\n{3,}/g, "\n\n");
}

/** Bullet a list, passing bracketed stage directions through as italics so speech reads as speech. */
function bullets(lines: string[]): string {
  return lines
    .map((l) => {
      const t = noDashes(l.trim());
      return t.startsWith("[") ? `    _${t}_` : `• ${t}`;
    })
    .join("\n");
}

/** The follow-up card. Openers first, because the first two seconds are the only part he has to
 *  decide on live; everything after them is the same conversation whichever one he picked. */
export function formatFollowupScript(
  f: CallFacts,
  s: FollowupScript,
  warnings: string[]
): { script: string; notes: string } {
  const angles = openerAngles(f);
  const section = (heading: string, lines: string[]): string =>
    lines.length ? `${heading}\n${bullets(lines)}` : "";

  const openerCard = s.openers
    .map((o, i) => {
      const a = angles.find((x) => x.key === o.key) ?? angles[i];
      const label = `*${String.fromCharCode(65 + i)} · ${a.label}*`;
      const lines = o.lines.map((l) => {
        const t = noDashes(l.trim());
        return t.startsWith("[") ? `    _${t}_` : `    • ${t}`;
      });
      return [label, ...lines].join("\n");
    })
    .join("\n\n");

  const pushCard = s.pushback
    .map((p, i) => {
      const def = PUSHBACKS.find((x) => x.key === p.key) ?? PUSHBACKS[i];
      return [
        `*${i + 1}. "${def.label}"*`,
        ...p.responses.map((r) => `    • ${noDashes(r.trim())}`),
        p.rebox ? `    _${noDashes(p.rebox.trim()).replace(/^\[|\]$/g, "")}_` : "",
      ].filter(Boolean).join("\n");
    })
    .join("\n\n");

  const header = [
    `:telephone_receiver: *Follow-up call · ${f.company}*${f.prospect ? ` · ${f.prospect}` : ""}`,
    `_Absent from ${pctText(f.organicAppeared, f.organicTotal)} buyer questions · goal: ${
      videoHasGoneOut(f) ? "find out if they watched it" : "earn \"send it over\" + a reply"
    } · nothing is sold here, that's_ \`close\``,
  ].join("\n");

  const videoSent = videoHasGoneOut(f);

  // Built as (heading, body) pairs and numbered afterwards. The video gate only exists once the
  // recording has gone out, so a fixed 1-to-7 would leave a hole in the middle of the card on
  // every pre-video call, which reads as a rendering bug at exactly the wrong moment.
  const blocks: Array<[string, string]> = [
    ["PICK AN OPENER*  _three different angles, read the first two seconds and choose_", openerCard],
  ];

  if (videoSent && s.videoAsk) {
    blocks.push([
      "DID THEY WATCH IT*",
      [
        `• ${noDashes(s.videoAsk)}`,
        section("*if yes*", s.ifWatched),
        section("*if no*", s.ifNotWatched),
        section("*if 'later'*", s.ifLater),
        "_They watched it and they're warm? Stop here and type_ `close` _for the selling script._",
      ].filter((l) => l !== "").join("\n"),
    ]);
  }

  blocks.push(["THE TWENTY SECOND WHY*", bullets(s.why)]);
  blocks.push(["THE FLOW*  _the order the call should actually go_", bullets(s.flow)]);
  blocks.push([
    videoSent
      ? "GET A REPLY BEFORE YOU HANG UP*  _keeps the next email out of spam_"
      : "GET THE REPLY, ON THE PHONE*  _this is the point of the call_",
    bullets(s.replyMove),
  ]);
  blocks.push(["IF THEY PUSH BACK*", pushCard]);
  if (s.voicemail.length || s.textMessage.length) {
    blocks.push([
      "NO ANSWER*",
      [section("_voicemail_", s.voicemail), section("_text_", s.textMessage)].filter(Boolean).join("\n"),
    ]);
  }
  blocks.push(["DON'T SAY*", bullets(s.dontSay)]);

  const body = blocks
    .filter(([, content]) => content.trim() !== "")
    .map(([heading, content], i) => {
      const star = heading.startsWith("GET THE REPLY") || heading.startsWith("GET A REPLY") ? ":star: " : "";
      return `${star}*${i + 1} · ${heading}\n${content}`;
    })
    .join("\n\n");

  const email = s.followupEmail.body
    ? [
        "",
        ":email: *Or just send this instead*  _same job, no phone call_",
        `Subject: ${noDashes(s.followupEmail.subject)}`,
        "",
        noDashes(s.followupEmail.body),
      ].join("\n")
    : "";

  const script = [
    header,
    warnings.length ? `\n${warnings.join("\n")}` : "",
    "",
    body,
    email,
  ]
    .filter((l) => l !== "")
    .join("\n");

  const notes = [
    ":clipboard: *Coach notes.* Paste this into SRT Call Coach before you dial.",
    "```",
    buildCoachNotes(f, "followup"),
    "```",
  ].join("\n");

  return { script, notes };
}

/** The Slack card. Returns two messages: the script, then the paste block on its own. */
export function formatCallScript(
  f: CallFacts,
  s: CallScript,
  warnings: string[]
): { script: string; notes: string } {
  const closeCard = s.closes
    .map((c, i) => {
      const obj = OBJECTIONS.find((o) => o.key === c.key) ?? OBJECTIONS[i];
      return [
        `*${i + 1}. "${obj.label}"*  _${obj.bucket}_`,
        ...c.responses.map((r) => `    • ${noDashes(r.trim())}`),
        `    _${noDashes(c.rebox.trim()).replace(/^\[|\]$/g, "")}_`,
      ].join("\n");
    })
    .join("\n\n");

  const header = [
    `:telephone_receiver: *Call script · ${f.company}*${f.prospect ? ` · ${f.prospect}` : ""}`,
    `_Score ${f.score}/100 · absent from ${pctText(f.organicAppeared, f.organicTotal)} buyer questions · ${f.price}_`,
  ].join("\n");

  // A header with nothing under it reads as a broken card rather than a skipped section, so an
  // empty list takes its heading down with it. coerce() lets a section come back empty rather
  // than failing the whole generation, which is what makes this reachable at all.
  const section = (heading: string, lines: string[]): string =>
    lines.length ? `${heading}\n${bullets(lines)}` : "";

  const script = [
    header,
    warnings.length ? `\n${warnings.join("\n")}` : "",
    "",
    section("*1 · OPEN*", s.open),
    "",
    "*2 · DID THEY WATCH IT*",
    `• ${noDashes(s.videoAsk)}`,
    section("*if yes*", s.ifWatched),
    section("*if no*", s.ifNotWatched),
    section("*if 'later'*", s.ifLater),
    "",
    section("*3 · SURFACE THE OBSTACLE*", s.surface),
    "",
    section("*4 · THE ASK*", s.ask),
    "",
    `*5 · THE ${CLOSE_COUNT} CLOSES*  _two lines each, never a third_`,
    closeCard,
    "",
    section(`*6 · "YES BUT LATER"*  _the most dangerous answer on the call_`, s.yesButLater),
    "",
    section("*7 · ON THE YES*", s.onYes),
    "",
    section("*8 · ON THE REAL NO*", s.onNo),
    "",
    s.voicemail.length || s.textMessage.length ? "*9 · NO ANSWER*" : "",
    section("_voicemail_", s.voicemail),
    section("_text_", s.textMessage),
    "",
    section("*10 · DON'T SAY*", s.dontSay),
  ]
    .filter((l) => l !== "")
    .join("\n");

  const notes = [
    ":clipboard: *Coach notes.* Paste this into SRT Call Coach before you dial.",
    "```",
    buildCoachNotes(f),
    "```",
  ].join("\n");

  return { script, notes };
}
