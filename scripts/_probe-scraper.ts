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

import { parseCsv, parseCsvRows, toCsv } from "../src/lib/scraper/csv";
import { emailDomain, isDisposableDomain, isRoleAccount, resolveEmailColumn } from "../src/lib/scraper/rules";
import { applyMxVerdicts, filterRows } from "../src/lib/scraper/filter";
import { formatBreakdown } from "../src/lib/scraper/report";
import { parseResultLines } from "../src/lib/scraper/millionverifier";
import { hasMx } from "../src/lib/scraper/mx";

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
