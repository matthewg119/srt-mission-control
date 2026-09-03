// Probe: the drop's dedupe, offline.
//
//   bunx tsx scripts/_probe-scraper-dedup.ts     pure checks, no network, no DB, no Slack
//
// This lane deletes rows from a run before anybody sees them, so the question this file answers is
// not "does it dedupe" but "does it ever delete a business that is not a duplicate". Three rails
// carry that weight and all three are asserted here by name:
//
//   1. A platform host is not an identity. Keyed on facebook.com, the SECOND clinic with a Facebook
//      page vanishes forever, because the drop also writes the key to the ledger.
//   2. A phone key is the last ten digits. A seven-digit local listing must not become a key at all,
//      or every "555-01xx" row in the file collapses onto one lead.
//   3. company+city is a LAST RESORT, computed only when a row has no domain, no phone and no
//      email, and it does NOT strip "spa" / "clinic" the way normalizeCompanyName does, because on
//      one street those words are the only thing separating two businesses.
//
// ‼️ THE SUMMARY AND THE process.exit MUST STAY THE LAST TWO STATEMENTS IN THIS FILE, same rule as
// _probe-scraper.ts: checks written below them never run.

import {
  allKeys,
  domainKey,
  emailKey,
  phoneKey,
  companyCityKey,
  countTruncatedNames,
  editDistanceWithin,
  looksTruncated,
  matchInCity,
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

const NO_KEYS: KnownKeys = {
  domain: new Set(),
  phone: new Set(),
  email: new Set(),
  companyCityByCity: new Map(),
};

/** A KnownKeys with just the keys under test. `companyCity` entries are "name|city" strings. */
function ledger(over: Partial<Record<"domain" | "phone" | "email" | "companyCity", string[]>>): KnownKeys {
  const byCity = new Map<string, string[]>();
  for (const key of over.companyCity ?? []) {
    const bar = key.indexOf("|");
    const name = key.slice(0, bar);
    const city = key.slice(bar + 1);
    byCity.set(city, [...(byCity.get(city) ?? []), name]);
  }
  return {
    domain: new Set(over.domain ?? []),
    phone: new Set(over.phone ?? []),
    email: new Set(over.email ?? []),
    companyCityByCity: byCity,
  };
}

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
  const known = ledger({ domain: ["glowbar.com"] });
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
  eq("no key columns: nothing to ask the ledger", allKeys(rows, bare), { domain: [], phone: [], email: [], cities: [] });
}

{
  // Precedence: a row that collides on domain AND phone AND email reports the domain.
  const rows = [row({ website: "glowbar.com", phone: "7045550134", email: "jane@glowbar.com" })];
  const known = ledger({ domain: ["glowbar.com"], phone: ["7045550134"], email: ["jane@glowbar.com"] });
  const { dupes } = splitDuplicates({ rows, cols: COLS, known });
  eq("precedence: domain wins over phone and email", dupes[0].matchedOn, "domain");
}

{
  // Phone before email, when there is no domain to judge by.
  const rows = [row({ phone: "7045550134", email: "jane@glowbar.com" })];
  const known = ledger({ phone: ["7045550134"], email: ["jane@glowbar.com"] });
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
    cities: [],
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
    known: ledger({ domain: ["glowbar.com"] }),
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
    keyless: 0,
    truncatedNames: 0,
    keyColumns: { website: "website", phone: null, email: null, company: "company", city: "city" },
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
    keyless: 10,
    truncatedNames: 0,
    keyColumns: { website: null, phone: null, email: null, company: null, city: null },
  });
  check("split card: says so when nothing COULD be matched",
    card.includes("Nothing in this file could be matched"), card);
  check("split card: warns that keyless rows come back forever",
    card.includes("10 of the new rows carry no website"), card);
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
  check("picker: the headline IS the new count, not the file's", picker.startsWith("*185 new leads*"), picker);
  check("picker: points at new.csv, not the dropped file", picker.includes("`new.csv` above, not the file you dropped"), picker);
  check("picker: the original total is demoted to a subline", picker.includes("had 226 rows") && picker.includes("41 are in `duplicates.csv`"), picker);
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
  check("picker: a clean file names the file and says none were seen",
    picker.includes("*first.csv*, 12 rows, none seen before"), picker);
}


