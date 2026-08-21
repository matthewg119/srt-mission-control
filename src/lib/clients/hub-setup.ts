// The two hub steps that the step engine could never actually perform.
//
// ‼️ THIS FILE EXISTS BECAUSE registerClientHosts() HAD NO AUTOMATED CALLER.
// It is the only code in this repo that attaches a domain to Vercel and reads the REAL
// per-domain CNAME target back out of `GET /v6/domains/{host}/config` — and its two callers
// were a button on the client board and a CLI script, both of which somebody has to remember
// to run. `hub_preview` meanwhile was `auto_then_manual` with no runner and no instructions,
// so its Slack card was a label and three buttons.
//
// The consequence on the first real pilot: the step was ticked by hand, no domain was ever
// attached, the DNS rows carried the `HUB_CNAME_TARGET` fallback rather than the true target,
// `reviews.{domain}` answered NXDOMAIN, and `review_tool_preview` failed one line later for a
// completely different reason (an unconfirmed theme) which made the real cause invisible.
//
// ‼️ ATTACHING BEFORE THE DNS RECORD EXISTS IS THE CORRECT ORDER and CLAUDE.md says so:
// attaching alone is harmless because nothing resolves without the record, and the hub code is
// already in production, so a resolving host serves the hub rather than Mission Control.

import { supabaseAdmin } from "@/lib/db";
import { registerClientHosts, hostsFor } from "@/lib/hub/vercel-domains";
import {
  DNS_RECORDS,
  dnsRecordByKey,
  fqdn,
  loadDnsRows,
  recheckDnsRecords,
  seedDnsRecords,
  type DnsRow,
} from "@/lib/clients/dns-records";
import { subdomainLabel } from "@/lib/clients/normalize";
import { activeTheme, readTheme } from "@/lib/hub/theme";

interface ClientRow {
  id: string;
  domain: string | null;
  subdomain: string | null;
  theme: unknown;
}

async function loadHubClient(clientId: string): Promise<ClientRow | null> {
  const { data } = await supabaseAdmin
    .from("clients")
    .select("id, domain, subdomain, theme")
    .eq("id", clientId)
    .maybeSingle();

  return (data as ClientRow | null) ?? null;
}

/** Has a person confirmed the theme? `review_tool_preview` refuses until they have. */
export async function themeConfirmed(clientId: string): Promise<boolean> {
  const client = await loadHubClient(clientId);
  if (!client) return false;
  return activeTheme(readTheme(client.theme)) !== null;
}

/**
 * The three records, rendered the way they are typed into a registrar.
 *
 * ‼️ HOST IS THE LABEL ONLY — `guide`, `reviews`, `@`. Registrars append the domain
 * themselves, so a full name saves as `guide.clinic.com.clinic.com`. That trap is already
 * documented in dns-records.ts and was reproduced once by the code documenting it, which is
 * why every caller goes through the stored `row.host` rather than composing its own.
 *
 * `fqdn()` is used only for the "what this becomes" line, never for the Host column.
 */
export function formatDnsRecords(rows: DnsRow[], domain: string): string[] {
  if (!rows.length) return ["No DNS rows have been seeded for this client yet."];

  const out: string[] = [
    "*Three records. Two CNAMEs and one TXT.* Say it that way: \"CNAME and TXT\" reads as two.",
    "Type in the *Host* column exactly as written. The registrar adds the domain itself.",
    "",
    "```",
  ];

  for (const row of rows) {
    const def = dnsRecordByKey(row.record_key);
    const value =
      row.value ??
      (def?.valueIsExternal
        ? "generated in Search Console on the call"
        : "not set yet — attach the hub first");
    out.push(`${row.record_type.padEnd(6)} ${row.host.padEnd(10)} ${value}`);
  }

  out.push("```");
  out.push("");

  for (const row of rows) {
    out.push(`  • ${row.host} becomes ${fqdn(row.host, domain)} — currently *${row.status}*`);
  }

  return out;
}

/**
 * `hub_preview` step 15: attach both hostnames to Vercel, then seed the DNS rows.
 *
 * Order matters. `registerClientHosts` writes the true CNAME target onto the DNS rows via
 * `writeCnameTarget()`, and it can only do that for rows that exist — so `seedDnsRecords`
 * runs FIRST and the attach fills in the value. Seeding is idempotent and never overwrites a
 * status a human or the resolver has set, so running this twice costs nothing.
 *
 * It returns ok on a partial attach and says which half failed in the note, because one host
 * attaching and the other not is a real and recoverable state: the printed cards only need
 * `reviews.`, and the hub only needs the other.
 */
