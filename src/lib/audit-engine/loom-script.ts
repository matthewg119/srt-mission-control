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
// ── What is filled from real data and what is not ───────────────────────────
// The score, the X of Y, the prompts, the prompt they rank best on and the ones they are absent
// from all come from this audit's own run. The customers named in the open are the niche's own
// avatars (niche-avatars.ts), not something written here. ONE Claude call supplies the wordings
// that are a fact about the TRADE rather than about this business: the verb for what they do
// when a lead lands, the jobs in the owner's own words, and the customers to avoid REWORDED for
// saying out loud. The three pillars are hand-written constants and must stay that way, for the
// reason spelled out over LOOM_PILLARS. Nothing else is generated, and nothing is estimated.
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
  LOOM_CLIENT_COUNT_CLAIM,
  LOOM_PRICE_LABEL,
  LOOM_START_WINDOW,
  LOOM_TEXT_NUMBER,
  ONBOARDING_WINDOW,
  PAYMENT_LINK,
  PRICE_COMPLETE,
  PRICE_CORE,
  TIER_CONTRAST,
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
 * ‼️ THE THREE PILLARS ARE COPY, NOT PROMPT MATERIAL, AND THEY MUST STAY THAT WAY.
 *
 * Same precedent as PERMISSION_CLOSE, NOT_SELLING_LINE and REPLY_ASK_LINE, but the reason here is
 * sharper than "the model rewrites it". Two of these three pillars are carried by a STORY ABOUT A
 * REAL PERSON: an operator in Florida whose own reviews were quoted to recommend his competitors,
 * and Matthew's wife booking a laser appointment off a review ChatGPT surfaced at a barbecue. A
 * model asked to "tell a client story for this niche" does not decline for lack of one. It invents
 * a client, on camera, in a pitch whose entire basis is "you can verify all of this yourself".
 *
 * That is the same no-fabrication rule run-prompts.ts states for engine results, applied to speech.
 * If a new anecdote is ever worth telling, it gets written here by a person who was there.
 *
 * Vertical-agnostic on purpose: the laser story is told to contractors and film festivals alike,
 * because the point of it is HOW the machine chose, not what was being bought.
 */
const LOOM_PILLARS: ReadonlyArray<{ title: string; lines: string[] }> = [
  {
    title: "Number 1. Findable",
    lines: [
      "I had a guy in Florida. Twenty years in business, hundreds of reviews.",
      "And the engine was quoting his own reviews to recommend his competitors.",
      "That is because most sites are written for people. The machine cannot read them.",
      "And AI is not like Google. There is no twenty options and a hundred pages of results.",
      "It hands back three or five business names. That is the whole list.",
      "So you can be easy to find on Google and still be hard to find in the AI answers, and that is a whole different fix.",
      "So what we do is rewrite your pages into answers the machine can actually quote.",
    ],
  },
  {
    title: "Number 2. Familiar",
    lines: [
      "The machine is scared of being wrong. It picks whoever it has the most evidence for.",
      "I was at a barbecue with my wife, and we had a trip coming up the next weekend.",
      "We had just moved to a new city, and she had never had laser treatment here.",
      "And she goes, let me just ask ChatGPT where I can go.",
      "She pulls out her phone and starts talking to it. She tells it she had a bad experience with laser treatment before, and asks what places it recommends.",
      "And it pulled a review one of those websites had, from someone with her exact problem.",
      "She did not even hesitate. She booked that week, and they sold her on a yearly plan.",
      "It barely reads your website. It reads what other people said about you. Reviews, forums, blogs.",
      "And it checks whether your information matches everywhere. One mismatch and it drops you.",
      "So what we do is turn your happy customers into the proof the machine can quote.",
    ],
  },
  {
    title: "Number 3. Freshness",
    lines: [
      "The machine builds a new answer every single time. Recent beats old.",
      "And the longer the same names keep coming back, the harder they set.",
      "So the game is not getting picked once. It is being the name it keeps coming back to.",
      "It is like asking the machine who owns Tesla. It already has a memory, and it says Elon Musk instantly.",
      "So what we do is keep you in the answer, until you are part of the memory of the AI.",
      "And we prove it monthly.",
    ],
  },
];

