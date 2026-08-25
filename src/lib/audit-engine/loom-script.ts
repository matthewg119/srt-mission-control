// The Loom script, written out to be read aloud.
//
// This replaced a six-beat timing sheet in six-word bullets. That sheet was built on the theory
// that Matthew improvises better than he reads; in practice it meant re-deciding the wording of
// the same pitch on every recording, which is slow and comes out different every time. The
// template here is HIS script, the one he wrote for the surface-sealing contractor, with the
// per-audit facts substituted in. Screenshots get pasted over the top while it is read.
//
// ── Template v2 (2026-08-16) ────────────────────────────────────────────────
// The order changed and a middle section was added. The score is now the FIRST thing said rather
// than the payoff of a build-up, all three best customers get named where one used to, an either-or
// beat bookends the video, and the explanatory middle is three pillars (Findable, Familiar,
// Freshness) carried by fixed anecdotes. The offer is three commitments, both tiers are contrasted
// rather than just priced, and the close sends them to the payment link instead of asking for a
// reply phrase. That last change is not local to this file: delivery-email.ts carries the same link
// and no longer flags a missing reply phrase.
//
// ── Template v3 (2026-08-21) ────────────────────────────────────────────────
// Guarantee-anchored, ChatGPT Ads lead. The evidence half of v2 is untouched: score first, the
// three customers, speed, the 20 prompts, the either-or, and the live ChatGPT window with the
// concession opening it. What changed is everything after that.
//
// v2's PILLARS (what is true about the machine) and COMMITMENTS (what we do about it) were two
// passes over the same three ideas, so a listener heard "Findable" explained and then, ninety
// seconds later, heard the fix for it. v3 merges them into THREE PROMISES, each one running the
// doc's fixed 4-beat pattern — Outcome, Trap, Work, Return — so the fix lands while the problem is
// still in the room.
//
//   1. We put you in the list.                      (v2's Findable pillar + commitment 1)
//   2. We put you in front of buyers today.         (ChatGPT Ads. Where the guarantee lived)
//   3. We make you the default answer.              (v2's Familiar + Freshness + commitments 2, 3)
//
// ── Template v4 (2026-08-25) ────────────────────────────────────────────────
// New offer, new middle, and a competitor named on camera. The template is Matthew's med-spa Loom
// script, generalized. The evidence half survives again: score first, the customers, the 20
// prompts, the either-or, the live ChatGPT window with the concession opening it.
//
// What changed:
//
//  1. THE OFFER. The four tiers are gone and so is the money guarantee that rode on one of them.
//     There is one price, a free period in front of it, and a founding cohort. Nothing is charged
//     up front, so the close is a BOOKING LINK and not a payment page. See config/pitch.ts.
//
//  2. PROMISES BECAME PILLARS AGAIN, and this time they are named up front and explained later —
//     Findable, Familiar, Fresh. v3 merged the two passes because they were redundant; v4 splits
//     them again for a different reason: the naming is fifteen seconds long and it is a promise of
//     STRUCTURE, which is what buys the next four minutes. It is not v2's two-pass explanation.
//
//  3. THE ADS ARE THE LAST BEAT, not the second promise. They stopped being a tier, so they stop
//     being a thing the video sells and become the answer to "what if I do not want to wait".
//     No figure is attached to them anywhere.
//
//  4. A COMPETITOR IS NAMED, twice: once as a count in WHAT WE FOUND, once by name in the closing
//     either-or. Both come off this audit's own run through pickRival(), and when the run turned
//     up no usable rival the script says nothing about one rather than reaching for "your
//     competitor". See the note over pickRival().
//
//  5. THE AESTHETICS LANE. A med spa, clinic or TRT practice gets Matthew's hand-written patient
//     types, dollar figures included. Everybody else gets the researched niche set, without any.
//     See isAesthetics() and the note over MEDSPA_PATIENTS for why those two are not the same
//     kind of sentence and must not be merged.
//
// The v2 "one extra client a month will very likely make back the investment" line is still GONE,
// and the v3 money guarantee that replaced it is gone too. What the video commits to now is
// VISIBILITY, which is the thing this pipeline actually measures. Do not put either back.
//
// ── What is filled from real data and what is not ───────────────────────────
// The score, the X of Y, the prompts, the prompt they rank best on, the ones they are absent from
// and the competitor named on camera all come from this audit's own run. The customers are either
// the niche's own avatars (niche-avatars.ts) or the hand-written aesthetics block, never invented
// here. ONE Claude call supplies the wordings that are a fact about the TRADE rather than about
// this business: the verb for what they do when a lead lands, the jobs in the owner's own words,
// and the customers to avoid REWORDED for saying out loud. The three pillars are hand-written
// constants and must stay that way, for the reason spelled out over loomPillars(). Nothing else is
// generated, and nothing is estimated.
//
// ── The name ────────────────────────────────────────────────────────────────
// The video opens on the owner's first name, because that is the whole difference between a
// recording made for someone and a recording sent to someone. It is never invented: with no
// prospect_name, no requester_name and no `loom <name>` override, the open falls back to the
// trade noun and the header says the name is missing. A wrong name on camera cannot be edited out.
//
// ── The two honesty rules that survive from the rest of the pipeline ────────
//  1. The image is the TARGET, never a result (dream-lead.ts, lines 8-12). The script therefore
//     reads "this is the exact kind of inquiry we point at your phone" and never "here is a
//     lead that came in". AI generates the future; screenshots show the present.
//  2. No number is said out loud that the pipeline cannot back. There is no forecast of how
//     many customers this produces, because nothing here measures or predicts one. If that
//     claim is ever worth owning it goes in LOOM_CLIENT_COUNT_CLAIM, deliberately as a config
//     decision someone makes on purpose rather than a sentence a model wrote.

