// Does this domain accept mail at all.
//
// Replaces the Python's dnspython step. Node's resolver is the fast path; Cloudflare DoH is the
// fallback, and the SPLIT between them is the whole point of this file.
//
// ‼️ "COULD NOT LOOK" AND "NOTHING IS THERE" ARE DIFFERENT ANSWERS AND THIS IS THE ONE STEP THAT
// CAN CONFUSE THEM AT SCALE. The Python caught bare `Exception` and recorded every failure as
// no_mx, so a resolver hiccup on a lambda cold start junks a batch of perfectly good leads and the
// only trace is a slightly smaller clean.csv. Here NXDOMAIN and NODATA are real answers and mean
// no; anything else (SERVFAIL, ETIMEOUT, ECONNREFUSED, EAI_AGAIN) is a failure to ask, and it goes
// to DoH before anyone is allowed to say no. A domain that neither path could resolve returns null
// and is left PENDING in the database rather than junked, so the next tick asks again.
//
// Same doctrine as `dns-records.ts`: an absent answer from a broken resolver is never stored.

import dns from "dns/promises";
import { getOrFetch, cacheKeyOf } from "@/lib/data/dataset-cache";
// The one MX-provider classifier in the repo. Do not write a second.
import { detectMailProvider } from "@/lib/clients/site-intel";

/** true = has MX, false = definitively does not, null = could not determine, ask again later. */
export type MxVerdict = boolean | null;

/**
 * Exchange hostnames for a domain, lowercased, trailing dot stripped, priority order preserved.
 *
 * An EMPTY LIST is a definitive "this domain accepts no mail". `null` anywhere this appears is
 * "could not determine", exactly as before.
 */
export type MxExchanges = string[];

/** Node renders the root exchange as "" or "."; both mean RFC 7505 null MX. */
function isNullMxHosts(hosts: string[]): boolean {
  if (hosts.length !== 1) return false;
  const h = hosts[0].trim();
  return h === "" || h === ".";
}

function normalizeExchanges(hosts: string[]): MxExchanges {
  return hosts
    .map((h) => h.trim().toLowerCase().replace(/\.$/, ""))
    .filter((h) => h.length > 0);
}

const DNS_TIMEOUT_MS = 4000; // DNS_TIMEOUT_S = 4 in the Python.
const DOH_TIMEOUT_MS = 5000;

/** Codes that are a real, authoritative "this domain has no mail exchanger". */
const DEFINITIVE_NO = new Set(["ENOTFOUND", "ENODATA", "NXDOMAIN"]);


function errCode(e: unknown): string {
  const code = (e as { code?: unknown } | null)?.code;
  return typeof code === "string" ? code : "";
}

async function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      p,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          const e = new Error(`${label} timed out`) as Error & { code?: string };
          e.code = "ETIMEOUT";
          reject(e);
        }, ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * DNS-over-HTTPS against Cloudflare. `fetch` is the one outbound primitive a serverless runtime is
 * guaranteed to have, so this works where UDP/53 does not.
 *
 * Status 3 is NXDOMAIN. Status 0 with no Answer of type 15 is NODATA. Both are real noes, and both
 * come back as an empty list. Anything else, including a non-200, is another failure to ask.
 */
async function mxViaDoh(domain: string): Promise<MxExchanges | null> {
  const url = `https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(domain)}&type=MX`;
  const res = await withTimeout(
    fetch(url, { headers: { accept: "application/dns-json" } }),
    DOH_TIMEOUT_MS,
    "doh"
  );
  if (!res.ok) return null;

  const body = (await res.json()) as { Status?: number; Answer?: Array<{ type?: number; data?: string }> };
  if (body.Status === 3) return [];
  if (body.Status !== 0) return null;

  // DoH returns MX rdata as "<priority> <exchange>", so a null MX arrives as "0 ." here.
  const mx = (body.Answer ?? []).filter((a) => a.type === 15);
  if (mx.length === 0) return [];
  const hosts = mx.map((a) => (a.data ?? "").trim().split(/\s+/).pop() ?? "");
  if (isNullMxHosts(hosts)) return [];
  return normalizeExchanges(hosts);
}

