// Buying the client's domain, and pointing it at this deployment.
//
// ‼️ THIS IS THE ONLY CODE IN THIS REPOSITORY THAT SPENDS MONEY.
// Everything else here costs model tokens on an account somebody is already watching. This
// charges a card for a domain registration, which is non-refundable and, for a one-character
// typo, permanently non-refundable. Three rules follow from that and none of them is optional:
//
//   1. A LEDGER ROW IS WRITTEN BEFORE THE PURCHASE CALL, NOT AFTER.
//      A buy that succeeds at Vercel and fails to return to us (a timeout, a lambda killed
//      mid-flight) is indistinguishable from one that never happened, unless something recorded
//      the attempt first. Without the pre-write, the obvious repair -- press it again -- is a
//      second charge.
//   2. NOTHING HERE BUYS WITHOUT AN expectedPriceCents SUPPLIED BY THE CALLER.
//      It comes from the search the person actually looked at. A price that moved between
//      looking and buying is a refusal, not a surprise on the invoice.
//   3. IT IS NEVER CALLED BY A RUNNER, A CRON OR A RETRY. Only by a person pressing a button
//      that showed them the price.
//
// WHY VERCEL AND NOT A REGISTRAR. The domain lands in the same account that already serves every
// client hub, on Vercel's own nameservers, so attaching it is immediate: no CNAME for the client
// to add, no registrar login to collect, no propagation to wait out. The slowest step in the
// Slack lane (step 26, "three records added by the client") does not exist in this one.

import { supabaseAdmin } from "@/lib/db";
import { vercelConfig, attachHost, attachRedirectHost, type DomainState } from "@/lib/hub/vercel-domains";

const API = "https://api.vercel.com";

/**
 * Search and pricing are PUBLIC endpoints and take no token.
 *
 * Kept deliberately separate from the authenticated helpers below: looking up a price must work
 * on a deployment where HUB_VERCEL_TOKEN is missing or wrong, because "the search is broken" and
 * "we cannot buy" are different problems and the person needs to be told which one they have.
 */
export interface DomainCandidate {
  domain: string;
  available: boolean;
  /** USD cents for the first registration period. Null when Vercel priced nothing. */
  priceCents: number | null;
  renewalCents: number | null;
}

/** Vercel returns prices as USD numbers. Money is carried as integer cents from here on. */
function toCents(v: unknown): number | null {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n * 100);
}

function readCandidate(raw: Record<string, unknown>, fallbackDomain: string): DomainCandidate {
  // The response shape has moved once already (the legacy /v4 endpoints were sunset in favour of
  // /v1/registrar), so each field is read from the spellings actually observed rather than from
  // one assumed name. An unknown shape reads as "no price", never as free.
  const price = raw.price ?? raw.registrationPrice ?? (raw.pricing as Record<string, unknown> | undefined)?.registration;
  const renewal = raw.renewalPrice ?? (raw.pricing as Record<string, unknown> | undefined)?.renewal;
  return {
    domain: (raw.name as string) ?? (raw.domain as string) ?? fallbackDomain,
    available: raw.available === true,
    priceCents: toCents(price),
    renewalCents: toCents(renewal),
  };
}

/**
 * Availability and price for up to 200 exact names, in one round trip.
 *
 * It checks the names given. It does not generate suggestions, so the caller builds the list.
 */
export async function searchDomains(
  domains: string[]
): Promise<{ ok: true; results: DomainCandidate[] } | { ok: false; error: string }> {
  const names = domains
    .map((d) => d.trim().toLowerCase())
    .filter(Boolean)
    .slice(0, 200);

  if (names.length === 0) return { ok: false, error: "No domains to search for." };

  let res: Response;
  try {
    res = await fetch(`${API}/v1/registrar/domains/search`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ domains: names }),
      cache: "no-store",
      signal: AbortSignal.timeout(15_000),
    });
  } catch (e) {
    return { ok: false, error: `The domain search could not be reached: ${(e as Error).message}` };
  }

  if (!res.ok) {
    return { ok: false, error: `The domain search answered ${res.status}.` };
  }

  let body: unknown;
  try {
    body = await res.json();
  } catch {
    return { ok: false, error: "The domain search returned something that was not JSON." };
  }

  const rows = Array.isArray(body)
    ? body
    : Array.isArray((body as Record<string, unknown>)?.domains)
      ? ((body as Record<string, unknown>).domains as unknown[])
      : Array.isArray((body as Record<string, unknown>)?.results)
        ? ((body as Record<string, unknown>).results as unknown[])
        : null;

  if (!rows) return { ok: false, error: "The domain search returned a shape this code does not recognise." };

  // Results come back in input order, so a row with no name of its own still knows what it is.
  return { ok: true, results: rows.map((r, i) => readCandidate((r ?? {}) as Record<string, unknown>, names[i] ?? "")) };
}

