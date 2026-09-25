// Probe: the Apollo cold-list pre-filter, offline.
//
//   bunx tsx scripts/_probe-scraper.ts          pure checks, no network, no DB, no Slack
//   bunx tsx scripts/_probe-scraper.ts --mx     plus real MX lookups against three known domains
//
// This is the file that answers "is the TypeScript port faithful to apollo_prefilter.py". Every
// check below is a pure function over a string, which is why the whole pipeline was split so that
// its expensive half (mx.ts) and its stateful half (store.ts) sit behind their own modules.
//
// ‼️ THE SUMMARY AND THE process.exit MUST STAY THE LAST TWO STATEMENTS IN THIS FILE. The DM probe
// records what happens otherwise: five checks once sat below them and never ran.

import { readFileSync } from "node:fs";
import { parseCsv, parseCsvRows, toCsv } from "../src/lib/scraper/csv";
import { columnVerdict, emailDomain, isDisposableDomain, isRoleAccount, resolveEmailColumn, runnableWorkflows } from "../src/lib/scraper/rules";
import type { Workflow } from "../src/lib/scraper/store";
import { applyMxVerdicts, filterRows } from "../src/lib/scraper/filter";
import { formatBreakdown, formatLatePick, formatPickRewind } from "../src/lib/scraper/report";
import { parseResultLines } from "../src/lib/scraper/millionverifier";
import { hasMx } from "../src/lib/scraper/mx";
import {
  EMAIL_TIER,
  bestEmailTier,
  emailTier,
  pickBestEmail,
  type EmailCandidate,
} from "../src/lib/email-scrape";
import {
  NAME_SCORE_CEILING,
  bestNameScore,
  collectNames,
  looksLikeTitle,
  pickOwnerName,
} from "../src/lib/medspa-owner-scrape";

let passed = 0;
const failures: string[] = [];

function check(label: string, cond: boolean, detail?: string): void {
  if (cond) {
    passed++;
  } else {
    failures.push(label + (detail ? "  (" + detail + ")" : ""));
  }
}

function eq(label: string, actual: unknown, expected: unknown): void {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  check(label, a === e, "got " + a + ", wanted " + e);
}

// ── CSV ─────────────────────────────────────────────────────────────────────────────────────────
// The case that makes a comma-split parser wrong: a company name with a comma in it, so every
// column right of it shifts and the email column stops being the email column.

eq(
  "quoted comma keeps columns aligned",
  parseCsvRows('a,b,c\n"Baker, Donelson",x,y@z.com')[1],
  ["Baker, Donelson", "x", "y@z.com"]
);
eq('escaped quote ("") unescapes', parseCsvRows('a\n"he said ""hi"""')[1], ['he said "hi"']);
eq("newline inside a quoted field", parseCsvRows('a,b\n"line1\nline2",x')[1], ["line1\nline2", "x"]);
eq("CRLF ends a row", parseCsvRows("a,b\r\n1,2").length, 2);
eq("trailing newline makes no phantom row", parseCsvRows("a,b\n1,2\n").length, 2);
eq("BOM is stripped from the first header", parseCsv("﻿email\nx@y.com").headers, ["email"]);
eq("blank line inside the file is not a row", parseCsv("a\n1\n\n2").rows.length, 2);
eq("short row is padded", parseCsv("a,b,c\n1,2").rows[0], { a: "1", b: "2", c: "" });

eq("toCsv quotes only what needs it", toCsv(["a", "b"], [{ a: "x,y", b: "z" }]).split("\r\n")[1], '"x,y",z');
eq("toCsv round-trips a quote", parseCsv(toCsv(["a"], [{ a: 'he said "hi"' }])).rows[0].a, 'he said "hi"');

// ── the email column ────────────────────────────────────────────────────────────────────────────
// The Python hardcoded "email" and Apollo exports "Email", so its own default was wrong for its
// own stated input.

eq("Apollo's capital Email resolves", resolveEmailColumn(["Name", "Email", "Title"]), "Email");
eq("lowercase email resolves", resolveEmailColumn(["email"]), "email");
eq("Primary Email is a fallback", resolveEmailColumn(["Name", "Primary Email"]), "Primary Email");
eq("no email column returns null", resolveEmailColumn(["Name", "Company"]), null);
check(
  "the exact-name column wins over the fallback",
  resolveEmailColumn(["Primary Email", "Email"]) === "Email"
);

