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
];

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
}

/** Does this record actually resolve to what we asked for? */
export async function checkRecord(
  def: DnsRecordDef,
  name: string,
  expected: string | null
): Promise<CheckResult> {
  if (!expected) return { status: "pending", observed: null };

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
      // Only the verification-shaped records, so a card is not filled with the client's
      // SPF and DKIM strings.
      observed: found.filter((f) => /verification|verify|=/.test(f)).slice(0, 4).join(" | ") || null,
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
