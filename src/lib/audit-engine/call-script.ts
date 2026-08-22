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
// suggest funding this personally. Those are in hardLines() and they are not negotiable by a
// free-text instruction typed into the thread.

import { callClaudeJSON, camelizeKeys } from "@/lib/claude-calls";
import { LOOM_PRICE_LABEL, LOOM_START_WINDOW, RECOMMENDED_TIER, guaranteeFor, priceForTier } from "@/config/pitch";
import { noDashes } from "./email-assistant";
import { usefulIntakeAnswers } from "./outreach-intake";
import { getNicheAvatars, type BestAvatar, type NicheAvatars, type WorstCustomer } from "./niche-avatars";
import { computeWeightedScore, type ReportView } from "./report-view";
import { readLedger } from "./seed-ledger";
import type { AuditReportRow } from "./types";
import { SRT_COMPANY } from "@/config/rep-profile";
import { displayName } from "./display-name";

/**
 * The two identity strings the script is allowed to say out loud.
 *
 * `OUTREACH_SIGNATURE_AGENCY` is the same env the email tail already reads (email-assistant.ts),
 * so the phone and the email cannot introduce the business under two different names.
 * `FROM_DOMAIN` is derived from the mailbox the outreach actually leaves from, because section 4
 * of every follow-up card tells the prospect where to go looking for that email.
 */
export const AGENCY_NAME = process.env.OUTREACH_SIGNATURE_AGENCY || SRT_COMPANY.tagline;
export const FROM_DOMAIN =
  (process.env.OUTREACH_MAILBOX || "matthew@srtagency.com").split("@")[1]?.trim() || "srtagency.com";

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
export const PUSHBACKS = [
  { key: "notinterested", label: "Not interested", angle: "Do not sell. This is a free video about their own business. Ask one honest question that costs them nothing to answer." },
  { key: "sendemail", label: "Just send me an email", angle: "He already did, that is what the call is about. Turn it into the reply move: pull it up now, reply, and it goes out immediately." },
  { key: "whoisthis", label: "Who is this / what is this about", angle: "Straight answer in one line, no pitch. Name the business, name what was run, name what came back." },
  { key: "allset", label: "We're all set / we already do SEO", angle: "Do not attack the incumbent. Different surface: this is what the AI answer says when nobody clicks a link. Ask what they have been told about ChatGPT specifically." },
  { key: "howmuch", label: "How much is it", angle: "DO NOT QUOTE A PRICE ON THIS CALL. Nothing is being sold yet. The video is free and theirs to keep. Deflect honestly: let them see the work first, then price is a real conversation." },
] as const;

/**
 * Max spoken words in one line. Past this it cannot be said in one breath and gets read aloud
 * badly, which is worse than not having the line.
 *
 * On the FOLLOW-UP card this is enforced, not warned about: a real run shipped with its own
 * ":warning: 12 line(s) run past 25 words" printed above it, which is a card telling him it is
 * broken while he dials off it anyway. See followupSpeechProblems. The closing card still warns only.
 */
export const MAX_SPOKEN_WORDS = 25;

/**
 * The three points are held tighter than everything else, because they are the only lines said to
 * someone who has not read the email and has no reason yet to keep listening. The shape Matthew
 * asks for runs 11 to 14 words: "We found 12 buyer questions where you're not showing up at all."
 */
const MAX_POINT_WORDS = 20;

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
 * The two lines that are CONSTANTS, not prompt instructions.
 *
 * Same precedent as PERMISSION_CLOSE in email-assistant.ts, and for the same reason: the model
 * rewrote both of these every single time it was merely asked to include them, and the rewrites
 * were always worse in the same way. "I'm not selling you anything" became "I'm not here to sell
 * you anything today", which is a salesperson's sentence and lands as one. And the reply ask kept
 * growing a justification, when the entire reason it works is that it is a tiny favour asked
 * quickly and then followed by silence.
 *
 * These are the words that get spoken. The model writes around them.
 */
const NOT_SELLING_LINE = "I'm not selling you anything on this call. I just want to get you the video.";
const REPLY_ASK_LINE =
  "Can you pull up that email real quick and just fire back one word? Clears your spam filter and I can send it straight through.";

/**
 * How the call opens. ONE opener, not a menu.
 *
 * There used to be three, chosen live. That was wrong for a card he reads while the phone is
 * already ringing: picking between three framings in the first two seconds of a call is a decision
 * he does not have time to make, and having them there made the top of the card the longest part
 * of it. The redesign angle wins whenever a redesign exists, because leading with something already
 * built and free is the only opener that costs the listener nothing to say yes to.
 */
/**
 * How the follow-up call opens.
 *
 * ‼️ NEPQ, and it is the whole call. This is a dial to someone who got an email and did nothing,
 * so the opener decides whether there is a conversation at all. Anything that reads as "just
 * following up" fires the defense reflex before the second line lands: the prospect is not
 * declining the offer at that point, they are declining a salesperson.
 *
 * The shape that survives it: his name said like someone they already know, a VAGUE recall of the
 * last contact with a question mark on it, their problem in their words, then the question that
 * does the work. Being slightly unsure about the timing is deliberate — it invites a correction,
 * and a prospect correcting you is a prospect in a two-way conversation.
 */
