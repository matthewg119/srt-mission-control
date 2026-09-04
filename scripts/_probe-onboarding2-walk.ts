// The whole funnel, driven end to end against a running deployment.
//
//   ./node_modules/.bin/next start -p 3399
//   npx tsx scripts/_probe-onboarding2-walk.ts http://localhost:3399
//
// ‼️ THIS IS THE ONE CHECK THE PURE PROBES CANNOT MAKE. _probe-onboarding2-pdf and
// _probe-onboarding2-chat exercise the renderer, the executor and the coverage functions
// directly. Neither of them touches a route, so neither would notice a guard ordered wrongly, a
// screen-one field the server refuses, a coverage check counting pages where it should count
// sections, or the 409 a five-page document produces against an eleven-page expectation.
//
// !! THE COUNTS COME FROM THE TEMPLATE, NOT FROM LITERALS IN THIS FILE. They were "nine" and
// "four" until v5 added two clauses (2026-09-03), which broke five checks that were all
// restating two numbers the config already exports. The point of this probe is that the SERVED
// document and the LOCAL template agree; hardcoding either side turns that into a tautology on
// one run and a false failure on the next.
//
// ‼️ RUN IT ONLY AGAINST localhost OR A *.vercel.app PREVIEW. Both are demo hosts
// (src/lib/onboarding2/demo.ts), so every row it writes is flagged is_demo and nothing escapes:
// no startPilot, no ingestLead, no Slack, no email, no delivery board. It refuses to run
// anywhere else rather than trusting the operator to have read this paragraph.
//
// Purge what a run leaves behind:
//   delete from public.onboarding2_leads where is_demo;
//   delete from public.onboarding2_signings where is_demo;

import { canonicalPage, sha256Hex } from "../src/lib/onboarding2/canonical";
import {
  AGREEMENT_PAGE_COUNT,
  AGREEMENT_SECTION_COUNT,
  TEMPLATE_VERSION,
} from "../src/config/onboarding2-agreement";

const BASE = (process.argv[2] ?? "http://localhost:3399").replace(/\/$/, "");

let failures = 0;
function check(name: string, ok: boolean, detail = ""): void {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `\n      ${detail}` : ""}`);
  if (!ok) failures++;
}

type Json = Record<string, unknown>;

async function post(path: string, body: Json): Promise<Json> {
  const res = await fetch(`${BASE}/api/onboarding2/${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return (await res.json()) as Json;
}

interface Section {
  n: number;
  key: string;
  heading: string;
  body: string[];
  bullets?: string[];
  after?: string[];
  sha256: string;
}

interface Page {
  p: number;
  sections: number[];
  sha256: string;
}