// ── syntax ──────────────────────────────────────────────────────────────────────────────────────

eq("plain address yields its domain", emailDomain("jane@acme.com"), "acme.com");
eq("domain is lowercased", emailDomain("jane@ACME.COM"), "acme.com");
eq("subdomain survives", emailDomain("jane@mail.acme.co.uk"), "mail.acme.co.uk");
eq("plus addressing is valid", emailDomain("jane+apollo@acme.com"), "acme.com");
eq("no at sign", emailDomain("janeacme.com"), null);
eq("two at signs takes the last", emailDomain("a@b@acme.com"), null);
eq("empty local part", emailDomain("@acme.com"), null);
eq("empty domain", emailDomain("jane@"), null);
eq("bare hostname is not deliverable", emailDomain("jane@localhost"), null);
eq("double dot in the domain", emailDomain("jane@acme..com"), null);
eq("leading dot in the local part", emailDomain("jane@.acme.com"), null);
eq("hyphen may not start a label", emailDomain("jane@-acme.com"), null);
eq("numeric TLD is not a TLD", emailDomain("jane@acme.123"), null);
eq("IP literal domain is rejected", emailDomain("jane@192.168.1.1"), null);
eq("a space is not an address", emailDomain("jane doe@acme.com"), null);
eq("over-long local part", emailDomain("a".repeat(65) + "@acme.com"), null);
// Stated as a behaviour difference from the Python rather than discovered later.
eq("no IDNA: a non-ASCII domain is bad_syntax", emailDomain("jane@münchen.de"), null);

// ── role accounts, ported verbatim ──────────────────────────────────────────────────────────────

check("info@ is a role account", isRoleAccount("info@acme.com"));
check("SALES@ is case-insensitive", isRoleAccount("SALES@acme.com"));
check("no-reply@ is a role account", isRoleAccount("no-reply@acme.com"));
check("inquiries@ is a role account", isRoleAccount("inquiries@acme.com"));
// The anchoring is what stops a real person being junked for having a role word in their name.
check("salesian@ is a person", !isRoleAccount("salesian@acme.com"));
check("jsales@ is a person", !isRoleAccount("jsales@acme.com"));
check("info.smith@ is a person", !isRoleAccount("info.smith@acme.com"));

// ── disposable ──────────────────────────────────────────────────────────────────────────────────

check("mailinator.com is disposable", isDisposableDomain("mailinator.com"));
check("acme.com is not disposable", !isDisposableDomain("acme.com"));
check("gmail.com is NOT disposable", !isDisposableDomain("gmail.com"));

// ── the pipeline, one row per reason ────────────────────────────────────────────────────────────

const FIXTURE = [
  "Name,Email,Company",
  "No Address,,Nobody Inc",
  "Jane Doe,jane@acme.com,Acme",
  "Jane Again,JANE@ACME.COM,Acme",
  "Known Lead,known@crm.com,Already Ours",
  "Broken,not-an-address,Broken Ltd",
  "Front Desk,info@acme.com,Acme",
  "Throwaway,throw@mailinator.com,Nowhere",
  "Real Person,bob@example.org,Example",
].join("\n");

const parsedFixture = parseCsv(FIXTURE);
const column = resolveEmailColumn(parsedFixture.headers)!;
const filtered = filterRows({
  rows: parsedFixture.rows,
  emailColumn: column,
  knownEmails: new Set(["known@crm.com"]),
});

const reasonAt = (i: number) => filtered.rows[i].reason;
eq("row 0 no_email", reasonAt(0), "no_email");
eq("row 1 survives the string checks", reasonAt(1), null);
eq("row 2 duplicate_in_file", reasonAt(2), "duplicate_in_file");
eq("row 3 already_in_crm", reasonAt(3), "already_in_crm");
eq("row 4 bad_syntax", reasonAt(4), "bad_syntax");
eq("row 5 role_account", reasonAt(5), "role_account");
eq("row 6 disposable_domain", reasonAt(6), "disposable_domain");
eq("row 7 survives the string checks", reasonAt(7), null);