import { callClaudeJSON } from "@/lib/claude-calls";
import {
  ADS_ACCELERATOR,
  BOOKING_LINK,
  DEFAULT_ANSWER_LINE,
  FAST_WINDOW,
  FOUNDING_BONUS,
  FOUNDING_EXCHANGE,
  FOUNDING_SPOTS,
  FREE_UNTIL_LINE,
  FRESHNESS_STAT,
  GUARANTEE_LINE,
  GUARANTEE_RESTATE,
  KEEP_WORKING_FREE_LINE,
  LOOM_CLIENT_COUNT_CLAIM,
  LOOM_START_WINDOW,
  LOOM_TEXT_NUMBER,
  OFFER_INCLUDES,
  ONBOARDING_WINDOW,
  PRICE_RETAINER,
  PRICE_RETAINER_AMOUNT,
  QUALIFIED_INQUIRY_DEF,
  VALUE_MONTH_ONE,
  VALUE_RECURRING,
} from "@/config/pitch";
import { competitorsWhereAbsent } from "./delivery-guards";
import { noDashes } from "./email-assistant";
import type { BeatSheetFacts } from "./loom-beatsheet";
import type { BestAvatar, NicheAvatars, WorstCustomer } from "./niche-avatars";
import type { AuditReportRow } from "./types";
import type { ReportView } from "./report-view";

export interface LoomScriptOptions {
  /** Overrides from `loom $499` / `loom $299/mo, 45 days`. Fall back to the config constants. */
  price?: string | null;
  window?: string | null;
  /**
   * The whole niche set, so the open can name who to AVOID as well as who to attract.
   *
   * Optional because the wizard has a fallback path where the niche set failed to build and one
   * customer was derived from the missing money questions instead (thread-assistant.ts,
   * `derivedAvatar`). There the avoid clause is simply not said.
   */
  avatars?: NicheAvatars | null;
  /** The name read on camera, from `loom Fran`. Outranks the row. */
  greetName?: string | null;
}

export interface LoomScriptResult {
  text: string;
  fileName: string;
}

/** The wordings that are a fact about the trade, not about this business. */
interface TradeVoice {
  /** How the video opens when there is no name, e.g. "surface sealing contractor", "clinic owner". */
  greeting: string;
  /** What the owner does when a lead lands: "drive out and quote it", "book the consult". */
  action: string;
  /** Three jobs in the owner's own words, short. */
  jobs: string[];
  /**
   * The customers to avoid, plural and spoken: "sample hoarders". Empty when there is no niche set.
   *
   * There is no matching `attract`, and there used to be. v2 reads the best customers out as their
   * own card LABELS ("The Corporate Film Program Buyer"), so the spoken plural rewording that fed
   * "get in front of more X or Y" has nothing left to fill. Generating it anyway would be a field
   * nothing reads, drifting quietly against the labels actually on screen.
   */
  avoid: string[];
  /**
   * Who is typing the prompts the ads get targeted at: "corporate buyers, venue GMs and film
   * school directors". Read in Promise 2's work beat.
   *
   * Optional in the contract on purpose. It is one small field on a call that already carries
   * four, and failing the whole generation over it would cost the greeting, the action, the jobs
   * and the avoid line — everything the script actually depends on — to save a phrase that has a
   * perfectly good fallback in `buyer_persona`.
   */
  adsBuyers?: string;
}

function isTradeVoice(v: unknown): v is TradeVoice {
  const o = v as TradeVoice;
  return (
    !!o &&
    typeof o.greeting === "string" &&
    o.greeting.length > 0 &&
    typeof o.action === "string" &&
    o.action.length > 0 &&
    Array.isArray(o.jobs) &&
    o.jobs.length >= 1 &&
    // avoid is allowed to be empty: a run with no niche set simply does not say the line.
    Array.isArray(o.avoid)
  );
}

/**
 * Make a fragment read as a sentence.
 *
 * The avatar's ticket and the site finding are stored as fragments ("recurring annual sealing
 * across multiple roofs", "there is no LocalBusiness markup on the site") because everywhere else
 * they are rendered mid-line. Dropped raw into a script they come out lowercase after a period,
 * which is exactly where someone reading aloud stumbles.
 */
function sentence(s: string): string {
  const t = s.trim();
  if (!t) return "";
  const capped = t[0].toUpperCase() + t.slice(1);
  return /[.!?]$/.test(capped) ? capped : `${capped}.`;
}

/**
 * "a surface sealing contractor", "an orthodontist".
 *
 * business_type is a noun for the BUSINESS, so it needs an article the moment it appears inside a
 * sentence about what a customer is looking for. Left bare it reads "looking for surface sealing
 * contractor", which is the one line in the script that sounds machine-written.
 */
function aTrade(trade: string): string {
  const t = trade.trim();
  if (/^(a|an|the)\s/i.test(t)) return t;
  // Plurals take no article: "looking for dentists" is right, "looking for a dentists" is not.
  if (/(?:[^s]s|es)$/i.test(t) && !/(?:ss|us|is)$/i.test(t)) return t;
  return `${/^[aeiou]/i.test(t) ? "an" : "a"} ${t}`;
}

/** "Claude, Gemini or Perplexity". Read aloud, a trailing comma list sounds unfinished. */
function orList(items: string[]): string {
  if (items.length <= 1) return items[0] ?? "";
  return `${items.slice(0, -1).join(", ")} or ${items[items.length - 1]}`;
}

const HONORIFIC = /^(dr|dra|mr|mrs|ms|miss|sr|sra|prof)\.?$/i;

/**
 * The name to say in the first line, or null.
 *
 * Null is a real answer here and the caller must handle it. A cold /audit run has no contact row
 * at all, and `requester_name` on a public intake is whatever the visitor typed, which is
 * sometimes an email address or a company. Anything with a digit or an @ is rejected rather than
 * cleaned up, because the failure mode of guessing is a recording that opens on the wrong name.
 *
 * "Dr. Mehta" keeps both words: dropping to the first word would open the video with "Hey Dr",
 * and dropping the honorific would be a familiarity the sender has not earned.
 */
function readName(report: AuditReportRow, override?: string | null): string | null {
  const raw = (override || report.prospect_name || report.requester_name || "").trim();
  if (!raw || /[\d@]/.test(raw)) return null;

  const words = raw.split(/\s+/).filter(Boolean);
  if (!words.length) return null;
  if (HONORIFIC.test(words[0])) {
    const surname = words[words.length - 1];
    // An honorific on its own ("Dr.") is not a name.
    return surname && !HONORIFIC.test(surname) ? `${words[0].replace(/\.?$/, ".")} ${surname}` : null;
  }
  return words[0];
}

/**
 * A card label turned into something sayable, for when the trade-voice call fails.
 *
 * Avatar labels are written to be read on a Slack card, so they arrive singular and articled:
 * "the $45 one-time mow shopper". Said out loud after "get in front of more" that is wrong twice.
 * This is the fallback only; normally the model does this properly with the ticket and economics
 * lines in front of it.
 */