/**
 * Thrown to decline caching a verdict we never reached.
 *
 * ‼️ IT IS THIS FILE'S OWN DOCTRINE, MADE ENFORCEABLE. The header says an absent answer from a
 * broken resolver is never stored, and MxBatchResult says in words that "a null verdict means
 * undetermined; the caller must not store it as false". A cache that kept the null would be the
 * Python bug this file was written to replace, with a month-long memory.
 */
class MxUndetermined extends Error {
  constructor() {
    super("neither resolver answered");
    this.name = "MxUndetermined";
  }
}

/**
 * How long an MX verdict stays true.
 *
 * ‼️ FOURTEEN DAYS, AND THE NUMBER IS CHOSEN AGAINST THE FALSE, NOT THE TRUE. A true is nearly
 * permanent and could live forever. A false is the expensive direction: a domain that configures
 * mail tomorrow stays filtered out of every list until the entry expires, and the whole cost of
 * being wrong lands on a lead nobody ever sees. Two weeks bounds that while still collapsing the
 * case this exists for, which is the same domains reappearing across overlapping pulls.
 */
const MX_TTL_DAYS = 14;

/**
 * One domain's exchanges, through the cache. Prefer `resolveMxBatch`, which also memoizes per run.
 *
 * ‼️ THE CACHE KIND IS VERSIONED, AND SKIPPING THAT WOULD HAVE BEEN A FOURTEEN DAY OUTAGE. The old
 * entries under `dns.mx` are bare booleans. Reading one back as `{ exchanges }` gives `undefined`,
 * which is falsy, so EVERY DOMAIN ALREADY IN THE CACHE would have answered "no MX" until its TTL
 * expired. Before the free pre-filter that would merely have mislabelled rows; after it, a false
 * no-MX DROPS a deliverable address before anything can correct it. A new kind costs one free
 * re-lookup per domain and re-asks the cached falses, which the TTL comment above calls the
 * expensive direction anyway.
 *
 * client_id is null because whether a domain accepts mail is a fact about the domain.
 */
export async function mxRecords(domain: string): Promise<MxExchanges | null> {
  try {
    const { payload } = await getOrFetch<{ exchanges: MxExchanges }>({
      clientId: null,
      kind: "dns.mx.v2",
      cacheKey: cacheKeyOf({ domain }),
      ttlDays: MX_TTL_DAYS,
      provider: "node dns + cloudflare dns-over-https",
      params: { domain },
      // Both roads are free, so this zero is a measurement. What it saves is twenty thousand
      // lookups on the next overlapping pull.
      fetch: async () => ({ payload: { exchanges: await readMx(domain) }, costUsd: 0 }),
    });
    return payload?.exchanges ?? null;
  } catch (e) {
    // Neither resolver answered. Undetermined, which is this file's whole point.
    if (e instanceof MxUndetermined) return null;
    // ‼️ ANYTHING ELSE IS THE CACHE FAILING, NOT DNS. The verdict is null either way so nothing is
    // mis-stored, but the header of this file says "could not look" and "nothing is there" must
    // never be confused, and a database outage counted silently into `undetermined` makes a sweep
    // look like a DNS problem for as long as it lasts.
    console.error(`[mx] verdict failed below the door: ${(e as Error).message}`);
    return null;
  }
}

/**
 * Does this domain accept mail at all.
 *
 * ‼️ DERIVED, NOT STORED SEPARATELY. "Has MX" and "which provider" are two readings of one answer,
 * and two cache entries could disagree across a TTL boundary: the filter would drop a domain the
 * router had just classified as Microsoft 365. One source, two accessors.
 */
export async function hasMx(domain: string): Promise<MxVerdict> {
  const records = await mxRecords(domain);
  if (records === null) return null;
  return records.length > 0;
}