// -- rail 3: company + city, the last resort ----------------------------------------------------
//
// This is the file that prompted the whole feature: an Outscraper pull with company and city and a
// blank website column, dropped three times and re-scored three times.

eq("company+city: normalized and joined", companyCityKey("5D Wellness", "Riga"), "5dwellness|riga");
eq("company+city: punctuation and case come out", companyCityKey("ABClinic Art & Beauty", "Prague"), "abclinicartbeauty|prague");
eq("company+city: no city is no key", companyCityKey("Skin Bar", ""), null);
eq("company+city: no company is no key", companyCityKey("", "Charlotte"), null);
eq("company+city: same name, two cities, two keys",
  companyCityKey("Skin Bar", "Charlotte") === companyCityKey("Skin Bar", "Miami"), false);

// The difference from normalizeCompanyName, asserted rather than described. Stripping the generic
// suffix would fold these two into one business.
eq("company+city: Spa and Clinic stay two businesses",
  companyCityKey("Glow Spa", "Charlotte") === companyCityKey("Glow Clinic", "Charlotte"), false);
eq("company+city: LLC is NOT stripped either", companyCityKey("Glow Spa LLC", "Charlotte"), "glowspallc|charlotte");

{
  // The re-drop. Exactly the shape of leads (1).csv: company and city, nothing else.
  const rows = [row({ company: "5D Wellness", city: "Riga" }), row({ company: "8 West Clinic", city: "Vancouver" })];
  const { fresh, dupes, keyless } = splitDuplicates({
    rows,
    cols: COLS,
    known: ledger({ companyCity: ["5dwellness|riga"] }),
  });
  eq("re-drop: the scored company is caught", dupes.map((d) => d.matchedOn), ["company_city"]);
  eq("re-drop: reported with the snake_case key name", dupes[0].matchedValue, "5dwellness|riga");
  eq("re-drop: the unseen one survives", fresh.map((f) => f.company), ["8 West Clinic"]);
  eq("re-drop: and it is keyed, so the NEXT drop catches it",
    [keyless, fresh[0].keys.companyCity], [0, "8westclinic|vancouver"]);
}

{
  // THE LAST-RESORT RULE. A row with a website never takes a name key, so a chain with one domain
  // and ten locations cannot collide on its own name.
  const rows = [row({ company: "Ideal Image", city: "Charlotte", website: "idealimage.com" })];
  const { fresh } = splitDuplicates({ rows, cols: COLS, known: NO_KEYS });
  eq("last resort: a website suppresses the name key", fresh[0].keys.companyCity, null);
  eq("last resort: the domain is the key instead", fresh[0].keys.domain, "idealimage.com");
}

{
  const rows = [row({ company: "Ideal Image", city: "Charlotte", phone: "(704) 555-0134" })];
  const { fresh } = splitDuplicates({ rows, cols: COLS, known: NO_KEYS });
  eq("last resort: a phone suppresses the name key too", fresh[0].keys.companyCity, null);
}

{
  // A file with a company and city column but no city VALUES: keyless, and the count says so.
  const rows = [row({ company: "Glow Bar" }), row({ company: "Derma Luxe" })];
  const { fresh, keyless } = splitDuplicates({ rows, cols: COLS, known: NO_KEYS });
  eq("keyless: counted, not hidden", [fresh.length, keyless], [2, 2]);
}


// -- the truncated-export guard -----------------------------------------------------------------
//
// Real strings out of leads (2).csv, which was captured from a screenshot of an Apollo grid: the
// ellipsis is IN THE DATA. 71 of its 115 company names looked like this and leads (1).csv had none.

eq("truncated: an ASCII ellipsis", looksTruncated("Aloe Vera Medical Cente..."), true);
eq("truncated: a unicode ellipsis", looksTruncated("Adara Longevity & Aesth…"), true);
eq("truncated: trailing space does not hide it", looksTruncated("ALRAYA MEDICAL CENTE...  "), true);
eq("truncated: a complete name is not", looksTruncated("Aloe Vera Medical Center"), false);
eq("truncated: blank is not", looksTruncated(""), false);
eq("truncated: null is not", looksTruncated(null), false);

