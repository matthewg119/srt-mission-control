// The three DNS records, and whether they are actually live.
//
// THE RULE: 'verified' IS OBSERVED, NEVER ASSERTED. A human can say a record was added;
// only the resolver can say it resolves. Those are different facts and the gap between
// them is where a build quietly stalls, so `added` and `verified` are separate statuses
// and nothing but checkRecord() may write the second one.
//
// Three records: two CNAMEs and one TXT. Say it that way. "CNAME and TXT" reads as two,
// which is exactly where the count drifted before.
//
// All three go in live on the call even though the reviews host is not built yet. An
// unattached CNAME simply does not resolve and nobody visits it before the cards are
// printed; getting a client back into their registrar weeks later is worse than a record
// sitting idle for a fortnight.

import dns from "dns/promises";
import { supabaseAdmin } from "@/lib/db";

export type DnsStatus = "pending" | "ready" | "added" | "verified" | "mismatch";

export interface DnsRecordDef {
  key: string;
  type: "CNAME" | "TXT";
  label: string;
  /** The Host / Name box, given the client's chosen subdomain. LABEL ONLY. */
  host: (subdomain: string) => string;
  /** Why this record exists, in one line, for the card. */
  why: string;
  /** True when the value has to come from somewhere outside this system. */
  valueIsExternal?: boolean;
}

export const DNS_RECORDS: DnsRecordDef[] = [
  {
    key: "cname_hub",
    type: "CNAME",
    label: "CNAME, the answer hub",
    host: (sub) => sub,
    why: "Where every page we publish lives. Nothing we write is visible without it.",
  },
  {
    key: "cname_reviews",
    type: "CNAME",
    label: "CNAME, the review tool",
    host: () => "reviews",
    why: "The QR on the review cards points here. It goes in now so nobody has to go back into the registrar later.",
  },
  {
    key: "txt_verify",
    type: "TXT",
    // @ means the domain itself. Some registrars want the box left blank instead, which
    // is the same thing and confuses everybody once.
    host: () => "@",
    label: "TXT, Search Console",
    why: "Domain level verification, so Search Console covers the hub as well as the main site.",
    valueIsExternal: true,
  },
];

export function dnsRecordByKey(key: string): DnsRecordDef | undefined {
  return DNS_RECORDS.find((r) => r.key === key);
}

