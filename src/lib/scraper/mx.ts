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

/** true = has MX, false = definitively does not, null = could not determine, ask again later. */
export type MxVerdict = boolean | null;

const DNS_TIMEOUT_MS = 4000; // DNS_TIMEOUT_S = 4 in the Python.
const DOH_TIMEOUT_MS = 5000;

/** Codes that are a real, authoritative "this domain has no mail exchanger". */
const DEFINITIVE_NO = new Set(["ENOTFOUND", "ENODATA", "NXDOMAIN"]);

/**
 * RFC 7505 "null MX": a single record whose exchange is the root, published to say THIS DOMAIN
 * ACCEPTS NO MAIL, deliberately and in writing.
 *
 * ‼️ COUNTING RECORDS IS NOT ENOUGH, AND example.com IS THE PROOF. The Python asked
 * `len(answers) > 0` and a null MX is one answer, so the strongest possible "do not email us"
 * signal on the internet reads as "has a mail server". Parked domains and holding companies
 * publish these, which is exactly the population an Apollo pull is full of, and every one of them
 * would survive the filter and then be paid for at MillionVerifier.
 *
 * Node renders the root exchange as "" or "."; both are checked.
 */
function isNullMx(answers: Array<{ exchange?: string }>): boolean {
  if (answers.length !== 1) return false;
  const exchange = (answers[0].exchange ?? "").trim();
  return exchange === "" || exchange === ".";
}

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
 * guaranteed to have, so this works in environments where UDP/53 does not.
 *
 * Status 3 is NXDOMAIN. Status 0 with no Answer of type 15 is NODATA. Both are real noes. Anything
 * else, including a non-200, is another failure to ask.
 */
async function mxViaDoh(domain: string): Promise<MxVerdict> {
  const url = `https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(domain)}&type=MX`;
  const res = await withTimeout(
    fetch(url, { headers: { accept: "application/dns-json" } }),
    DOH_TIMEOUT_MS,
    "doh"
  );
  if (!res.ok) return null;

  const body = (await res.json()) as { Status?: number; Answer?: Array<{ type?: number; data?: string }> };
  if (body.Status === 3) return false;
  if (body.Status !== 0) return null;

  // DoH returns MX rdata as "<priority> <exchange>", so a null MX arrives as "0 ." here.
  const mx = (body.Answer ?? []).filter((a) => a.type === 15);
  if (mx.length === 0) return false;
  if (mx.length === 1) {
    const exchange = (mx[0].data ?? "").trim().split(/\s+/).pop() ?? "";
    if (exchange === "." || exchange === "") return false;
  }
  return true;
}

/**
 * One domain, uncached. Prefer `resolveMxBatch`, which memoizes.
 *
 * A resolver that answers "no MX but the domain exists" is deliberately a NO here, matching the
 * Python. Mail can technically fall back to the A record, but a business domain with no MX is not
 * one that reads email, and this list is being paid for per address downstream.
 */
export async function hasMx(domain: string): Promise<MxVerdict> {
  try {
    const answers = await withTimeout(dns.resolveMx(domain), DNS_TIMEOUT_MS, "resolveMx");
    if (isNullMx(answers)) return false;
    return answers.length > 0;
  } catch (e) {
    if (DEFINITIVE_NO.has(errCode(e))) return false;
    // Everything else is "we could not ask". Try the other road before saying no.
    try {
      return await mxViaDoh(domain);
    } catch {
      return null;
    }
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