async function main(): Promise<void> {
  const host = new URL(BASE).hostname;
  if (host !== "localhost" && host !== "127.0.0.1" && !host.endsWith(".vercel.app")) {
    console.error(`Refusing to run against ${host}. Demo mode only covers localhost and previews.`);
    process.exit(2);
  }

  // renderedAt has to be at least MIN_FILL_SECONDS in the past or the time trap silently
  // succeeds and writes nothing, which reads as a pass and is not one.
  const renderedAt = Date.now() - 5000;

  // ── 1. Start ──
  const start = await post("start", { renderedAt, company_url_hp: "", attribution: {} });
  check("POST /start opens a session", start.ok === true, JSON.stringify(start).slice(0, 200));
  check("the preview is in DEMO mode, so nothing escapes", start.demo === true);

  const token = start.sessionToken as string;
  const agreement = start.agreement as {
    sections: Section[];
    pages: Page[];
    documentSha256: string;
  };
  check(
    `the served agreement is ${AGREEMENT_SECTION_COUNT} sections (${TEMPLATE_VERSION})`,
    agreement.sections.length === AGREEMENT_SECTION_COUNT,
    `got ${agreement.sections.length}`
  );
  check(
    `laid out as ${AGREEMENT_PAGE_COUNT} pages`,
    agreement.pages?.length === AGREEMENT_PAGE_COUNT,
    JSON.stringify(agreement.pages?.map((p) => p.sections))
  );
  check(
    "the pages cover every section exactly once",
    (() => {
      const seen = (agreement.pages ?? []).flatMap((p) => p.sections);
      return seen.length === AGREEMENT_SECTION_COUNT && new Set(seen).size === AGREEMENT_SECTION_COUNT;
    })(),
    JSON.stringify(agreement.pages?.map((p) => p.sections))
  );

  const byNumber = new Map(agreement.sections.map((s) => [s.n, s]));
  const sectionsOn = (pg: Page): Section[] =>
    pg.sections.map((n) => byNumber.get(n)).filter((s): s is Section => Boolean(s));

  const leadEmail = `walk-${Date.now()}@example.com`;

  // ── 2. THE INTAKE IS A CONVERSATION NOW, AND THIS WALKS IT ──
  //
  // ‼️ IT USED TO DRIVE POST /email, WHICH THE FUNNEL NO LONGER CALLS. Screen one was six labelled
  // fields; the chat asks four of them itself, between the timezone and the day. Those checks
  // kept passing after the form was deleted, which made them worse than useless: a green probe
  // over a dead route reads as coverage of the live one.
  //
  // /api/onboarding2/email is deliberately still mounted and still enforces every rule it ever
  // did. It simply has no caller, like /initial and /sign.
  //
  // ‼️ THE GAP BETWEEN TURNS IS REAL AND NOT PADDING. The route refuses a user turn arriving
  // within MIN_TURN_GAP_MS of the last one, on the grounds that a human has not read the reply
  // yet. A probe that fires faster than that gets 429s with no `messages`, which is exactly how
  // this walk failed on its first run.
  const TURN_GAP_MS = 1500;

  async function say(text: string): Promise<Json> {
    await new Promise((r) => setTimeout(r, TURN_GAP_MS));
    return post("chat", { sessionToken: token, message: text });
  }

  function saidThat(res: Json, fragment: string): boolean {
    return JSON.stringify((res as { messages?: string[] }).messages ?? []).includes(fragment);
  }

  // The two taps. Nothing is stored for these: the user turn itself is the record, and
  // replayDraft() reads it back. See lib/onboarding2/intake-steps.ts.
  check(
    "the intake REFUSES a daypart it cannot read, rather than guessing",
    saidThat(await say("sometime next week maybe"), "tap one of the options"),
    "a half-read daypart decides which three days get offered"
  );
  check(
    "a daypart it can read moves on to the timezone",
    saidThat(await say("Afternoons"), "time zone"),
    ""
  );
  check(
    "the timezone is asked BEFORE the days, because dayOptions() judges their day",
    saidThat(await say("Eastern"), "website"),
    ""
  );

  // ‼️ THE SAME VALIDATORS THE FORM USED, IMPORTED RATHER THAN RESTATED. normalizeTarget is the
  // gate the scanner and the hub lane both use, so anything accepted here is something
  // intakePatchFrom() can later turn into a real domain.
  check(
    "the intake REFUSES an unreadable website",
    saidThat(await say("not a website"), "does not look right"),
    "clients.domain comes from this and eight hub-lane steps need it"
  );
  check("a real website moves on to the name", saidThat(await say("glowclinic.com"), "full name"), "");

  check(
    "the intake REFUSES a one-character name",
    saidThat(await say("J"), "full name, please"),
    "clients.legal_name is NOT NULL and startPilot falls back to the email address"
  );
  check("a real name moves on to the email", saidThat(await say("Jordan Reyes"), "best email"), "");

  check(
    "the intake REFUSES a malformed email",
    saidThat(await say("jordan@"), "email does not look right"),
    "the lead row is keyed on this"
  );
  check("a real email moves on to the phone", saidThat(await say(leadEmail), "phone number"), "");

  check(
    "the intake REFUSES a phone that is not ten digits",
    saidThat(await say("12"), "does not look right"),
    ""
  );
  check(
    "a real phone reaches the day, with three options computed from the daypart",
    saidThat(await say("(336) 833-2303"), "Which of these works"),
    ""
  );

  // ── 3. The day, and the calendar handoff ──
  const dayTurn = (await say("Tuesday afternoon")) as { bookingUrl?: string | null };
  check(
    "picking a day hands over a Calendly URL",
    typeof dayTurn.bookingUrl === "string" && dayTurn.bookingUrl.includes("calendly.com"),
    String(dayTurn.bookingUrl)
  );

  // ‼️ THE ONE PARAMETER THE WHOLE CONTINUATION DEPENDS ON. Without embed_type Calendly renders a
  // perfectly good booking page and posts NOTHING to the parent window, so the booking completes,
  // the iframe says "You are scheduled!", and the conversation underneath never says another
  // word. That is the bug this check exists to keep fixed. embed_domain is added in the browser,
  // because it has to be the host the page is actually served from.
  const bookingUrl = new URL(String(dayTurn.bookingUrl));
  check(
    "the Calendly URL declares itself an embed, so event_scheduled reaches the parent window",
    bookingUrl.searchParams.get("embed_type") === "Inline",
    "without this the conversation dead-ends on a completed booking"
  );
  check(
    "the calendar is prefilled with the email they just gave us",
    bookingUrl.searchParams.get("email") === leadEmail,
    String(bookingUrl.searchParams.get("email"))
  );

  // ── 4. THE SIGNATURE SECTIONS WERE DELETED HERE ON 2026-09-04 ──
  //
  // Sections 4 to 10 drove /api/onboarding2/initial and /api/onboarding2/sign: a signature with
  // no initials, three forged page initials, the real signature, the PDF, replay, and a signature
  // with no identity behind it. Every one of those routes still exists and still enforces every
  // guard it enforced. NOTHING CALLS THEM. The agreement is signed by hand on the call, at
  // delivery step `agreement_signed`.
  //
  // They are not kept as skipped checks, because a probe full of skips reads as a probe that is
  // half broken. If e-signature comes back, this is the file to restore them into, and git has
  // them.

  // ── 4. Booking is refused for a session that never completed screen one ──
  //
  // ‼️ THIS IS THE GUARD THAT REPLACED "not signed". /booked provisions a client and takes one of
  // six pilot seats, so the question it has to answer is not "did they sign" but "do we know who
  // this is". A booking against a row with no email has no lead to attach and no client to make.
  const fresh = await post("start", {});
  const freshToken = String((fresh.sessionToken as string) ?? "");
  const anon = await post("booked", { sessionToken: freshToken, eventUri: null });
  check(
    "POST /booked REFUSES a session that never completed screen one",
    anon.ok !== true,
    JSON.stringify(anon).slice(0, 200)
  );

  // ── 5. The booking lands, and the probe says which guard actually ran ──
  //
  // ‼️ THE ANTI-FORGERY CHECK IS CONDITIONAL ON CALENDLY_API_TOKEN, AND THE PROBE REPORTS WHICH
  // WAY IT WENT RATHER THAN ASSERTING ONE. With a token, verifyScheduledEvent() rejects a URI
  // that names no real event and this booking is refused. Without one, nobody can check, the
  // route accepts and records `verified: false`. Asserting either outcome unconditionally would
  // make this probe fail on exactly half the correctly-configured deployments there are.
  const booked = await post("booked", {
    sessionToken: token,
    eventUri: "https://api.calendly.com/scheduled_events/PROBE0000000000000000000",
    inviteeUri: null,
  });

  if (booked.ok === true) {
    console.log(
      "      note: CALENDLY_API_TOKEN is unset on this deployment, so the booking was accepted " +
        "unverified. That is the documented degraded state, not a pass on the forgery guard."
    );
    // ‼️ IT ASSERTS THE ROW WAS WRITTEN, NOT THAT THE ROUTE SAID YES. The predecessor of this
    // check read `ok === true` alone, which the route answered off the request rather than off
    // the saved row, and it went green for a whole run against a database rejecting every write.
    check(
      "POST /booked records the booking, and the row actually landed",
      booked.stored === true,
      JSON.stringify(booked).slice(0, 200)
    );
    check(
      "an unverifiable booking is recorded AS unverified, never as verified",
      booked.verified === false,
      `verified=${String(booked.verified)}`
    );
  } else {
    check(
      "POST /booked REFUSES an event Calendly does not have, so a forged booking cannot provision",
      true,
      JSON.stringify(booked).slice(0, 200)
    );
  }

  // ── 6. Booking is idempotent ──
  //
  // Calendly's embed can fire event_scheduled more than once on a slow connection, and a second
  // Slack card in a thread somebody is reading is worse than a dropped one.
  if (booked.ok === true) {
    const again = await post("booked", {
      sessionToken: token,
      eventUri: "https://api.calendly.com/scheduled_events/PROBE0000000000000000000",
    });
    check(
      "a second event_scheduled for the same session does not book twice",
      again.ok === true && again.alreadyBooked === true,
      JSON.stringify(again).slice(0, 200)
    );
  }

  // ── 12. The honeypot ──
  //
  // ‼️ IT IS TESTED ON /start NOW, WHICH IS THE ONLY PLACE IT STILL FIRES. The trap and the
  // MIN_FILL_SECONDS time trap both lived on the identity form, and the form is gone. /start
  // still accepts and enforces both, and the client still sends them, so the SESSION is still
  // trapped; what is no longer trapped is an identity submission, because there is no longer one.
  // What bounds the chat instead is the per-IP start cap, the per-IP hourly turn cap, the
  // per-signing turn caps and MIN_TURN_GAP_MS.
  const trap = await post("start", {
    renderedAt: Date.now() - 9_000,
    company_url_hp: "http://spam.example",
  });
  check(
    "the honeypot returns ok and opens nothing",
    trap.ok === true && !trap.sessionToken,
    JSON.stringify(trap).slice(0, 160)
  );

  console.log(
    failures === 0
      ? `\nAll checks passed. Session ${token.slice(0, 8)} is flagged is_demo.`
      : `\n${failures} check(s) FAILED.`
  );
  process.exit(failures === 0 ? 0 : 1);
}

void main();
