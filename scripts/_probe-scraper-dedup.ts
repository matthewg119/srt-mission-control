// Probe: the drop's dedupe, offline.
//
//   bunx tsx scripts/_probe-scraper-dedup.ts     pure checks, no network, no DB, no Slack
//
// This lane deletes rows from a run before anybody sees them, so the question this file answers is
// not "does it dedupe" but "does it ever delete a business that is not a duplicate". Two rails
// carry that weight and both are asserted here by name:
//
//   1. A platform host is not an identity. Keyed on facebook.com, the SECOND clinic with a Facebook
//      page vanishes forever, because the drop also writes the key to the ledger.
//   2. A phone key is the last ten digits. A seven-digit local listing must not become a key at all,
//      or every "555-01xx" row in the file collapses onto one lead.
//
// ‼️ THE SUMMARY AND THE process.exit MUST STAY THE LAST TWO STATEMENTS IN THIS FILE, same rule as
// _probe-scraper.ts: checks written below them never run.

import {
  allKeys,
  domainKey,
  emailKey,
  phoneKey,
  splitDuplicates,
  type DedupeColumns,
  type KnownKeys,
} from "../src/lib/scraper/dedup";
import { filterRows } from "../src/lib/scraper/filter";
import { resolvePhoneColumn } from "../src/lib/scraper/rules";
import { buildDuplicatesCsv, formatDedupeSplit, formatWorkflowPicker } from "../src/lib/scraper/report";

let passed = 0;
const failures: string[] = [];

function check(label: string, cond: boolean, detail?: string): void {
  if (cond) passed++;
  else failures.push(label + (detail ? "  (" + detail + ")" : ""));
}

function eq(label: string, actual: unknown, expected: unknown): void {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  check(label, a === e, "got " + a + ", wanted " + e);
}

const NO_KEYS: KnownKeys = { domain: new Set(), phone: new Set(), email: new Set() };

const COLS: DedupeColumns = {
  company: "company",
  city: "city",
  website: "website",
  phone: "phone",
  email: "email",
};

function row(over: Partial<Record<string, string>> = {}): Record<string, string> {
  return { company: "", city: "", website: "", phone: "", email: "", ...over };
}

// ── domain keys ─────────────────────────────────────────────────────────────────────────────────

eq("domain: scheme, www and path all come off", domainKey("https://www.5DWellness.LV/about"), "5dwellness.lv");
eq("domain: a bare host is the same key", domainKey("5dwellness.lv"), "5dwellness.lv");
eq("domain: trailing slash", domainKey("http://glowbar.com/"), "glowbar.com");
eq("domain: blank is no key", domainKey(""), null);
eq("domain: whitespace is no key", domainKey("   "), null);
eq("domain: null is no key", domainKey(null), null);
eq("domain: a bare hostname is not a site", domainKey("localhost"), null);
eq("domain: an IP literal is not a site", domainKey("http://192.168.1.4/"), null);

// Rail 1. The apex is a platform, the subdomain is a business.
eq("domain: facebook.com is nobody", domainKey("https://facebook.com/glowbar"), null);
eq("domain: www.facebook.com is nobody", domainKey("www.facebook.com/glowbar"), null);
eq("domain: instagram.com is nobody", domainKey("instagram.com/theclinic"), null);
eq("domain: a business.site SUBDOMAIN is somebody", domainKey("https://theclinic.business.site"), "theclinic.business.site");
eq("domain: bare business.site is nobody", domainKey("business.site"), null);
eq("domain: bare wixsite.com is nobody", domainKey("wixsite.com"), null);
eq("domain: a wix SUBDOMAIN is somebody", domainKey("https://glowbar.wixsite.com/spa"), "glowbar.wixsite.com");
eq("domain: two wix clinics do not collide",
  domainKey("glowbar.wixsite.com") === domainKey("dermaluxe.wixsite.com"), false);

// ── phone keys ──────────────────────────────────────────────────────────────────────────────────

// Rail 2. One number, four spellings, one key.
eq("phone: formatted US", phoneKey("(704) 555-0134"), "7045550134");
eq("phone: +1 prefixed", phoneKey("+1 704-555-0134"), "7045550134");
eq("phone: 11 digits raw", phoneKey("17045550134"), "7045550134");
eq("phone: with an extension separator", phoneKey("704.555.0134"), "7045550134");
check("phone: all four spellings are one key",
  new Set(["(704) 555-0134", "+1 704-555-0134", "17045550134", "704.555.0134"].map(phoneKey)).size === 1);

eq("phone: seven digits is not a phone number", phoneKey("555-0134"), null);
eq("phone: blank", phoneKey(""), null);
eq("phone: null", phoneKey(null), null);
eq("phone: letters only", phoneKey("call us"), null);
eq("phone: a placeholder repdigit is not a key", phoneKey("555-555-5555"), null);
eq("phone: zeroes are not a key", phoneKey("(000) 000-0000"), null);

// ── email keys ──────────────────────────────────────────────────────────────────────────────────

