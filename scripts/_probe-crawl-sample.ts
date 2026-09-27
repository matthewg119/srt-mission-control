// Measure the crawl: what the owner-name and email scrapers actually find on 60 live med spa sites.
//
//   bun run --env-file=.env.local scripts/_probe-crawl-sample.ts            measure the frozen sample
//   bun run --env-file=.env.local scripts/_probe-crawl-sample.ts --pick     choose the 60 and write them
//   bun run --env-file=.env.local scripts/_probe-crawl-sample.ts --limit 10 a quick smoke run
//
// THE OLD MATCHER AND THE NEW ONE RUN OVER THE SAME HTML, IN ONE PASS. The "before" numbers recorded
// in docs/prompts/2026-09-25-lead-engine-three-front-doors.md came from a sample whose 60 ids were
// never written down, so a fresh sample measured today is NOT comparable to them: any difference
// could be the change, or could be the sites. Reproducing the pre-fix matcher here as LEGACY_* and
// running both over one fetch makes the comparison PAIRED, which is the only version of this
// measurement that means anything. The legacy copies below are a measuring instrument and must never
// be imported by anything under src/.
//
// IT DOES NOT REPORT PRECISION. "Genuinely a person" was inspected by hand, and a script claiming
// that number would be inventing it. The per-site table at the bottom exists so the inspection is a
// 60 row read rather than 60 fetches.

import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { supabaseAdmin } from "@/lib/db";
import {
  EMAIL_TIER,
  emailTier,
  extractEmails,
  pickBestEmail,
  type EmailCandidate,
} from "@/lib/email-scrape";
import {
  NAME_SCORE_CEILING,
  bestNameScore,
  collectNames,
  fetchPage,
  pickOwnerName,
  textFromHtml,
  type NameCandidate,
} from "@/lib/medspa-owner-scrape";

const SAMPLE_FILE = "docs/2026-09-25-crawl-sample.txt";
const SAMPLE_SIZE = 60;
const CONCURRENCY = 6;

const ABOUT_PATHS = ["", "/about", "/about-us", "/our-team", "/team", "/meet-the-team", "/staff"];
const CONTACT_PATHS = ["", "/contact", "/contact-us", "/about", "/about-us", "/team", "/staff"];
const UNION_PATHS = [
  "", "/contact", "/contact-us", "/about", "/about-us", "/our-team", "/team", "/meet-the-team", "/staff",
];

// String.raw, because a plain "..." or `...` turns \s into a bare s and this regex then
// matches the LETTER s. That is exactly how this harness first reported 0 legacy names out of 60.
const LEGACY_NAME = String.raw`(?:Dr\.?\s+)?([A-Z][a-z]+(?:\s+[A-Z]\.)?\s+[A-Z][a-z]+)`;
const LEGACY_CUE_PATTERNS = [
  new RegExp(`(?:owner|founder|co-?founder|owned by|founded by|CEO|medical director)[^.<>]{0,40}?${LEGACY_NAME}`, "i"),
  new RegExp(String.raw`${LEGACY_NAME}[^.<>]{0,25}?(?:,?\s*(?:owner|founder|co-?founder|owned by|founded by|CEO|medical director))`, "i"),
];

/** The pre-fix findName, verbatim. */
function LEGACY_findName(text: string): string | null {
  for (const re of LEGACY_CUE_PATTERNS) {
    const m = text.match(re);
    if (m && m[1]) {
      const name = m[1].trim();
      if (/^[A-Z][a-z]+(\s+[A-Z]\.)?\s+[A-Z][a-z]+$/.test(name)) return name;
    }
  }
  return null;
}

const LEGACY_ROLE_LOCAL_PARTS = new Set([
  "info", "contact", "hello", "office", "frontdesk", "admin", "appointments",
  "support", "hi", "team", "care", "reception", "scheduling", "clinic", "help",
]);
const LEGACY_WEBMAIL = new Set([
  "gmail.com", "yahoo.com", "outlook.com", "hotmail.com", "aol.com", "icloud.com",
  "me.com", "live.com", "msn.com", "comcast.net", "att.net", "verizon.net", "sbcglobal.net",
  "protonmail.com", "proton.me", "ymail.com", "googlemail.com", "mac.com", "mail.com",
]);

const localOf = (e: string) => e.slice(0, e.indexOf("@"));
const domainOf = (e: string) => e.slice(e.lastIndexOf("@") + 1).toLowerCase();
function registrable(host: string): string {
  const labels = host.toLowerCase().replace(/^www\./, "").split(".");
  return labels.length <= 2 ? labels.join(".") : labels.slice(-2).join(".");
}