export async function registerHubAndSeedDns(clientId: string): Promise<{
  ok: boolean;
  error?: string;
  note?: string;
}> {
  const client = await loadHubClient(clientId);
  if (!client) return { ok: false, error: "That client could not be read." };
  if (!client.domain) {
    return { ok: false, error: "No domain on file, so there is no hostname to attach." };
  }

  // ‼️ DECIDE THE LABEL BEFORE ATTACHING ANYTHING, because subdomainLabel() falls back to
  // the literal "learn" on a null column and that fallback is a GUESS. chooseSubdomain does the
  // actual DNS check. It only runs at provisioning when a domain was already known, and /start
  // provisions from an email alone, so a client can reach this step with subdomain still null.
  // Attaching learn.{domain} on a domain where learn. is already in use points a hostname
  // somebody else is serving at this Vercel project, and the DNS panel would sit at `added`
  // forever with nothing visibly wrong.
  let subdomain = client.subdomain;
  if (!subdomain) {
    const { chooseSubdomain } = await import("@/lib/clients/provision");
    await chooseSubdomain(clientId, client.domain).catch(() => {});
    subdomain = (await loadHubClient(clientId))?.subdomain ?? null;
  }

  const label = subdomainLabel(subdomain, client.domain);
  await seedDnsRecords(clientId, label);

  const result = await registerClientHosts(clientId);
  const rows = await loadDnsRows(clientId);
  const wanted = hostsFor({ subdomain, domain: client.domain });

  const lines: string[] = [`:globe_with_meridians: *Hub hostnames for ${client.domain}*`];

  for (const host of wanted) {
    const state = result.hosts.find((h) => h.host === host.host);
    lines.push(
      state?.attached
        ? `  • \`${host.host}\` attached to the Vercel project`
        : `  • \`${host.host}\` NOT attached${state?.error ? `: ${state.error}` : ""}`
    );
  }

  if (result.warnings.length) {
    lines.push("");
    for (const w of result.warnings) lines.push(`:warning: ${w}`);
  }

  lines.push("");
  lines.push(...formatDnsRecords(rows, client.domain));

  // ‼️ THE THEME IS THE MANUAL HALF AND IT IS STATED HERE, not left to be discovered when
  // review_tool_preview fails. That is exactly what happened on the pilot: hub_preview was
  // ticked, and the very next step refused with "the theme has not been confirmed", which
  // reads as a failure of the review tool rather than as the unfinished half of this step.
  const themed = activeTheme(readTheme(client.theme)) !== null;
  lines.push("");
  lines.push(
    themed
      ? ":white_check_mark: Theme confirmed. [Done] will go through."
      : ":warning: *The theme is not confirmed yet, so this step is not finished.* Open the " +
          "client board, extract or set the colours, then press Confirm on the Theme panel. " +
          "Until you do, the hub and the review tool render in SRT's colours rather than theirs, " +
          "and `review_tool_preview` will refuse."
  );

  const attached = result.hosts.filter((h) => h.attached).length;
  if (attached === 0) {
    return {
      ok: false,
      error:
        result.warnings[0] ??
        "Neither hostname attached. Check HUB_VERCEL_TOKEN, HUB_VERCEL_PROJECT_ID and HUB_VERCEL_TEAM_ID.",
      note: lines.join("\n"),
    };
  }

  return { ok: true, note: lines.join("\n") };
}

/**
 * `subdomain_live` step 26: say how many of the three records actually resolve.
 *
 * ‼️ IT REPORTS, IT DOES NOT ASSERT. `checkRecord` never stores `not_found`, deliberately —
 * a record added ninety seconds ago and a record never added look identical to a resolver, and
 * writing `mismatch` over `added` mid-propagation is worse than saying nothing. So "0 of 3
 * resolving, checked just now" is an honest card, not a failure, and the step still waits on a
 * person to confirm Search Console.
 */
export async function checkHubResolving(clientId: string): Promise<{
  ok: boolean;
  error?: string;
  note?: string;
}> {
  const client = await loadHubClient(clientId);
  if (!client?.domain) {
    return { ok: false, error: "No domain on file, so there is nothing to resolve." };
  }

  const rows = await recheckDnsRecords(clientId, client.domain);
  const verified = rows.filter((r) => r.status === "verified").length;

  const lines = [
    `:satellite: *DNS check for ${client.domain}* — ${verified} of ${DNS_RECORDS.length} resolving.`,
    "",
    ...rows.map((r) => {
      const mark =
        r.status === "verified" ? ":white_check_mark:" : r.status === "mismatch" ? ":x:" : ":hourglass:";
      return `  ${mark} ${r.record_type} \`${r.host}\` — ${r.status}${r.observed ? ` (saw: ${r.observed})` : ""}`;
    }),
  ];

  if (verified < DNS_RECORDS.length) {
    lines.push("");
    lines.push(
      "A record that does not resolve yet is left at whatever the last human said, because " +
        "propagation runs up to an hour. Re-check from the DNS panel rather than assuming it is wrong."
    );
  }

  return { ok: true, note: lines.join("\n") };
}
