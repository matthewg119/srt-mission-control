// Is the widget's hostname actually answering?
//
// ‼️ THIS EXISTS BECAUSE A CARD CLAIMED SOMETHING NOBODY HAD CHECKED. On 2026-09-04
// `concierge.srtagency.com` returned NXDOMAIN, no CONCIERGE_HOST was set in production, and so
// conciergeHostname() fell through to a constant naming a host that had never been attached to the
// project. Every `<script src="https://concierge.srtagency.com/embed.js">` in production pointed
// at nothing, on every hub page and on every replica, and the site_replica step card said "the
// assistant appears on every page above" the whole time.
//
// Nothing in the config row can tell you this. `concierge_configs.enabled` is a decision somebody
// made; a hostname resolving is a fact about the world, and the only honest way to learn it is to
// ask. So this asks, once, cheaply, and reports either way.
//
// ‼️ IT NEVER THROWS AND IT NEVER BLOCKS ANYTHING. A widget host that is briefly unreachable must
// not fail a delivery step or an artifact: the consequence of getting this wrong in the pessimistic
// direction is a scary line on a card, and in the optimistic direction it is a green tick over a
// dead widget in front of a prospect. The first is recoverable in ten seconds and the second is
// not, which is why the timeout is short and a timeout counts as unreachable.

import { conciergeHostname } from "./origin";

/** Short: this runs inside a step runner that has already spent its budget crawling their site. */
const TIMEOUT_MS = 6000;

export interface HostVerdict {
  ok: boolean;
  /** The hostname that was actually checked, so a card can name it rather than describe it. */
  host: string;
  /** A fragment that reads as the middle of a sentence: "`host` does not resolve". */
  detail: string;
}

/**
 * Whether the loader the embed tag names can actually be fetched.
 *
 * The loader rather than the frame, because `/embed.js` is what a third-party page requests first
 * and it needs no tenant to exist. A 200 here means every part of the chain up to the widget is
 * real: DNS, the certificate, the domain attachment and the route.
 */
export async function widgetHostReachable(): Promise<HostVerdict> {
  const host = conciergeHostname();

  try {
    const res = await fetch(`https://${host}/embed.js`, {
      method: "GET",
      redirect: "follow",
      signal: AbortSignal.timeout(TIMEOUT_MS),
      // The loader is cached hard at the edge; a stale 200 still proves the host answers.
      headers: { accept: "application/javascript,*/*" },
    });

    if (res.ok) return { ok: true, host, detail: "is answering" };

    // ‼️ A NON-200 IS NOT THE SAME FAILURE AS AN UNREACHABLE HOST AND MUST NOT READ AS ONE. This
    // is the host existing and refusing, which points at the route or at Deployment Protection,
    // not at DNS, and sending somebody to their registrar for it wastes an afternoon.
    return {
      ok: false,
      host,
      detail: `answered ${res.status} for /embed.js rather than serving the loader`,
    };
  } catch (e) {
    return { ok: false, host, detail: transportFailure(e, TIMEOUT_MS) };
  }
}

/**
 * Why a fetch threw, as the middle of a sentence: "`host` does not resolve, ...".
 *
 * ‼️ THE REASON IS IN `cause`, NOT IN `message`, AND READING ONLY THE MESSAGE LOSES IT.
 * Node's fetch collapses every transport failure into the string "fetch failed" and hangs the
 * real error off `cause`. Matching on the message alone reported a missing DNS record as
 * "could not be reached", which sends somebody to look at the route and at Deployment
 * Protection when the answer was that the hostname does not exist. Walk the chain instead.
 */
function transportFailure(e: unknown, timeoutMs: number): string {
  const parts: string[] = [];
  for (let err: unknown = e, hops = 0; err && hops < 4; hops++) {
    const o = err as { message?: string; code?: string; cause?: unknown };
    if (o.code) parts.push(o.code);
    if (o.message) parts.push(o.message);
    err = o.cause;
  }
  const message = parts.join(" ");
  const dns = /ENOTFOUND|EAI_AGAIN|getaddrinfo|ERR_NAME|NXDOMAIN/i.test(message);
  const timedOut = /abort|timeout|timed out|ETIMEDOUT/i.test(message);

  return dns
    ? "does not resolve, so there is no DNS record for it"
    : timedOut
      ? `did not answer within ${timeoutMs / 1000} seconds`
      : `could not be reached (${message.slice(0, 120)})`;
}

export type ProbeResult =
  | { ok: true; status: number }
  | { ok: false; status: number | null; detail: string };

/**
 * Did this exact URL answer 200, just now?
 *
 * For the links a step card hands a person (the step 20 demo link, the step 19 review tool), so a
 * card can print a link only after it was actually requested. Same never-throws rule as
 * widgetHostReachable above, and `detail` reads the same way: the middle of a sentence.
 *
 * ‼️ A REDIRECT OFF THE HOST WE ASKED IS A FAILURE, NOT A 200. Deployment Protection answers a
 * protected URL with a 302 to Vercel's login page, which then answers 200. Following that and
 * reporting success is the green tick over a dead link this file exists to prevent.
 *
 * ‼️ cache: "no-store" IS LOAD BEARING. Next patches fetch on the server and may answer a GET
 * from its data cache, and a cached 200 from last week says nothing about the link today.
 */
export async function probeUrl(url: string, timeoutMs: number = TIMEOUT_MS): Promise<ProbeResult> {
  let host: string;
  try {
    host = new URL(url).host.toLowerCase();
  } catch {
    return { ok: false, status: null, detail: "is not a valid URL" };
  }

  try {
    const res = await fetch(url, {
      method: "GET",
      redirect: "follow",
      cache: "no-store",
      signal: AbortSignal.timeout(timeoutMs),
      headers: { accept: "text/html,*/*" },
    });
    // The body is not read, so release the connection rather than leave it for the GC.
    await res.body?.cancel().catch(() => {});

    let landed = host;
    try {
      landed = new URL(res.url || url).host.toLowerCase();
    } catch {
      // No final URL to compare: judge on the status alone.
    }
    if (landed !== host) {
      return { ok: false, status: res.status, detail: `redirected to ${landed} instead of answering` };
    }
    if (res.status === 200) return { ok: true, status: 200 };
    return { ok: false, status: res.status, detail: `answered ${res.status}` };
  } catch (e) {
    return { ok: false, status: null, detail: transportFailure(e, timeoutMs) };
  }
}
