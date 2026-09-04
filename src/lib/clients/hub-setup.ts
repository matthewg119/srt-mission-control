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
import { readTheme } from "@/lib/hub/theme";
import { stepNumber } from "@/config/delivery-steps";

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

/**
 * Has a person confirmed the theme? `hub_preview` and `review_tool_preview` refuse until they have.
 *
 * ‼️ CONFIRMED AND HAS-OVERRIDES ARE TWO DIFFERENT QUESTIONS AND CONFLATING THEM WAS A DEADLOCK.
 *
 * This used to be `activeTheme(readTheme(...)) !== null`, and activeTheme returns null when
 * nothing is overridden as well as when nothing is confirmed. So a client who looked at the
 * default palette and decided to keep it could never satisfy this: the panel said "Nothing set.
 * The hub renders the default palette, which is a fine place to start" directly above a DISABLED
 * Confirm button, and step 15 could never complete, taking 16, 17 and 18 with it.
 *
 * CONFIRMED is "a person looked at it and said yes", which is `confirmedAt` and nothing else.
 * HAS OVERRIDES is "there is something to apply when rendering", which is what activeTheme
 * answers, and it must keep returning null for an empty theme so the hub renders its defaults.
 * Confirming nothing is a decision and it is recorded as one.
 */
export async function themeConfirmed(clientId: string): Promise<boolean> {
  const client = await loadHubClient(clientId);
  if (!client) return false;
  return readTheme(client.theme).confirmedAt !== null;
}

/**
 * Which theme fields are actually overridden, in words, for a message that has to say which of
 * the two states above it is in. Empty means the client renders SRT's defaults.
 *
 * Reads the same four fields activeTheme() does, so the two can never disagree about what
 * counts as an override.
 */
export async function themeOverrides(clientId: string): Promise<string[]> {
  const client = await loadHubClient(clientId);
  if (!client) return [];
  const t = readTheme(client.theme);
  const out: string[] = [];
  if (t.logoUrl) out.push("logo");
  if (t.accent) out.push("accent");
  if (t.accentSoft) out.push("accent soft");
  if (t.fontFamily) out.push("font");
  return out;
}

/** The one sentence every card uses to describe the theme, so the wording cannot drift. */
export function themeLine(confirmed: boolean, overrides: string[]): string {
  if (!confirmed) {
    return (
      ":warning: *[Done] will refuse until the theme is confirmed.* Client board, Theme panel. " +
      "Set the colours, or press Confirm with nothing set to keep SRT's defaults deliberately. " +
      "Either is a decision; leaving it unconfirmed is not."
    );
  }
  if (overrides.length === 0) {
    return (
      ":white_check_mark: Theme confirmed with no overrides, so the hub and the review tool " +
      "render SRT's defaults on the client's own domain. That is a recorded decision, not an " +
      "unfinished step. [Done] will go through."
    );
  }
  return `:white_check_mark: Theme confirmed (${overrides.join(", ")}). [Done] will go through.`;
}

/**
 * The three records, rendered the way they are typed into a registrar.
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
export function formatDnsRecords(
  rows: DnsRow[],
  domain: string,
  opts?: { preview?: boolean }
): string[] {
  if (!rows.length) return ["No DNS rows have been seeded for this client yet."];

  const preview = opts?.preview === true;

  const out: string[] = preview
    ? [
        "*Three records. Two CNAMEs and one TXT.* Say it that way: \"CNAME and TXT\" reads as two.",
        // ‼️ COMPUTED, NOT TYPED. These were literal "15" and "22" and the second one had
        // already gone stale: agreement_signed landed on 2026-09-04 and pushed dns_records from
        // 22 to 23, so this card was sending somebody to the wrong step down the phone. A
        // position is an array index, which delivery-steps.ts says twice, and every number a
        // person reads has to come from stepNumber().
        `*For reference only right now.* Do not put these in yet: step ${stepNumber("hub_preview")} attaches the hostnames`,
        `and fills in the real values, and step ${stepNumber("dns_records")} is where they get typed into the registrar and`,
        "confirmed. This is here so the whole DNS conversation is in one thread while you are on",
        "the phone.",
        "",
        "```",
      ]
    : [
        "*Three records. Two CNAMEs and one TXT.* Say it that way: \"CNAME and TXT\" reads as two.",
        "Type in the *Host* column exactly as written. The registrar adds the domain itself.",
        "",
        "```",
      ];

  for (const row of rows) {
    const def = dnsRecordByKey(row.record_key);
    // ‼️ PREVIEW MODE NEVER PRINTS A CNAME TARGET, AND THAT IS THE WHOLE POINT OF THE FLAG.
    // The true target is per-domain and is only known after registerClientHosts reads it back
    // out of Vercel at step 15. hubCnameTarget()'s fallback is `cname.vercel-dns.com`, which is
    // MEASURED WRONG for this project (rank 1 is a per-project vercel-dns-017.com name). A
    // value printed here is a value somebody reads down the phone, three steps before anything
    // could correct it.
    const value = preview
      ? def?.valueIsExternal
        ? "generated in Search Console on the call"
        : "issued by Vercel at step 15"
      : row.value ??
        (def?.valueIsExternal
          ? "generated in Search Console on the call"
          : "not set yet — attach the hub first");
    out.push(`${row.record_type.padEnd(6)} ${row.host.padEnd(10)} ${value}`);
  }

  out.push("```");
  out.push("");

  for (const row of rows) {
    out.push(
      preview
        ? `  • ${row.host} becomes ${fqdn(row.host, domain)} once step 15 attaches it`
        : `  • ${row.host} becomes ${fqdn(row.host, domain)} — currently *${row.status}*`
    );
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
  // Same helper the step card uses, so the two cannot drift into saying different things
  // about the same client.
  const stored = readTheme(client.theme);
  const themed = stored.confirmedAt !== null;
  const overrides: string[] = [];
  if (stored.logoUrl) overrides.push("logo");
  if (stored.accent) overrides.push("accent");
  if (stored.accentSoft) overrides.push("accent soft");
  if (stored.fontFamily) overrides.push("font");
  lines.push("");
  lines.push(themeLine(themed, overrides));

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