// The dedup is case-insensitive because the address is lowercased before it is compared. Apollo
// really does export the same person twice in different casing.
check("the FIRST occurrence is the one that survives", filtered.rows[1].email === "jane@acme.com");
eq("pending domains are deduped", filtered.pendingDomains.sort(), ["acme.com", "example.org"]);

// ── order matters, and it is the cost argument ──────────────────────────────────────────────────
// A row that is BOTH a role account and on a disposable domain must report role_account, because
// that check runs first. Getting this backwards would not break the filter, it would make the junk
// breakdown describe a different list than the one the pipeline actually rejected.
const bothRows = parseCsv("Email\ninfo@mailinator.com").rows;
eq(
  "role beats disposable, matching the script's order",
  filterRows({ rows: bothRows, emailColumn: "Email", knownEmails: new Set() }).rows[0].reason,
  "role_account"
);
// And a role account on a CRM address reports already_in_crm, because dedup is cheaper still.
eq(
  "crm dedup beats role, matching the script's order",
  filterRows({ rows: bothRows, emailColumn: "Email", knownEmails: new Set(["info@mailinator.com"]) })
    .rows[0].reason,
  "already_in_crm"
);

// ── MX verdicts ─────────────────────────────────────────────────────────────────────────────────
// The one behaviour the Python does NOT have, and the reason mx.ts is tri-state.

const verdicts = new Map<string, boolean | null>([
  ["acme.com", true],
  ["example.org", false],
]);
const split = applyMxVerdicts(filtered.rows, verdicts);
eq("a domain with MX is clean", split.clean.map((r) => r.email), ["jane@acme.com"]);
check("a domain with no MX is junked as no_mx", split.junk.some((r) => r.reason === "no_mx"));
eq("nothing is left pending when every domain answered", split.stillPending.length, 0);

const partial = applyMxVerdicts(filtered.rows, new Map([["acme.com", true]]));
eq("an unasked domain stays PENDING, never junk", partial.stillPending.map((r) => r.email), [
  "bob@example.org",
]);
check(
  "an undetermined domain is never counted as clean",
  !partial.clean.some((r) => r.email === "bob@example.org")
);
const undetermined = applyMxVerdicts(filtered.rows, new Map([["example.org", null]]));
check(
  "an explicit null verdict is pending, not junk",
  undetermined.stillPending.some((r) => r.email === "bob@example.org") &&
    !undetermined.junk.some((r) => r.reason === "no_mx")
);

// ── the report ──────────────────────────────────────────────────────────────────────────────────

const breakdown = formatBreakdown({
  fileName: "apollo_export.csv",
  emailColumn: "Email",
  total: 8,
  clean: 1,
  junk: 7,
  breakdown: new Map([
    ["no_email", 1],
    ["role_account", 3],
    ["bad_syntax", 3],
  ] as Array<[import("../src/lib/scraper/rules").JunkReason, number]>),
});
check("the breakdown prints the percentages", breakdown.includes("12.5%"));
check("the breakdown names the email column it used", breakdown.includes("`Email`"));
check(
  "ties break on pipeline order, not Map order",
  breakdown.indexOf("bad_syntax") < breakdown.indexOf("role_account")
);
check("no em dash reaches the thread", !breakdown.includes("—"));
eq(
  "zero rows does not divide by zero",
  formatBreakdown({ fileName: null, emailColumn: null, total: 0, clean: 0, junk: 0, breakdown: new Map() })
    .includes("NaN"),
  false
);

// ── MillionVerifier result parsing ──────────────────────────────────────────────────────────────
// Their column layout is not contractual, so the parser locates the address and the verdict rather
// than trusting positions.

const mvResults = parseResultLines(
  ["email,quality,result", "a@x.com,good,ok", "b@x.com,bad,invalid", "c@x.com,,catch_all"].join("\n")
);
eq("mv: ok parsed", mvResults.get("a@x.com"), "ok");
eq("mv: invalid parsed", mvResults.get("b@x.com"), "invalid");
eq("mv: catch_all parsed", mvResults.get("c@x.com"), "catch_all");
eq("mv: the header line is not a result", mvResults.has("email"), false);
eq(
  "mv: an extra leading column does not shift the verdict",
  parseResultLines("1,d@x.com,something,ok").get("d@x.com"),
  "ok"
);
eq(
  "mv: a line with no recognisable verdict is skipped, never guessed",
  parseResultLines("e@x.com,mystery").size,
  0
);

