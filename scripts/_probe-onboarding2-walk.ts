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

  // ── 2. Screen one refuses a partial identity, field by field ──
  const base = {
    sessionToken: token,
    contactName: "Jordan Reyes",
    businessLegalName: "Glow Clinic LLC",
    signerTitle: "Owner",
    website: "glowclinic.com",
    email: `walk-${Date.now()}@example.com`,
    contactPhone: "(336) 833-2303",
    renderedAt,
    company_url_hp: "",
    attribution: {},
  };

  for (const missing of [
    ["contactName", "clients.legal_name is NOT NULL and startPilot falls back to the email address"],
    ["businessLegalName", "the party the agreement binds"],
    ["signerTitle", "the authority to bind it"],
    ["website", "clients.domain comes from this and eight hub-lane steps need it"],
    ["email", "where the executed contract goes"],
    ["contactPhone", "how we reach them about the call"],
  ] as const) {
    const res = await post("email", { ...base, [missing[0]]: "" });
    check(`POST /email REFUSES without ${missing[0]}`, res.ok === false, missing[1]);
  }

  const bad = await post("email", { ...base, website: "not a website" });
  check("POST /email REFUSES an unreadable website", bad.ok === false, JSON.stringify(bad).slice(0, 160));

  const email = base.email;
  const complete = await post("email", base);
  check("POST /email accepts the whole identity", complete.ok === true, JSON.stringify(complete).slice(0, 200));

  // ── 3. The identity comes BACK on resume, so nothing is ever typed twice ──
  const resumed = await post("start", { renderedAt, company_url_hp: "", attribution: {}, resume: token });
  const identity = resumed.identity as Json | null;
  check(
    "a resumed session hands back the WHOLE identity, not just the email",
    Boolean(identity) &&
      identity?.contactName === "Jordan Reyes" &&
      identity?.businessLegalName === "Glow Clinic LLC" &&
      identity?.signerTitle === "Owner" &&
      identity?.website === "glowclinic.com" &&
      identity?.email === email &&
      String(identity?.phone ?? "").includes("336"),
    JSON.stringify(identity)
  );

  // ── 4. Signing before the initials is refused, and it answers in SECTION numbers ──
  const early = await post("sign", {
    sessionToken: token,
    documentSha256: agreement.documentSha256,
    renderedAt,
    company_url_hp: "",
    signatureTyped: "Jordan Reyes",
    addressLine1: "12 Elm Street",
  });
  check(
    "POST /sign REFUSES with no initials, and names every missing SECTION",
    early.error === "initials_incomplete" && (early.missing as number[])?.length === AGREEMENT_SECTION_COUNT,
    JSON.stringify(early).slice(0, 200)
  );

  // == 5. One initial per page, each hashed over the whole page in the browser's own way ==
  let doneSections: number[] = [];
  let donePages: number[] = [];
  for (const pg of agreement.pages) {
    const res = await post("initial", {
      sessionToken: token,
      pageNo: pg.p,
      pageSections: pg.sections,
      // Recomputed over the text we were served, exactly as the client does. Echoing pg.sha256
      // would be the server checking its own number against itself.
      pageSha256: await sha256Hex(canonicalPage(sectionsOn(pg))),
      initials: "JR",
      dwellMs: 4200,
      clientNonce: crypto.randomUUID(),
    });
    if (res.ok !== true) {
      check(`page ${pg.p} initialled`, false, JSON.stringify(res).slice(0, 200));
      break;
    }
    doneSections = (res.initialledSections as number[]) ?? [];
    donePages = (res.initialledPages as number[]) ?? [];
  }
  check(
    `${AGREEMENT_PAGE_COUNT} initials were typed`,
    donePages.length === AGREEMENT_PAGE_COUNT,
    `got ${donePages.length}`
  );
  check(
    `and they cover all ${AGREEMENT_SECTION_COUNT} sections, which is what /sign counts`,
    doneSections.length === AGREEMENT_SECTION_COUNT,
    `got ${doneSections.length}: ${doneSections.join(",")}`
  );

  // ── 6. The three ways a page initial can be forged, all refused ──
  const multi = agreement.pages.find((p) => p.sections.length > 1)!;

  const tampered = await post("initial", {
    sessionToken: token,
    pageNo: multi.p,
    pageSections: multi.sections,
    pageSha256: "0".repeat(64),
    initials: "JR",
    dwellMs: 4200,
    clientNonce: crypto.randomUUID(),
  });
  check(
    "an initial whose page hash does not match the stored page is refused",
    tampered.ok !== true && tampered.error === "text_changed",
    JSON.stringify(tampered).slice(0, 200)
  );

  // ‼️ THE ONE A PER-PAGE MODEL INVENTS. Claiming a page covers more sections than it does would
  // let one initial cover the whole document, which is the coverage check deleting itself.
  const overreach = await post("initial", {
    sessionToken: token,
    pageNo: multi.p,
    pageSections: [1, 2, 3, 4, 5, 6, 7, 8, 9],
    pageSha256: await sha256Hex(canonicalPage(sectionsOn(multi))),
    initials: "JR",
    dwellMs: 4200,
    clientNonce: crypto.randomUUID(),
  });
  check(
    "an initial CLAIMING to cover more sections than its page holds is refused",
    overreach.ok !== true,
    JSON.stringify(overreach).slice(0, 200)
  );

  // A hash over a DIFFERENT page than the one being claimed.
  const wrongPage = agreement.pages.find((p) => p.p !== multi.p)!;
  const crossed = await post("initial", {
    sessionToken: token,
    pageNo: multi.p,
    pageSections: multi.sections,
    pageSha256: await sha256Hex(canonicalPage(sectionsOn(wrongPage))),
    initials: "JR",
    dwellMs: 4200,
    clientNonce: crypto.randomUUID(),
  });
  check(
    "a hash computed over a DIFFERENT page is refused",
    crossed.ok !== true && crossed.error === "text_changed",
    JSON.stringify(crossed).slice(0, 200)
  );

  // ── 7. The signature. IDENTITY IS NOT IN THIS PAYLOAD. ──
  const signed = await post("sign", {
    sessionToken: token,
    documentSha256: agreement.documentSha256,
    renderedAt,
    company_url_hp: "",
    signatureTyped: "Jordan Reyes",
    addressLine1: "12 Elm Street",
    addressCity: "Greensboro",
    addressState: "NC",
    addressPostal: "27401",
    signedDate: new Date().toISOString().slice(0, 10),
  });
  check("POST /sign records the signature", signed.ok === true, JSON.stringify(signed).slice(0, 300));
  check("the signature is flagged demo", signed.demo === true);
  check("it hands back a document URL", typeof signed.documentUrl === "string");
  check(
    "the printed name came off the ROW, not off the request",
    (signed.prefill as Json)?.printName === "Jordan Reyes" &&
      (signed.prefill as Json)?.businessLegalName === "Glow Clinic LLC" &&
      (signed.prefill as Json)?.email === email,
    JSON.stringify(signed.prefill)
  );

  // ── 8. The PDF really renders and really is a PDF ──
  const doc = await fetch(signed.documentUrl as string);
  const bytes = Buffer.from(await doc.arrayBuffer());
  check(
    "the signed PDF downloads and starts with %PDF",
    doc.status === 200 && bytes.subarray(0, 4).toString() === "%PDF",
    `status ${doc.status}, ${bytes.length} bytes`
  );

  // ── 9. Replay is the same document, not a second signature ──
  const replay = await post("sign", {
    sessionToken: token,
    documentSha256: agreement.documentSha256,
    renderedAt,
    company_url_hp: "",
    signatureTyped: "Jordan Reyes",
    addressLine1: "12 Elm Street",
  });
  check(
    "a double-tapped sign button replays rather than signing twice",
    replay.alreadySigned === true && replay.signingId === signed.signingId,
    JSON.stringify(replay).slice(0, 200)
  );

  // ── 10. A signature with no identity behind it is refused ──
  //
  // A second session that skips screen one entirely. /sign reads the identity off the row, so
  // there is nothing to read and the only correct answer is to send them back.
  const bare = await post("start", { renderedAt, company_url_hp: "", attribution: {} });
  const bareToken = bare.sessionToken as string;
  const barePages = (bare.agreement as { pages: Page[]; sections: Section[] });
  const bareByNumber = new Map(barePages.sections.map((s) => [s.n, s]));
  for (const pg of barePages.pages) {
    await post("initial", {
      sessionToken: bareToken,
      pageNo: pg.p,
      pageSections: pg.sections,
      pageSha256: await sha256Hex(
        canonicalPage(pg.sections.map((n) => bareByNumber.get(n)!).filter(Boolean))
      ),
      initials: "XX",
      dwellMs: 4200,
      clientNonce: crypto.randomUUID(),
    });
  }
  const noIdentity = await post("sign", {
    sessionToken: bareToken,
    documentSha256: (bare.agreement as { documentSha256: string }).documentSha256,
    renderedAt,
    company_url_hp: "",
    signatureTyped: "Nobody At All",
    addressLine1: "1 Nowhere",
  });
  check(
    "POST /sign REFUSES a session that never completed screen one",
    noIdentity.ok === false && noIdentity.error === "identity_missing",
    JSON.stringify(noIdentity).slice(0, 200)
  );

  // == 11. The close records a day, and never shows a calendar ==
  //
  // !! THE PROBE RUNS AGAINST A DEMO HOST, SO NO INVITE IS SENT AND THAT IS THE POINT. A
  // calendar invite lands in a real person's inbox, which is exactly the class of thing
  // src/lib/onboarding2/demo.ts exists to stop escaping. scheduleCallAndInvite() checks isDemo
  // BEFORE it checks whether Graph is configured, so this stays true even once MS_CALENDAR_* is
  // set in a preview environment.
  const scheduled = await post("booked", {
    sessionToken: token,
    daypart: "afternoons",
    day: "Tomorrow afternoon",
    timezone: "Pacific",
  });
  // !! IT ASSERTS THE ROW WAS WRITTEN, NOT THAT THE ROUTE SAID YES. This check used to read
  // `ok === true && typeof day === "string"`, both of which the route answered off the PICKED
  // object rather than off the saved row, so it went green for a whole run against a database
  // that was rejecting every write with a missing-column error. A probe that cannot tell a
  // stored booking from a discarded one is not proving the close works.
  check(
    "POST /booked records a day agreed in conversation, and the row actually landed",
    scheduled.ok === true && scheduled.stored === true && typeof scheduled.day === "string",
    JSON.stringify(scheduled).slice(0, 200)
  );
  check(
    "no invite is sent from a demo host, whatever MS_CALENDAR_* is set to",
    scheduled.invite === "not_attempted",
    `invite=${String(scheduled.invite)}`
  );
  // !! THIS IS THE MIGRATION CHECK, AND IT IS THE ONLY ONE IN THIS FILE THAT FAILS ON A
  // DEPLOYMENT WHOSE SCHEMA IS BEHIND THE CODE. The zone write is deliberately a SECOND upsert
  // after the day, so before docs/2026-09-03-onboarding2-call-invite.sql runs the close still
  // records the booking and still posts the honest "NO INVITE HAS BEEN SENT" card, and only
  // this comes back null. Failing loudly here is the point: the alternative is a funnel that
  // looks fine and quietly cannot ever send an invite.
  check(
    "the timezone round-trips, which needs 2026-09-03-onboarding2-call-invite.sql",
    scheduled.zone === "America/Los_Angeles",
    `zone=${String(scheduled.zone)}. Null means that migration has not been run on this database.`
  );
  const badDay = await post("booked", {
    sessionToken: token,
    daypart: "afternoons",
    day: "1998-04-12",
  });
  check(
    "POST /booked REFUSES a day that was never offered",
    badDay.ok !== true,
    JSON.stringify(badDay).slice(0, 200)
  );

  // ── 12. The honeypot still returns 200 and writes nothing ──
  const trap = await post("email", {
    ...base,
    email: "bot@example.com",
    company_url_hp: "http://spam.example",
  });
  check("the honeypot returns ok and writes nothing", trap.ok === true && trap.leadId === null);

  console.log(
    failures === 0
      ? `\nAll checks passed. Signing ${String(signed.signingId)} is flagged is_demo.`
      : `\n${failures} check(s) FAILED.`
  );
  process.exit(failures === 0 ? 0 : 1);
}

void main();