/** The fully qualified name, for the resolver and for reading aloud. Never for the form. */
export function fqdn(host: string, domain: string): string {
  return host === "@" ? domain : `${host}.${domain}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Who runs their DNS
// ─────────────────────────────────────────────────────────────────────────────
//
// Resolved from the nameservers rather than asked. "Who is your domain with" is a
// question plenty of owners genuinely cannot answer, and it is the first thing the call
// needs. The nameservers answer it for them.

const NS_PROVIDERS: Array<[RegExp, string]> = [
  [/domaincontrol\.com$/i, "GoDaddy"],
  [/registrar-servers\.com$/i, "Namecheap"],
  [/cloudflare\.com$/i, "Cloudflare"],
  [/squarespacedns\.com$/i, "Squarespace"],
  [/wixdns\.net$/i, "Wix"],
  [/googledomains\.com$/i, "Google Domains"],
  [/awsdns/i, "AWS Route 53"],
  [/name-services\.com$/i, "Network Solutions"],
  [/dnsimple\.com$/i, "DNSimple"],
  [/bluehost\.com$/i, "Bluehost"],
  [/hostgator\.com$/i, "HostGator"],
  [/shopify\.com$/i, "Shopify"],
  [/vercel-dns\.com$/i, "Vercel"],
  [/ui-dns\./i, "IONOS"],
  [/hover\.com$/i, "Hover"],
  [/gandi\.net$/i, "Gandi"],
  // Added 2026-08-19 for Runner v3 section 5, which names both and neither of which was here.
  // GoHighLevel matters disproportionately for this vertical: agencies park clinic domains on
  // it constantly, and the client usually does not know that is where their DNS lives.
  [/leadconnectorhq\.com$/i, "GoHighLevel"],
  [/msging\.net$/i, "GoHighLevel"],
  [/porkbun\.com$/i, "Porkbun"],
  [/withgoogle\.com$/i, "Google Domains"],
];

/**
 * The literal instruction printed on the call sheet, keyed by the SAME strings
 * resolveDnsProvider returns. Runner v3 section 5: "Maintain a lookup table keyed by DNS
 * provider giving the literal instruction printed on the call sheet."
 *
 * ‼️ NEVER "check your DNS settings". The whole point of resolving the provider before the call
 * is that the owner is told which website to open and which button to press, by name, while
 * somebody is on the phone with them. A generic instruction wastes the call, and the call is
 * the only time they will be sitting in front of their registrar.
 *
 * {domain} is substituted at print time. An unknown provider gets no entry and the call sheet
 * prints the nameservers instead, which is the honest answer rather than a guess.
 */
export const PROVIDER_CLICK_PATHS: Record<string, string> = {
  GoDaddy:
    "Open godaddy.com, sign in, My Products, find {domain}, click DNS, then Add New Record",
  Cloudflare:
    "Open dash.cloudflare.com, select {domain}, click DNS, then Add record. Set Proxy status to DNS only",
  Namecheap:
    "Open namecheap.com, Domain List, Manage next to {domain}, Advanced DNS, Add New Record",
  Squarespace:
    "Open account.squarespace.com, Domains, {domain}, DNS Settings, Add Record",
  "Google Domains":
    "Google Domains moved to Squarespace. Open account.squarespace.com, Domains, {domain}, DNS Settings, Add Record",
  Wix: "Open manage.wix.com, Domains, {domain}, Advanced, Edit DNS",
  "AWS Route 53":
    "Open console.aws.amazon.com/route53, Hosted zones, {domain}, Create record",
  "Network Solutions":
    "Open networksolutions.com, Account Manager, My Domain Names, {domain}, Manage, Change Where Domain Points, Advanced DNS",
  Bluehost: "Open bluehost.com, Domains, {domain}, DNS, Add Record",
  HostGator: "Open portal.hostgator.com, Domains, {domain}, Manage DNS, Add Record",
  Shopify: "Open admin.shopify.com, Settings, Domains, {domain}, Manage DNS settings, Add custom record",
  IONOS: "Open ionos.com, Domains and SSL, {domain}, DNS, Add Record",
  Hover: "Open hover.com, Domains, {domain}, DNS tab, Add A Record",
  Gandi: "Open admin.gandi.net, Domains, {domain}, DNS Records, Add",
  DNSimple: "Open dnsimple.com, Domains, {domain}, DNS, Manage records, Add record",
  GoHighLevel:
    "The DNS is on GoHighLevel, which usually means an agency set it up. Open app.gohighlevel.com, Settings, Domains, {domain}. If they cannot get in, whoever built their site holds this and we need that person on the call",
  Porkbun: "Open porkbun.com, Account, Domain Management, {domain}, DNS Records, Add",
  Vercel: "Open vercel.com, the project, Settings, Domains, {domain}",
};

/** The instruction for a provider, with {domain} filled in. Null when we do not know it. */
export function clickPathFor(provider: string | null, domain: string): string | null {
  if (!provider) return null;
  const path = PROVIDER_CLICK_PATHS[provider];
  return path ? path.replace(/\{domain\}/g, domain) : null;
}

export interface DnsProvider {
  provider: string | null;
  nameservers: string[];
}

/**
 * Look up who actually runs this domain's DNS.
 *
 * Returns provider null with the nameservers still populated when nothing matches, which
 * is a real and useful answer: the call checklist can then read the nameservers out and
 * let the owner recognise them, rather than claiming a registrar it guessed.
 */
export async function resolveDnsProvider(domain: string): Promise<DnsProvider> {
  let nameservers: string[] = [];
  try {
    nameservers = (await dns.resolveNs(domain)).map((n) => n.toLowerCase()).sort();
  } catch {
    return { provider: null, nameservers: [] };
  }

  for (const [pattern, name] of NS_PROVIDERS) {
    if (nameservers.some((ns) => pattern.test(ns))) return { provider: name, nameservers };
  }
  return { provider: null, nameservers };
}

// ─────────────────────────────────────────────────────────────────────────────
// Checking
// ─────────────────────────────────────────────────────────────────────────────

export interface CheckResult {
  /**
   * "not_found" is deliberately NOT a DnsStatus and is never stored. It means the
   * resolver got NXDOMAIN, which is the normal state of a record nobody has added yet
   * AND of one added ninety seconds ago. Writing it over what a human last said would
   * turn "they added it" into "wrong" while propagation is still in flight.
   */
  status: DnsStatus | "not_found";
  observed: string | null;
  /**
   * A value the RESOLVER taught us that nobody had typed in. Only ever set on the
   * external-TXT path, and recheckDnsRecords writes it only onto a row whose value is
   * still null. See checkExternalTxt for why that path exists at all.
   */
  learnedValue?: string | null;
}

/**
 * Search Console's own TXT, in the one shape we are willing to recognise without being told.
 * Narrow on purpose: this is a prefix match against a namespace Google owns, not a guess at
 * what a verification record looks like in general.
 */
const GOOGLE_VERIFY_PREFIX = "google-site-verification=";

/**
 * The verification-shaped answers only, so a card is not filled with the client's SPF and
 * DKIM strings. Shared by both TXT paths so the two cannot drift apart.
 */
function verificationDigest(found: string[]): string | null {
  return found.filter((f) => /verification|verify|=/.test(f)).slice(0, 4).join(" | ") || null;
}

/**
 * ‼️ THE TXT ROW OFTEN HAS NO EXPECTED VALUE, AND THAT IS THE NORMAL CASE, NOT A GAP.
 *
 * When the registrar is a Google partner (GoDaddy is), Search Console verifies through
 * "Domain name provider" and writes the TXT record ITSELF. Nobody ever sees the string, so
 * nobody ever pastes it into our panel, so `value` stays null. Before this, checkRecord
 * returned `pending` at its first line without issuing a query at all, and the row sat there
 * forever while verification had in fact succeeded weeks earlier. Nothing was visibly wrong,
 * which is what made it expensive: the Hub status strip simply never reached 3 of 3.
 *
 * So with nothing to compare against, the SHAPE is the evidence. A live
 * google-site-verification= record on the domain means Google verified it, which is the fact
 * the row was always trying to state.
 *
 * ‼️ AN ABSENT VERIFICATION RECORD IS `pending`, NEVER `mismatch`. Nothing was ever claimed for
 * this row, so there is nothing for the world to disagree with. Same doctrine as the not_found
 * rule one function down: say nothing rather than say something wrong.
 *
 * This is deliberately NOT extended to CNAMEs. There is no such thing as a correct-SHAPED
 * CNAME, only the specific per-domain target Vercel issued, so a CNAME with no stored target
 * stays pending and keeps its exact compare.
 */
async function checkExternalTxt(name: string): Promise<CheckResult> {
  try {
    const found = (await dns.resolveTxt(name)).map((chunks) => chunks.join(""));
    const hit = found
      .map((f) => f.trim())
      .find((f) => f.toLowerCase().startsWith(GOOGLE_VERIFY_PREFIX));

    return {
      status: hit ? "verified" : "pending",
      observed: verificationDigest(found),
      // Recorded so the next pass has something to compare against, and so the panel shows
      // what was actually seen rather than an empty Value box on a green row.
      learnedValue: hit ?? null,
    };
  } catch {
    return { status: "not_found", observed: null };
  }
}

/** Does this record actually resolve to what we asked for? */
export async function checkRecord(
  def: DnsRecordDef,
  name: string,
  expected: string | null
): Promise<CheckResult> {
  // No expected value. For a TXT that is the Search Console case above and there is real work
  // to do; for a CNAME there is nothing to check against and never will be.
  if (!expected) {
    if (def.type === "TXT") return checkExternalTxt(name);
    return { status: "pending", observed: null };
  }

  try {
    if (def.type === "CNAME") {
      const found = await dns.resolveCname(name);
      const norm = (v: string) => v.replace(/\.$/, "").toLowerCase();
      const hit = found.some((f) => norm(f) === norm(expected));
      return {
        status: hit ? "verified" : "mismatch",
        observed: found.join(", ") || null,
      };
    }

    // TXT answers arrive as arrays of chunks that have to be joined before comparing: a
    // long verification string is split at 255 characters by the protocol, and comparing
    // chunk by chunk would never match one.
    const found = (await dns.resolveTxt(name)).map((chunks) => chunks.join(""));
    const hit = found.some((f) => f.trim() === expected.trim());
    return {
      status: hit ? "verified" : "mismatch",
      observed: verificationDigest(found),
    };
  } catch {
    // Every resolver failure lands here as not_found. ENOTFOUND, ENODATA and a timeout
    // are all "we cannot see it yet" from the point of view of somebody who added a
    // record two minutes ago, and none of them is evidence it was entered wrong.
    return { status: "not_found", observed: null };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Rows
// ─────────────────────────────────────────────────────────────────────────────

export interface DnsRow {
  record_key: string;
  record_type: string;
  host: string;
  value: string | null;
  status: DnsStatus;
  observed: string | null;
  last_checked_at: string | null;
  verified_at: string | null;
}

/** The CNAME target every hub and review host points at. */
export function hubCnameTarget(): string {
  return process.env.HUB_CNAME_TARGET || "cname.vercel-dns.com";
}

/**
 * Create the three rows for a client, once their domain and subdomain are known.
 *
 * Idempotent: existing rows keep their value and status, so re-seeding after a subdomain
 * changes cannot wipe a verification somebody already got.
 */
export async function seedDnsRecords(clientId: string, subdomain: string): Promise<void> {
  const target = hubCnameTarget();
  const rows = DNS_RECORDS.map((def) => ({
    client_id: clientId,
    record_key: def.key,
    record_type: def.type,
    host: def.host(subdomain),
    // The TXT value comes from that client's own Search Console property, so there is
    // nothing to prefill and pretending otherwise would put a wrong string in front of
    // somebody about to paste it into a registrar.
    value: def.valueIsExternal ? null : target,
    status: def.valueIsExternal ? "pending" : "ready",
  }));

  const { error } = await supabaseAdmin
    .from("client_dns_records")
    .upsert(rows, { onConflict: "client_id,record_key", ignoreDuplicates: true });

  if (error) console.error("[dns-records] seed failed:", error.message);

  // ── Repair a host that no longer matches the convention ──
  //
  // ignoreDuplicates protects a value and a verification somebody already earned, which
  // is right. It also means a row written with the WRONG host keeps it forever, and rows
  // written before `clients.subdomain` became label-only hold a full host that resolves
  // to nothing. A host is not a fact worth preserving: it is derived from the convention,
  // and a stale one is what sends somebody back into a registrar.
  //
  // verified_at is cleared with it. A verification is a statement about a specific name,
  // so carrying it across a rename would assert that a host nobody has checked resolves.
  for (const row of rows) {
    await supabaseAdmin
      .from("client_dns_records")
      .update({
        host: row.host,
        // row.status, not a literal: the TXT record seeds `pending` because its value has
        // to come from the client's own Search Console, and resetting it to `ready` would
        // claim we had a string to give them.
        status: row.status,
        // row.value, for the same reason the host is repaired. Vercel issues a PER-DOMAIN
        // CNAME target, so a learn -> guide flip changes which hostname is attached and
        // therefore which target is correct. Leaving the old domain's target behind a
        // freshly reset `ready` label would hand the client a value that resolves to
        // nothing, on a row that looks ready to type. registerClientHosts() overwrites this
        // with the real target immediately after; the default is the honest placeholder in
        // the gap between them.
        value: row.value,
        verified_at: null,
        observed: null,
        note: null,
        updated_at: new Date().toISOString(),
      })
      .eq("client_id", clientId)
      .eq("record_key", row.record_key)
      .neq("host", row.host);
  }
}

export async function loadDnsRows(clientId: string): Promise<DnsRow[]> {
  const { data } = await supabaseAdmin
    .from("client_dns_records")
    .select("record_key, record_type, host, value, status, observed, last_checked_at, verified_at")
    .eq("client_id", clientId);

  const byKey = new Map((data ?? []).map((r) => [r.record_key as string, r as unknown as DnsRow]));
  // Ordered by DNS_RECORDS rather than by the database, so the card always reads
  // hub, reviews, TXT.
  return DNS_RECORDS.map((d) => byKey.get(d.key)).filter(Boolean) as DnsRow[];
}

/**
 * Re-check every record for one client and write what was actually seen.
 *
 * A record whose name does not resolve at all is left at whatever a human last said,
 * rather than being marked mismatch: propagation takes up to an hour and overwriting
 * "they added it" with "wrong" ninety seconds later is worse than saying nothing.
 */
export async function recheckDnsRecords(
  clientId: string,
  domain: string
): Promise<DnsRow[]> {
  const rows = await loadDnsRows(clientId);
  const now = new Date().toISOString();

  for (const row of rows) {
    const def = dnsRecordByKey(row.record_key);
    if (!def) continue;

    const result = await checkRecord(def, fqdn(row.host, domain), row.value);
    const resolved = result.status !== "not_found";

    const patch: Record<string, unknown> = {
      last_checked_at: now,
      observed: result.observed,
      updated_at: now,
    };
    if (resolved) {
      patch.status = result.status;
      patch.verified_at = result.status === "verified" ? now : null;
    }

    // Record a value the resolver taught us, and ONLY onto a row nobody has typed into.
    // Guarding on !row.value keeps a human-entered value authoritative: this may fill an
    // empty box, never correct a full one. Once written, the next pass takes the ordinary
    // exact-compare branch above and still verifies, because the stored string is literally
    // the one the resolver returned. The two paths agree by construction.
    if (result.learnedValue && !row.value) patch.value = result.learnedValue;

    await supabaseAdmin
      .from("client_dns_records")
      .update(patch)
      .eq("client_id", clientId)
      .eq("record_key", row.record_key);
  }

  return loadDnsRows(clientId);
}

/** All three verified. What the dns_records delivery step should actually mean. */
export function allVerified(rows: DnsRow[]): boolean {
  return rows.length === DNS_RECORDS.length && rows.every((r) => r.status === "verified");
}