/**
 * The registrant contact, as one JSON environment variable.
 *
 * ‼️ ONE VARIABLE RATHER THAN NINE. A registrant contact is a fixed block of about a dozen
 * fields that are always set together and are meaningless apart, and this repo has already
 * measured what happens when environment variables are added one at a time: `vercel env add`
 * from stdin writes an EMPTY value, and a `sensitive` variable reads back as "" whether it is
 * empty or merely unreadable. Nine chances to half-configure a purchase is nine too many. It is
 * validated as a whole, here, before any money moves.
 */
export interface RegistrantContact {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  address1: string;
  city: string;
  state: string;
  zip: string;
  country: string;
  companyName?: string;
}

const REQUIRED_CONTACT_FIELDS: (keyof RegistrantContact)[] = [
  "firstName",
  "lastName",
  "email",
  "phone",
  "address1",
  "city",
  "state",
  "zip",
  "country",
];

export function registrantContact(): { ok: true; contact: RegistrantContact } | { ok: false; error: string } {
  const raw = process.env.VERCEL_REGISTRAR_CONTACT;
  if (!raw?.trim()) {
    return {
      ok: false,
      error:
        "VERCEL_REGISTRAR_CONTACT is not set. It is one JSON object holding the registrant " +
        `contact: ${REQUIRED_CONTACT_FIELDS.join(", ")}, plus an optional companyName.`,
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ok: false, error: "VERCEL_REGISTRAR_CONTACT is set but is not valid JSON." };
  }

  const c = (parsed ?? {}) as Record<string, unknown>;
  const missing = REQUIRED_CONTACT_FIELDS.filter(
    (f) => typeof c[f] !== "string" || !(c[f] as string).trim()
  );
  if (missing.length) {
    return { ok: false, error: `VERCEL_REGISTRAR_CONTACT is missing: ${missing.join(", ")}.` };
  }

  return { ok: true, contact: parsed as RegistrantContact };
}

export interface BuyOutcome {
  ok: boolean;
  domain: string;
  orderId?: string;
  chargedCents?: number | null;
  error?: string;
}

/**
 * Buy one domain for one client.
 *
 * The caller supplies the price it showed the person. This refuses rather than buying at a
 * different one.
 */