// ── the picker refuses, it does not kill ───────────────────────────────────────────
// On 2026-09-04 `leads (5).csv` was dropped, :one: was reacted, and workflow 1 correctly refused a
// file with no email column - by calling fail(), which marked the batch `error`. The :two: reacted
// straight afterwards was then swallowed with no message at all, and the picker was dead forever.
// A missing required column is a WRONG PICK, not a broken file.

eq(
  "a company list picked for filtering rewinds",
  columnVerdict("filter", ["company", "city", "state", "website"]).kind,
  "rewind"
);
eq(
  "leads (5).csv's real headers rewind rather than die",
  columnVerdict("filter", [
    "company", "city", "state", "industry", "employees", "website", "confidence", "people_count", "contacts",
  ]).kind,
  "rewind"
);
eq(
  "a contact list picked for scoring rewinds to filter",
  columnVerdict("score", ["Email", "First Name"]).kind,
  "rewind"
);

// ================================================================================================
// THE TERMINATION BOUND, ENUMERATED RATHER THAN SAMPLED.
//
// ‼️ THE OLD PROOF DIED WHEN THE THIRD ARM LANDED, AND PRETENDING OTHERWISE WOULD BE THE WORST
// OUTCOME. With two arms, "this arm cannot run and some arm can" forced the runnable set to be a
// singleton, so a rewind card always named the one arm that works and the bound was one hop. With
// three arms a file carrying only `company` leaves 2️⃣ runnable while BOTH 1️⃣ and 3️⃣ bounce, so
// somebody can bounce twice. The bound is now |workflows| - |runnable|, which is two.
//
// What pays for the weaker bound is that the proof is now COMPLETE instead of exemplary: three
// arms distinguished by three columns is 2^3 header subsets x 3 arms = 24 cells, and every one is
// checked below. The four properties are what the lane actually relies on.
// ================================================================================================
{
  const COLS = { email: "Email", company: "Company", website: "Website" } as const;
  const ARMS: Workflow[] = ["filter", "score", "listprep"];
  let cells = 0;
  let ok = true;
  const fails: string[] = [];

  for (let mask = 0; mask < 8; mask++) {
    const headers = [
      mask & 1 ? COLS.email : null,
      mask & 2 ? COLS.company : null,
      mask & 4 ? COLS.website : null,
    ].filter(Boolean) as string[];
    const runnable = runnableWorkflows(headers);

    for (const arm of ARMS) {
      cells++;
      const v = columnVerdict(arm, headers);
      const armRuns = runnable.includes(arm);

      // The verdict and the runnable set are the same computation, or the card lies to the person.
      if (armRuns !== (v.kind === "ok")) {
        ok = false;
        fails.push(`${arm} [${headers}] verdict ${v.kind} but runnable=${armRuns}`);
      }
      // P4: terminal exactly when nothing can run, and therefore arm-independent.
      if ((v.kind === "terminal") !== (runnable.length === 0)) {
        ok = false;
        fails.push(`${arm} [${headers}] terminal/runnable disagree`);
      }
      if (v.kind === "rewind") {
        // P1: every arm offered is genuinely runnable on these exact headers.
        if (!v.runnable.every((r) => columnVerdict(r.workflow, headers).kind === "ok")) {
          ok = false;
          fails.push(`${arm} [${headers}] offered an arm that would bounce`);
        }
        // P2: never offer back the arm that just refused.
        if (v.runnable.some((r) => r.workflow === arm)) {
          ok = false;
          fails.push(`${arm} [${headers}] offered itself`);
        }
        // P3: the COMPLETE set, not a representative. This is what replaced the one-hop bound:
        // a second bounce is only possible on an arm the card already said would bounce.
        if (v.runnable.length !== runnable.length) {
          ok = false;
          fails.push(`${arm} [${headers}] offered ${v.runnable.length} of ${runnable.length}`);
        }
      }
    }
  }
  eq("all 8 header subsets x 3 arms enumerated", cells, 24);
  check("the rewind bound holds on every cell" + (fails.length ? ": " + fails.join("; ") : ""), ok);
}