{
  const rows = [
    row({ company: "Aloe Vera Medical Cente...", city: "Baltimore" }),
    row({ company: "Aloe Vera Medical Center", city: "Baltimore" }),
    row({ company: "8 West Clinic", city: "Vancouver" }),
  ];
  eq("truncated: counted across the file", countTruncatedNames(rows, "company"), 1);
  eq("truncated: no company column, nothing to count", countTruncatedNames(rows, null), 0);

  // ‼️ THE PREFIX TIER NOW RESCUES THIS, and this assertion is the proof. Before it, a cut-off name
  // could not match its full self and the pair was reported as two businesses; that is the exact
  // 24-row miss the tier was built for. The 🚨 still fires, because a file this damaged is under-
  // matching in ways no rule recovers — a name cut mid-word to `Aloe Vera Med...` matches nothing.
  const { dupes } = splitDuplicates({ rows, cols: COLS, known: NO_KEYS });
  eq("truncated: a cut-off name now matches its full self", dupes.map((d) => d.matchedOn), ["in_file"]);
}

{
  const card = formatDedupeSplit({
    fileName: "leads (2).csv",
    total: 218,
    dupes: [],
    newCount: 218,
    keyless: 0,
    truncatedNames: 71,
    keyColumns: { website: null, phone: null, email: null, company: "company", city: "city" },
  });
  check("truncation card: leads with the alarm, above the numbers",
    card.startsWith(":rotating_light:"), card.slice(0, 60));
  check("truncation card: names the count", card.includes("71 of the 218 company names"), card);
  check("truncation card: says the duplicate count is TOO LOW",
    card.includes("the duplicate count below is too low"), card);
  check("truncation card: says what to do about it", card.includes("Re-export this list properly"), card);
}

{
  const card = formatDedupeSplit({
    fileName: "clean.csv",
    total: 218,
    dupes: [],
    newCount: 218,
    keyless: 0,
    truncatedNames: 0,
    keyColumns: { website: null, phone: null, email: null, company: "company", city: "city" },
  });
  check("truncation card: a clean file gets no alarm at all",
    !card.includes("rotating_light"), card.slice(0, 60));
}


// -- rail 4: OCR noise, the three tiers inside a city bucket ------------------------------------
//
// FIXTURES ARE REAL PAIRS out of leads (1).csv and leads (3).csv, two screenshot-derived pulls of
// the same Apollo search. 39 of the 90 rows recorded as new on 2026-09-03 were repeats hidden by
// differences this small. If any of these stops matching, the lane has silently gone back to
// re-buying SERPs for businesses it already scored.

eq("edit distance: identical", editDistanceWithin("glowbar", "glowbar", 1), 0);
eq("edit distance: one substitution", editDistanceWithin("grayaesthetics", "greyaesthetics", 1), 1);
eq("edit distance: one insertion", editDistanceWithin("bcinic", "bclinic", 1), 1);
eq("edit distance: length gap alone exceeds the cap", editDistanceWithin("abc", "abcdef", 1), 2);
check("edit distance: over the cap returns cap+1, not the true distance",
  editDistanceWithin("proxoaesthetics", "nwmeaesthetics", 1) === 2);
eq("edit distance: empty against empty", editDistanceWithin("", "", 1), 0);

{
  // The 24-row tier: one name contains the other.
  const seen = ["annexusdermatology", "comprehensivehealth", "auriaestheticsmedspa"];
  eq("prefix: the longer name matches the shorter on file",
    matchInCity("annexusdermatologyaesthetics", seen)?.match, "company_city_prefix");
  eq("prefix: and the shorter matches the longer",
    matchInCity("comprehensivehealthandwellnesscenter", seen)?.match, "company_city_prefix");
  eq("prefix: it reports WHICH recorded name it hit",
    matchInCity("auriaestheticsmedspawellness", seen)?.value, "auriaestheticsmedspa");
}

{
  // ‼️ THE LENGTH FLOOR. Without it a four-letter prefix swallows a whole clinic.
  eq("prefix: a short prefix does NOT swallow a long name",
    matchInCity("bmed", ["bmedicalspawellnesscenter"]), null);
  eq("prefix: exactly at the floor still matches",
    matchInCity("dermaluxes", ["dermaluxe12"])?.match ?? null, null);
}