eq("email: lowercased and trimmed", emailKey("  Jane@GlowBar.com "), "jane@glowbar.com");
eq("email: not an address at all", emailKey("jane at glowbar"), null);
eq("email: no TLD", emailKey("jane@glowbar"), null);
eq("email: blank", emailKey(""), null);

// ── the split ───────────────────────────────────────────────────────────────────────────────────

{
  const rows = [
    row({ company: "Glow Bar", website: "https://www.glowbar.com" }),
    row({ company: "Derma Luxe", website: "dermaluxe.com" }),
  ];
  const known: KnownKeys = { domain: new Set(["glowbar.com"]), phone: new Set(), email: new Set() };
  const { fresh, dupes } = splitDuplicates({ rows, cols: COLS, known });
  eq("split: the known domain is caught", dupes.length, 1);
  eq("split: it reports the key that caught it", dupes[0].matchedOn, "domain");
  eq("split: and the value", dupes[0].matchedValue, "glowbar.com");
  eq("split: the other row survives", fresh.length, 1);
  eq("split: row indexes are the ORIGINAL ones", [dupes[0].rowIndex, fresh[0].rowIndex], [0, 1]);
}

{
  // Two rows, no website on either, sharing a front desk. One lead, first occurrence survives.
  const rows = [
    row({ company: "Glow Bar", phone: "(704) 555-0134" }),
    row({ company: "Glow Bar Uptown", phone: "+1 704 555 0134" }),
  ];
  const { fresh, dupes } = splitDuplicates({ rows, cols: COLS, known: NO_KEYS });
  eq("in-file: the second row is the duplicate", dupes.map((d) => d.rowIndex), [1]);
  eq("in-file: reported as in_file, not phone", dupes[0].matchedOn, "in_file");
  eq("in-file: the FIRST occurrence survives", fresh.map((f) => f.rowIndex), [0]);
}

{
  // Rail 1, end to end. Both clinics list Facebook and nothing else. Neither may be deleted.
  const rows = [
    row({ company: "Glow Bar", website: "https://facebook.com/glowbar" }),
    row({ company: "Derma Luxe", website: "https://facebook.com/dermaluxe" }),
  ];
  const { fresh, dupes } = splitDuplicates({ rows, cols: COLS, known: NO_KEYS });
  eq("platform host: nothing is deduped", dupes.length, 0);
  eq("platform host: both clinics survive", fresh.length, 2);
}

{
  // A row with no key at all cannot be a duplicate of anything, however many of them there are.
  const rows = [row({ company: "Glow Bar" }), row({ company: "Glow Bar" })];
  const { fresh, dupes } = splitDuplicates({ rows, cols: COLS, known: NO_KEYS });
  eq("keyless rows are never duplicates", [fresh.length, dupes.length], [2, 0]);
}

{
  // A file with no website, phone or email column at all. Every row is new; nothing throws.
  const bare: DedupeColumns = { company: "company", city: null, website: null, phone: null, email: null };
  const rows = [row({ company: "Glow Bar" }), row({ company: "Derma Luxe" })];
  const { fresh, dupes } = splitDuplicates({ rows, cols: bare, known: NO_KEYS });
  eq("no key columns: all new", [fresh.length, dupes.length], [2, 0]);
  eq("no key columns: nothing to ask the ledger", allKeys(rows, bare), { domain: [], phone: [], email: [] });
}

{
  // Precedence: a row that collides on domain AND phone AND email reports the domain.
  const rows = [row({ website: "glowbar.com", phone: "7045550134", email: "jane@glowbar.com" })];
  const known: KnownKeys = {
    domain: new Set(["glowbar.com"]),
    phone: new Set(["7045550134"]),
    email: new Set(["jane@glowbar.com"]),
  };
  const { dupes } = splitDuplicates({ rows, cols: COLS, known });
  eq("precedence: domain wins over phone and email", dupes[0].matchedOn, "domain");
}

{
  // Phone before email, when there is no domain to judge by.
  const rows = [row({ phone: "7045550134", email: "jane@glowbar.com" })];
  const known: KnownKeys = {
    domain: new Set(),
    phone: new Set(["7045550134"]),
    email: new Set(["jane@glowbar.com"]),
  };
  const { dupes } = splitDuplicates({ rows, cols: COLS, known });
  eq("precedence: phone wins over email", dupes[0].matchedOn, "phone");
}

{
  // An in-file collision is reported as in_file even when the ledger also knows the key.
  const rows = [row({ website: "glowbar.com" }), row({ website: "www.glowbar.com/book" })];
  const { dupes } = splitDuplicates({ rows, cols: COLS, known: NO_KEYS });
  eq("in-file beats the ledger in the reason", dupes[0].matchedOn, "in_file");
}

// ── the keys handed to the ledger ───────────────────────────────────────────────────────────────

{
  const rows = [
    row({ website: "https://www.glowbar.com/", phone: "(704) 555-0134", email: "Jane@GlowBar.com" }),
    row({ website: "glowbar.com", phone: "704-555-0134", email: "jane@glowbar.com" }),
    row({ website: "facebook.com", phone: "555-0134", email: "not-an-address" }),
  ];
  eq("allKeys: normalized and deduped, junk dropped", allKeys(rows, COLS), {
    domain: ["glowbar.com"],
    phone: ["7045550134"],
    email: ["jane@glowbar.com"],
  });
}