function openerAngle(f: CallFacts): string {
  const nepq = [
    "NEPQ SHAPE, and it is not optional. Line 1 names himself the way someone they already know would, and recalls the last contact VAGUELY with a question mark on it, never precisely: \"looks like we sent you something, I want to say a couple of weeks ago?\".",
    "Line 2 ends on the question that does the work: did they give up on the result they wanted, or what actually happened. Written for THIS business out of FACTS, not that sentence verbatim.",
    "BANNED outright: 'just following up', 'circling back', 'checking in', 'touching base', 'is this a good time', 'do you have two minutes'. Any of them and the call is over before the finding.",
    "Almost nobody answers 'yes, we gave up'. They explain instead, which is the entire point: it hands the call back to them and gets him out of pitch mode.",
  ].join(" ");

  return f.redesignUrl
    ? `Lead with the free redesign that already exists. Ask if they saw it, and make clear it is theirs either way, no strings. This opens on a gift, not a pitch, so there is nothing to say no to. He SAYS it, he does not read out a URL. ${nepq}`
    : `Say who he is and that he sent something over, then go to the question. No hook, no cleverness. This has to survive a prospect who has already screened two calls today. ${nepq}`;
}

/**
 * Non-negotiable. Stated to the model, and the last three are re-checked in code by lintScript.
 *
 * ‼️ A FUNCTION SINCE 2026-08-21, BECAUSE ONE OF THESE LINES IS NOW CONDITIONAL. Pass the
 * guarantee from `guaranteeFor(tier)` and the ban inverts into a permission with exact wording
 * attached; pass null and it reads exactly as it always did.
 *
 * Null is the right argument almost everywhere, and it is the only right argument on a FOLLOW-UP
 * call, which withholds the price for the same reason: nothing is being sold on that dial, so a
 * guarantee sitting in a helpful model's context is one it will eventually reach for. Absent beats
 * forbidden, same doctrine as call-coach-price-gate.ts.
 *
 * Even when it is allowed, "risk-free", "money-back" and "refund" stay banned in `lintSpoken`. The
 * guarantee is a performance commitment on one tier, not a refund policy, and the difference is
 * exactly what a prospect will try to collect on later.
 */
export function hardLines(guarantee: string | null): string[] {
  return [
    "NEVER invent a number. You may only speak figures that appear in FACTS below. The prospect has the report open and can count.",
    guarantee
      ? `THE ONE GUARANTEE, WORD FOR WORD: "${guarantee}". Say it exactly that way or not at all. It exists on the ChatGPT Ads tier and NO OTHER, so it may never be attached to a lower tier or offered as a way to close someone who is buying one. It is NOT a refund and NOT a trial: never say risk-free, money-back or refund.`
      : "There is NO GUARANTEE on this offer. Never say risk-free, money-back, guaranteed results, or 'if it doesn't work you don't pay'. Month to month is not a guarantee and must not be dressed up as one.",
    "Never promise customers, jobs, leads or revenue. We report VISIBILITY and nothing else. 'You will get more calls' is a banned claim.",
    "Never suggest a personal credit card, a retirement account, a personal loan, or selling anything personal. If it cannot come out of the business the deal is too big: offer a smaller scope or walk.",
    "No fake scarcity, no invented deadlines, no made-up case studies, no other clients' names or results.",
    "No em dashes anywhere.",
  ];
}

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

interface Pushback {
  key: string;
  responses: string[];
}

interface FollowupScript {
  opener: string[];
  /**
   * Exactly three, and they carry the whole call.
   *
   * The shape is fixed because it is what makes a stranger listen: a number, then ONE real buyer
   * question behind it, then why that particular customer is worth more than the one they get
   * today. Abstract findings do not survive a phone call; "property managers looking for a
   * flooring contractor for rental units" does, because the owner can picture the person.
   *
   * They are BULLETS, one sentence each, said with a breath between. A live run returned three
   * sentences in one point ("...in Citrus County. That is a recurring contract, 10 to 30 units a
   * year, one invoice contact, no emotional design decisions.") which is two of the three points
   * crammed into the second one, and unreadable off a phone. Enforced in followupSpeechProblems.
   */
  points: string[];
  /**
   * What he says WHILE they hunt for the email: who it is from, where to look.
   *
   * REPLY_ASK_LINE has just been spoken verbatim, so this must NOT restate it. It was one array
   * (`replyFallback`) whose first slot was described in prose as "what he says while they are
   * hunting"; the model restated the ask there every time and the card printed it twice. A named
   * field is a stronger contract than line 1 of a list.
   */
  whileTheyLook: string;
  /** The fallback if they will not do it on the phone: a specific day and time he calls back,
   *  never an open ended "I'll follow up". Also must not restate the ask. */
  ifTheyWont: string;
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
  /**
   * The tier the Loom quoted, and the guarantee that rides on it (or null).
   *
   * Read off `loom_state.tier` for the same reason `price` is read off `loom_state.price`: the
   * prospect on this call watched a specific recording, and a closing script that has never heard
   * of the guarantee they were just made is not a small inconsistency. It is the prospect finding
   * out the offer moves depending on who they are talking to.
   */
  tier: string | null;
  guarantee: string | null;
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
  /**
   * Who the rep says he is, and the domain the email he is asking them to find came FROM.
   *
   * These exist because the model had no grounding for either and filled both blanks. A live Grey
   * Seal script opened "I'm with Search Ranking Technologies" and told the prospect to check spam
   * for mail "from searchrankingtech.com". Neither string exists anywhere in this repo, SRT does
   * not own that domain, and the whole point of section 4 is getting them to find a real email.
   *
   * Same doctrine as the numbers: absent grounding is not a neutral gap, it is an invitation.
   */
  agencyName: string;
  fromDomain: string;
}