eq(
  "neither column is terminal, never a rewind (filter)",
  columnVerdict("filter", ["first_name", "phone"]).kind,
  "terminal"
);
eq(
  "neither column is terminal, never a rewind (score)",
  columnVerdict("score", ["first_name", "phone"]).kind,
  "terminal"
);
check(
  "no headers can produce a rewind in any direction",
  (["filter", "score", "listprep"] as const).every((w) =>
    [[], ["first_name"], ["phone", "zip"]].every((h) => columnVerdict(w, h).kind !== "rewind")
  )
);

eq("both columns present, filter runs", columnVerdict("filter", ["Email", "Company"]), {
  kind: "ok",
  columns: { email: "Email" },
});
eq("both columns present, score runs", columnVerdict("score", ["Email", "Company"]), {
  kind: "ok",
  columns: { company: "Company" },
});

// ‼️ 3️⃣ NEEDS TWO COLUMNS, AND A COMPANY-ONLY FILE MUST NOT REACH IT. `enrichOne` degrades to
// "not enriched" rather than throwing, so a website-less file would run a full paid qualification
// sweep and then produce zero sendable rows.
eq(
  "listprep needs a website, not just a company",
  columnVerdict("listprep", ["Company", "City"]).kind,
  "rewind"
);
eq("listprep runs with company and website", columnVerdict("listprep", ["Company", "Website"]), {
  kind: "ok",
  columns: { company: "Company", website: "Website" },
});
check(
  "a company-only file leaves exactly :two: runnable",
  runnableWorkflows(["Company", "City"]).join() === "score"
);

// ‼️ Slack never re-fires reaction_added for an emoji already on the message, and after a wrong
// pick the other keycap is usually already sitting there. Without this line the rewind looks
// exactly as broken as the silence it replaces.
const rewindCard = formatPickRewind({
  reason: "No email column in that file, so there is nothing to filter. Headers found: `company`",
  runnable: [{ workflow: "score", columns: { company: "company" } }],
});
check("the rewind says to take the reaction off and put it back", rewindCard.includes("take it off and put it back"));
check("the rewind names the keycap to react", rewindCard.includes(":two:"));
check("the rewind names the column that survives", rewindCard.includes("`company`"));
check(
  "the rewind promises nothing was inserted and nothing was spent",
  rewindCard.includes("Nothing was inserted and nothing was spent")
);

// ‼️ WITH TWO ARMS OFFERED, BOTH ARE NAMED. Naming one would reinstate the old singleton
// assumption inside a card that can now carry two, and the un-named arm is exactly where a second
// bounce comes from.
const twoArmRewind = formatPickRewind({
  reason: "That file is missing website.",
  runnable: [
    { workflow: "filter", columns: { email: "Email" } },
    { workflow: "score", columns: { company: "Company" } },
  ],
});
check("a two-arm rewind names :one:", twoArmRewind.includes(":one:"));
check("a two-arm rewind names :two:", twoArmRewind.includes(":two:"));

// ‼️ "Just drop the file again" is the obvious advice and it is WRONG: recordSeen runs at the
// drop, before the pick, so a re-drop of a batch that later died comes back as duplicates. Any arm
// that tells him to re-drop must name the purge first.
const latePick = (status: Parameters<typeof formatLatePick>[0]["status"], error: string | null) =>
  formatLatePick({
    batchId: "044ca122-6125-49af-a87e-0c7b3273a133",
    fileName: "leads (5).csv",
    picked: "score",
    running: "filter",
    status,
    error,
  });

const deadCard = latePick("error", "No email column in that file");
check("a late pick on a dead batch is not silent", deadCard.length > 0);
check("a late pick on a dead batch quotes the stored error", deadCard.includes("No email column in that file"));
check("a late pick on a dead batch names the purge script", deadCard.includes("purge-scraper-batch.ts"));
check("a late pick on a dead batch names the batch id", deadCard.includes("044ca122-6125-49af-a87e-0c7b3273a133"));
check(
  "the purge is named BEFORE the re-drop is suggested",
  deadCard.indexOf("purge-scraper-batch.ts") < deadCard.indexOf("Then drop the file again")
);