// ── the column resolver ─────────────────────────────────────────────────────────────────────────

eq("phone column: exact", resolvePhoneColumn(["company", "Phone"]), "Phone");
eq("phone column: Apollo's spelling", resolvePhoneColumn(["Company Phone"]), "Company Phone");
eq("phone column: Outscraper's spelling", resolvePhoneColumn(["phone number"]), "phone number");
eq("phone column: business line beats the mobile", resolvePhoneColumn(["Mobile", "Business Phone"]), "Business Phone");
eq("phone column: a miss is null, never an error", resolvePhoneColumn(["company", "city"]), null);

// ── the skip set reaches workflow 1 ─────────────────────────────────────────────────────────────

{
  const rows = [
    { email: "a@glowbar.com" },
    { email: "b@dermaluxe.com" },
    { email: "c@skinbar.com" },
  ];
  const filtered = filterRows({
    rows,
    emailColumn: "email",
    knownEmails: new Set(),
    skipIndexes: new Set([1]),
  });
  eq("workflow 1: the skipped row is junk", filtered.rows[1].reason, "duplicate_prior_batch");
  eq("workflow 1: the others are untouched", [filtered.rows[0].reason, filtered.rows[2].reason], [null, null]);
  eq("workflow 1: it does not reach the MX sweep", filtered.pendingDomains.sort(), ["glowbar.com", "skinbar.com"]);
  eq("workflow 1: row indexes stay the file's", filtered.rows.map((r) => r.rowIndex), [0, 1, 2]);
}

{
  // No skip set at all: byte-identical to the behaviour _probe-scraper.ts already proves.
  const rows = [{ email: "a@glowbar.com" }, { email: "" }];
  const withOut = filterRows({ rows, emailColumn: "email", knownEmails: new Set() });
  const withEmpty = filterRows({ rows, emailColumn: "email", knownEmails: new Set(), skipIndexes: new Set() });
  eq("workflow 1: an absent skip set changes nothing", withOut.rows.map((r) => r.reason), [null, "no_email"]);
  eq("workflow 1: an empty skip set changes nothing", withEmpty.rows.map((r) => r.reason), [null, "no_email"]);
}

// ── the cards and the file ──────────────────────────────────────────────────────────────────────

{
  const rows = [row({ company: "Glow Bar", website: "glowbar.com" })];
  const { dupes } = splitDuplicates({
    rows,
    cols: COLS,
    known: { domain: new Set(["glowbar.com"]), phone: new Set(), email: new Set() },
  });
  const csv = buildDuplicatesCsv(["company", "website"], dupes);
  check("duplicates.csv: keeps the original headers and adds two",
    csv.startsWith("company,website,duplicate_reason,matched_value\r\n"), csv.split("\r\n")[0]);
  check("duplicates.csv: names the value that matched", csv.includes("domain,glowbar.com"), csv);

  const card = formatDedupeSplit({
    fileName: "leads (1).csv",
    total: 226,
    dupes,
    newCount: 225,
    keyColumns: { website: "website", phone: null, email: null },
  });
  check("split card: names the file", card.includes("leads (1).csv"), card);
  check("split card: prints both counts", card.includes("already in  1") && card.includes("new         225"), card);
  check("split card: names the column the key was read from", card.includes("website `website`"), card);
}

{
  const card = formatDedupeSplit({
    fileName: "companies.csv",
    total: 10,
    dupes: [],
    newCount: 10,
    keyColumns: { website: null, phone: null, email: null },
  });
  check("split card: says so when nothing COULD be matched",
    card.includes("nothing could be matched"), card);
}

{
  const picker = formatWorkflowPicker({
    fileName: "leads (1).csv",
    totalRows: 226,
    emailColumn: null,
    companyColumn: "company",
    cityColumn: "city",
    websiteColumn: "website",
    duplicateCount: 41,
    newCount: 185,
  });
  check("picker: the headline carries the split", picker.includes("41 already seen") && picker.includes("185 new"), picker);
  check("picker: says the workflow runs on the new rows only", picker.includes("185 new rows only"), picker);
}

{
  const picker = formatWorkflowPicker({
    fileName: "again.csv",
    totalRows: 226,
    emailColumn: "email",
    companyColumn: "company",
    cityColumn: null,
    websiteColumn: null,
    duplicateCount: 226,
    newCount: 0,
  });
  check("picker: a re-drop says there is nothing to work on",
    picker.includes("nothing " + "to work on"), picker);
}

{
  const picker = formatWorkflowPicker({
    fileName: "first.csv",
    totalRows: 12,
    emailColumn: "email",
    companyColumn: null,
    cityColumn: null,
    websiteColumn: null,
    duplicateCount: 0,
    newCount: 12,
  });
  check("picker: a clean file says all new and adds no scope line",
    picker.includes("all new") && !picker.includes("new rows only"), picker);
}

console.log("\n" + passed + " passed, " + failures.length + " failed");
if (failures.length) for (const f of failures) console.log("  FAIL " + f);
process.exit(failures.length ? 1 : 0);
