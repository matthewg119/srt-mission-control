// The Loom script, written out to be read aloud.
//
// This replaced a six-beat timing sheet in six-word bullets. That sheet was built on the theory
// that Matthew improvises better than he reads; in practice it meant re-deciding the wording of
// the same pitch on every recording, which is slow and comes out different every time. The
// template here is HIS script, the one he wrote for the surface-sealing contractor, with the
// per-audit facts substituted in. Screenshots get pasted over the top while it is read.
//
// ── What is filled from real data and what is not ───────────────────────────
// The score, the X of Y, the competitor and its count, the prompts, the prompt they rank best
// on and the ones they are absent from all come from this audit's own run. ONE Claude call
// supplies the three things that are a fact about the TRADE rather than about this business:
// how to greet the owner, the verb for what they do when a lead lands, and the jobs in the
// owner's own words. Nothing else is generated, and nothing is estimated.
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
import type { BestAvatar } from "./niche-avatars";
import type { AuditReportRow } from "./types";
import type { ReportView } from "./report-view";

export interface LoomScriptOptions {
  /** Overrides from `loom $499` / `loom $299/mo, 45 days`. Fall back to the config constants. */
  price?: string | null;
  window?: string | null;
}

export interface LoomScriptResult {
  text: string;
  fileName: string;
}

/** The three things that are a fact about the trade, not about this business. */
interface TradeVoice {
  /** How the video opens, e.g. "surface sealing contractor", "clinic owner". */
  greeting: string;
  /** What the owner does when a lead lands: "drive out and quote it", "book the consult". */
  action: string;
  /** Three jobs in the owner's own words, short. */
  jobs: string[];
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
    o.jobs.length >= 1
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

/** File-safe slug for the attachment name. */
function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

async function tradeVoice(report: AuditReportRow, view: ReportView, avatar: BestAvatar): Promise<TradeVoice> {
  const trade = report.business_type ?? "local service";
  const absent = view.prompts
    .filter((p) => !p.appeared && !p.isBranded && (p.block === "SERVICIO" || p.block === "COMPARATIVO"))
    .map((p) => p.prompt)
    .slice(0, 8);

  const fallback: TradeVoice = {
    greeting: trade,
    action: "get back to them and quote the job",
    jobs: absent.slice(0, 3),
  };

  try {
    const { data } = await callClaudeJSON<TradeVoice>({
      model: "claude-sonnet-4-6",
      system: [
        "You supply three small pieces of wording for a sales video script aimed at one trade. Nothing else.",
        "",
        'greeting: how to address the owner in the first line, after "Hey". A trade noun as an owner would say it about themselves, e.g. "surface sealing contractor", "clinic owner", "commercial landscaper". No company name, no adjectives.',
        'action: what this owner physically does once a lead comes in, as a short verb phrase that finishes the sentence "all you have to do is ___". e.g. "drive out and quote the job", "book the consultation", "send the estimate over". Match how this trade actually closes work.',
        "jobs: three jobs this business could be getting, in the owner's own plain words, five to nine words each. Take them from the buyer questions provided. Describe the WORK, not the search.",
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
        absent.length
          ? `Buyer questions they do NOT appear in. The jobs come from these:\n${absent.map((q) => `- ${q}`).join("\n")}`
          : "They appear in most tested questions, so use the highest-value work this trade does.",
        "",
        'Return {"greeting":"...","action":"...","jobs":["...","...","..."]}',
      ]
        .filter(Boolean)
        .join("\n"),
      maxTokens: 600,
      temperature: 0.4,
      validate: isTradeVoice,
    });
    return data;
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
  const voice = await tradeVoice(report, view, avatar);
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

  // 1 + 2. Greeting and what the video is.
  say(...rule("OPEN"));
  say(
    screen("the dream lead image, full screen"),
    "",
    `Hey ${voice.greeting},`,
    "",
    LOOM_CLIENT_COUNT_CLAIM
      ? `In this video I am going to show you how you can get ${LOOM_CLIENT_COUNT_CLAIM}${where}.`
      : `In this video I am going to show you how you can get in front of the people looking for ${aTrade(report.business_type ?? "this work")}${where}, at the moment they are looking.`
  );

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

  // 7 + 8. The score, then the competitor. Both real, both checkable.
  say(...rule("THE SCORE"));
  say(
    screen("the PDF scorecard"),
    "",
    `We ran all twenty, and scored what came back.`,
    "",
    `You came out at ${facts.score} out of 100. You showed up in ${facts.appeared} of the ${facts.total}.`
  );
  if (facts.topCompetitor) {
    say("", `And while you were missing, ${facts.topCompetitor.name} came up ${facts.topCompetitor.count} times.`);
  }
  say("", `This report is yours either way. I am sending it over regardless of what you decide here.`);

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

  // The site. Only ever as strong as what was actually measured. See robots-check.ts.
  if (facts.robotsVerdict === "devastating" && facts.robotsBot) {
    say(...rule("YOUR SITE"));
    say(
      screen(`${report.website.replace(/\/$/, "")}/robots.txt`),
      "",
      `There is a second thing, and it is on your own site.`,
      "",
      `This line blocks ${facts.robotsBot}. That is the crawler ${facts.robotsEngine ?? "the engine"} reads pages with.`,
      "",
      `You have locked yourself out of your own front door. It is a one line fix and it is the first thing we would do.`
    );
  } else if (facts.siteFinding) {
    say(...rule("YOUR SITE"));
    say(
      screen("their website"),
      "",
      `There is a second thing, and it is on your own site.`,
      "",
      sentence(facts.siteFinding),
      "",
      `You are paying to be invisible.`
    );
  }

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
    `And if it is not for you, thanks for watching. The report is yours anyway.`
  );

  say(
    ...rule("AFTER RECORDING"),
    `Paste the Loom transcript in this Slack thread, then reply "delivery" for the hand-over email.`,
    `It quotes two real timestamps read off what you actually said, so it will not draft without the transcript.`
  );

  const text = noDashes(lines.join("\n")).replace(/\n{4,}/g, "\n\n\n");
  return { text, fileName: `loom-script-${slugify(company)}.txt` };
}