function pctText(appeared: number, total: number): string {
  if (total <= 0) return "no organic prompts measured";
  return `${appeared} of ${total}`;
}

/**
 * The GAP, not the wins. `pctText(organicAppeared, organicTotal)` reads "8 of 18" and means they
 * APPEARED in 8. Both card headers used to print that same string under the word "Absent", so a
 * card told him to say the exact inverse of its own script body ("you only show up in 8"), on a
 * call where the prospect is holding the PDF and can count.
 *
 * Absent is the complement. Anything that labels itself "absent from" must call this.
 */
function absentText(f: CallFacts): string {
  if (f.organicTotal <= 0) return "no organic prompts measured";
  return `${f.organicTotal - f.organicAppeared} of ${f.organicTotal}`;
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
    company: displayName(report),
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
    price: report.loom_state?.price ?? priceForTier(report.loom_state?.tier ?? null) ?? LOOM_PRICE_LABEL,
    tier: report.loom_state?.price ? null : report.loom_state?.tier ?? null,
    guarantee: report.loom_state?.price ? null : guaranteeFor(report.loom_state?.tier ?? null),
    startWindow: report.loom_state?.window ?? LOOM_START_WINDOW,
    seen: whatTheySaw(report),
    redesignUrl: report.redesign_url,
    loomUrl: report.loom_url,
    installedBeliefs: readLedger(report).installed.map((i) => i.belief),
    intakeAnswers: usefulIntakeAnswers(report.intake_answers),
    reportUrl: report.slug ? `https://mission.srtagency.com/r/${report.slug}` : null,
    language: report.call_language === "es" ? "es" : "en",
    agencyName: AGENCY_NAME,
    fromDomain: FROM_DOMAIN,
  };
}