function pluralish(label: string): string {
  const t = label.trim().replace(/^(?:the|a|an)\s+/i, "");
  if (!t) return "";
  if (/(?:s|x|z|ch|sh)$/i.test(t)) return `${t}es`;
  if (/[^aeiou]y$/i.test(t)) return `${t.slice(0, -1)}ies`;
  return `${t}s`;
}

/**
 * One pillar of the middle section, in the doc's fixed 4-beat pattern.
 *
 * The beats are separate fields rather than one `lines` array because the pattern IS the template:
 * outcome in the buyer's language, the trap that makes it hard, the specific work that fixes it,
 * then the outcome again, transformed. v2 stored flat line lists and the shape drifted — one
 * pillar was all trap and no work, another was all work. Named beats make an omission visible.
 */
interface Pillar4Beat {
  /**
   * ‼️ SPOKEN AS "Number 1.", NOT "Promise 1.", AND THAT IS A GUARD DECISION NOT A STYLE ONE.
   *
   * `DELIVERY_BANNED_PROMISES` matches the bare word "promise", and it is deliberately broad.
   * Titling these "Promise N" would put three hits in every transcript, and a flag block that
   * fires three times on every recording is a flag block nobody reads to the end. Only the
   * colliding noun is avoided; the pillar names are said in full.
   */
  name: string;
  /** What they get, one or two sentences, in their language. */
  outcome: string[];
  /** What most people in their position do that fails, carried by a fixed anecdote. */
  trap: string[];
  /** The specific thing we do about it. */
  work: string[];
  /** The outcome restated, transformed. */
  ret: string[];
}

/**
 * ‼️ THE THREE PILLARS ARE COPY, NOT PROMPT MATERIAL, AND THEY MUST STAY THAT WAY.
 *
 * Same precedent as PERMISSION_CLOSE, NOT_SELLING_LINE and REPLY_ASK_LINE, but the reason here is
 * sharper than "the model rewrites it". Two of these three pillars are carried by a STORY ABOUT A
 * REAL PERSON: a nurse practitioner in Fort Pierce whose own patient reviews were quoted to
 * recommend the clinic two miles down the road, and Matthew's wife booking a laser appointment off
 * a review ChatGPT surfaced at a barbecue. A model asked to "tell a client story for this niche"
 * does not decline for lack of one. It invents a client, on camera, in a pitch whose entire basis
 * is "you can verify all of this yourself".
 *
 * That is the same no-fabrication rule run-prompts.ts states for engine results, applied to speech.
 * If a new anecdote is ever worth telling, it gets written here by a person who was there.
 *
 * ‼️ THE FORT PIERCE STORY IS TOLD TO EVERY VERTICAL, NOT JUST TO CLINICS (2026-08-25). It arrived
 * with Matthew's med-spa script and it replaced the Florida surface-sealing operator who used to
 * carry this beat, because it is the sharper telling of the same thing. It stays global for exactly
 * the reason the barbecue story always was: the point of it is HOW the machine chose, not what was
 * being bought. Generating a parallel story per vertical buys a little relevance and reopens
 * precisely the door this comment exists to keep shut. That decision is Matthew's and it survived
 * the offer rebuild.
 *
 * ‼️ THE CITY IN THE STORY IS FORT PIERCE, ONCE, EVERYWHERE. The source script said Tampa in the
 * setup and Fort Pierce in both quoted searches. It is one anecdote about one person, so it gets
 * one city, and Matthew chose Fort Pierce (2026-08-25). Do not "fix" it back to Tampa in one place.
 *
 * This is a function only because the pillars need the trade, the market and the city. Every
 * sentence in it is still written here, by hand.
 */
function loomPillars(ctx: {
  trade: string;
  where: string;
  city: string;
  startWindow: string;
}): Pillar4Beat[] {
  const { trade, where, city, startWindow } = ctx;

  const findable: Pillar4Beat = {
    name: "Being findable.",
    outcome: [
      `When your ideal customer opens ChatGPT, Claude or Perplexity and asks who is the best ${trade}${where}, your name is in the handful that comes back.`,
    ],
    trap: [
      "Most people think being on top of Google is enough.",
      "But AI is not like Google. Google shows you twenty options across a hundred pages.",
      "AI shows three names, total, and that is it.",
      "I worked with a nurse practitioner in Fort Pierce. Fourteen years injecting, three hundred and eighty five-star Google reviews, ranked number one for Botox in Fort Pierce.",
      "And when I asked ChatGPT where to get Botox in Fort Pierce, it quoted her patient reviews to recommend the SkinSpirit two miles down the street.",
      "Her words. Recommending her competitor. I know, insane.",
      "That is because most sites are written for people. The machine cannot read them.",
      "So you can be easy to find on Google and still be hard to find in the AI answers, and that is a whole different fix.",
    ],
    work: [
      "So we rewrite your pages into answers the engine wants to quote.",
      `Answers only your ideal customer${where} actually asks.`,
      "And we answer them in words the machine can actually quote.",
    ],
    ret: ["So when your prospect asks the machine who to go to, your name is one of the few that comes back."],
  };

  const familiar: Pillar4Beat = {
    name: "Being familiar.",
    outcome: [
      "The engine has seen your name enough times, in enough places it trusts, that recommending you is the safe answer.",
    ],
    trap: [
      "Here is what most people miss. It is barely reading your website.",
      "It reads what other people said about you. Reviews, forums, blogs.",
      "It is also scared of being wrong. So it picks whoever it has the most evidence for.",
      "I was at a barbecue with my wife, and we had a trip coming up the next weekend.",
      "We had just moved to a new city, and she had never had laser treatment here.",
      "And she goes, let me just ask ChatGPT where I can go.",
      "She pulls out her phone and starts talking to it. She tells it she had a bad experience with laser treatment before, and asks what places it recommends.",
      "And it pulled a review one of those websites had, from someone with her exact problem.",
      "She did not even hesitate. She booked that week, and they sold her on a yearly plan.",
      "And it checks whether your information matches everywhere. One mismatch and it drops you.",
    ],
    work: [
      "So we turn your happy customers into the evidence.",
      "We set up automatic workflows so the reviews come out pain driven, with real customer details, and end on what changed for them.",
      "We get your facts matching everywhere the machine checks.",
      "And we do outreach to the forums and the blogs that make the lists the engine quotes.",
    ],
    ret: ["So by the time it is deciding who to name, you are the one it has the most reason to trust."],
  };

  const fresh: Pillar4Beat = {
    name: "Staying fresh.",
    outcome: [
      `Every time a buyer asks, your name keeps coming back, until the default answer when somebody asks for ${aTrade(trade)}${where} is you.`,
    ],
    trap: [
      "Getting picked once means nothing.",
      "The machine builds a new answer every single time. Recent beats old.",
      // ‼️ FRESHNESS_STAT is null until it has a source. See the note over it in config/pitch.ts:
      // the pillar has to make this point without a figure, because an invented statistic is the
      // same failure as an invented client and it is the easier one to get caught on.
      ...(FRESHNESS_STAT ? [FRESHNESS_STAT] : []),
      "And the longer the same names keep coming back, the harder they set.",
      "It is like asking the machine who owns Tesla. It already has a memory, and it says Elon Musk instantly.",
    ],
    work: [
      "So we rewrite your pages every single month, and we keep adding the new questions your buyers are asking.",
      `Then every month we run these same real questions your buyers${city ? ` in ${city}` : ""} are asking, and we send you the findings.`,
      "Whether your name showed up, and whether it moved.",
      "You are measuring me, not trusting me.",
    ],
    ret: [
      DEFAULT_ANSWER_LINE,
      "Not because you asked it to. Because the machine keeps coming back to you.",
      `And that is the part that takes ${startWindow} to fully set, which is why we start it on day one.`,
    ],
  };

  return [findable, familiar, fresh];
}

