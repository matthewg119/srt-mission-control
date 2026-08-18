// Attaching a client's hostnames to this Vercel project, and reading back the CNAME target
// Vercel actually wants.
//
// This is the first Vercel API call in the repo. Everything Vercel-side here was manual
// before: paste channel ids, correct CNAME targets in the dashboard by hand.
//
// WHY IT EXISTS. hubCnameTarget() returns cname.vercel-dns.com and its own comment says
// that is "a default, not a truth" — Vercel issues PER-DOMAIN targets for newer projects.
// A client typing the default into their registrar when their domain wants a different one
// gets a record that never resolves, and the DNS panel would sit at `added` forever with
// nothing visibly wrong. So the target is read from the API and written into
// client_dns_records.value, and the value read out on the call is the real one.
//
// ENV PREFIX GOTCHA: Vercel RESERVES the VERCEL_ prefix for its own system variables and
// refuses custom ones. These are HUB_VERCEL_*, not VERCEL_*.

import { revalidateTag } from "next/cache";
import { supabaseAdmin } from "@/lib/db";
import { subdomainLabel } from "@/lib/clients/normalize";
import { hubCnameTarget } from "@/lib/clients/dns-records";
import { HOSTS_TAG } from "@/lib/hub/resolve";

const API = "https://api.vercel.com";

interface VercelConfig {
  token: string;
  projectId: string;
  teamId: string | null;
}

export function vercelConfig(): VercelConfig | null {
  const token = process.env.HUB_VERCEL_TOKEN;
  const projectId = process.env.HUB_VERCEL_PROJECT_ID;
  if (!token || !projectId) return null;
  return { token, projectId, teamId: process.env.HUB_VERCEL_TEAM_ID || null };
}

function apiUrl(path: string, cfg: VercelConfig, extra?: Record<string, string>): string {
  const u = new URL(path, API);
  if (cfg.teamId) u.searchParams.set("teamId", cfg.teamId);
  for (const [k, v] of Object.entries(extra ?? {})) u.searchParams.set(k, v);
  return u.toString();
}

async function call(
  path: string,
  cfg: VercelConfig,
  init?: RequestInit & { query?: Record<string, string> }
): Promise<{ status: number; body: Record<string, unknown> }> {
  const res = await fetch(apiUrl(path, cfg, init?.query), {
    ...init,
    headers: {
      Authorization: `Bearer ${cfg.token}`,
      "content-type": "application/json",
      ...(init?.headers ?? {}),
    },
    cache: "no-store",
  });

  let body: Record<string, unknown> = {};
  try {
    body = (await res.json()) as Record<string, unknown>;
  } catch {
    // A 204, or an HTML error page from the edge. The status is the fact that matters.
  }
  return { status: res.status, body };
}

export interface DomainState {
  host: string;
  attached: boolean;
  verified: boolean;
  misconfigured: boolean | null;
  /** What Vercel wants in the CNAME. Null when the API gave nothing usable. */
  target: string | null;
  error: string | null;
}

/**
 * The CNAME target for one attached domain.
 *
 * recommendedCNAME is ranked by preference; rank 1 is the one to read out. An empty array
 * falls back to hubCnameTarget(), which is the correct default for older projects and is
 * exactly what the panel would have shown anyway.
 */