/** The pre-fix pickBestEmail tierOf, verbatim: same-domain ROLE first. */
function LEGACY_tier(c: EmailCandidate, siteDomain: string): number {
  const domain = domainOf(c.email);
  const same = registrable(domain) === siteDomain;
  const isRole = LEGACY_ROLE_LOCAL_PARTS.has(localOf(c.email));
  if (same) return isRole ? 1 : 2;
  if (LEGACY_WEBMAIL.has(domain)) return 3;
  if (isRole && c.viaMailto) return 4;
  return 99;
}

function LEGACY_pick(cands: EmailCandidate[], siteDomain: string): string | null {
  const ranked = cands
    .map((c) => ({ c, tier: LEGACY_tier(c, siteDomain) }))
    .filter((r) => r.tier < 99)
    .sort(
      (a, b) =>
        a.tier - b.tier ||
        b.c.count - a.c.count ||
        Number(b.c.viaMailto) - Number(a.c.viaMailto) ||
        a.c.email.length - b.c.email.length
    );
  return ranked.length ? ranked[0].c.email : null;
}

interface SampleRow {
  id: string;
  website: string;
}

/**
 * Deterministic, and frozen to a file the operator commits.
 *
 * A RE-DERIVED SAMPLE IS A DIFFERENT SAMPLE. med_spa_leads was 439 rows on 2026-09-25 and grows with
 * every pull, so "a spread of 60" computed next month is 60 other clinics and the before/after
 * comparison silently becomes a comparison of two populations. Ordering by a hash of the id is stable
 * against inserts; writing the ids down is what makes it stable against everything else.
 */
async function chooseSample(): Promise<SampleRow[]> {
  const { data, error } = await supabaseAdmin
    .from("med_spa_leads")
    .select("id, website")
    .not("website", "is", null)
    .neq("website", "");
  if (error) throw new Error("reading med_spa_leads failed: " + error.message);
  const rows = (data ?? []).map((r) => ({ id: String(r.id), website: String(r.website) }));
  return rows
    .map((r) => ({ r, h: createHash("md5").update(r.id).digest("hex") }))
    .sort((a, b) => (a.h < b.h ? -1 : a.h > b.h ? 1 : 0))
    .slice(0, SAMPLE_SIZE)
    .map((x) => x.r);
}

function loadFrozen(): SampleRow[] | null {
  if (!existsSync(SAMPLE_FILE)) return null;
  const rows: SampleRow[] = [];
  for (const line of readFileSync(SAMPLE_FILE, "utf8").split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const parts = t.split(/\s+/);
    if (parts.length >= 2) rows.push({ id: parts[0], website: parts[1] });
  }
  return rows.length ? rows : null;
}

interface SiteResult {
  website: string;
  host: string;
  reachable: boolean;
  pagesFetched: number;
  /** What the merged one-pass crawl would fetch, with its early exit. */
  simMerged: number;
  /** What the two old passes would fetch, each with its own early exit. */
  simLegacy: number;
  newName: string | null;
  legacyName: string | null;
  newEmail: string | null;
  newTier: number | null;
  legacyEmail: string | null;
}

function poolOver(html: Map<string, string>, paths: string[]): EmailCandidate[] {
  const pool = new Map<string, EmailCandidate>();
  for (const p of paths) {
    const h = html.get(p);
    if (!h) continue;
    for (const f of extractEmails(h)) {
      const existing = pool.get(f.email);
      if (existing) {
        existing.count++;
        existing.viaMailto = existing.viaMailto || f.viaMailto;
      } else pool.set(f.email, { ...f, path: p, count: 1 });
    }
  }
  return [...pool.values()];
}

/** Old scrapeOwnerName (stops on any name) plus old scrapeEmail (stops on a same-domain role). */
function simulateLegacyPages(
  text: Map<string, string>,
  html: Map<string, string>,
  siteDomain: string
): number {
  let pages = 0;
  for (const p of ABOUT_PATHS) {
    pages++;
    const t = text.get(p);
    if (t && LEGACY_findName(t)) break;
  }
  const pool = new Map<string, EmailCandidate>();
  for (const p of CONTACT_PATHS) {
    pages++;
    const h = html.get(p);
    if (h) for (const f of extractEmails(h)) if (!pool.has(f.email)) pool.set(f.email, { ...f, path: p, count: 1 });
    if ([...pool.values()].some((c) => LEGACY_tier(c, siteDomain) === 1)) break;
  }
  return pages;
}

