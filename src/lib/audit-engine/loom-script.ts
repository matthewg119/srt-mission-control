// The Loom script, written out to be read aloud.
//
// This replaced a six-beat timing sheet in six-word bullets. That sheet was built on the theory
// that Matthew improvises better than he reads; in practice it meant re-deciding the wording of
// the same pitch on every recording, which is slow and comes out different every time. The
// template here is HIS script, the one he wrote for the surface-sealing contractor, with the
// per-audit facts substituted in. Screenshots get pasted over the top while it is read.
//
// ── What is filled from real data and what is not ───────────────────────────
// The score, the X of Y, the prompts, the prompt they rank best on and the ones they are absent
// from all come from this audit's own run. The customers named in the open are the niche's own
// avatars (niche-avatars.ts), not something written here. ONE Claude call supplies the wordings
// that are a fact about the TRADE rather than about this business: the verb for what they do
// when a lead lands, the jobs in the owner's own words, and the two customers to attract and two
// to avoid REWORDED for saying out loud. Nothing else is generated, and nothing is estimated.
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
  /** The customers to get in front of, plural and spoken: "new home builders". */
  attract: string[];
  /** The customers to avoid, plural and spoken: "sample hoarders". Empty when there is no niche set. */
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
    // avoid is allowed to be empty (no niche set), attract never is: it is the sentence the whole
    // video is pointed at, and "get in front of more" with nothing after it is not a fallback.
    Array.isArray(o.attract) &&
    o.attract.length >= 1 &&
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
  attractAvatars: BestAvatar[],
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
    attract: attractAvatars.map((a) => pluralish(a.label)).filter(Boolean),
    avoid: avoidAvatars.map((w) => pluralish(w.label)).filter(Boolean),
  };
  if (!fallback.attract.length) fallback.attract = [pluralish(avatar.label) || avatar.label];

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
        "attract and avoid: you are given customer types that have ALREADY been decided. Your only job is to reword each one for saying out loud.",
        'They are written to be read on a card, so they arrive singular and articled, e.g. "the $45 one-time mow shopper". They are going to be read in these two sentences:',
        '  "...get in front of more X or Y"   and   "...and avoid the P or the Q".',
        "So make each one a bare plural noun phrase: no leading 'the' or 'a', no dollar amounts, TWO TO FOUR WORDS.",
        'e.g. "the recurring commercial property manager" becomes "property management companies"; "the $45 one-time mow shopper" becomes "sample shoppers"; "the individual room flipper" becomes "one room flippers".',
        "A NAME, not a description. No verbs, no \"who\" or \"that\" clause, no reason attached. \"sample hoarders\" is right; \"free sample collectors who never buy\" is wrong, that is the reason and it does not get said.",
        "The detail in brackets next to each one is context so you pick the right words. It is never part of your answer.",
        "",
        "HARD RULE on attract and avoid: reword only. Return one entry per customer given, in the same order. Never introduce a customer type that is not in the list, never merge two into one, never drop one. These names have already been checked against how this trade actually makes and loses money, and a substitution here would put a customer on camera that nobody chose.",
        "",
        "Plain language only. No marketing adjectives, no jargon, no dollar amounts, no dashes as punctuation.",
        "Return JSON only.",
      ].join("\n"),
      user: [
        `Trade: ${trade}`,
        report.city ? `Market: ${report.city}` : "",
        `Their buyer, as classified: ${report.buyer_persona ?? "unknown"}`,
        `The customer this video is aimed at: ${avatar.label}`,
        "",
        `Customers to ATTRACT, reword these ${attractAvatars.length} in this order:`,
        ...attractAvatars.map((a, i) => `${i + 1}. ${a.label} (${a.ticket})`),
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
        'Return {"greeting":"...","action":"...","jobs":["...","...","..."],"attract":["...","..."],"avoid":["...","..."]}',
      ]
        .filter(Boolean)
        .join("\n"),
      maxTokens: 800,
      temperature: 0.4,
      schemaHint:
        '{ "greeting": string, "action": string, "jobs": string[] (3), ' +
        '"attract": string[] (one per customer given, same order), "avoid": string[] (one per customer given, same order) }',
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
      attract: tidy(data.attract, attractAvatars, fallback.attract),
      avoid: tidy(data.avoid, avoidAvatars, fallback.avoid),
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
  // Two to attract: the one picked in the wizard, then the strongest of the set that is not it.
  // Two to avoid: the first two on the card, which is the order they were judged in.
  const others = (opts.avatars?.best ?? []).filter((b) => b.label !== avatar.label);
  const attractAvatars = [avatar, ...others].slice(0, 2);
  const avoidAvatars = (opts.avatars?.worst ?? []).slice(0, 2);

  const voice = await tradeVoice(report, view, avatar, attractAvatars, avoidAvatars);
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

  // 1 + 2. Greeting and what the video is.
  //
  // The whole pitch is in this sentence: not "more visibility" but a named customer they want more
  // of and a named customer they are sick of. Both come from the niche's avatar set, the same one
  // shown on the Slack card, so what he says here is what he already agreed to when he picked.
  const attract = orList(voice.attract);
  const avoid = voice.avoid.length ? orList(voice.avoid.map((a) => `the ${a}`)) : null;
  const pitch = LOOM_CLIENT_COUNT_CLAIM
    ? `In this video I am going to show you how you can get ${LOOM_CLIENT_COUNT_CLAIM}${where}.`
    : [
        `In this video I am going to show you how to increase your AI visibility,`,
        `so you can get in front of more ${attract}${where}${avoid ? `,` : `.`}`,
        avoid ? `and avoid ${avoid}.` : "",
      ]
        .filter(Boolean)
        .join(" ");

  say(screen("the dream lead image, full screen"), "", `Hey ${name ?? voice.greeting},`, "", pitch);

  // 3. The dream lead, framed as the target.
  say("");
  say(
    `This right here is the exact kind of inquiry we point at your phone.`,
    "",
    `Someone like ${avatar.label}. ${sentence(avatar.ticket)}`,
    "",
    `And look at the line in the message. They asked ChatGPT for ${avatar.aiQuestion}, and that is how they found you.`,
    "",
    `That is the job we are pointing this at.`
  );

  // 4. The jobs.
  if (voice.jobs.length) {
    say(...rule("THE JOBS"));
    say(`These are the jobs we can bring you.`, "");
    for (const job of voice.jobs) say(`  ${job}`);
  }

  // 5. Speed to lead. Said early because it is the one thing HE needs from THEM.
  say(...rule("SPEED"));
  say(
    `One thing before I show you the rest, because it decides whether this works for you or not.`,
    "",
    `We found this works really well when you call the lead within five minutes of the inquiry.`,
    "",
    `Speed is the name of the game. If you can be fast, this can work for you.`
  );

  // 6. The 20 prompts.
  say(...rule("WHAT WE FOUND"));
  say(
    screen("the list of 20 prompts"),
    "",
    `Here is what we figured out.`,
    "",
    `These are the twenty questions we tested. Real things people type into ChatGPT when they are looking for ${aTrade(report.business_type ?? "what you do")}${where}.`,
    ""
  );
  for (const p of view.prompts) say(`  ${p.prompt}`);

  // 7. The score. The competitor count and the "yours either way" line used to sit here and were
  // cut to keep the recording to the beats in the written script. Both are still true and both are
  // still in the pre-flight and the PDF, so they are available to say, just not scripted.
  say(...rule("THE SCORE"));
  say(
    screen("the PDF scorecard"),
    "",
    `We ran all twenty, and scored what came back.`,
    "",
    `You came out at ${facts.score} out of 100. You showed up in ${facts.appeared} of the ${facts.total}.`
  );

  // 9. Live. The concession first, because he will check it himself afterwards.
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

  // 10 + 11 + 12. The offer, in plain terms.
  say(...rule("WHAT WE DO"));
  say(
    `What we do is optimize not just your website, but your online presence overall.`,
    "",
    `So you get in front of those exact questions, and the people looking for that kind of work find you.`,
    "",
    `And then all you have to do is ${voice.action}.`,
    "",
    `You will not win all of them. But if you are fast, you will win more than you don't.`
  );

  // 13. Price and timeline.
  say(...rule("THE INVESTMENT"));
  say(
    `If you want to get started, the investment is ${price}.`,
    "",
    `Typically you start getting pushed by ${orList(facts.engines)}${otherEngines.length ? `, and the other search agents like ${orList(otherEngines)}` : ""}, in anywhere from ${startWindow}.`,
    "",
    `So it does take some time to kick in. The work requires us to be patient.`,
    "",
    `And again, it works really well if you can call the leads within five minutes.`
  );

  // 14 + 15. The CTA and what happens next.
  say(...rule("THE CLOSE"));
  say(
    `If that sounds like you and you want to get started, reply to the email I sent over with "let's do it", and I will send an invoice that looks like this.`,
    "",
    screen("the invoice"),
    "",
    `It takes you to a page where you can pay by credit card, PayPal or direct ACH.`,
    "",
    `After that we reach out to get some basic information from you about your Google Business profile, and we get started. Usually a few hours depending on how busy we are.`,
    "",
    `There are no fireworks and no gold stars.`,
    "",
    `But if that sounds like you, send that email and we will get you going.`,
    "",
    `If you have any questions you can reach me on this guy right here. My number is ${LOOM_TEXT_NUMBER}. Feel free to text me.`,
    "",
    `And if it is not for you, thanks for watching.`
  );

  say(
    ...rule("AFTER RECORDING"),
    `Paste the Loom transcript in this Slack thread, then reply "delivery" for the hand-over email.`,
    `It quotes two real timestamps read off what you actually said, so it will not draft without the transcript.`
  );

  const text = noDashes(lines.join("\n")).replace(/\n{4,}/g, "\n\n\n");
  return { text, fileName: `loom-script-${slugify(company)}.txt` };
}