/** The offer as three things we commit to, which is what replaced the old "what we do" paragraph. */
const LOOM_COMMITMENTS: ReadonlyArray<{ title: string; lines: string[] }> = [
  {
    title: "Number 1",
    lines: [
      "We rebuild your pages into answers the engine wants to quote.",
      "Answers only your ideal customer in your city actually asks.",
      "And we answer them in words the machine can actually quote.",
    ],
  },
  {
    title: "Number 2",
    lines: [
      "We turn your happy customers into the evidence.",
      "We set up automatic workflows so the reviews come out pain driven, with real customer details, and end on what changed for them.",
      "We get your facts matching everywhere the machine checks.",
      "And we do outreach to the forums and the blogs that make the lists the engine quotes.",
    ],
  },
  {
    title: "Number 3",
    lines: [
      "Every month we run these same real questions and send you the findings.",
      "Whether your name showed up, and whether it moved.",
      "So ninety days from now you are not wondering whether this worked.",
      "You are measuring me, not trusting me.",
    ],
  },
];

/**
 * The either-or beat, said twice: once before the pillars and once in the close.
 *
 * ONE source for both readings. Said twice from two hand-written copies they drift by a word or
 * two, and a repeated line that is not quite the same line is worse than saying it once: the second
 * pass sounds like a different thought instead of the point landing again.
 */
function urgencyBeat(city: string | null, withPromise: boolean): string[] {
  const where = city ?? "your city";
  const lines = [
    "And either you start doing something about it or you don't.",
    "",
    `Somebody in ${where} is going to become the name that keeps getting quoted.`,
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
        'Return {"greeting":"...","action":"...","jobs":["...","...","..."],"avoid":["...","..."]}',
      ]
        .filter(Boolean)
        .join("\n"),
      maxTokens: 800,
      temperature: 0.4,
      schemaHint:
        '{ "greeting": string, "action": string, "jobs": string[] (3), ' +
        '"avoid": string[] (one per customer given, same order) }',
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
    return { ...data, avoid: tidy(data.avoid, avoidAvatars, fallback.avoid) };
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
  const price = opts.price || LOOM_PRICE_LABEL;
  const startWindow = opts.window || LOOM_START_WINDOW;
  const where = report.city ? ` in ${report.city}` : "";
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
    `Target 4 minutes. Read it out loud, paste the screenshots over the top.`,
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

  // 6. The either-or. First of two readings; this one carries the promise that sets up the pillars.
  say("");
  say(...urgencyBeat(report.city, true));

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

  // 8. THE THREE PILLARS. The explanatory middle of the video, and the only part that is the same
  // every time. See LOOM_PILLARS for why the anecdotes are written here and not generated.
  say(...rule("THE 3 PILLARS"));
  say(
    `Being recommended by AI comes down to three main pillars.`,
    "",
    `If you miss one, you stay invisible.`
  );
  for (const pillar of LOOM_PILLARS) {
    say("", `${pillar.title}`, "");
    for (const line of pillar.lines) say(line, "");
  }

  // 9. The offer as three commitments, replacing the old single "what we do" paragraph.
  say(...rule("WHAT WE COMMIT TO"));
  say(
    `So you can do all of this yourself.`,
    "",
    `But if you want us to do it for you, our promise is simple. We commit to three things.`
  );
  for (const c of LOOM_COMMITMENTS) {
    say("", `${c.title}`, "");
    for (const line of c.lines) say(line, "");
  }
  say(`And then all you have to do is ${voice.action}.`);

  // 10. The math.
  //
  // ‼️ The second line is a DELIVERY_BANNED_PROMISES hit: it claims the investment is made back,
  // which nothing in this pipeline measures. It is here ON PURPOSE and SPOKEN ONLY (Matthew's call,
  // 2026-08-16). Downstream behaviour is already correct and must not be "fixed" to match: the
  // transcript path runs spokenPromises() over what was said, FLAGS this line in Slack, and
  // declines to repeat it in the delivery email. The video cannot unsay it; the email can decline
  // to put it in writing. Do not copy this sentence into any drafter.
  say("");
  say(
    `You will not win all of the jobs. But if you are fast, you will win more than you don't.`,
    "",
    `And just one extra client a month will very likely make back the investment.`
  );

  // 11. Price and timeline. Both tiers, with what actually separates them.
  say(...rule("THE INVESTMENT"));
  if (opts.price) {
    // A `loom $499` override means the recording quotes one number, so the contrast would describe
    // a choice that is not being offered.
    say(`If you want to get started, the investment is ${price}.`);
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
  say(
    "",
    `Typically you start getting pushed by ${orList(facts.engines)}${otherEngines.length ? `, and the other search agents like ${orList(otherEngines)}` : ""}, in anywhere from ${startWindow}.`,
    "",
    `So it does take some time to kick in. The work requires us to be patient.`,
    "",
    `And again, it works really well if you can call the leads within five minutes.`
  );

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