export async function buyDomain(args: {
  clientId: string;
  domain: string;
  years?: number;
  /** What the person was shown, in cents, from searchDomains(). */
  expectedPriceCents: number;
  by: string;
}): Promise<BuyOutcome> {
  const domain = args.domain.trim().toLowerCase();
  const years = Math.max(1, Math.min(10, args.years ?? 1));

  if (!/^[a-z0-9][a-z0-9-]*(\.[a-z0-9][a-z0-9-]*)+$/.test(domain)) {
    return { ok: false, domain, error: `"${domain}" is not a domain name.` };
  }
  if (!Number.isInteger(args.expectedPriceCents) || args.expectedPriceCents <= 0) {
    return {
      ok: false,
      domain,
      error: "No price was supplied. A purchase may only be made at a price somebody was shown.",
    };
  }

  const cfg = vercelConfig();
  if (!cfg) return { ok: false, domain, error: "HUB_VERCEL_TOKEN or HUB_VERCEL_PROJECT_ID is not set." };

  const contact = registrantContact();
  if (!contact.ok) return { ok: false, domain, error: contact.error };

  // ‼️ HAS THIS DOMAIN ALREADY BEEN BOUGHT? The partial unique index on (lower(domain)) where
  // status <> 'failed' makes the pre-write below fail on a duplicate, but a clear answer here is
  // worth more than a constraint violation surfaced through PostgREST.
  const { data: prior } = await supabaseAdmin
    .from("client_domain_orders")
    .select("id, client_id, status")
    .eq("domain", domain)
    .neq("status", "failed")
    .maybeSingle();

  if (prior) {
    return {
      ok: false,
      domain,
      error:
        prior.client_id === args.clientId
          ? `${domain} already has an order on this client (${prior.status as string}). It will not be bought twice.`
          : `${domain} is already ordered for a different client. Check before buying.`,
    };
  }

  // ── 1. The ledger row, BEFORE the money moves ──────────────────────────────
  const { data: order, error: orderErr } = await supabaseAdmin
    .from("client_domain_orders")
    .insert({
      client_id: args.clientId,
      domain,
      years,
      auto_renew: true,
      expected_price_cents: args.expectedPriceCents,
      status: "requested",
      requested_by: args.by,
    })
    .select("id")
    .maybeSingle();

  if (orderErr || !order) {
    return {
      ok: false,
      domain,
      error: `The order could not be recorded, so nothing was bought: ${orderErr?.message ?? "no row returned"}`,
    };
  }
  const orderId = order.id as string;

  const fail = async (message: string): Promise<BuyOutcome> => {
    await supabaseAdmin
      .from("client_domain_orders")
      .update({ status: "failed", vercel_error: message.slice(0, 1000), completed_at: new Date().toISOString() })
      .eq("id", orderId);
    return { ok: false, domain, orderId, error: message };
  };

  // ── 2. The purchase ────────────────────────────────────────────────────────
  const url = new URL(`/v1/registrar/domains/${encodeURIComponent(domain)}/buy`, API);
  if (cfg.teamId) url.searchParams.set("teamId", cfg.teamId);

  let res: Response;
  try {
    res = await fetch(url.toString(), {
      method: "POST",
      headers: { Authorization: `Bearer ${cfg.token}`, "content-type": "application/json" },
      body: JSON.stringify({
        years,
        autoRenew: true,
        expectedPrice: args.expectedPriceCents / 100,
        contact: contact.contact,
      }),
      cache: "no-store",
      // ‼️ NO TIMEOUT SIGNAL, DELIBERATELY, AND IT IS THE OPPOSITE CHOICE FROM EVERY OTHER FETCH
      // HERE. Aborting a purchase does not cancel it; it only throws away our knowledge of
      // whether it happened. The ledger row above is what makes that survivable either way, and
      // waiting is strictly better than not knowing.
    });
  } catch (e) {
    return fail(
      `The purchase request failed in flight: ${(e as Error).message}. The order is recorded as ` +
        `failed, but it may still have gone through at Vercel. CHECK THE VERCEL DASHBOARD BEFORE RETRYING.`
    );
  }

  let body: Record<string, unknown> = {};
  try {
    body = (await res.json()) as Record<string, unknown>;
  } catch {
    // Status is the fact that matters.
  }

  if (res.status !== 200 && res.status !== 201 && res.status !== 202) {
    const err = body.error as { code?: string; message?: string } | undefined;
    return fail(`${err?.code ?? `http_${res.status}`}: ${err?.message ?? "Vercel refused the purchase."}`);
  }

  const chargedCents = toCents(body.price ?? body.charged ?? null) ?? args.expectedPriceCents;

  await supabaseAdmin
    .from("client_domain_orders")
    .update({
      status: "bought",
      charged_price_cents: chargedCents,
      vercel_order_id: (body.orderId as string) ?? (body.id as string) ?? null,
      completed_at: new Date().toISOString(),
    })
    .eq("id", orderId);

  return { ok: true, domain, orderId, chargedCents };
}

export interface AttachOutcome {
  ok: boolean;
  apex: DomainState | null;
  www: DomainState | null;
  error?: string;
}

/**
 * Point a bought domain at this project and record it.
 *
 * The apex is attached and gets the `client_hosts` row. www is attached as a 308 redirect to the
 * apex and gets NO row: it never reaches this application, so nothing needs to resolve it.
 *
 * ‼️ A FAILED www IS A WARNING, NOT A FAILURE. The site is fully live on the apex without it.
 * Refusing the whole step because the redirect did not attach would leave a working site behind
 * a red board, and somebody would fix it by attaching the apex a second time.
 */
export async function attachSiteHosts(args: {
  clientId: string;
  domain: string;
}): Promise<AttachOutcome> {
  const apexHost = args.domain.trim().toLowerCase();

  const apex = await attachHost(apexHost);
  if (!apex.attached) {
    return { ok: false, apex, www: null, error: apex.error ?? `${apexHost} could not be attached.` };
  }

  const now = new Date().toISOString();
  const { error: rowErr } = await supabaseAdmin.from("client_hosts").upsert(
    {
      client_id: args.clientId,
      host: apexHost,
      kind: "site",
      enabled: true,
      vercel_attached_at: now,
      vercel_verified: apex.verified,
      vercel_misconfigured: apex.misconfigured,
      vercel_checked_at: now,
      vercel_error: apex.error,
      updated_at: now,
    },
    { onConflict: "client_id,kind" }
  );

  if (rowErr) {
    return {
      ok: false,
      apex,
      www: null,
      error:
        `${apexHost} is attached at Vercel but the client_hosts row failed: ${rowErr.message}. ` +
        "Nothing will serve until that row exists, because resolveHost() reads it.",
    };
  }

  const www = await attachRedirectHost(`www.${apexHost}`, apexHost);

  return {
    ok: true,
    apex,
    www,
    error: www.attached ? undefined : `The apex is live. www could not be attached: ${www.error ?? "unknown"}`,
  };
}
