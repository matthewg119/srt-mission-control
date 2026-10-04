// What is actually true about this client's DNS, as text the conversation can answer from.
//
// ‼️ IT RESTATES NOTHING. Every record, every target, every registrar click path comes from
// src/lib/clients/dns-records.ts, which is the one place that knows what the three records are
// and the only place allowed to say a record is verified. A second copy of "the CNAME points at
// cname.vercel-dns.com" is how a model ends up confidently reading out a target that changed six
// months ago: HUB_CNAME_TARGET is an env var precisely because it is not a constant.
//
// ‼️ AND THIS IS WHY THE CHAT MAY ANSWER DNS QUESTIONS AT ALL.
// A model asked "how do I set up the DNS for this" with no facts in front of it will produce a
// plausible, generic, WRONG answer: the right-shaped instructions for the wrong registrar with an
// invented target. Nobody can tell the difference by reading it, and the cost lands an hour later
// when the record does not resolve. So the rule in the system prompt is that DNS answers come out
// of this block or they do not get given, and the block carries the real values.
//
// The one thing it deliberately does NOT do is check. Rendering is free and happens on every
// turn; a resolver round trip per record is not, and `check_dns` is the action that observes.

import {
  DNS_RECORDS,
  loadDnsRows,
  resolveDnsProvider,
  clickPathFor,
  hubCnameTarget,
  fqdn,
  dnsRecordByKey,
  type DnsRow,
} from "@/lib/clients/dns-records";
import { supabaseAdmin } from "@/lib/db";

export interface DnsFacts {
  /** Null when the client has no domain yet, which is a Launch Lane client before the domain step. */
  domain: string | null;
  subdomain: string;
  rows: DnsRow[];
  provider: string | null;
  nameservers: string[];
  clickPath: string | null;
  /** Hosts attached on our side, with whether the row says Vercel is happy. */
  hosts: { host: string; kind: string; enabled: boolean; misconfigured: boolean }[];
  text: string;
}

/**
 * ‼️ `status` IS WHAT SOMEBODY SAID, `verified_at` IS WHAT THE RESOLVER SAW.
 * dns-records.ts keeps `added` and `verified` apart on purpose and the gap between them is where
 * a build stalls, so this prints both rather than collapsing them into a tick. "He says he added
 * it and it does not resolve yet" is the single most useful sentence this block can produce and
 * it is unsayable if the two are merged.
 */
function describeRow(row: DnsRow, domain: string): string {
  const def = dnsRecordByKey(row.record_key);
  const name = fqdn(row.host, domain);
  const value = row.value ?? "(no value yet)";
  const seen = row.verified_at
    ? `resolver confirmed it on ${row.verified_at.slice(0, 10)}`
    : row.observed
      ? `resolver last saw "${row.observed}", which does not match`
      : row.last_checked_at
        ? `checked ${row.last_checked_at.slice(0, 10)} and it did not resolve at all`
        : "never checked";

  return [
    `  ${def?.label ?? row.record_key}`,
    `    type: ${row.record_type}`,
    // ‼️ THE HOST BOX TAKES THE LABEL, NOT THE FULL NAME, AND GETTING THIS WRONG IS THE SINGLE
    // MOST COMMON REGISTRAR MISTAKE. Typing the FQDN into GoDaddy's Host field creates
    // learn.srtagency.com.srtagency.com. Both forms are printed, each labelled with where it goes.
    `    host box: ${row.host}   (this is the label only; the full name is ${name})`,
    `    value: ${value}`,
    `    status on file: ${row.status}, ${seen}`,
    def?.why ? `    why: ${def.why}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

/** Everything known about this client's DNS, rendered for the conversation's context. */
export async function dnsFacts(clientId: string): Promise<DnsFacts> {
  const { data: client } = await supabaseAdmin
    .from("clients")
    .select("domain, subdomain")
    .eq("id", clientId)
    .maybeSingle();

  const domain = ((client?.domain as string | null) ?? "").trim() || null;
  const subdomain = ((client?.subdomain as string | null) ?? "").trim() || "learn";

  const { data: hostRows } = await supabaseAdmin
    .from("client_hosts")
    .select("host, kind, enabled, vercel_misconfigured")
    .eq("client_id", clientId);

  const hosts = (hostRows ?? []).map((h) => ({
    host: h.host as string,
    kind: h.kind as string,
    enabled: h.enabled !== false,
    misconfigured: h.vercel_misconfigured === true,
  }));

  if (!domain) {
    return {
      domain: null,
      subdomain,
      rows: [],
      provider: null,
      nameservers: [],
      clickPath: null,
      hosts,
      text:
        "THE DNS:\n" +
        "  This client has no domain on file yet, so there is nothing to point anywhere. The domain\n" +
        "  step is where one is searched for and bought. Do not give DNS instructions until there is\n" +
        "  a domain: there is nothing true to say.",
    };
  }

  const [rows, provider] = await Promise.all([
    loadDnsRows(clientId),
    // ‼️ NEVER THROWS OUTWARD. resolveDnsProvider already swallows a failed lookup and returns
    // nulls, but a local resolver that is simply unavailable would otherwise take the whole
    // context build down and the chat would answer nothing at all about anything.
    resolveDnsProvider(domain).catch(() => ({ provider: null, nameservers: [] as string[] })),
  ]);

  const clickPath = clickPathFor(provider.provider, domain);

  const hostLines = hosts.length
    ? hosts.map(
        (h) =>
          `  ${h.host} (${h.kind})${h.enabled ? "" : ", DISABLED"}${
            h.misconfigured ? ", Vercel reports it misconfigured, which almost always means the CNAME is not there" : ""
          }`
      )
    : ["  nothing attached on our side yet"];

  const recordLines = rows.length
    ? rows.map((r) => describeRow(r, domain))
    : [
        `  No record rows exist for this client yet. There are ${DNS_RECORDS.length} of them and they are` +
          " seeded once the domain and subdomain are known.",
      ];

  return {
    domain,
    subdomain,
    rows,
    provider: provider.provider,
    nameservers: provider.nameservers,
    clickPath,
    hosts,
    text: [
      "THE DNS, AND EVERY VALUE BELOW IS READ FROM THE DATABASE OR THE RESOLVER:",
      `  domain: ${domain}`,
      `  the hub subdomain label: ${subdomain}`,
      provider.provider
        ? `  who runs the DNS: ${provider.provider} (nameservers ${provider.nameservers.join(", ")})`
        : provider.nameservers.length
          ? `  who runs the DNS: unrecognised. The nameservers are ${provider.nameservers.join(", ")}. Read those out and let him recognise them rather than guessing a registrar.`
          : "  who runs the DNS: the nameserver lookup failed just now, so this is unknown. Say so rather than guessing.",
      clickPath ? `  where the records go: ${clickPath}` : "",
      `  the CNAME target every hub and review host points at: ${hubCnameTarget()}`,
      "",
      "  THE RECORDS:",
      ...recordLines,
      "",
      "  ATTACHED ON OUR SIDE:",
      ...hostLines,
      "",
      "  Two separate halves, and both have to be true: we attach the hostname to the Vercel project,",
      "  and he adds the record at the registrar. Either one alone leaves the name dead.",
    ]
      .filter(Boolean)
      .join("\n"),
  };
}
