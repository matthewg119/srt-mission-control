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
//   2. We put you in front of buyers today.         (NEW: ChatGPT Ads. Where the guarantee lives)
//   3. We make you the default answer.              (v2's Familiar + Freshness + commitments 2, 3)
//
// ‼️ PROMISE 2 EXISTS ONLY ON THE TIER THAT SELLS ADS, AND SO DOES THE GUARANTEE. On `loom core`
// or `loom complete` it is not softened, hedged or reworded: it is not rendered, and neither is
// the BIG PROMISE beat. Selling a paid layer that is not in the tier they are being quoted is the
// same error as promising a return we have no mechanism to deliver, and both come out of the same
// decision. `guaranteeFor()` in config/pitch.ts is the gate; absent beats forbidden.
//
// The v2 "one extra client a month will very likely make back the investment" line is GONE. It was
// a deliberate, documented DELIVERY_BANNED_PROMISES violation, spoken only, and it was a vaguer
// version of the claim the guarantee now makes properly: with a number, a window, one tier, and a
// stated remedy if it is missed. Do not put it back alongside the guarantee.
//
// ── What is filled from real data and what is not ───────────────────────────
// The score, the X of Y, the prompts, the prompt they rank best on and the ones they are absent
// from all come from this audit's own run. The customers named in the open are the niche's own
// avatars (niche-avatars.ts), not something written here. ONE Claude call supplies the wordings
// that are a fact about the TRADE rather than about this business: the verb for what they do
// when a lead lands, the jobs in the owner's own words, and the customers to avoid REWORDED for
// saying out loud. The three pillars are hand-written constants and must stay that way, for the
// reason spelled out over loomPromises(). Nothing else is generated, and nothing is estimated.
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
  ADS_WINDOW_LINE,
  ANNUAL_LINE,
  DEFAULT_ANSWER_LINE,
  GUARANTEE_LINE,
  GUARANTEE_MATH,
  GUARANTEE_RESTATE,
  LOOM_CLIENT_COUNT_CLAIM,
  LOOM_START_WINDOW,
  LOOM_TEXT_NUMBER,
  ONBOARDING_WINDOW,
  PAYMENT_LINK,
  PRICE_ADS,
  PRICE_COMPLETE,
  PRICE_CORE,
  PRICE_ENTERPRISE_FROM,
  RECOMMENDED_TIER,
  TIER_CONTRAST,
  guaranteeFor,
  priceForTier,
} from "@/config/pitch";
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
  /**
   * Which tier this recording sells. A name out of OFFER_TIERS, defaulting to RECOMMENDED_TIER.
   *
   * ‼️ It decides two things at once, and they are the same decision: whether Promise 2 (the ads)
   * is in the video, and whether the guarantee is spoken. A tier without the paid layer cannot
   * deliver a 30 day return, so it does not get to promise one.
   */
  tier?: string | null;
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
 * One promise, in the doc's fixed 4-beat pattern.
 *
 * The beats are separate fields rather than one `lines` array because the pattern IS the template:
 * outcome in the buyer's language, the trap that makes it hard, the specific work that fixes it,
 * then the outcome again, transformed. v2 stored flat line lists and the shape drifted — one
 * pillar was all trap and no work, another was all work. Named beats make an omission visible.
 */