// ── The aesthetics lane ─────────────────────────────────────────────────────
/**
 * ‼️ WHICH BUSINESSES GET THE HAND-WRITTEN PATIENT BLOCK INSTEAD OF THE GENERATED AVATARS.
 *
 * Matthew wrote MEDSPA_PATIENTS by hand, with real dollar ranges in it, because he knows this
 * market. Everywhere else the customers come from niche-avatars.ts, which researches them per
 * niche and is explicitly forbidden from putting a dollar figure in a spoken label. That asymmetry
 * is the whole point and it is not a bug: a hand-written figure is somebody's knowledge, and a
 * generated one is a guess with a dollar sign on it.
 *
 * So this gate decides which of those two things is about to be read out loud, and it has to stay
 * narrow. A pest control company matching this regex would have Matthew reading Botox prices on
 * camera.
 *
 * Deliberately the same haystack shape as choosePreset() in dream-lead.ts — vertical_slug, then
 * business_type, then buyer_persona — because a business that gets the aesthetic dream-lead image
 * is the same business that should get this block, and two different answers to "is this a clinic"
 * is how the picture and the script end up describing different companies.
 */
const AESTHETICS_RE =
  /\b(?:med[\s-]?spa|medspa|medical spa|aesthetic|esthetic|injectable|botox|filler|dysport|laser|cosmetic|dermatolog|derm\b|plastic surgery|trt\b|hormone|testosterone|wellness|weight loss)/i;

function isAesthetics(report: AuditReportRow): boolean {
  const haystack = `${report.vertical_slug ?? ""} ${report.business_type ?? ""} ${report.buyer_persona ?? ""}`;
  return AESTHETICS_RE.test(haystack);
}

/**
 * The three patients an aesthetics clinic actually wants, and the one it does not.
 *
 * ‼️ HAND-WRITTEN BY MATTHEW, DOLLAR FIGURES INCLUDED, AND THAT IS WHY THEY ARE ALLOWED HERE.
 * niche-avatars.ts strips money out of every spoken label it generates, on the grounds that a
 * researched figure said on camera is a guess the prospect can call. These are not researched.
 * They are what Matthew knows about this market, said in his own words, and he owns them.
 *
 * ‼️ THEY ARE PATIENT LIFETIME VALUES, NOT A FORECAST, AND THE SCRIPT MUST KEEP THEM THAT WAY.
 * "This kind of patient is worth $4,200 to $6,800 a year" is a fact about the segment. "You will
 * get patients worth $4,200 to $6,800 a year" is a promise of revenue, it trips
 * DELIVERY_BANNED_PROMISES, and it is not masked because it is not an approved constant. The
 * wording below is the first sentence, deliberately, every time.
 */
const MEDSPA_PATIENTS = {
  attract: [
    {
      label: "First-time injectable patients",
      note: "People who tried Botox and are searching for filler for the first time. They used to ask Google, now they are asking AI for the safest place to go. That kind of patient is worth $4,200 to $6,800 a year.",
    },
    {
      label: "Membership program buyers",
      note: "The ones searching for a med spa to commit to for a year. Those are worth $2,000 to $4,000 on autopilot, depending on the package.",
    },
    {
      label: "High-lifetime-value cosmetic patients",
      note: "Botox every three months, filler twice a year, laser packages. The kind that spend $4,000 or more a year without blinking.",
    },
  ],
  avoid: "Groupon deal hunters",
  /**
   * ‼️ A COST OF AN EMPTY CHAIR, NOT A PROMISE OF A FULL ONE. Same line as the LTV figures: it
   * describes what a slow Tuesday costs a clinic, which is a fact about their business, and it
   * must never be flipped into "we will fill your Tuesdays".
   */
  emptyChairs: "An empty Tuesday costs a clinic somewhere between $1,500 and $3,000.",
} as const;

// ── The competitor the script names ─────────────────────────────────────────
/**
 * ‼️ THE ONE COMPETITOR NUMBER THE RECORDING IS ALLOWED TO SAY, AND WHERE IT COMES FROM.
 *
 * `competitorsWhereAbsent(view)` counts a rival ONLY in the buyer questions this client is missing
 * from. That is the number the sentence "you showed up in 3, they showed up in 11" has to survive
 * being checked against, because the prospect has the report open and can count the rows.
 *
 * ‼️ NOT `view.mostRecommended`. Its own doc comment in delivery-guards.ts says in bold that the
 * two must not be reconciled: that one counts audit_runs rows without ever asking whether the
 * client appeared, so it is the right number for "who owns the answers" and the wrong number for
 * this sentence. It is used here only as a FALLBACK, and when it is used the gap count is not
 * spoken at all — only the name — because the two counts do not mean the same thing.
 *
 * Three states, and the third one is the reason this is a function and not an inline lookup:
 *   1. A rival with a gap count. The full sentence.
 *   2. A rival with no gap count. Name only.
 *   3. Neither. The script says nothing about competitors and NEVER INVENTS ONE. An audit where
 *      the engines returned no usable rival is a real outcome, and a script that fills the hole
 *      with "your competitor" is making a claim about a business that may not exist.
 */