const doneCard = latePick("done", null);
check("a late pick on a finished batch names the purge script", doneCard.includes("purge-scraper-batch.ts"));

// Mid-flight is a different answer: the batch is still going, so there is nothing to purge and
// nothing to re-drop. Collapsing these arms into one would tell him to destroy a live run.
const flightCard = latePick("mx", null);
check("a late pick mid-flight does not offer the purge", !flightCard.includes("purge-scraper-batch.ts"));
check("a late pick mid-flight refuses to switch workflow", flightCard.includes("mid-flight"));
check("a late pick mid-flight reports the stage", flightCard.includes("`mx`"));
check(
  "the same keycap mid-flight reads differently from the other one",
  formatLatePick({
    batchId: "b", fileName: "f.csv", picked: "filter", running: "filter", status: "mx", error: null,
  }) !== flightCard
);

// ── live MX, opt-in ─────────────────────────────────────────────────────────────────────────────

async function liveMx(): Promise<void> {
  if (!process.argv.includes("--mx")) return;
  console.log("\nLive MX:");
  for (const domain of ["gmail.com", "example.com", "this-domain-does-not-exist-srt-probe.com"]) {
    const verdict = await hasMx(domain);
    console.log("  " + domain.padEnd(46) + String(verdict));
  }
  console.log(
    "  (true = has MX, false = definitively none, null = nobody could ask, so the row stays pending)"
  );
}

// ================================================================================================
// THE DISPATCH. Source-read rather than imported, because lane.ts pulls in the Slack client and
// this probe is offline.
//
// ‼️ THIS IS THE CHECK THAT GUARDS THE ONLY STEP HERE THAT CAN SPEND MONEY. The pick used to be
// `keycap === 1 ? "filter" : "score"` in four separate places, every one falling through to score.
// A 3️⃣ that fell through would insert company rows and buy a DataForSEO SERP for each of them,
// with no error and a thread that reads as though the right thing happened.
{
  const lane = readFileSync("src/lib/scraper/lane.ts", "utf8");
  // ‼️ COMMENTS STRIPPED BEFORE ANY "THIS PATTERN IS GONE" CHECK. The comment explaining WHY the
  // ternary was removed contains the ternary, so a raw source test fails on its own documentation
  // and the obvious fix is to delete the explanation. Strip first, assert second.
  const laneCode = lane
    .split("\n")
    .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l))
    .join("\n");
  check(
    "the pick is a table, not a ternary",
    /const PICK: Record<number, Workflow> = \{ 1: "filter", 2: "score", 3: "listprep" \}/.test(laneCode)
  );
  check(
    "3 maps to listprep and nothing falls through to score",
    !/keycap === 1 \? "filter" : "score"/.test(laneCode),
    "a ternary dispatch survives in lane.ts"
  );
  check(
    "the keycap cap is gone, so an unknown keycap is absent rather than defaulted",
    !/keycap > 2/.test(laneCode)
  );
  check(
    "workflow dispatch is one exhaustive switch with a never default",
    /const _never: never = workflow/.test(lane)
  );
  // The shared statuses are the ones a two-workflow assumption survives into.
  check(
    "the shared verifying arm branches on workflow before it reads a row",
    /batch\.workflow === "listprep"[\s\S]{0,200}pollListPrepVerification/.test(lane)
  );
  check(
    "list_run_id is in BATCH_COLUMNS, or the pull opens a run every tick",
    /list_run_id/.test(readFileSync("src/lib/scraper/store.ts", "utf8").match(/const BATCH_COLUMNS =[\s\S]*?;/)?.[0] ?? "")
  );
  const rep = readFileSync("src/lib/scraper/report.ts", "utf8");
  const inFlight = rep.match(/const IN_FLIGHT: BatchStatus\[\] = \[[\s\S]*?\];/)?.[0] ?? "";
  check(
    "IN_FLIGHT carries the workflow C stages, which the compiler cannot check",
    ["pulling", "qualifying", "enriching", "catchall_recheck", "suppressing"].every((s) =>
      inFlight.includes(s)
    ),
    inFlight
  );
}