async function readDomainConfig(
  host: string,
  cfg: VercelConfig
): Promise<{ target: string | null; misconfigured: boolean | null }> {
  const { status, body } = await call(`/v6/domains/${encodeURIComponent(host)}/config`, cfg, {
    query: { projectIdOrName: cfg.projectId },
  });

  if (status !== 200) return { target: null, misconfigured: null };

  const recommended = body.recommendedCNAME;
  let target: string | null = null;

  if (Array.isArray(recommended) && recommended.length > 0) {
    const ranked = [...(recommended as Array<{ rank?: number; value?: unknown }>)].sort(
      (a, b) => (a.rank ?? 99) - (b.rank ?? 99)
    );
    const value = ranked[0]?.value;
    // The field has been both a string and an array of strings across API versions, so
    // both are handled rather than assumed.
    if (typeof value === "string") target = value;
    else if (Array.isArray(value) && typeof value[0] === "string") target = value[0] as string;
  }

  return {
    // Vercel returns a FULLY QUALIFIED name with the root dot on it — the observed value
    // for this project is `4fddd1b501fe6565.vercel-dns-017.com.`. checkRecord() strips it
    // before comparing, so a stored dot would still verify; a registrar's Value box is the
    // problem. GoDaddy shows it back with the dot, the client reads it out, and the next
    // person to check it by eye against the panel sees two different strings. Strip it once,
    // here, where the value enters the system.
    target: (target ?? hubCnameTarget()).replace(/\.$/, ""),
    misconfigured: typeof body.misconfigured === "boolean" ? body.misconfigured : null,
  };
}

/**
 * Attach one hostname to this project, idempotently.
 *
 * GETs first rather than POSTing and interpreting a 409: "already attached to us" and
 * "attached to somebody else" are different outcomes and a 409 does not cleanly separate
 * them.
 */
export async function attachHost(host: string): Promise<DomainState> {
  const base: DomainState = {
    host,
    attached: false,
    verified: false,
    misconfigured: null,
    target: null,
    error: null,
  };

  const cfg = vercelConfig();
  if (!cfg) {
    return { ...base, error: "HUB_VERCEL_TOKEN or HUB_VERCEL_PROJECT_ID is not set." };
  }

  const existing = await call(
    `/v9/projects/${cfg.projectId}/domains/${encodeURIComponent(host)}`,
    cfg
  );

  let verified = false;

  if (existing.status === 200) {
    verified = existing.body.verified === true;
  } else {
    const added = await call(`/v10/projects/${cfg.projectId}/domains`, cfg, {
      method: "POST",
      body: JSON.stringify({ name: host }),
    });

    if (added.status !== 200 && added.status !== 201) {
      const err = added.body.error as { code?: string; message?: string } | undefined;
      const code = err?.code ?? `http_${added.status}`;
      const message = err?.message ?? "Vercel refused the domain.";

      // These two get named, because they are the ones somebody will actually hit and the
      // raw message explains neither.
      if (code === "domain_already_in_use") {
        return {
          ...base,
          error: `${host} is attached to a different Vercel project or account. ${message}`,
        };
      }
      if (added.status === 400 && /deployment/i.test(message)) {
        return {
          ...base,
          error: `Vercel will not attach a domain while the last production deployment failed. ${message}`,
        };
      }
      if (added.status === 429) {
        return { ...base, error: `Vercel rate limited the request. Try again shortly.` };
      }
      return { ...base, error: `${code}: ${message}` };
    }

    verified = added.body.verified === true;
  }

  const { target, misconfigured } = await readDomainConfig(host, cfg);
  return { host, attached: true, verified, misconfigured, target, error: null };
}

export interface WantedHost {
  host: string;
  kind: "hub" | "reviews";
  recordKey: "cname_hub" | "cname_reviews";
}

/**
 * The two hostnames a client should have, composed exactly the way baseVars() composes them
 * for the WhatsApp drafts.
 *
 * subdomainLabel(), never clients.subdomain raw: rows written before 2026-08-20 hold a full
 * host, and reading one raw is what produced learn.clinic.com.clinic.com.
 */
export function hostsFor(client: { subdomain: string | null; domain: string | null }): WantedHost[] {
  if (!client.domain) return [];
  const label = subdomainLabel(client.subdomain, client.domain);
  const domain = client.domain.toLowerCase();
  return [
    { host: `${label}.${domain}`, kind: "hub", recordKey: "cname_hub" },
    { host: `reviews.${domain}`, kind: "reviews", recordKey: "cname_reviews" },
  ];
}

/**
 * Write the real target into the DNS row the panel renders.
 *
 * THE STATUS GUARD IS THE POINT. Once a row is `added`, `verified` or `mismatch`, a human
 * or the resolver has made a statement about it, and a background refresh must not overwrite
 * that. If Vercel starts recommending something else after a record has already gone green,
 * that is an exception a person should see — so it goes in `note`, and the green tick is
 * left alone rather than silently becoming a lie.
 */