{
  // The 13-row tier: one character. Every pair here is real.
  const seen = [
    "drsophieshatterteam", "grayaesthetics", "alletteaesthetics",
    "medigomedicalspa", "rejuviwelsuites", "bastuhealthboutique",
  ];
  for (const [typo, on] of [
    ["drsophieshotterteam", "drsophieshatterteam"],
    ["greyaesthetics", "grayaesthetics"],
    ["alleteaesthetics", "alletteaesthetics"],
    ["medigiomedicalspa", "medigomedicalspa"],
    ["rejuviwellsuites", "rejuviwelsuites"],
    ["bestuhealthboutique", "bastuhealthboutique"],
  ] as Array<[string, string]>) {
    const hit = matchInCity(typo, seen);
    eq("typo: " + typo + " is " + on, [hit?.match, hit?.value], ["company_city_typo", on]);
  }
}

{
  // ‼️ THE PAIR THAT MUST NOT MATCH. Two different Dallas businesses, 4 edits apart. pg_trgm scores
  // them 0.41 while scoring the genuine bclinic/bcinic pair 0.50, which is why this is edit
  // distance and not similarity.
  eq("typo: two different businesses stay two", matchInCity("proxoaesthetics", ["nwmeaesthetics"]), null);
  eq("typo: a short name is below the floor", matchInCity("gebu", ["geblu"]), null);
  eq("typo: two edits is not one", matchInCity("bioconnectmedicalcentre", ["bioconnectmedicalcenter"]), null);
}

{
  // Exact still wins, and is still reported as the plain key.
  eq("tiers: exact beats prefix", matchInCity("annexusdermatology",
    ["annexusdermatologyaesthetics", "annexusdermatology"])?.match, "company_city");
}

{
  // ‼️ THE CITY IS THE BUCKET AND IS NEVER FUZZY. matchInCity is only ever handed one city's names.
  const rows = [row({ company: "CLEO Skin + Laser", city: "Chanhassen" })];
  const { dupes, fresh } = splitDuplicates({
    rows,
    cols: COLS,
    known: ledger({ companyCity: ["cleoskinlaser|newyork"] }),
  });
  eq("city: the same name in another city is NOT a duplicate", [dupes.length, fresh.length], [0, 1]);
}

{
  // End to end, through splitDuplicates rather than matchInCity directly.
  const rows = [
    row({ company: "Annexus Dermatology Aesthetics", city: "Orange City" }),
    row({ company: "Dr Sophie Shotter & Team", city: "London" }),
    row({ company: "Brand New Clinic", city: "Orange City" }),
  ];
  const { dupes, fresh } = splitDuplicates({
    rows,
    cols: COLS,
    known: ledger({ companyCity: ["annexusdermatology|orangecity", "drsophieshatterteam|london"] }),
  });
  eq("end to end: both OCR variants caught",
    dupes.map((d) => d.matchedOn), ["company_city_prefix", "company_city_typo"]);
  eq("end to end: the genuinely new row survives", fresh.map((f) => f.company), ["Brand New Clinic"]);
  eq("end to end: matched_value names the recorded key",
    dupes[0].matchedValue, "annexusdermatology|orangecity");
}

{
  // The same OCR pair INSIDE one file collapses too, and is reported as in_file.
  const rows = [
    row({ company: "Grey Aesthetics", city: "Newport Beach" }),
    row({ company: "Gray Aesthetics", city: "Newport Beach" }),
  ];
  const { dupes, fresh } = splitDuplicates({ rows, cols: COLS, known: NO_KEYS });
  eq("in-file: a typo variant of an earlier row in the SAME file", dupes.map((d) => d.matchedOn), ["in_file"]);
  eq("in-file: the first spelling survives", fresh.map((f) => f.rowIndex), [0]);
}

{
  // allKeys hands the store CITIES, not name|city keys, or the fetch returns only exact matches.
  const rows = [
    row({ company: "Glow Bar", city: "Charlotte" }),
    row({ company: "Derma Luxe", city: "Charlotte" }),
    row({ company: "Skin Bar", city: "Miami" }),
  ];
  eq("allKeys: distinct cities for the name lookup", allKeys(rows, COLS).cities.sort(), ["charlotte", "miami"]);
}

console.log("\n" + passed + " passed, " + failures.length + " failed");
if (failures.length) for (const f of failures) console.log("  FAIL " + f);
process.exit(failures.length ? 1 : 0);