/** One walk over the union, stopping only when a tier-1 email and a ceiling name are both held. */
function simulateMergedPages(
  text: Map<string, string>,
  html: Map<string, string>,
  siteDomain: string
): number {
  let pages = 0;
  const pool = new Map<string, EmailCandidate>();
  const names: NameCandidate[] = [];
  for (const p of UNION_PATHS) {
    pages++;
    const h = html.get(p);
    const t = text.get(p);
    if (h) for (const f of extractEmails(h)) if (!pool.has(f.email)) pool.set(f.email, { ...f, path: p, count: 1 });
    if (t) names.push(...collectNames(t, p));
    const bestName = pickOwnerName(names);
    const emailDone = [...pool.values()].some((c) => emailTier(c, siteDomain, bestName) === EMAIL_TIER.OWNER);
    if (emailDone && bestNameScore(names) >= NAME_SCORE_CEILING) break;
  }
  return pages;
}

async function measureSite(website: string): Promise<SiteResult> {
  const raw = website.replace(/%3F/gi, "?").replace(/%26/gi, "&").replace(/%3D/gi, "=");
  const withProto = raw.startsWith("http") ? raw : `https://${raw}`;
  const base: SiteResult = {
    website, host: "", reachable: false, pagesFetched: 0, simMerged: 0, simLegacy: 0,
    newName: null, legacyName: null, newEmail: null, newTier: null, legacyEmail: null,
  };

  let origin: string;
  let path0: string;
  let siteDomain: string;
  try {
    const url = new URL(withProto);
    origin = url.origin;
    path0 = origin + url.pathname;
    siteDomain = registrable(url.hostname);
  } catch {
    return base;
  }
  base.host = siteDomain;

  // Every page fetched once. Both matchers then read the same bytes.
  const html = new Map<string, string>();
  for (const p of UNION_PATHS) {
    const res = await fetchPage(p ? `${origin}${p}` : path0, { timeoutMs: 6000 });
    base.pagesFetched++;
    if (res.ok) html.set(p, res.html);
  }
  base.reachable = html.size > 0;
  if (!base.reachable) return base;

  const text = new Map<string, string>();
  for (const [p, h] of html) text.set(p, textFromHtml(h));

  const allNames: NameCandidate[] = [];
  for (const p of UNION_PATHS) {
    const t = text.get(p);
    if (t) allNames.push(...collectNames(t, p));
  }
  base.newName = pickOwnerName(allNames);

  for (const p of ABOUT_PATHS) {
    const t = text.get(p);
    if (!t) continue;
    const n = LEGACY_findName(t);
    if (n) {
      base.legacyName = n;
      break;
    }
  }

  const unionPool = poolOver(html, UNION_PATHS);
  const newPick = pickBestEmail(unionPool, siteDomain, base.newName);
  base.newEmail = newPick?.email ?? null;
  const winner = newPick ? unionPool.find((c) => c.email === newPick.email) : undefined;
  base.newTier = winner ? emailTier(winner, siteDomain, base.newName) : null;
  base.legacyEmail = LEGACY_pick(poolOver(html, CONTACT_PATHS), siteDomain);

  base.simLegacy = simulateLegacyPages(text, html, siteDomain);
  base.simMerged = simulateMergedPages(text, html, siteDomain);
  return base;
}

function pct(n: number, of: number): string {
  return of ? String(Math.round((n / of) * 100)) + "%" : "0%";
}