/**
 * Which mail provider runs this domain, or null when it cannot be told.
 *
 * ‼️ THIS IS THE WHOLE ARGUMENT FOR MX ROUTING AND IT IS A PROPERTY OF THE RECEIVING SERVER, NOT OF
 * A VERIFIER. Measured over all 561 US domains in the Apollo list on 2026-09-25: Microsoft 365
 * returns a decisive verdict 93% of the time (163 valid, 12 catch-all, 6 invalid of 181), so
 * guessing an address there is cheap and safe. Google Workspace is catch-all HALF the time (133 of
 * 268), so a permutation is unresolvable and must never be sent. Nothing that speaks SMTP can beat
 * that, because the server is answering yes to everything on purpose.
 *
 * `detectMailProvider` is reused rather than reimplemented: it already covers Google, Microsoft,
 * Zoho, GoDaddy, Fastmail, Proofpoint, Mimecast, ImprovMX and Namecheap, and it splits each entry
 * on whitespace and takes the last token, so bare hostnames work unchanged.
 */
export async function mailProviderOf(domain: string): Promise<string | null> {
  const records = await mxRecords(domain);
  if (!records || !records.length) return null;
  return detectMailProvider(records);
}

/**
 * The lookup itself. Throws rather than returning null, so an undetermined verdict is not kept.
 *
 * A resolver that answers "no MX but the domain exists" is deliberately an empty list here, matching
 * the Python. Mail can technically fall back to the A record, but a business domain with no MX is
 * not one that reads email, and this list is paid for per address downstream.
 */
async function readMx(domain: string): Promise<MxExchanges> {
  try {
    const answers = await withTimeout(dns.resolveMx(domain), DNS_TIMEOUT_MS, "resolveMx");
    const hosts = answers
      .slice()
      .sort((a, b) => (a.priority ?? 0) - (b.priority ?? 0))
      .map((a) => a.exchange ?? "");
    if (isNullMxHosts(hosts)) return [];
    return normalizeExchanges(hosts);
  } catch (e) {
    if (DEFINITIVE_NO.has(errCode(e))) return [];
    // Everything else is "we could not ask". Try the other road before saying no.
    let viaDoh: MxExchanges | null;
    try {
      viaDoh = await mxViaDoh(domain);
    } catch {
      throw new MxUndetermined();
    }
    if (viaDoh === null) throw new MxUndetermined();
    return viaDoh;
  }
}

export interface MxBatchResult {
  /** domain -> verdict. A null verdict means undetermined; the caller must not store it as false. */
  verdicts: Map<string, MxVerdict>;
  resolved: number;
  undetermined: number;
}

/**
 * Resolve many domains with bounded concurrency and a per-run memo.
 *
 * The memo is why a 20k-row pull is affordable: an Apollo export averages several contacts per
 * company, so the unique-domain count is a fraction of the row count and the same domain is never
 * asked twice in one batch.
 */
export async function resolveMxBatch(
  domains: Iterable<string>,
  opts: { concurrency?: number; deadline?: number } = {}
): Promise<MxBatchResult> {
  const concurrency = opts.concurrency ?? 25;
  const queue = Array.from(new Set(domains));
  const verdicts = new Map<string, MxVerdict>();

  let cursor = 0;
  async function worker(): Promise<void> {
    for (;;) {
      // A deadline stops the sweep cleanly mid-list rather than letting the function be killed:
      // whatever resolved is written, and the rest stays pending for the next tick.
      if (opts.deadline && Date.now() > opts.deadline) return;
      const i = cursor++;
      if (i >= queue.length) return;
      const domain = queue[i];
      try {
        verdicts.set(domain, await hasMx(domain));
      } catch {
        verdicts.set(domain, null);
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, queue.length) }, () => worker()));

  let undetermined = 0;
  for (const v of verdicts.values()) if (v === null) undetermined++;

  return { verdicts, resolved: verdicts.size - undetermined, undetermined };
}