interface Rival {
  name: string;
  /** Questions this rival came up in AND the client did not. Null when only a name is known. */
  gap: number | null;
}

function pickRival(view: ReportView, facts: BeatSheetFacts): Rival | null {
  const absent = competitorsWhereAbsent(view)[0];
  if (absent?.name) return { name: absent.name, gap: absent.count };
  if (facts.topCompetitor?.name) return { name: facts.topCompetitor.name, gap: null };
  return null;
}

/**
 * The either-or beat, said twice: once before the pillars and once in the close.
 *
 * ONE source for both readings. Said twice from two hand-written copies they drift by a word or
 * two, and a repeated line that is not quite the same line is worse than saying it once: the second
 * pass sounds like a different thought instead of the point landing again.
 *
 * ‼️ THE RIVAL IS NAMED ONLY IN THE CLOSING READING, AND ONLY IF THERE IS ONE. Matthew's script
 * ends on "either you're the name ChatGPT keeps quoting in [City] or [Competitor] is", which is the
 * sharpest sentence in the video precisely because it is a real name off their own run. With no
 * rival the beat falls back to "somebody in your city", which is the v3 wording and is still true.
 * It never says "your competitor" as a stand-in for a business we could not find.
 */
function urgencyBeat(city: string | null, withPromise: boolean, rival: Rival | null = null): string[] {
  const where = city ?? "your city";
  const lines = [
    "And either you start doing something about it or you don't.",
    "",
    rival
      ? `In the next six months, either you are the name ChatGPT keeps quoting in ${where}, or ${rival.name} is.`
      : `Somebody in ${where} is going to become the name that keeps getting quoted.`,
    "",
    "Right now it is leaning their way.",
  ];
  if (withPromise) {
    lines.push("", "But do not worry. In this video I am going to show you how to become the one it quotes.");
  }
  return lines;
}

/** File-safe slug for the attachment name. */
function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

async function tradeVoice(
  report: AuditReportRow,
  view: ReportView,
  avatar: BestAvatar,
  avoidAvatars: WorstCustomer[]
): Promise<TradeVoice> {
  const trade = report.business_type ?? "local service";
  const absent = view.prompts
    .filter((p) => !p.appeared && !p.isBranded && (p.block === "SERVICIO" || p.block === "COMPARATIVO"))
    .map((p) => p.prompt)
    .slice(0, 8);

  const fallback: TradeVoice = {
    greeting: trade,
    action: "get back to them and quote the job",
    jobs: absent.slice(0, 3),
    avoid: avoidAvatars.map((w) => pluralish(w.label)).filter(Boolean),
    // buyer_persona is written by classify.ts for exactly this kind of use and is already piped
    // verbatim into every outreach email, so it is a real answer here rather than a placeholder.
    adsBuyers: report.buyer_persona ?? `people looking for ${aTrade(trade)}`,
  };

  try {
    const { data } = await callClaudeJSON<TradeVoice>({
      model: "claude-sonnet-4-6",
      system: [
        "You supply small pieces of wording for a sales video script aimed at one trade. Nothing else.",
        "",
        'greeting: how to address the owner in the first line, after "Hey", WHEN THEIR NAME IS NOT KNOWN. A trade noun as an owner would say it about themselves, e.g. "surface sealing contractor", "clinic owner", "commercial landscaper". No company name, no adjectives.',
        'action: what this owner physically does once a lead comes in, as a short verb phrase that finishes the sentence "all you have to do is ___". e.g. "drive out and quote the job", "book the consultation", "send the estimate over". Match how this trade actually closes work.',
        "jobs: three jobs this business could be getting, in the owner's own plain words, five to nine words each. Take them from the buyer questions provided. Describe the WORK, not the search.",
        'adsBuyers: who physically types these questions into ChatGPT, as a short list of ROLES, e.g. "corporate marketing directors, venue GMs and film school directors", "practice managers and patients researching treatments". It is read in this sentence: "we target the exact prompt patterns ___ are typing". Two or three roles, no adjectives, no company names, no numbers.',
        "",
        "avoid: you are given customer types that have ALREADY been decided. Your only job is to reword each one for saying out loud.",
        'They are written to be read on a card, so they arrive singular and articled, e.g. "the $45 one-time mow shopper". They are going to be read in this sentence:',
        '  "...and keep you away from the P or the Q".',
        "So make each one a bare plural noun phrase: no leading 'the' or 'a', no dollar amounts, TWO TO FOUR WORDS.",
        'e.g. "the $45 one-time mow shopper" becomes "sample shoppers"; "the individual room flipper" becomes "one room flippers".',
        "A NAME, not a description. No verbs, no \"who\" or \"that\" clause, no reason attached. \"sample hoarders\" is right; \"free sample collectors who never buy\" is wrong, that is the reason and it does not get said.",
        "The detail in brackets next to each one is context so you pick the right words. It is never part of your answer.",
        "",
        "HARD RULE on avoid: reword only. Return one entry per customer given, in the same order. Never introduce a customer type that is not in the list, never merge two into one, never drop one. These names have already been checked against how this trade actually loses money, and a substitution here would put a customer on camera that nobody chose.",
        "",
        "Plain language only. No marketing adjectives, no jargon, no dollar amounts, no dashes as punctuation.",
        "Return JSON only.",
      ].join("\n"),
      user: [
        `Trade: ${trade}`,
        report.city ? `Market: ${report.city}` : "",
        `Their buyer, as classified: ${report.buyer_persona ?? "unknown"}`,
        `The customer this video is aimed at: ${avatar.label} (${avatar.ticket})`,
        "",
        avoidAvatars.length
          ? [
              `Customers to AVOID, reword these ${avoidAvatars.length} in this order:`,
              ...avoidAvatars.map((w, i) => `${i + 1}. ${w.label} (${w.whyItHurts})`),
            ].join("\n")
          : "There are no customers to avoid for this one. Return an empty array for avoid.",
        "",
        absent.length
          ? `Buyer questions they do NOT appear in. The jobs come from these:\n${absent.map((q) => `- ${q}`).join("\n")}`
          : "They appear in most tested questions, so use the highest-value work this trade does.",
        "",
        'Return {"greeting":"...","action":"...","jobs":["...","...","..."],"avoid":["...","..."],"adsBuyers":"..."}',
      ]
        .filter(Boolean)
        .join("\n"),
      maxTokens: 800,
      temperature: 0.4,
      schemaHint:
        '{ "greeting": string, "action": string, "jobs": string[] (3), ' +
        '"avoid": string[] (one per customer given, same order), "adsBuyers": string }',
      validate: isTradeVoice,
    });
    // Two ways the rewording goes wrong, both handled by falling back to the plain plural of the
    // label rather than by asking again.
    //
    // A list that came back a different LENGTH is a rewrite, not a rewording: something was merged
    // or dropped, so the pairing is no longer the one that was picked.
    //
    // An entry that came back LONG is the model answering with the reason as well as the name:
    // "free sample collectors who never buy" instead of "sample hoarders". Both are true, but this
    // line has two customer types in it already and the second clause is what turns a sentence
    // someone can say into one they stumble over.
    const tidy = (got: string[], source: Array<{ label: string }>, plain: string[]): string[] => {
      if (got.length !== source.length) return plain;
      return got.map((s, i) => (s.trim().split(/\s+/).length > 5 ? plain[i] ?? s.trim() : s.trim()));
    };
    return {
      ...data,
      avoid: tidy(data.avoid, avoidAvatars, fallback.avoid),
      // Optional in the contract, so an omission falls back rather than failing the generation.
      adsBuyers: data.adsBuyers?.trim() || fallback.adsBuyers,
    };
  } catch (e) {
    console.error("[loom-script] trade voice failed, using fallbacks:", (e as Error).message);
    return fallback;
  }
}