/** The FACTS block. The ONLY numbers the model is allowed to speak. */
function factsPrompt(f: CallFacts): string {
  const lines: string[] = [
    // First, because it is the first thing said out loud and the model will invent it otherwise.
    `WHO THE REP IS: ${f.agencyName}. That is the ONLY name you may introduce him with. Never invent a company name, an abbreviation, or a variation of it.`,
    `The email came FROM the domain ${f.fromDomain}. That is the ONLY domain you may tell them to look for. Never invent a sender domain, a website, or a URL.`,
    "",
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
    `Price: ${f.price}${f.tier ? ` (${f.tier})` : ""}. Realistic first movement on the organic work: ${f.startWindow}.`,
    f.guarantee
      ? `THE GUARANTEE, and it is on THIS tier only: "${f.guarantee}". It is a performance commitment, not a trial and not a refund.`
      : "THERE IS NO GUARANTEE. No trial, no refund promise, no performance guarantee.",
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

// ── The shape of a spoken line ──────────────────────────────────────────────────
// Pure, and shared by the validators and the linter so the rule that REJECTS a script and the
// rule that WARNS about one can never drift apart.

function wordsIn(line: string): number {
  return line.trim().split(/\s+/).filter(Boolean).length;
}

/** Sentences, for the one-breath rule. Split on terminal punctuation followed by something that
 *  starts a new sentence, so "10 to 30 units a year" and "Mr. Ruiz" do not read as two. */
function sentencesIn(line: string): string[] {
  return line
    .trim()
    .split(/(?<=[.?!])\s+(?=["'(]?[A-Z0-9])/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** A bracketed stage direction is read, not said, so none of the speech rules apply to it. */
export function isDirection(line: string): boolean {
  return line.trim().startsWith("[");
}

function overLong(lines: string[], cap = MAX_SPOKEN_WORDS): string[] {
  return lines.filter((l) => !isDirection(l) && wordsIn(l) > cap);
}

/**
 * Is this line the reply ask again?
 *
 * REPLY_ASK_LINE is spoken verbatim immediately before both of the lines this guards, and the ask
 * only works because it is small, made once, and followed by silence. Neither "what he says while
 * they hunt for the email" nor "the dated callback" has any business containing a reply verb, so
 * the test is exactly that and nothing cleverer.
 */
function restatesReplyAsk(line: string): boolean {
  return /\b(reply|replies|replying|respond|write back|fire back|shoot (?:me )?back|send (?:me )?back|hit reply)\b/i.test(line);
}

/**
 * Lines that are too long to say, and hard-line violations that survived the prompt.
 *
 * Reported above the script rather than rejecting it, and on the follow-up card this is now the
 * SALVAGE path: strict validation already rejected the over-long lines once and asked for a
 * correction, so anything still here survived that. A script with one clumsy line is still usable
 * and refusing to post it would leave him with nothing to dial on. The guarantee and
 * personal-funding checks are the exception worth shouting about, so they are flagged separately
 * and prominently.
 *
 * `spoken` is what he SAYS; `written` is that plus anything sent in his words. The one-breath rule
 * applies only to speech, because an email body is paragraphs and would fail it on every run. The
 * content guards apply to both: a price or a reach claim is no more acceptable written down, and a
 * sent email outlives an improvised sentence.
 */
/**
 * The only part of CallFacts the identity checks below actually read.
 *
 * ‼️ NARROWED FROM CallFacts ON PURPOSE (2026-08-22). Those two checks — an invented sender domain
 * and the rep introducing himself as a company we are not — are the two most damaging things a
 * script can contain, and they were reachable only by a caller holding a full CallFacts, which
 * means a caller holding a finished AUDIT. The booking lane has no audit and needed them most,
 * since a prospect it calls may never have been sent anything at all. Every existing caller passes
 * a CallFacts and satisfies this structurally, so nothing else changes.
 */
export type SpokenIdentity = Pick<
  CallFacts,
  "fromDomain" | "reportUrl" | "redesignUrl" | "loomUrl" | "company" | "agencyName"
>;

export function lintSpoken(
  spoken: string[],
  written: string[],
  opts: { noPrice?: boolean; allowGuarantee?: boolean; facts?: SpokenIdentity } = {}
): string[] {
  const warnings: string[] = [];

  // ── NEPQ tells ───────────────────────────────────────────────────────────
  // A prose ban is not a ban, same lesson as the em-dash rule and the price gate. These are the
  // phrases that identify a salesperson in the first two seconds of a follow-up dial, and on this
  // card the opener IS the call, so one of them showing up costs the whole conversation.
  const NEPQ_TELLS: Array<[RegExp, string]> = [
    [/\bjust (?:following up|checking in)\b|\bfollowing up\b|\bcircl(?:ing|e) back\b|\btouch(?:ing)? base\b|\bchecking in\b/i, "following up / checking in"],
    [/\bis (?:this|now) a good time\b|\bdid i catch you at a bad time\b/i, "is this a good time"],
    [/\bdo you have (?:two|2|a couple(?: of)?) minutes\b|\bgot a minute\b/i, "do you have two minutes"],
    [/\blet me ask you a question\b/i, "let me ask you a question"],
  ];
  const spokenBlob = spoken.join(" ");
  const tells = NEPQ_TELLS.filter(([re]) => re.test(spokenBlob)).map(([, name]) => name);
  if (tells.length) {
    warnings.push(
      `:warning: SALESPERSON TELL in a spoken line (${tells.join(", ")}). ` +
        `NEPQ: these fire the defense reflex before the finding lands. Open on a vague recall and ` +
        `"did you give up on that, or what actually happened?" instead.`
    );
  }

  // An invented sender domain is worse than a wrong number: it sends the prospect hunting through
  // spam for mail from a company that does not exist, and the whole ask of section 4 is that they
  // find the real one. Any bare domain that is not ours, and is not the prospect's own site, is a
  // fabrication. `.filter(Boolean)` on the allow list matters: reportUrl is nullable.
  if (opts.facts) {
    const f = opts.facts;
    const allowedHosts = [f.fromDomain, f.reportUrl, f.redesignUrl, f.loomUrl, f.company]
      .filter(Boolean)
      .map((s) => String(s).toLowerCase());
    const domains = written
      .join(" ")
      .match(/\b[a-z0-9][a-z0-9-]*(?:\.[a-z0-9-]+)*\.(?:com|net|org|io|ai|co|us|biz)\b/gi);
    const bogus = [...new Set((domains ?? []).map((d) => d.toLowerCase()))].filter(
      (d) => !allowedHosts.some((a) => a.includes(d) || d.includes(a))
    );
    if (bogus.length) {
      warnings.push(
        `:rotating_light: INVENTED DOMAIN in the script (${bogus.join(", ")}). ` +
          `The email came from ${f.fromDomain}. Do NOT send them looking for anything else.`
      );
    }

    // The same failure one layer up: the rep introducing himself as a company we are not. Only
    // checked on the lines that name an agency at all, so a script that never says it is fine.
    const agency = f.agencyName.toLowerCase();
    const misnamed = written.filter((l) => {
      const low = l.toLowerCase();
      return /\b(i'm with|i am with|this is|calling from|we're|we are)\b/.test(low)
        && /\b(search|srt|retrieval|ranking|tactics|technologies)\b/.test(low)
        && !low.includes(agency);
    });
    if (misnamed.length) {
      warnings.push(
        `:rotating_light: The script introduces the rep as a company that is not ${f.agencyName} ` +
          `(${misnamed.length} line(s), e.g. "${misnamed[0].slice(0, 90)}"). Say ${f.agencyName}, nothing else.`
      );
    }
  }

  const longLines = overLong(spoken);
  if (longLines.length) {
    warnings.push(`:warning: ${longLines.length} line(s) run past ${MAX_SPOKEN_WORDS} words. Cut them down before dialing, they cannot be said in one breath.`);
  }

  const all = written.join(" ").toLowerCase();

  // ‼️ TWO LISTS, AND THE SPLIT IS THE POINT.
  //
  // The first list stays banned on every tier, guarantee or no guarantee. What the ads tier
  // promises is a RETURN: double the investment, or the invoice does not get paid. That is not a
  // refund, not a trial and not "risk-free", and those three words describe arrangements SRT does
  // not offer. Letting them through on the guaranteed tier would mean a prospect who heard "money
  // back" on a call trying to collect one later, which is a worse conversation than the one this
  // warning prevents.
  const NEVER = ["risk-free", "risk free", "money-back", "money back", "refund", "free trial"];
  const ONLY_WITH_GUARANTEE = ["guarantee", "guaranteed", "if it doesn't work you don't pay"];

  const hardHits = NEVER.filter((g) => all.includes(g));
  if (hardHits.length) {
    warnings.push(
      `:rotating_light: REFUND LANGUAGE in the script (${hardHits.join(", ")}). ` +
        `Even on the guaranteed tier this is wrong: it is a performance commitment, not money back. Do NOT say these lines.`
    );
  }

  const guaranteeHits = opts.allowGuarantee ? [] : ONLY_WITH_GUARANTEE.filter((g) => all.includes(g));
  if (guaranteeHits.length) {
    warnings.push(
      `:rotating_light: GUARANTEE LANGUAGE in the script (${guaranteeHits.join(", ")}). ` +
        `There is no guarantee on this tier. Do NOT say these lines.`
    );
  }
  const personal = ["personal credit card", "personal card", "401k", "401(k)", "retirement", "personal loan", "home equity"];
  const personalHits = personal.filter((g) => all.includes(g));
  if (personalHits.length) {
    warnings.push(`:rotating_light: The script suggests funding this personally (${personalHits.join(", ")}). Never say this. Offer a smaller scope or walk.`);
  }

  // Follow-up stage only. Quoting a number to someone who has not seen the work is the fastest
  // way to turn a free video into a sales call, and it is the one thing this stage cannot undo.
  if (opts.noPrice) {
    const priced = written.filter((l) => /\$\s?\d|\bper month\b|\ba month\b|\bmonthly fee\b|\bretainer\b/i.test(l));
    if (priced.length) {
      warnings.push(`:rotating_light: A PRICE is quoted on a follow-up call (${priced.length} line(s)). Nothing is being sold yet. Cut it, the video is free.`);
    }
  }

  // The reach claim the audit cannot back. "In front of 500 more people" is not measured anywhere
  // in this pipeline, and it is exactly the kind of number a prospect asks you to show your work on.
  const reach = written.filter((l) => /in front of\s+[\d,]+|\b[\d,]{3,}\s+(more\s+)?(people|customers|buyers|homeowners|searches|views|impressions)\b/i.test(l));
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

/**
 * The SHAPE of a follow-up card: the fields exist, the fixed counts are right.
 *
 * Split from the speech rules below because the two failures deserve different endings. A missing
 * `pushback` array is unrecoverable and should surface as an error; a bullet that runs three words
 * long is a card he can still dial off. `buildFollowupScript` keeps the last shape-valid payload
 * and posts it with a warning banner rather than leaving him with nothing.
 */
function followupShapeOk(p: unknown): p is FollowupScript {
  const o = p as FollowupScript;
  return (
    !!o &&
    Array.isArray(o.opener) &&
    o.opener.length > 0 &&
    Array.isArray(o.points) &&
    o.points.length === 3 &&
    typeof o.whileTheyLook === "string" &&
    o.whileTheyLook.trim().length > 0 &&
    typeof o.ifTheyWont === "string" &&
    o.ifTheyWont.trim().length > 0 &&
    Array.isArray(o.pushback) &&
    o.pushback.length === PUSHBACK_COUNT
  );
}

/**
 * How the card has to SOUND. Every one of these is a real defect from one live run.
 *
 * Rejected so `callClaudeJSON` runs its correction retry with `describeInvalidFollowup`'s reason,
 * rather than warned about above a card that is already broken. This is the whole point of fixing
 * the limit: the previous card shipped with ":warning: 12 line(s) run past 25 words" printed on
 * top of it, which is a note telling him it is unusable while he dials off it anyway.
 */
function followupSpeechProblems(s: FollowupScript): string[] {
  const problems: string[] = [];

  const long = overLong(followupSpoken(s));
  if (long.length) {
    problems.push(
      `${long.length} spoken line(s) run past ${MAX_SPOKEN_WORDS} words and cannot be said in one breath. ` +
        `The worst is ${wordsIn(long[0])} words: "${long[0]}". ` +
        `Rewrite each one shorter. Where the section has a fixed number of lines, CUT it back, do not split it into more lines.`
    );
  }

  const fatPoints = s.points.filter((p) => wordsIn(p) > MAX_POINT_WORDS);
  if (fatPoints.length) {
    problems.push(
      `${fatPoints.length} of the 3 points run past ${MAX_POINT_WORDS} words (worst: ${wordsIn(fatPoints[0])}). ` +
        `They are spoken bullets, not paragraphs. Say less.`
    );
  }
  const multiPoints = s.points.filter((p) => sentencesIn(p).length > 1);
  if (multiPoints.length) {
    problems.push(
      `${multiPoints.length} of the 3 points contain more than one sentence, e.g. "${multiPoints[0]}". ` +
        `Each point is exactly ONE sentence. If it has two sentences you have put two of the three points into one, so move the second one where it belongs.`
    );
  }

  for (const [field, line] of [["whileTheyLook", s.whileTheyLook], ["ifTheyWont", s.ifTheyWont]] as const) {
    if (restatesReplyAsk(line)) {
      problems.push(
        `${field} asks them to reply again: "${line}". The rep has ALREADY said the ask, word for word, immediately before this line. ` +
          `Do not restate it. ${field === "whileTheyLook" ? "This line assumes they are already looking for the email." : "This line is only the dated callback."}`
      );
    }
  }

  return problems;
}

function describeInvalidFollowup(p: unknown): string {
  if (!p || typeof p !== "object") return "the response was not a JSON object";
  const o = p as Partial<FollowupScript>;
  const problems: string[] = [];
  if (!Array.isArray(o.opener) || o.opener.length === 0) problems.push("opener was missing or empty");
  if (!Array.isArray(o.points)) problems.push("points was missing or not an array");
  else if (o.points.length !== 3) problems.push(`points had ${o.points.length}, expected exactly 3: the number, the one real buyer question, then why that customer beats the one they get today`);
  if (typeof o.whileTheyLook !== "string" || !o.whileTheyLook.trim()) problems.push("whileTheyLook was missing: one line, what he says while they hunt for the email");
  if (typeof o.ifTheyWont !== "string" || !o.ifTheyWont.trim()) problems.push("ifTheyWont was missing: one line, the dated callback if they will not do it on the phone");
  if (!Array.isArray(o.pushback)) problems.push("pushback was missing");
  else if (o.pushback.length !== PUSHBACK_COUNT) problems.push(`pushback had ${o.pushback.length}, expected exactly ${PUSHBACK_COUNT}, one per key given`);

  // Only reachable once the shape is right, so the speech rules are the reason it failed.
  if (!problems.length && followupShapeOk(p)) problems.push(...followupSpeechProblems(p));

  return problems.join("; ") || "it did not match the required shape";
}

const FOLLOWUP_LISTS = ["opener", "points", "voicemail", "textMessage", "dontSay"] as const;

function coerceFollowup(p: unknown): unknown {
  const o = camelizeKeys(p) as Record<string, unknown>;
  if (!o || typeof o !== "object") return o;
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
  // Both are ONE line, and a model that reads "one line" sometimes sends a one-item array anyway.
  // Flattening it is exactly the near-miss coerce exists for; validate still rejects an empty one.
  for (const key of ["whileTheyLook", "ifTheyWont"] as const) {
    const v = o[key];
    if (typeof v === "string") continue;
    o[key] = Array.isArray(v) ? v.filter((l): l is string => typeof l === "string").join(" ") : "";
  }
  if (Array.isArray(o.pushback)) {
    o.pushback = (o.pushback as Pushback[]).map((x) => ({
      ...x,
      responses: Array.isArray(x?.responses) ? x.responses.filter((r): r is string => typeof r === "string") : [],
    }));
  }
  return o;
}

/**
 * Every line the rep SAYS on a follow-up card.
 *
 * The email body is deliberately NOT here. It is paragraphs, so measuring it against a one-breath
 * word limit would fail every run the moment that limit became a rejection rather than a warning.
 * It goes through the content guards instead, in followupWritten below.
 */
function followupSpoken(s: FollowupScript): string[] {
  return [
    ...s.opener, ...s.points, s.whileTheyLook, s.ifTheyWont, ...s.voicemail, ...s.textMessage,
    ...s.pushback.flatMap((p) => p.responses),
  ].filter((l) => typeof l === "string" && l.trim() !== "" && !isDirection(l));
}

/** Everything that goes out in his words, spoken or sent. The email goes through the same content
 *  guards as the speech: a price or a reach claim is no more acceptable written down, and this one
 *  is sent rather than improvised, so it lasts longer. */
function followupWritten(s: FollowupScript): string[] {
  return [...followupSpoken(s), s.followupEmail.body].filter((l) => typeof l === "string" && l.trim() !== "");
}

export async function buildFollowupScript(
  report: AuditReportRow,
  view: ReportView,
  extraContext: string
): Promise<{ facts: CallFacts; script: FollowupScript; warnings: string[] }> {
  const facts = await buildCallFacts(report, view);
  const videoSent = videoHasGoneOut(facts);

  /**
   * The speech rules reject, and this is what stops that leaving him with nothing.
   *
   * callClaudeJSON runs ONE correction retry on a validation failure and then THROWS, and the
   * thread router turns a throw into ":warning: Couldn't draft that" with no card at all. That is
   * the wrong ending for a bullet that runs three words long. So the validator keeps the last
   * payload whose SHAPE was right: if the retry still cannot get the lines short, that script is
   * posted with lintSpoken's warning banner above it instead of nothing. Costs no extra API call,
   * because it is exactly what the correction retry already returned.
   *
   * Held on an object rather than a bare `let` so the assignment inside the closure is visible to
   * the catch below, and scoped per call so two Slack handlers cannot see each other's scripts.
   */
  const kept: { script: FollowupScript | null } = { script: null };
  const validate = (p: unknown): p is FollowupScript => {
    if (!followupShapeOk(p)) return false;
    kept.script = p;
    return followupSpeechProblems(p).length === 0;
  };

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
      // null, ALWAYS. A follow-up dial sells nothing, so the guarantee is withheld here exactly
      // the way the price is: absent beats forbidden.
      ...hardLines(null).map((h) => `- ${h}`),
      "- NEVER estimate reach, traffic, calls, leads or 'people you'll get in front of'. Nothing in the audit measures that. The honest version is how many of their buyers' questions they are absent from, and that number is in FACTS.",
      "",
      "STYLE",
      `- Every spoken line is what the rep SAYS OUT LOUD, first person, under ${MAX_SPOKEN_WORDS} words. This is checked and a card that breaks it is sent back.`,
      "- ONE sentence per bullet. If a bullet has two sentences in it, it is two bullets. Where the section has a fixed number of lines, cut it back to one sentence instead of adding a line.",
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
      "This card is SHORT. He reads it with the phone already ringing, so every line has to earn its place. Do not pad.",
      "",
      "Write the card:",
      `- opener: 2 lines, ending on a question. ${openerAngle(facts)}`,
      `- points: EXACTLY 3 SPOKEN BULLETS, and they carry the whole call. ONE sentence each, under ${MAX_POINT_WORDS} words each, said one after the other with a breath between. Not paragraphs. In this order:`,
      "    (1) the number: how many real buyer questions they do not show up in at all.",
      "    (2) ONE of those questions, made concrete as a PERSON the owner can picture, tied to the high-value customer in FACTS.",
      "    (3) why THAT customer is worth more than the one they get today, named against the low-value customer in FACTS as the contrast.",
      "    Exactly this shape. Three sentences, three bullets, nothing longer:",
      '      "We found 12 buyer questions where you are not showing up at all."',
      '      "One of them is property managers looking for a flooring contractor for rental units."',
      '      "That is a recurring contract, not a one time $89 backsplash."',
      "    If one of your bullets has two sentences in it, you have put two of the three points into one. Move the second one where it belongs.",
      "    Concrete beats abstract every time. An owner cannot picture 'visibility gaps', he can picture a property manager. Use the real absent questions and the real customer labels from FACTS, in his words, not ours.",
      "- whileTheyLook: ONE line. The rep has JUST said, word for word: \"" + REPLY_ASK_LINE + "\" Do NOT restate, rephrase, shorten or summarise that ask, and do not use the word 'reply' at all. It has been made, once, and saying it twice is the most common mistake in this slot. Your line assumes they are already looking: who the email is from, what the subject line is, tell them to check promotions or spam.",
      "- ifTheyWont: ONE line. Only the fallback for someone who will not do it while on the phone: a specific day and time he calls back. Never an open ended 'I'll follow up'. Do not re-ask for the reply here either.",
      `- pushback: exactly ${PUSHBACK_COUNT} entries, one per key below, in this order. Each has TWO short spoken responses worded for THIS business, and each gets back to the same ask: send the video.`,
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
      `{ "opener": string[], "points": string[] (EXACTLY 3, one sentence each, under ${MAX_POINT_WORDS} words each), ` +
      '"whileTheyLook": string (ONE line), "ifTheyWont": string (ONE line), ' +
      `"pushback": [{ "key": string, "responses": [string, string] }] (exactly ${PUSHBACK_COUNT}, keys in the given order), ` +
      '"voicemail": string[], "textMessage": string[], "followupEmail": { "subject": string, "body": string }, "dontSay": string[] }',
    coerce: coerceFollowup,
    describeInvalid: describeInvalidFollowup,
    validate,
  }).catch((e: Error) => {
    // Shape was never right, so there is nothing worth posting: fail the way every other command
    // in the thread fails.
    if (!kept.script) throw e;
    console.warn(`[call-script] follow-up card still broke the speech rules after the correction retry (${e.message}); posting it with warnings`);
    return { data: kept.script };
  });

  return {
    facts,
    script: data,
    warnings: lintSpoken(followupSpoken(data), followupWritten(data), { noPrice: true, facts }),
  };
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
      ...hardLines(facts.guarantee).map((h) => `- ${h}`),
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
  ].filter((l) => typeof l === "string" && !isDirection(l));

  // The closing card still WARNS about over-long lines rather than rejecting them. It is read
  // mid-call by someone who has already had the whole conversation once, so a clumsy line costs
  // less there than it does on a cold opener, and its seven closes are a much more expensive
  // generation to re-ask for. Nothing written goes out with it, so spoken and written are the same.
  return {
    facts,
    script: data,
    warnings: lintSpoken(spoken, spoken, { facts, allowGuarantee: facts.guarantee !== null }),
  };
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
  // being there is a stronger safeguard than being told not to use it. The GUARANTEE is withheld
  // on the same call for the same reason, and it matters more: a model reaching for a price
  // quotes a number early, a model reaching for a guarantee makes a commitment nobody authorised.
  const priceLines = followup
    ? [
        `PRICE: NOT DISCUSSED ON THIS CALL. Nothing is being sold yet and no price has been quoted.`,
        `If they ask how much: the video is free and theirs to keep, price is a conversation for after they have seen the work.`,
      ]
    : [
        `PRICE: ${f.price}${f.tier ? ` (${f.tier})` : ""}. First movement on the organic work realistically ${f.startWindow}.`,
        f.guarantee
          ? `THE GUARANTEE, WORD FOR WORD: "${f.guarantee}". This tier only. It is a performance commitment, NOT a refund, NOT a trial, and never "risk free".`
          : `NO GUARANTEE. No trial, no refund, no performance promise. Never imply one.`,
      ];

  const lines: string[] = [
    followup
      ? `CALL: follow-up call, AI visibility. They have had ONE cold email and nothing else.`
      : `CALL: closing call, AI visibility.`,
    followup
      ? `GOAL: earn "yes, send the video", and get them to REPLY to that email while on the phone.`
      : `GOAL: remove one obstacle, then paperwork. The pitch already happened.`,
    // Who we are, before who they are. The live coach invents this exactly the way the script
    // generator did if nothing tells it, and it is said in the first sentence of the call.
    `WE ARE: ${f.agencyName}. Our email came from ${f.fromDomain}. Never say any other company name or domain.`,
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
    // Both halves, stated. The coach used to get only the appeared count and had to subtract to
    // answer "how many am I missing", which is the number actually spoken on the call, and a model
    // doing arithmetic on a live call is a model that will eventually get it backwards.
    `- absent from ${absentText(f)} of those same questions`,
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
    f.guarantee && !followup
      ? `DO NOT SAY: any guarantee OTHER than the one quoted above and in those exact words, any promise of customers/jobs/revenue, any number not listed above,`
      : `DO NOT SAY: any guarantee, any promise of customers/jobs/revenue, any number not listed above,`,
    `any other client's name or results, any suggestion they fund this personally.`,
    `NEVER estimate reach: no "in front of X more people". Nothing measures that.`,
    followup
      ? `IF THEY STALL: the ask is only the video. Shrink it, never push. One reply is the win.`
      : // Four tiers, so a request for less has a real answer that is not a discount: step DOWN
        // the ladder, which is a smaller scope for a smaller number. Below Core there is nothing,
        // and inventing a figure between two rungs is banned.
        //
        // ‼️ Stepping down off the ads tier DROPS THE GUARANTEE, and that has to be said out loud
        // rather than discovered on the invoice. It is also the honest reason to stay: the
        // guarantee is not a bonus attached to a price, it is what the paid layer pays for.
        `IF THEY ASK FOR LESS: step down a tier. ${RECOMMENDED_TIER} to Complete to Core, each one a smaller scope for a smaller number, never a discount. ${
          f.guarantee
            ? `Say plainly that stepping off ${RECOMMENDED_TIER} means there is no guarantee any more, because there are no ads to deliver it. `
            : ""
        }There is nothing below Core and no figure between two tiers exists.`,
  ];
  return lines.filter((l) => l !== "").join("\n").replace(/\n{3,}/g, "\n\n");
}

/** Bullet a list, passing bracketed stage directions through as italics so speech reads as speech. */
export function bullets(lines: string[]): string {
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
  const section = (heading: string, lines: string[]): string =>
    lines.length ? `${heading}\n${bullets(lines)}` : "";

  const pushCard = s.pushback
    .map((p, i) => {
      const def = PUSHBACKS.find((x) => x.key === p.key) ?? PUSHBACKS[i];
      return [
        `*${i + 1}. "${def.label}"*`,
        ...p.responses.map((r) => `    • ${noDashes(r.trim())}`),
      ].join("\n");
    })
    .join("\n\n");

  const header = [
    `:telephone_receiver: *Follow-up call · ${f.company}*${f.prospect ? ` · ${f.prospect}` : ""}`,
    `_Absent from ${absentText(f)} buyer questions · one job: get the reply, send the video · not selling_`,
    // One line, not a section. `call` is the "they have not seen it" call by definition, but the
    // row cannot prove they never pressed play, so the handoff is stated and then dropped.
    videoHasGoneOut(f)
      ? ":warning: _The video already went out. If they say they watched it, stop and type_ `close`_._"
      : "",
  ].filter(Boolean).join("\n");

  const blocks: Array<[string, string]> = [
    ["OPEN*", bullets(s.opener)],
    ["THE THREE POINTS*  _what's in the email he hasn't read_", bullets(s.points)],
    ["THE FRAME*  _say it early, it's what makes them relax_", `• ${NOT_SELLING_LINE}`],
    [
      "GET THE REPLY, ON THE PHONE*  _the whole reason you dialled_",
      // The ask is spoken ONCE. `restatesReplyAsk` already failed the generation that put it in
      // either of these two slots and asked for a correction, so this is the last line of defence
      // rather than the only one: whatever comes back, the card cannot print the ask twice.
      bullets([REPLY_ASK_LINE, ...[s.whileTheyLook, s.ifTheyWont].filter((l) => l?.trim() && !restatesReplyAsk(l))]),
    ],
    ["IF THEY PUSH BACK*", pushCard],
  ];
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
      const star = heading.startsWith("GET THE REPLY") ? ":star: " : "";
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
    `_Score ${f.score}/100 · absent from ${absentText(f)} buyer questions · ${f.price}_`,
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