// ── The email tiers, owner first ────────────────────────────────────────────────────────────────
// The two role lists disagree, so "prefer non-role" is not the same instruction as "prefer a
// person". These checks pin the band ORDER, which is the whole of W2a.
{
  const cand = (email: string, viaMailto = false): EmailCandidate => ({
    email, viaMailto, path: "", count: 1,
  });
  const site = "clinic.com";

  eq("a front desk role is tier 2", emailTier(cand("info@clinic.com"), site), EMAIL_TIER.FRONT_OFFICE);
  eq("a hiring inbox is tier 4, BELOW info@", emailTier(cand("careers@clinic.com"), site), EMAIL_TIER.BACK_OFFICE);
  eq("so is billing", emailTier(cand("billing@clinic.com"), site), EMAIL_TIER.BACK_OFFICE);
  eq("so is marketing", emailTier(cand("marketing@clinic.com"), site), EMAIL_TIER.BACK_OFFICE);

  // ‼️ THE REGRESSION THE SIX BANDS EXIST TO PREVENT. careers@ is not in this file's
  // ROLE_LOCAL_PARTS, so a plain "role loses to non-role" swap would have ranked it FIRST.
  check(
    "info@ beats careers@, which a bare tier swap would have inverted",
    emailTier(cand("info@clinic.com"), site) < emailTier(cand("careers@clinic.com"), site)
  );

  eq(
    "a same-domain business inbox is tier 3, below info@",
    emailTier(cand("zenfuldaymedspa@zenfulday.com"), "zenfulday.com"),
    EMAIL_TIER.SAME_DOMAIN
  );
  check(
    "so the business inbox does NOT outrank the front desk",
    emailTier(cand("info@zenfulday.com"), "zenfulday.com") <
      emailTier(cand("zenfuldaymedspa@zenfulday.com"), "zenfulday.com")
  );

  // The one true owner address in the 60 site sample, with and without the name in hand.
  eq(
    "marina@ is only tier 3 with no owner name to confirm it",
    emailTier(cand("marina@mmaestheticss.com"), "mmaestheticss.com"),
    EMAIL_TIER.SAME_DOMAIN
  );
  eq(
    "marina@ is tier 1 once the crawl has found Marina Musalyants",
    emailTier(cand("marina@mmaestheticss.com"), "mmaestheticss.com", "Marina Musalyants"),
    EMAIL_TIER.OWNER
  );
  eq(
    "first.last is person-shaped without any name in hand",
    emailTier(cand("jane.roe@clinic.com"), site),
    EMAIL_TIER.OWNER
  );
  check(
    "and a person beats the front desk, which is the point of the change",
    emailTier(cand("jane.roe@clinic.com"), site) < emailTier(cand("info@clinic.com"), site)
  );

  eq("webmail is tier 5", emailTier(cand("clinic@gmail.com"), site), EMAIL_TIER.WEBMAIL);
  eq(
    "a parent group role address via mailto is tier 6",
    emailTier(cand("info@medgroup.com", true), site),
    EMAIL_TIER.OTHER_DOMAIN_ROLE
  );
  eq(
    "a web agency footer credit is rejected",
    emailTier(cand("hello@someagency.com"), site),
    EMAIL_TIER.REJECT
  );

  // pickBestEmail must agree with the bands, and the owner name must change the winner.
  const pool = [cand("info@clinic.com"), cand("careers@clinic.com"), cand("marina@clinic.com")];
  eq("without a name the front desk wins", pickBestEmail(pool, site)?.email, "info@clinic.com");
  eq(
    "with the name, the owner wins",
    pickBestEmail(pool, site, "Marina Musalyants")?.email,
    "marina@clinic.com"
  );

  // ‼️ THE EARLY EXIT MUST FIRE ON TIER 1 AND NOTHING ELSE. If it fires on info@ the crawl stops on
  // the homepage and never fetches /team, so the ranking change buys nothing.
  eq(
    "bestEmailTier says OWNER only for a person",
    bestEmailTier([cand("info@clinic.com"), cand("jane.roe@clinic.com")], site),
    EMAIL_TIER.OWNER
  );
  eq(
    "and stays at FRONT_OFFICE for info@ alone, so the walk continues",
    bestEmailTier([cand("info@clinic.com")], site),
    EMAIL_TIER.FRONT_OFFICE
  );
  check(
    "scrapeEmail breaks on EMAIL_TIER.OWNER, not on a hand-copied condition",
    /bestEmailTier\(pool\.values\(\), siteDomain, ownerName\) === EMAIL_TIER\.OWNER/.test(
      readFileSync("src/lib/email-scrape.ts", "utf8")
    )
  );
}