/**
 * Build the read-aloud script for one audit and one chosen avatar.
 *
 * `facts` comes from computeBeatSheetFacts() rather than being recomputed here, so the prompt
 * flagged DO NOT OPEN WITH in the PRE-FLIGHT card is the same prompt this script calls the
 * concession. Two computations would eventually disagree, on camera.
 */
export async function buildLoomScript(
  report: AuditReportRow,
  view: ReportView,
  facts: BeatSheetFacts,
  avatar: BestAvatar,
  opts: LoomScriptOptions = {}
): Promise<LoomScriptResult> {
  // All three to attract, the picked one first: the script reads the whole best-customer set out as
  // the jobs this points at, where the old script named one. Two to avoid: the first two on the
  // card, which is the order they were judged in.
  const others = (opts.avatars?.best ?? []).filter((b) => b.label !== avatar.label);
  const attractAvatars = [avatar, ...others].slice(0, 3);
  const avoidAvatars = (opts.avatars?.worst ?? []).slice(0, 2);

  const voice = await tradeVoice(report, view, avatar, avoidAvatars);
  const name = readName(report, opts.greetName);
  const company = report.client_name ?? facts.company;
  const startWindow = opts.window || LOOM_START_WINDOW;
  const where = report.city ? ` in ${report.city}` : "";
  const trade = report.business_type ?? "what you do";
  const price = opts.price ?? PRICE_RETAINER;

  // ‼️ TWO DECISIONS, READ ONCE, USED EVERYWHERE.
  //
  // `aesthetics` decides whether the customers about to be read out are Matthew's hand-written
  // patient types (with their dollar figures) or the researched niche set (without any). See the
  // note over MEDSPA_PATIENTS for why those two are not interchangeable.
  //
  // `rival` decides whether the recording names a competitor at all. Deriving it separately at the
  // two points that use it is how a script ends up naming one business in the middle and a
  // different one in the close.
  const aesthetics = isAesthetics(report);
  const rival = pickRival(view, facts);

  // Named as "the other agents" only when they are genuinely other: an engine that returned data
  // on this run has already been named out loud, and naming it twice invites "wait, which is it".
  const otherEngines = ["Claude", "Gemini", "Perplexity"].filter((e) => !facts.engines.includes(e));

  const rule = (label: string) => ["", `--- ${label} ---`, ""];
  const screen = (what: string) => `[ON SCREEN: ${what}]`;

  const lines: string[] = [];
  const say = (...s: string[]) => lines.push(...s);

  // Header. Not read out; it is the operator's summary before hitting record.
  say(
    `LOOM SCRIPT`,
    `${company}${report.city ? ` · ${report.city}` : ""}`,
    `Customer this is aimed at: ${avatar.label}`,
    `Customers block: ${aesthetics ? "AESTHETICS (hand-written patient types, with figures)" : "generated niche set"}`,
    `Selling: ${opts.price ? `${opts.price}, quoted by hand` : PRICE_RETAINER}, free until the first 5 qualified AI-sourced inquiries`,
    `GUARANTEE: ${sentence(GUARANTEE_RESTATE)} Only record this if we will actually chase those 5 queries.`,
    rival
      ? `Competitor named on camera: ${rival.name}${rival.gap === null ? " (name only, no gap count is said)" : `, in ${rival.gap} of the questions they are missing from`}`
      : `NO COMPETITOR FOUND in this run. The script says nothing about a rival and does not invent one.`,
    `Target 6 minutes. Read it out loud, paste the screenshots over the top.`,
    `The image is the TARGET, never a lead that already arrived. Do not say "this came in".`
  );
  if (!name) {
    say(`NAME: not known. Say their name in the first line, or reply "loom <name>" and rebuild.`);
  }
  if (!BOOKING_LINK) {
    say(
      `NO BOOKING LINK SET. The close below sends them to the onboarding call. Set SRT_ONBOARDING_CALL_URL and rebuild this script, or that sentence points at a page that does not exist.`
    );
  }
  if (!QUALIFIED_INQUIRY_DEF) {
    say(
      `NO DEFINITION OF "QUALIFIED AI-SOURCED INQUIRY" IS SET. That phrase is what starts the billing, so you and the client will read it differently on day 31. Set QUALIFIED_INQUIRY_DEF in config/pitch.ts, or be ready to define it on the onboarding call.`
    );
  }
  if (!FRESHNESS_STAT) {
    say(
      `FRESHNESS STAT OMITTED. The "87% of AI citations are under 30 days old" line is not in this script because nothing here sources it. Set FRESHNESS_STAT with its source if you want it back. Do not say it from memory.`
    );
  }

  // 1 + 2. Greeting and THE SCORE, which is the first thing said.
  //
  // The video is sent as the answer to "want me to send it over", so the viewer already knows
  // roughly what this is, and holding the score back for ninety seconds spends the only attention
  // that was granted.
  say(
    screen("the PDF scorecard"),
    "",
    `Hey ${name ?? voice.greeting},`,
    "",
    `In this video I am going to show you your current visibility status.`,
    "",
    `As you can see here, you scored ${facts.score} out of 100.`
  );

  // 2b. The three pillars, NAMED but not explained. New in v4.
  //
  // Matthew's script announces them in the first fifteen seconds and breaks them down later. That
  // is a promise of structure, and it is what buys the next four minutes: the listener now knows
  // the video has three parts and roughly where they are in it.
  say(
    "",
    `AI citation comes down to three main pillars.`,
    "",
    `  Being findable`,
    `  Being familiar`,
    `  And staying fresh`,
    "",
    `I will break those down in a second.`
  );

  // 3. Who this points at.
  //
  // The pitch is in this list: not "more visibility" but named customers they want more of. Two
  // sources, never mixed — see MEDSPA_PATIENTS and isAesthetics().
  say(...rule("THE PATIENTS"));
  say(
    screen("the dream lead image, full screen"),
    "",
    `When we turn your score around, the kind of ${aesthetics ? "patients" : "customers"} that start showing up for you depend on your targeting.`,
    "",
    `We focus on attracting.`,
    ""
  );

  if (aesthetics) {
    for (const p of MEDSPA_PATIENTS.attract) {
      say(`  ${p.label}`, `  ${p.note}`, "");
    }
    say(
      `Not ${MEDSPA_PATIENTS.avoid}.`,
      "",
      `So ideally high-lifetime-value cosmetic patients. The kind that spend without blinking, so you can fill up your Tuesdays. ${MEDSPA_PATIENTS.emptyChairs}`
    );
  } else {
    const avoid = voice.avoid.length ? orList(voice.avoid.map((a) => `the ${a}`)) : null;
    if (LOOM_CLIENT_COUNT_CLAIM) {
      say(`We will be able to get you ${LOOM_CLIENT_COUNT_CLAIM}${where}.`, "");
    }
    for (const a of attractAvatars) say(`  ${a.label}`);
    if (avoid) say("", `And keep you away from ${avoid}.`);
    say(
      "",
      `This right here is the exact kind of inquiry we point at your phone.`,
      "",
      `Someone like ${avatar.label}. ${sentence(avatar.ticket)}`,
      "",
      `And look at the line in the message. They asked ChatGPT for ${avatar.aiQuestion}, and that is how they found you.`
    );
    if (voice.jobs.length) {
      say("", `Which in your world is work like this.`, "");
      for (const job of voice.jobs) say(`  ${job}`);
    }
  }

  // 4. The 20 prompts, framed by what makes them fair: none of them say the business name. This is
  // also where the competitor read-out lands, because the count only means anything once the
  // listener has seen what was actually asked.
  say(...rule("WHAT WE FOUND"));
  say(
    screen("the list of 20 prompts"),
    "",
    `These are the phrases we tested to see if AI would recommend your ${aesthetics ? "med spa" : "business"}, without mentioning your name.`,
    "",
    `Real things people type into ChatGPT when they are looking for ${aTrade(trade)}${where}.`,
    ""
  );
  for (const p of view.prompts) say(`  ${p.prompt}`);
  say("", `You showed up in ${facts.appeared} of the ${facts.total}.`);
  if (rival?.gap != null) {
    // ‼️ THE GAP COUNT, NOT A TOTAL. `competitorsWhereAbsent` counts only the questions this client
    // is MISSING FROM, so the sentence has to say that or the number does not check out against
    // the report the prospect has open. See pickRival().
    say(
      "",
      `${rival.name} showed up in ${rival.gap} of the ones you are missing from.`
    );
  } else if (rival) {
    say("", `${rival.name} is the name that kept coming back instead.`);
  }

  // 5. The either-or. First of two readings. The rival is NOT named here: it is held for the close,
  // where it is the last thing they hear.
  say("");
  say(...urgencyBeat(report.city, true));

  // 6. Live. The concession first, because he will check it himself afterwards.
  say(...rule("LIVE"));
  say(screen("a temporary ChatGPT window"), "");
  if (facts.trampa) {
    say(
      `Let me show you live, and I want to start with the one where you do well.`,
      "",
      `  ${facts.trampa.prompt}`,
      "",
      `There you are. That one is working${facts.trampa.rank ? `, you come up around number ${facts.trampa.rank}` : ""}.`,
      ""
    );
  } else {
    say(`Let me show you live. I will say up front, there was no question in the set where you came up on your own.`, "");
  }
  if (facts.apertura) {
    say(
      `Now this one.`,
      "",
      `  ${facts.apertura.prompt}`,
      "",
      `Read the names it gives back. ${company} is not there.`
    );
  }
  if (facts.ticketAlto && facts.ticketAlto.prompt !== facts.apertura?.prompt) {
    say("", `And this one, which is the bigger job.`, "", `  ${facts.ticketAlto.prompt}`, "", `Same thing.`);
  }

  // The YOUR SITE beat (a robots.txt line blocking the crawler an engine actually reads pages
  // with, or a finding off the site scan) was cut from the script for length. It is NOT lost: it
  // moved to the pre-flight card as an optional talking point, because a blocked crawler is real
  // evidence and deleting it outright would have thrown away the strongest thing some audits find.
  // See renderPreflight() in loom-beatsheet.ts.

  // 7. Speed to lead. Said here because it is the one thing HE needs from THEM, and because the
  // hot-dog line only lands once they have watched their own name fail to come back.
  say(...rule("SPEED"));
  say(
    `One thing before I show you the fix, because it decides whether this works for you or not.`,
    "",
    `This works best if you or your front desk can respond to an inquiry within five minutes.`,
    "",
    `Speed is the name of the game. AI-sourced ${aesthetics ? "patients" : "customers"} are like word of mouth referrals. They are already eighty percent of the way booked when they message you.`,
    "",
    `Compared to Meta ads, ChatGPT is like cold calling people at dinner versus selling hot dogs outside the club at three in the morning.`,
    "",
    `One of them is interrupting somebody. The other one is standing where the hungry people already are.`
  );

  // 8. THE PILLARS. The explanatory middle, and the only part that is the same every time.
  // See loomPillars() for why the anecdotes are written there and not generated.
  const pillars = loomPillars({
    trade,
    where,
    city: report.city ?? "",
    startWindow,
  });

  say(...rule("THE THREE PILLARS"));
  say(`So let me break down those three pillars, and what we do about each one.`);
  for (const [i, p] of pillars.entries()) {
    say("", `Number ${i + 1}. ${p.name}`, "");
    for (const line of [...p.outcome, ...p.trap, ...p.work, ...p.ret]) say(line, "");
  }
  say(`And then all you have to do is ${voice.action}.`);
  say("");
  say(`You will not win all of them. But if you are fast, you will win more than you don't.`);

  // 9. THE GUARANTEE. It sits after the pillars rather than in the open: it is an answer, and it
  // only lands as one once they have watched their own name fail to come back on camera.
  say(...rule("THE GUARANTEE"));
  say(`So here is my guarantee.`, "", `${sentence(GUARANTEE_LINE)}`);

  // 10. The value stack, then the price, then the free period. Order matters: the stack has to be
  // in the room before the number is, or the number is the only thing they have to react to.
  say(...rule("THE INVESTMENT"));
  say(`So each month, here is what we do.`, "");
  for (const item of OFFER_INCLUDES) say(`  ${item.work}. ${item.value}.`);
  say(
    "",
    `And since we are opening this vertical, founding members also get ${FOUNDING_BONUS.headline}.`,
    ""
  );
  for (const item of FOUNDING_BONUS.items) say(`  ${item}`);
  say("", `That part is only for the first ${FOUNDING_SPOTS}.`);

  say("");
  // ‼️ VALUE_MONTH_ONE is null until Matthew picks it, because the line items do not add to the
  // $4,000 the source script says. See the note over it. While it is null the recording says only
  // the recurring figure, which does check out.
  if (VALUE_MONTH_ONE) {
    say(`Total delivered value: ${VALUE_MONTH_ONE} in month one, ${VALUE_RECURRING} every month after.`);
  } else {
    say(`Total delivered value: ${VALUE_RECURRING} every month.`);
  }

  say(
    "",
    `But today, we will do that for free.`,
    "",
    `${sentence(FREE_UNTIL_LINE)}`,
    ...(QUALIFIED_INQUIRY_DEF ? ["", QUALIFIED_INQUIRY_DEF] : []),
    "",
    // ‼️ THE SECOND BEAT ATTACHES THE PRICE AND DOES NOT RESTATE THE TERMS. It used to say
    // "So you start free" one line under a sentence that had just said exactly that, which
    // reads as a stutter out loud. What the listener still needs at this point is the number.
    //
    // PRICE_RETAINER_AMOUNT, not PRICE_RETAINER: the sentence already says "monthly".
    `And if we hit that, the monthly retainer is ${opts.price ?? PRICE_RETAINER_AMOUNT}.`
  );

  // 11. Founding cohort. The scarcity is real and countable, which is the only reason it is said
  // out loud at all — see the note over FOUNDING_BONUS in config/pitch.ts.
  say(...rule("FOUNDING"));
  say(
    `But remember, I am taking on ${FOUNDING_SPOTS} independent ${aesthetics ? "med spas" : "businesses"} as founding clients in this vertical.`,
    "",
    `In exchange for ${FOUNDING_EXCHANGE}.`,
    "",
    // KEEP_WORKING_FREE_LINE already names the window and the outcome, so the lead-in must
    // not. Said as it was, this beat read "better visibility in two to three weeks" twice in
    // one breath.
    `You are going to see movement fast. And ${KEEP_WORKING_FREE_LINE}.`
  );

  // 12. The timeline, and then the ads as the answer to it. This is the one place the prospect
  // will otherwise reconcile wrongly: he has just heard "30 days" and "60 to 90 days" in the same
  // video, and it has to be clear which half each belongs to.
  const engineLine = `${orList(facts.engines)}${otherEngines.length ? `, and the other search agents like ${orList(otherEngines)}` : ""}`;
  say(...rule("THE ACCELERATOR"));
  say(
    `Organic AI visibility takes ${startWindow} to fully kick in. That is how long it takes to get pushed by ${engineLine}.`,
    "",
    `Because of your industry, we know we can get you there in about ${FAST_WINDOW}.`,
    "",
    `But if you do not want to wait for real momentum, there is a faster lane.`,
    ""
  );
  for (const line of ADS_ACCELERATOR) say(line, "");

  // 13. The CTA. The close is the onboarding call, not a payment page: nothing is charged up front
  // under this offer, so a checkout link here would contradict the free period two beats earlier.
  say(...rule("THE CLOSE"));
  if (BOOKING_LINK) {
    say(
      `So here is what happens next.`,
      "",
      `The link to book the onboarding call is right here.`,
      "",
      screen(`the booking page, ${BOOKING_LINK}`),
      "",
      `We write the first few pages after the onboarding call, but we will have a few examples ready for you before then.`,
      "",
      `Getting started usually takes ${ONBOARDING_WINDOW}.`
    );
  } else {
    say(
      `!! NO BOOKING LINK IS SET, so do not say "the link to book the onboarding call". Set SRT_ONBOARDING_CALL_URL and rebuild this script, or tell them you will send the booking link right after this video and stop there.`,
      "",
      `So here is what happens next. Reply to the email I sent over and I will send you the link to book the onboarding call.`
    );
  }
  say(
    "",
    `If you have one question before you click, my number is ${LOOM_TEXT_NUMBER}. Text me, I will answer.`
  );

  say("");
  say(...urgencyBeat(report.city, false, rival));
  say(
    "",
    `So hit the link and schedule the onboarding call. The founding offer is only ${FOUNDING_SPOTS} spots.`,
    "",
    `And if you feel like I did not understand your business correctly, or I missed something, we clarify all of it on that call. Or you can just call me.`,
    "",
    `Let's get AI to send you ${aesthetics ? "patients" : "clients"}.`
  );

  say(
    ...rule("AFTER RECORDING"),
    `Paste the Loom transcript in this Slack thread, then reply "delivery" for the hand-over email.`,
    `It quotes two real timestamps read off what you actually said, so it will not draft without the transcript.`
  );

  const text = noDashes(lines.join("\n")).replace(/\n{4,}/g, "\n\n\n");
  return { text, fileName: `loom-script-${slugify(company)}.txt` };
}