interface Promise4Beat {
  /**
   * ‼️ SPOKEN AS "Number 1.", NOT "Promise 1.", AND THAT IS A GUARD DECISION NOT A STYLE ONE.
   *
   * `DELIVERY_BANNED_PROMISES` matches the bare word "promise", and it is deliberately broad.
   * v2 spoke that word exactly once ("our promise is simple"), so a transcript flag meant
   * something. Titling all three of these "Promise N" would put five hits in every transcript,
   * and a flag block that fires five times on every recording is a flag block nobody reads to the
   * end. The doc's names for the three promises are kept in full; only the colliding noun is not
   * said out loud. It also matches the numbering Matthew already reads off v2 cards.
   *
   * ‼️ THE NUMBER IS APPLIED AT RENDER TIME, NOT STORED HERE. Promise 2 is dropped on a tier with
   * no ads, so a number baked into the constant would have the script say "Number 1 ... Number 3"
   * two sentences after announcing two things. Read out loud that is not a typo, it is the
   * listener wondering what they missed.
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
 * ‼️ THE THREE PROMISES ARE COPY, NOT PROMPT MATERIAL, AND THEY MUST STAY THAT WAY.
 *
 * Same precedent as PERMISSION_CLOSE, NOT_SELLING_LINE and REPLY_ASK_LINE, but the reason here is
 * sharper than "the model rewrites it". Two of these three promises are carried by a STORY ABOUT A
 * REAL PERSON: an operator in Florida whose own reviews were quoted to recommend his competitors,
 * and Matthew's wife booking a laser appointment off a review ChatGPT surfaced at a barbecue. A
 * model asked to "tell a client story for this niche" does not decline for lack of one. It invents
 * a client, on camera, in a pitch whose entire basis is "you can verify all of this yourself".
 *
 * That is the same no-fabrication rule run-prompts.ts states for engine results, applied to speech.
 * If a new anecdote is ever worth telling, it gets written here by a person who was there.
 *
 * ‼️ THE REBUILD DOC'S §7 SAYS TO GENERATE A PARALLEL STORY FOR NON-AESTHETIC VERTICALS. WE DO
 * NOT DO THAT, and the decision is Matthew's (2026-08-21). The barbecue story is told to
 * contractors, clinics and film studios alike for the reason it always was: the point of it is HOW
 * the machine chose, not what was being bought. A per-vertical anecdote buys a little relevance and
 * reopens exactly the door this comment exists to keep shut.
 *
 * This is a function only because Promise 2 needs the trade, the market and who is typing the
 * prompts. Every sentence in it is still written here, by hand.
 */
function loomPromises(ctx: {
  trade: string;
  where: string;
  city: string;
  adsBuyers: string;
  startWindow: string;
  guaranteed: boolean;
}): Promise4Beat[] {
  const { trade, where, city, adsBuyers, startWindow, guaranteed } = ctx;

  const findable: Promise4Beat = {
    name: "We put you in the list.",
    outcome: [
      `When your ideal customer opens ChatGPT, Claude or Perplexity and asks who is the best ${trade}${where}, your name is in the handful that comes back.`,
    ],
    trap: [
      "Most people think being on top of Google is enough.",
      "But AI is not like Google. There is no twenty options and a hundred pages of results.",
      "It hands back three or five business names. That is the whole list.",
      "I had a guy in Florida. Twenty years in business, hundreds of reviews.",
      "And the engine was quoting his own reviews to recommend his competitors.",
      "That is because most sites are written for people. The machine cannot read them.",
      "So you can be easy to find on Google and still be hard to find in the AI answers, and that is a whole different fix.",
    ],
    work: [
      "So we rewrite your pages into answers the engine wants to quote.",
      `Answers only your ideal customer${where} actually asks.`,
      "And we answer them in words the machine can actually quote.",
    ],
    ret: ["So when your prospect asks the machine who to hire, your name is one of the few that comes back."],
  };

  const ads: Promise4Beat = {
    name: "We put you in front of buyers today, with ChatGPT Ads.",
    outcome: [
      `While the organic work is compounding, the buyers asking ChatGPT for ${aTrade(trade)}${where} right now see your name. Not organically. Placed there directly.`,
      "Inquiries this week, not this quarter.",
    ],
    trap: [
      "Here is why that matters.",
      `Organic AI visibility takes ${startWindow} to compound. That is real, and it works.`,
      "But most of your competitors are sitting and waiting on that curve.",
      `Meanwhile ChatGPT just opened its ad platform, and almost nobody in your industry knows how to run it yet.`,
      // sentence() because ADS_WINDOW_LINE is stored as a fragment for use mid-line elsewhere, and
      // dropped raw after a period it reads "again. same low CPMs" — exactly where someone
      // reading aloud stumbles.
      `It is 2016 Facebook ads all over again. ${sentence(ADS_WINDOW_LINE)}`,
    ],
    work: [
      `So we build the creative, we target the exact prompt patterns ${adsBuyers} are typing, and we manage the budget end to end.`,
      "Weekly performance reports, so you see every dollar working.",
    ],
    ret: guaranteed
      ? [
          "You are getting real inquiries inside your first week.",
          `And that is how we hit the guarantee. ${sentence(GUARANTEE_RESTATE)}`,
        ]
      : ["You are getting real inquiries inside your first week."],
  };

  const dflt: Promise4Beat = {
    name: "We make you the default answer.",
    outcome: [
      `Every time a buyer asks, your name keeps coming back, until the default answer when somebody asks for ${aTrade(trade)}${where} is you.`,
      ...(guaranteed ? ["This is the equity that stays even after we turn the ads off."] : []),
    ],
    trap: [
      "Here is what most people miss. Getting picked once means nothing.",
      "The machine builds a new answer every single time. Recent beats old.",
      "And the longer the same names keep coming back, the harder they set.",
      "It is like asking the machine who owns Tesla. It already has a memory, and it says Elon Musk instantly.",
      "It is also scared of being wrong. So it picks whoever it has the most evidence for.",
      "I was at a barbecue with my wife, and we had a trip coming up the next weekend.",
      "We had just moved to a new city, and she had never had laser treatment here.",
      "And she goes, let me just ask ChatGPT where I can go.",
      "She pulls out her phone and starts talking to it. She tells it she had a bad experience with laser treatment before, and asks what places it recommends.",
      "And it pulled a review one of those websites had, from someone with her exact problem.",
      "She did not even hesitate. She booked that week, and they sold her on a yearly plan.",
      "It barely reads your website. It reads what other people said about you. Reviews, forums, blogs.",
      "And it checks whether your information matches everywhere. One mismatch and it drops you.",
    ],
    work: [
      "So we turn your happy customers into the evidence.",
      "We set up automatic workflows so the reviews come out pain driven, with real customer details, and end on what changed for them.",
      "We get your facts matching everywhere the machine checks.",
      "And we do outreach to the forums and the blogs that make the lists the engine quotes.",
      `Then every single month we run these same real questions your buyers${city ? ` in ${city}` : ""} are asking, and we send you the findings.`,
      "Whether your name showed up, and whether it moved.",
      ...(guaranteed
        ? ["So you get the guarantee and you get the scorecard. You are not just trusting the guarantee, you are watching it move."]
        : []),
      "You are measuring me, not trusting me.",
    ],
    ret: [
      DEFAULT_ANSWER_LINE,
      ...(guaranteed
        ? ["Not because you paid to be there. Because the machine keeps coming back to you."]
        : ["Not because you asked it to. Because the machine keeps coming back to you."]),
    ],
  };

  // ‼️ Promise 2 is DROPPED, not softened, when the tier has no ads in it. See the v3 note in the
  // file header: a recording that sells a paid layer the invoice does not include is the same
  // mistake as a guarantee with no mechanism behind it, and it is the same decision that causes it.
  return guaranteed ? [findable, ads, dflt] : [findable, dflt];
}

/**
 * The either-or beat, said twice: once before the pillars and once in the close.
 *
 * ONE source for both readings. Said twice from two hand-written copies they drift by a word or
 * two, and a repeated line that is not quite the same line is worse than saying it once: the second
 * pass sounds like a different thought instead of the point landing again.
 */
function urgencyBeat(city: string | null, withPromise: boolean, inside30 = false): string[] {
  const where = city ?? "your city";
  const lines = [
    "And either you start doing something about it or you don't.",
    "",
    `Somebody in ${where} is going to become the name that keeps getting quoted.`,
    "",
    "Right now it is leaning their way.",
  ];
  if (withPromise) {
    // "Starting inside 30 days" is only said where a 30 day mechanism exists. On a tier with no
    // ads in it the same sentence would be a timeline nothing in the offer can hold.
    lines.push(
      "",
      `But do not worry. In this video I am going to show you how to become the one it quotes${inside30 ? ", starting inside 30 days" : ""}.`
    );
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
  // All three to attract, the picked one first: v2 reads the whole best-customer set out as the
  // jobs this points at, where the old script named one. Two to avoid: the first two on the card,
  // which is the order they were judged in.
  const others = (opts.avatars?.best ?? []).filter((b) => b.label !== avatar.label);
  const attractAvatars = [avatar, ...others].slice(0, 3);
  const avoidAvatars = (opts.avatars?.worst ?? []).slice(0, 2);

  const voice = await tradeVoice(report, view, avatar, avoidAvatars);
  const name = readName(report, opts.greetName);
  const company = report.client_name ?? facts.company;
  const startWindow = opts.window || LOOM_START_WINDOW;
  const where = report.city ? ` in ${report.city}` : "";
  const trade = report.business_type ?? "what you do";

  // ‼️ ONE DECISION, READ ONCE, USED EVERYWHERE. The tier decides whether Promise 2 exists, whether
  // the BIG PROMISE beat is rendered, whether the either-or says "starting inside 30 days", and
  // which price leads the investment block. Deriving it separately at each of those four points is
  // how a script ends up promising a return and then quoting a tier that cannot deliver one.
  //
  // A `loom $499` price override also drops the guarantee: it means the recording quotes ONE
  // number chosen by hand, and the guarantee is attached to a named tier, not to a figure.
  const tier = opts.price ? null : opts.tier ?? RECOMMENDED_TIER;
  const guarantee = guaranteeFor(tier);
  const guaranteed = guarantee !== null;
  const tierPrice = priceForTier(tier);
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
    `Selling: ${opts.price ? `${opts.price}, quoted by hand` : `${tier}${tierPrice ? `, ${tierPrice}` : ""}`}`,
    guaranteed
      ? `GUARANTEE: ON. You are promising ${GUARANTEE_RESTATE}. Only record this if we can actually run the ads.`
      : `GUARANTEE: OFF. This tier has no ads and no guarantee. Do not say either.`,
    `Target 6 minutes. Read it out loud, paste the screenshots over the top.`,
    `The image is the TARGET, never a lead that already arrived. Do not say "this came in".`
  );
  if (!name) {
    say(`NAME: not known. Say their name in the first line, or reply "loom <name>" and rebuild.`);
  }
  if (!PAYMENT_LINK) {
    say(
      `NO PAYMENT LINK SET. The close below asks them to click the link in the email. Set SRT_PAYMENT_URL before recording, or that sentence promises something that does not exist.`
    );
  }

  // 1 + 2. Greeting and THE SCORE, which is now the first thing said.
  //
  // v2 opens on the number rather than working up to it. The reason is the thumbnail: the video is
  // sent as the answer to "want me to send it over", so the viewer already knows roughly what this
  // is, and holding the score back for ninety seconds spends the only attention that was granted.
  say(
    screen("the PDF scorecard"),
    "",
    `Hey ${name ?? voice.greeting},`,
    "",
    `In this video I am going to show you your current visibility status.`,
    "",
    `As you can see here, you scored ${facts.score} out of 100. You showed up in ${facts.appeared} of the ${facts.total} questions we tested.`
  );

  // 3. Who this points at. v2 names the WHOLE best-customer set, where the old script named one.
  //
  // The pitch is in this list: not "more visibility" but three named customers they want more of.
  // They are the niche set's own labels, the same ones on the Slack card, so what he reads here is
  // what he already agreed to when he picked. Labels rather than the spoken rewording, because read
  // as a list they are titles, and a title is what makes a customer type sound like a real segment.
  const avoid = voice.avoid.length ? orList(voice.avoid.map((a) => `the ${a}`)) : null;
  say(...rule("THE JOBS"));
  say(
    screen("the dream lead image, full screen"),
    "",
    LOOM_CLIENT_COUNT_CLAIM
      ? `When you decide to increase your AI visibility, we will be able to get you ${LOOM_CLIENT_COUNT_CLAIM}${where}.`
      : `When you decide to increase your AI visibility, we will be able to get you in front of this type of job${where}.`,
    ""
  );
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

  // 4. Speed to lead. Said early because it is the one thing HE needs from THEM.
  say(...rule("SPEED"));
  say(
    `One thing before I show you the rest, because it decides whether this works for you or not.`,
    "",
    `We found this works really well when you call the lead within five minutes of the inquiry.`,
    "",
    `Speed is the name of the game. If you can be fast, this can work for you.`
  );

  // 5. The 20 prompts, framed by what makes them fair: none of them say the business name.
  say(...rule("WHAT WE FOUND"));
  say(
    screen("the list of 20 prompts"),
    "",
    `These are the phrases we used to try and find you, without mentioning your name completely.`,
    "",
    `Real things people type into ChatGPT when they are looking for ${aTrade(report.business_type ?? "what you do")}${where}.`,
    ""
  );
  for (const p of view.prompts) say(`  ${p.prompt}`);

  // 6. The either-or. First of two readings; this one carries the promise that sets up the middle.
  say("");
  say(...urgencyBeat(report.city, true, guaranteed));

  // 7. Live. The concession first, because he will check it himself afterwards.
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

  // 8. THE BIG PROMISE. Only on the tier that can deliver it.
  //
  // It sits here, after the live demo, rather than in the open: the guarantee is an answer, and it
  // only lands as one once they have watched their own name fail to come back on camera.
  if (guarantee) {
    say(...rule("THE BIG PROMISE"));
    say(
      `So here is my promise.`,
      "",
      `If you run ${aTrade(trade)} and you are serious about winning customers from AI in the next 30 days, ${guarantee}.`,
      "",
      GUARANTEE_MATH,
      "",
      `Here is exactly what that looks like. Three specific things we commit to.`
    );
  }

  // 9. THE PROMISES. The explanatory middle of the video, and the only part that is the same every
  // time. See loomPromises() for why the anecdotes are written there and not generated.
  //
  // This replaced v2's PILLARS-then-COMMITMENTS, which explained a problem and then, ninety seconds
  // later, gave the fix for it. Each promise now runs Outcome, Trap, Work, Return in one pass.
  const promises = loomPromises({
    trade,
    where,
    city: report.city ?? "",
    adsBuyers: voice.adsBuyers ?? (report.buyer_persona ?? "your buyers"),
    startWindow,
    guaranteed,
  });

  say(...rule("THE PROMISES"));
  if (!guarantee) {
    say(
      `So you can do all of this yourself.`,
      "",
      `But if you want us to do it for you, our promise is simple. We commit to two things.`
    );
  }
  for (const [i, p] of promises.entries()) {
    say("", `Number ${i + 1}. ${p.name}`, "");
    for (const line of [...p.outcome, ...p.trap, ...p.work, ...p.ret]) say(line, "");
  }
  say(`And then all you have to do is ${voice.action}.`);

  say("");
  say(`You will not win all of the jobs. But if you are fast, you will win more than you don't.`);

  // 10. Price and timeline. The recommended tier first, then the alternatives, in the doc's order.
  say(...rule("THE INVESTMENT"));
  if (opts.price) {
    // A `loom $499` override means the recording quotes one number, so the ladder would describe
    // a choice that is not being offered.
    say(`If you want to get started, the investment is ${opts.price}.`);
  } else if (guaranteed) {
    say(
      `For anyone serious about winning customers from AI in the next 30 days, this is what we recommend. ${RECOMMENDED_TIER}, at ${PRICE_ADS}, with the guarantee.`,
      "",
      `${sentence(GUARANTEE_RESTATE)} That is the tier where all three promises fully activate.`,
      "",
      `If you are not ready for the ads and you want to build the organic foundation first, Complete Visibility is ${PRICE_COMPLETE}. Same organic work, no ads, no guarantee. You are on the compound curve, ${startWindow}. It works, it just does not move as fast.`,
      "",
      `If you just want the basics, Core Visibility is ${PRICE_CORE}. ${TIER_CONTRAST.Core.line} ${TIER_CONTRAST.Core.detail} The minimum needed to stop being invisible.`,
      "",
      `And if you are running 2 or more locations, there is a version built for that. Enterprise starts at ${PRICE_ENTERPRISE_FROM}. ${TIER_CONTRAST.Enterprise.line} ${TIER_CONTRAST.Enterprise.detail}`,
      "",
      TIER_CONTRAST.both,
      "",
      ANNUAL_LINE
    );
  } else {
    say(
      `We have our core Visibility program, which is ${PRICE_CORE}.`,
      "",
      `Or the complete Visibility program, where the investment is ${PRICE_COMPLETE}.`,
      "",
      `${TIER_CONTRAST.Core.line} ${TIER_CONTRAST.Core.detail}`,
      "",
      `${TIER_CONTRAST.Complete.line} ${TIER_CONTRAST.Complete.detail}`,
      "",
      TIER_CONTRAST.both
    );
  }

  // The organic timeline, said out loud in both cases, because it is the one thing the prospect
  // will otherwise reconcile wrongly: on the guaranteed tier he has just heard "30 days" and
  // "60 to 90 days" in the same video, and it has to be clear which half each belongs to.
  const engineLine = `${orList(facts.engines)}${otherEngines.length ? `, and the other search agents like ${orList(otherEngines)}` : ""}`;
  say("");
  if (guaranteed) {
    say(
      `One thing to be clear about. On the organic side you typically start getting pushed by ${engineLine}, in anywhere from ${startWindow}.`,
      "",
      `The ads are what carry the first 30 days while that builds. That is the whole reason they are in there.`
    );
  } else {
    say(
      `Typically you start getting pushed by ${engineLine}, in anywhere from ${startWindow}.`,
      "",
      `So it does take some time to kick in. The work requires us to be patient.`
    );
  }
  say("", `And again, it works really well if you can call the leads within five minutes.`);

  // 12. The CTA and what happens next. v2 sends them to the payment link rather than asking for a
  // reply phrase, so the delivery email carries that link. Both are read off PAYMENT_LINK.
  say(...rule("THE CLOSE"));
  if (PAYMENT_LINK) {
    say(
      `If this sounds like you and you would like to get started, click the link I sent over to your email.`,
      "",
      screen(`the payment page, ${PAYMENT_LINK}`),
      "",
      `It takes you to this page, where you can pay by credit card, PayPal or direct ACH.`,
      "",
      `After the payment is completed you will receive an invitation link to get you started right away.`,
      "",
      `Getting started usually takes ${ONBOARDING_WINDOW}, depending on how busy we are.`
    );
  } else {
    say(
      `!! NO PAYMENT LINK IS SET, so do not say "click the link I sent over". Set SRT_PAYMENT_URL and rebuild this script, or say you will send the invoice over after this video and stop there.`,
      "",
      `If this sounds like you and you would like to get started, reply to the email I sent over and I will send the invoice.`
    );
  }
  say("");
  say(...urgencyBeat(report.city, false));
  say(
    "",
    `If you have any questions you can reach me on this guy right here. My number is ${LOOM_TEXT_NUMBER}. Feel free to text me.`,
    "",
    `I hope I explained myself. And if you feel like I did not understand your business correctly, or I missed something, we clarify all of it on the onboarding call as soon as the payment is completed. Or you can just call me.`,
    "",
    `And if it is not for you, thanks for your time. I hope you learned something that gets you ready for the age of AI ahead of us.`
  );

  say(
    ...rule("AFTER RECORDING"),
    `Paste the Loom transcript in this Slack thread, then reply "delivery" for the hand-over email.`,
    `It quotes two real timestamps read off what you actually said, so it will not draft without the transcript.`
  );

  const text = noDashes(lines.join("\n")).replace(/\n{4,}/g, "\n\n\n");
  return { text, fileName: `loom-script-${slugify(company)}.txt` };
}