// ── Owner names: the title blocklist, and the suppression it undoes ─────────────────────────────
// Every junk string below was returned as an owner name by the matcher this replaces. Every real
// name below was a genuine hit in the same 60 site sample, so the blocklist must not touch them.
{
  const junk = [
    "Nurse Practitioner", "Medical Director", "Lead Physician",
    "Aesthetic Nurse", "Policy Refund", "Button James",
    // Still sitting in med_spa_leads.owner_name from the pre-fix scraper.
    "Join Our", "Learn More", "Vision Empower",
  ];
  for (const j of junk) check("a title is not a name: " + j, looksLikeTitle(j));

  const real = [
    "Marina Musalyants", "Anya Stassiy", "Nilam Patel", "Kathy Newman",
    "Ashraf G. Andrawis", "Jennie Evans", "Chidi Uche",
  ];
  for (const r of real) check("a real hit survives the blocklist: " + r, !looksLikeTitle(r));

  // ‼️ THE BLOCKLIST IS PER WHOLE TOKEN. "Newman" carries "new" and "Andrawis" carries "and";
  // a substring test would reject two of the seven names above.
  check("the test is per token, not substring", !looksLikeTitle("Kathy Newman"));

  // The failure that made precision 12%: a title matched first and ENDED the search.
  const page = "Our Medical Director Jane Roe leads care. The spa is owned by Dr. Marina Musalyants.";
  const found = collectNames(page, "/about");
  eq("the real owner is reached past the weaker cue", pickOwnerName(found), "Marina Musalyants");
  // Jane Roe IS a person and IS collected. She is a hired medical director, so her cue is weak and
  // she loses. The point is that the old matcher returned HER and stopped, never reaching the owner.
  check("the weaker candidate is still seen, just outranked", found.some((c) => c.name === "Jane Roe"));
  check(
    "and it is outranked on score, not on luck of position",
    (found.find((c) => c.name === "Marina Musalyants")?.score ?? 0) >
      (found.find((c) => c.name === "Jane Roe")?.score ?? 0)
  );

  // ‼️ THE BLOCKLIST'S OWN PATH: a cue whose NAME capture is itself a title. This is the shape that
  // produced `Nurse Practitioner` and `Aesthetic Nurse` as owner names.
  eq(
    "a title captured as the name is refused outright",
    pickOwnerName(collectNames("Our Owner Nurse Practitioner will see you now", "")),
    null
  );

  // Both cue orders are read, not just the first that matches.
  eq(
    "cue-then-name is collected",
    pickOwnerName(collectNames("Owner Sandra Klein welcomes you.", "")),
    "Sandra Klein"
  );
  eq(
    "name-then-cue is collected too",
    pickOwnerName(collectNames("Sandra Klein, founder of the practice.", "")),
    "Sandra Klein"
  );

  // A deliberate statement on /our-team outranks a caption on the homepage.
  const home = collectNames("Owner Sandra Klein welcomes you.", "");
  const about = collectNames("The clinic was founded by Dr. Priya Raman in 2011.", "/our-team");
  eq("the About page beats the homepage", pickOwnerName([...home, ...about]), "Priya Raman");

  eq("a strong cue on an About page with a Dr. prefix is the ceiling", bestNameScore(about), NAME_SCORE_CEILING);
  eq("nothing found is score zero", bestNameScore([]), 0);
  eq("and nothing found picks nothing", pickOwnerName([]), null);
}

// Wrapped rather than top-level await: tsx transforms this to CJS and rejects one.
async function main(): Promise<void> {
  await liveMx();

  console.log("\n" + passed + " passed, " + failures.length + " failed");
  if (failures.length) {
    for (const f of failures) console.log("  FAIL " + f);
  }
  process.exit(failures.length ? 1 : 0);
}

main();