function cell(count: number | string, percent: string): string {
  return (String(count).padStart(4) + "  " + percent.padEnd(5)).padEnd(19);
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const li = argv.indexOf("--limit");
  const limit = li >= 0 && argv[li + 1] ? Number(argv[li + 1]) : SAMPLE_SIZE;

  if (argv.includes("--pick")) {
    const chosen = await chooseSample();
    const body = [
      "# The frozen crawl sample, chosen 2026-09-25 by md5(id) order over every med_spa_leads row",
      "# carrying a website (425 of 439 at the time).",
      "#",
      "# DO NOT REGENERATE THIS FILE TO REFRESH IT. The whole point is that the same clinics are",
      "# measured before and after a change. A new sample is a new population, and the comparison",
      "# silently stops meaning anything.",
      "#",
      "# <med_spa_leads.id> <website>",
      ...chosen.map((r) => r.id + " " + r.website),
    ].join("\n");
    writeFileSync(SAMPLE_FILE, body + "\n");
    console.log("wrote " + chosen.length + " ids to " + SAMPLE_FILE);
    return;
  }

  const frozen = loadFrozen();
  if (!frozen) {
    console.log("No frozen sample at " + SAMPLE_FILE + ".");
    console.log("Run once with --pick, commit that file, then measure against it.");
    process.exit(1);
  }

  const sample = frozen.slice(0, limit);
  console.log("Measuring " + sample.length + " sites from " + SAMPLE_FILE + " ...");

  const started = Date.now();
  const results: SiteResult[] = [];
  for (let i = 0; i < sample.length; i += CONCURRENCY) {
    const slice = sample.slice(i, i + CONCURRENCY);
    results.push(...(await Promise.all(slice.map((r) => measureSite(r.website)))));
    process.stderr.write("  " + Math.min(i + CONCURRENCY, sample.length) + "/" + sample.length + "\r");
  }
  const wall = Math.round((Date.now() - started) / 1000);

  const n = results.length;
  const roleish = (e: string | null) => Boolean(e) && LEGACY_ROLE_LOCAL_PARTS.has(localOf(e as string));
  const newE = results.filter((r) => r.newEmail);
  const oldE = results.filter((r) => r.legacyEmail);
  const newN = results.filter((r) => r.newName);
  const oldN = results.filter((r) => r.legacyName);
  const owner = results.filter((r) => r.newTier === EMAIL_TIER.OWNER);
  const differs = results.filter((r) => r.newName !== r.legacyName);
  const legacyPages = results.reduce((a, r) => a + r.simLegacy, 0);
  const mergedPages = results.reduce((a, r) => a + r.simMerged, 0);

  const lines = [
    "```",
    "                            before            after",
    "EMAIL   any found          " + cell(oldE.length, pct(oldE.length, n)) + cell(newE.length, pct(newE.length, n)),
    "        role (info@ etc)   " + cell(oldE.filter((r) => roleish(r.legacyEmail)).length, pct(oldE.filter((r) => roleish(r.legacyEmail)).length, n)) + cell(newE.filter((r) => roleish(r.newEmail)).length, pct(newE.filter((r) => roleish(r.newEmail)).length, n)),
    "        non-role           " + cell(oldE.filter((r) => !roleish(r.legacyEmail)).length, pct(oldE.filter((r) => !roleish(r.legacyEmail)).length, n)) + cell(newE.filter((r) => !roleish(r.newEmail)).length, pct(newE.filter((r) => !roleish(r.newEmail)).length, n)),
    "        nothing            " + cell(n - oldE.length, pct(n - oldE.length, n)) + cell(n - newE.length, pct(n - newE.length, n)),
    "        tier 1, a person   " + cell("n/a", "") + cell(owner.length, pct(owner.length, n)),
    "",
    "NAME    scraper returned   " + cell(oldN.length, pct(oldN.length, n)) + cell(newN.length, pct(newN.length, n)),
    "        pick differs       " + cell("", "") + cell(differs.length, pct(differs.length, n)),
    "        genuinely a person   inspect the table below by hand. Not scripted, on purpose.",
    "",
    "FETCH   sites measured     " + n + "  (" + results.filter((r) => r.reachable).length + " reachable)",
    "        pages, two passes  " + legacyPages,
    "        pages, merged pass " + mergedPages + "  (" + pct(legacyPages - mergedPages, legacyPages) + " fewer)",
    "        wall seconds       " + wall + "  every page fetched with no early exit, so not a production number",
    "```",
  ];

  console.log("\n" + lines.join("\n") + "\n");

  console.log(
    "hostname".padEnd(33) + " | " + "name (new)".padEnd(20) + " | " + "name (old)".padEnd(20) +
    " | " + "email (new)".padEnd(28) + " | t | email (old)"
  );
  console.log("-".repeat(140));
  for (const r of results) {
    console.log(
      [
        (r.host || r.website).slice(0, 33).padEnd(33),
        (r.newName ?? "-").slice(0, 20).padEnd(20),
        (r.legacyName ?? "-").slice(0, 20).padEnd(20),
        (r.newEmail ?? "-").slice(0, 28).padEnd(28),
        String(r.newTier ?? "-"),
        r.legacyEmail ?? "-",
      ].join(" | ")
    );
  }
}

main().catch((e) => {
  console.error((e as Error).message);
  process.exit(1);
});