async function writeCnameTarget(
  clientId: string,
  recordKey: "cname_hub" | "cname_reviews",
  target: string
): Promise<void> {
  const { data: row } = await supabaseAdmin
    .from("client_dns_records")
    .select("status, value")
    .eq("client_id", clientId)
    .eq("record_key", recordKey)
    .maybeSingle();

  if (!row) return;

  const status = row.status as string;
  const current = (row.value as string | null) ?? null;
  if (current === target) return;

  const now = new Date().toISOString();

  if (status === "pending" || status === "ready") {
    await supabaseAdmin
      .from("client_dns_records")
      .update({ value: target, status: "ready", observed: null, updated_at: now })
      .eq("client_id", clientId)
      .eq("record_key", recordKey);
    return;
  }

  await supabaseAdmin
    .from("client_dns_records")
    .update({
      note: `Vercel now recommends ${target}; this record was set against ${current ?? "nothing"}.`,
      updated_at: now,
    })
    .eq("client_id", clientId)
    .eq("record_key", recordKey);
}

export interface RegisterResult {
  hosts: DomainState[];
  warnings: string[];
}

/**
 * Attach both of a client's hostnames, record what Vercel said, and put the real CNAME
 * target in front of whoever reads it out on the call.
 *
 * Called from the board, never from a cron and never on render. Each host is handled on its
 * own so one failing does not cost the other.
 */
export async function registerClientHosts(clientId: string): Promise<RegisterResult> {
  const warnings: string[] = [];

  const { data: client, error } = await supabaseAdmin
    .from("clients")
    .select("id, domain, subdomain")
    .eq("id", clientId)
    .maybeSingle();

  if (error || !client) return { hosts: [], warnings: ["That client could not be read."] };
  if (!client.domain) {
    return {
      hosts: [],
      warnings: ["This client has no domain yet, so there is no hostname to attach."],
    };
  }

  const wanted = hostsFor(client as { subdomain: string | null; domain: string | null });
  const states: DomainState[] = [];
  const now = new Date().toISOString();

  for (const { host, kind, recordKey } of wanted) {
    const state = await attachHost(host);
    states.push(state);
    if (state.error) warnings.push(state.error);

    await supabaseAdmin.from("client_hosts").upsert(
      {
        client_id: clientId,
        host,
        kind,
        enabled: true,
        vercel_attached_at: state.attached ? now : null,
        vercel_verified: state.attached ? state.verified : null,
        vercel_misconfigured: state.misconfigured,
        vercel_checked_at: now,
        vercel_error: state.error,
        updated_at: now,
      },
      { onConflict: "client_id,kind" }
    );

    if (state.target) await writeCnameTarget(clientId, recordKey, state.target);
  }

  // The host map changed, so every cached resolution is potentially stale.
  //
  // Guarded because this function is also reachable from a CLI script, where there is no
  // request context for revalidateTag to write into and it throws. Failing to bust a cache
  // that expires in five minutes anyway must not undo an attach that already happened.
  try {
    revalidateTag(HOSTS_TAG);
  } catch {
    // Not in a request. The TTL covers it.
  }

  return { hosts: states, warnings };
}

export interface ClientHostRow {
  host: string;
  kind: "hub" | "reviews";
  enabled: boolean;
  vercel_attached_at: string | null;
  vercel_verified: boolean | null;
  vercel_misconfigured: boolean | null;
  vercel_checked_at: string | null;
  vercel_error: string | null;
}

/** What the board renders. Read-only. */
export async function loadClientHosts(clientId: string): Promise<ClientHostRow[]> {
  const { data } = await supabaseAdmin
    .from("client_hosts")
    .select(
      "host, kind, enabled, vercel_attached_at, vercel_verified, vercel_misconfigured, vercel_checked_at, vercel_error"
    )
    .eq("client_id", clientId)
    .order("kind");
  return (data ?? []) as unknown as ClientHostRow[];
}
