// Where the client's site actually lives — Runner v3 section 5, delivery step 3.
//
// This answers the question the onboarding call is otherwise wrecked by: "who is your domain
// with?" Plenty of owners genuinely do not know, and plenty who think they know are wrong,
// because the registrar they bought from and the company whose nameservers are live are
// frequently different. The NS record is the truth about which UI they have to open while we
// are on the phone with them, so it gets resolved BEFORE the call and printed on the sheet.
//
// ‼️ NO NEW DEPENDENCIES AND NO SCRAPING. node:dns and fetch, nothing else.
// WHOIS deliberately is NOT done over port 43 with a whois library. RDAP is the official
// IANA-designated successor: JSON over HTTPS, no key, no rate-limit agreement to sign, and it
// is a published API rather than a screen being read. https://rdap.org fans out to the right
// registry automatically. The same endpoint shape answers the IP question, so the network
// operator behind the A record comes from the same code path.
//
// EVERY LOOKUP IS BEST-EFFORT AND EVERY FAILURE IS RECORDED AS A FAILURE. A domain with no MX,
// a registry that 404s, a site that refuses our user agent — all normal. What must never happen
// is an absent answer rendering as a confident one, so the shape distinguishes "we looked and
// there is nothing" (an empty array) from "we could not look" (null).

import dns from "node:dns/promises";
import { supabaseAdmin } from "@/lib/db";
import { resolveDnsProvider, clickPathFor } from "./dns-records";

const LOOKUP_TIMEOUT_MS = 8000;
const HTML_BUDGET_BYTES = 400_000;

// ─────────────────────────────────────────────────────────────────────────────
// Shape
// ─────────────────────────────────────────────────────────────────────────────

export interface DnsRecords {
  a: string[];
  aaaa: string[];
  cname: string[];
  ns: string[];
  mx: string[];
  txt: string[];
}

export interface RegistrationIntel {
  registrar: string | null;
  createdAt: string | null;
  expiresAt: string | null;
  /** True when the registrant contact is redacted or a privacy service. */
  privacy: boolean | null;
  /** Present when the lookup itself failed, so "unknown" is never read as "none". */
  error?: string;
}

export interface HostingIntel {
  ip: string | null;
  reverseDns: string | null;
  /** The network operator behind the A record, from RDAP. */
  networkOrg: string | null;
  headers: Record<string, string>;
  cdn: string | null;
}

export interface SiteIntel {
  domain: string;
  checkedAt: string;
  registration: RegistrationIntel;
  apex: DnsRecords;
  www: DnsRecords;
  dnsProvider: string | null;
  nameservers: string[];
  /** The literal instruction for the call sheet, or null when the provider is unknown. */
  clickPath: string | null;
  hosting: HostingIntel;
  cms: string | null;
  cmsEvidence: string[];
  mailProvider: string | null;
  /** null on a name means the resolver could not be asked, NOT that the name is free. */
  subdomains: { learn: boolean | null; guide: boolean | null; reviews: boolean | null };
  /**
   * Which of learn/guide is free. Decided here, before the call, never on it. Null when both
   * are taken OR when the resolver never answered — the second case is not a decision we are
   * entitled to make from silence.
   */
  subdomainConvention: "learn" | "guide" | null;
  /**
   * False when any DNS lookup failed for an infrastructure reason rather than returning a real
   * empty answer. When this is false EVERY DNS field below is unreliable and nothing may be
   * concluded from an absence, including the subdomain decision.
   */
  resolverHealthy: boolean;
  errors: string[];
}

// ─────────────────────────────────────────────────────────────────────────────
// Small helpers
// ─────────────────────────────────────────────────────────────────────────────

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error(`${label} timed out`)), ms)),
  ]);
}

/**
 * ‼️ "NOTHING IS THERE" AND "WE COULD NOT LOOK" ARE DIFFERENT ANSWERS, AND CONFLATING THEM IS
 * THE EXPENSIVE MISTAKE HERE.
 *
 * CLAUDE.md already records this trap one layer down, in checkRecord(): a resolver that is DOWN
 * reports the same NXDOMAIN an absent record does, "so an outage quietly changes nothing rather
 * than writing a wrong status". The same reasoning applies harder here, because this module
 * DECIDES SOMETHING from an empty answer — if learn. does not resolve we take learn. as the
 * client's hostname. A refused resolver would make every name look free, and we would point a
 * CNAME at a hostname the clinic is already using.
 *
 * Node's dns module separates the two by error code. ENOTFOUND and ENODATA are answers: the
 * name has no such record. Everything else — ECONNREFUSED, ETIMEOUT, ESERVFAIL, EREFUSED — is
 * the lookup failing, and those set `resolverFailed` so nothing downstream is allowed to treat
 * the emptiness as information.
 */
const REAL_ANSWER_CODES = new Set(["ENOTFOUND", "ENODATA", "ENOTIMP"]);

interface ResolveState {
  failed: boolean;
}

async function tryResolve<T>(state: ResolveState, fn: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await withTimeout(fn(), LOOKUP_TIMEOUT_MS, "dns");
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code;
    if (!code || !REAL_ANSWER_CODES.has(code)) state.failed = true;
    return fallback;
  }
}

async function records(name: string, state: ResolveState): Promise<DnsRecords> {
  const [a, aaaa, cname, ns, mx, txt] = await Promise.all([
    tryResolve(state, () => dns.resolve4(name), [] as string[]),
    tryResolve(state, () => dns.resolve6(name), [] as string[]),
    tryResolve(state, () => dns.resolveCname(name), [] as string[]),
    tryResolve(state, () => dns.resolveNs(name), [] as string[]),
    tryResolve(state, () => dns.resolveMx(name), [] as { exchange: string; priority: number }[]),
    tryResolve(state, () => dns.resolveTxt(name), [] as string[][]),
  ]);

  return {
    a,
    aaaa,
    cname,
    ns: ns.map((n) => n.toLowerCase()),
    mx: mx
      .slice()
      .sort((x, y) => x.priority - y.priority)
      .map((m) => `${m.priority} ${m.exchange.toLowerCase()}`),
    // TXT answers arrive chunked at 255 characters. Joined before anything reads them, the
    // same reason checkRecord() joins them: a long verification string is otherwise several
    // meaningless fragments.
    txt: txt.map((chunks) => chunks.join("")),
  };
}

/** Does anything at all answer for this name? Null when the resolver could not be asked. */
async function resolves(name: string, outer: ResolveState): Promise<boolean | null> {
  const state: ResolveState = { failed: false };
  const [a, cname] = await Promise.all([
    tryResolve(state, () => dns.resolve4(name), [] as string[]),
    tryResolve(state, () => dns.resolveCname(name), [] as string[]),
  ]);
  if (state.failed) {
    outer.failed = true;
    return null;
  }
  return a.length > 0 || cname.length > 0;
}

// ─────────────────────────────────────────────────────────────────────────────
// RDAP — the official WHOIS replacement
// ─────────────────────────────────────────────────────────────────────────────

interface RdapEvent {
  eventAction?: string;
  eventDate?: string;
}
interface RdapEntity {
  roles?: string[];
  vcardArray?: unknown;
  remarks?: { title?: string; description?: string[] }[];
}
interface RdapResponse {
  events?: RdapEvent[];
  entities?: RdapEntity[];
  remarks?: { title?: string; description?: string[] }[];
  name?: string;
}

function vcardName(entity: RdapEntity): string | null {
  // vcardArray is ["vcard", [["version",{},"text","4.0"], ["fn",{},"text","GoDaddy.com, LLC"], ...]]
  const arr = entity.vcardArray;
  if (!Array.isArray(arr) || arr.length < 2 || !Array.isArray(arr[1])) return null;
  for (const field of arr[1] as unknown[]) {
    if (Array.isArray(field) && field[0] === "fn" && typeof field[3] === "string") {
      return field[3];
    }
  }
  return null;
}

export async function fetchRegistration(domain: string): Promise<RegistrationIntel> {
  const empty: RegistrationIntel = {
    registrar: null,
    createdAt: null,
    expiresAt: null,
    privacy: null,
  };

  let json: RdapResponse;
  try {
    const res = await withTimeout(
      fetch(`https://rdap.org/domain/${encodeURIComponent(domain)}`, {
        headers: { accept: "application/rdap+json, application/json" },
      }),
      LOOKUP_TIMEOUT_MS,
      "rdap"
    );
    if (!res.ok) return { ...empty, error: `rdap ${res.status}` };
    json = (await res.json()) as RdapResponse;
  } catch (e) {
    return { ...empty, error: (e as Error).message };
  }

  const event = (action: string) =>
    json.events?.find((ev) => ev.eventAction === action)?.eventDate ?? null;

  const registrarEntity = json.entities?.find((e) => e.roles?.includes("registrar"));
  const registrant = json.entities?.find((e) => e.roles?.includes("registrant"));

  // Registries redact the registrant behind a privacy service, and they say so in a remark
  // rather than in a field. Absence of a registrant name is the same signal.
  const remarkText = [
    ...(json.remarks ?? []),
    ...(registrant?.remarks ?? []),
  ]
    .flatMap((r) => [r.title ?? "", ...(r.description ?? [])])
    .join(" ")
    .toLowerCase();

  const registrantName = registrant ? vcardName(registrant) : null;
  const privacy =
    remarkText.includes("redacted") ||
    remarkText.includes("privacy") ||
    /privacy|proxy|redacted|whoisguard|domains by proxy/i.test(registrantName ?? "") ||
    (!!registrant && !registrantName);

  return {
    registrar: registrarEntity ? vcardName(registrarEntity) : null,
    createdAt: event("registration"),
    expiresAt: event("expiration"),
    privacy,
  };
}

/** Who operates the network the A record sits on. Same RDAP shape, /ip instead of /domain. */
export async function fetchNetworkOrg(ip: string): Promise<string | null> {
  try {
    const res = await withTimeout(
      fetch(`https://rdap.org/ip/${encodeURIComponent(ip)}`, {
        headers: { accept: "application/rdap+json, application/json" },
      }),
      LOOKUP_TIMEOUT_MS,
      "rdap-ip"
    );
    if (!res.ok) return null;
    const json = (await res.json()) as RdapResponse;
    const org = json.entities?.find(
      (e) => e.roles?.includes("registrant") || e.roles?.includes("administrative")
    );
    return (org ? vcardName(org) : null) ?? json.name ?? null;
  } catch {
    return null;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Fingerprints — pure, so they are testable without a network
// ─────────────────────────────────────────────────────────────────────────────

const CDN_HEADERS: Array<[string, string]> = [
  ["cf-ray", "Cloudflare"],
  ["x-vercel-id", "Vercel"],
  ["x-amz-cf-id", "AWS CloudFront"],
  ["x-served-by", "Fastly"],
  ["x-akamai-transformed", "Akamai"],
];

export function detectCdn(headers: Record<string, string>): string | null {
  for (const [key, name] of CDN_HEADERS) {
    if (headers[key]) return name;
  }
  return null;
}

interface CmsRule {
  name: string;
  test: RegExp;
  /** What we would say out loud as the evidence. */
  evidence: string;
}

/**
 * Ordered most-specific first: a GoHighLevel site is built on a stack that also trips several
 * generic markers, so the specific platforms have to win before the generic ones are consulted.
 */
const CMS_RULES: CmsRule[] = [
  { name: "GoHighLevel", test: /leadconnectorhq\.com|gohighlevel|msgsndr\.com/i, evidence: "GoHighLevel asset host" },
  { name: "Wix", test: /static\.wixstatic\.com|wix-code|_wixCssImports/i, evidence: "Wix static assets" },
  { name: "Squarespace", test: /squarespace\.com|static1\.squarespace|Squarespace\.afterBodyLoad/i, evidence: "Squarespace assets" },
  { name: "Webflow", test: /assets\.website-files\.com|webflow\.js|data-wf-page/i, evidence: "Webflow page attributes" },
  { name: "Shopify", test: /cdn\.shopify\.com|Shopify\.theme/i, evidence: "Shopify CDN" },
  { name: "Duda", test: /irp\.cdn-website\.com|dudaone|_dm\.js/i, evidence: "Duda CDN" },
  { name: "HubSpot", test: /hs-scripts\.com|hubspot\.net/i, evidence: "HubSpot scripts" },
  { name: "Weebly", test: /weebly\.com|editmysite\.com/i, evidence: "Weebly assets" },
  { name: "WordPress", test: /wp-content\/|wp-includes\/|wp-json/i, evidence: "wp-content asset paths" },
  { name: "Drupal", test: /sites\/all\/(modules|themes)|drupal\.js/i, evidence: "Drupal asset paths" },
  { name: "Joomla", test: /\/media\/jui\/|joomla/i, evidence: "Joomla assets" },
];

export interface CmsResult {
  cms: string | null;
  evidence: string[];
}

export function fingerprintCms(html: string, generatorHeader?: string): CmsResult {
  const evidence: string[] = [];
  let cms: string | null = null;

  const generatorMeta = /<meta[^>]+name=["']generator["'][^>]+content=["']([^"']+)["']/i.exec(html);
  if (generatorMeta) evidence.push(`meta generator: ${generatorMeta[1]}`);
  if (generatorHeader) evidence.push(`x-generator header: ${generatorHeader}`);

  for (const rule of CMS_RULES) {
    if (rule.test.test(html)) {
      cms = rule.name;
      evidence.push(rule.evidence);
      break;
    }
  }

  if (!cms && generatorMeta) {
    for (const rule of CMS_RULES) {
      if (rule.test.test(generatorMeta[1])) {
        cms = rule.name;
        break;
      }
    }
  }

  // Not "unknown" and not "custom" — those are different claims and only one is defensible.
  // Nothing matched means nothing matched.
  return { cms, evidence };
}

const MAIL_RULES: Array<[RegExp, string]> = [
  [/google\.com$|googlemail\.com$|aspmx\.l\.google\.com$/i, "Google Workspace"],
  [/outlook\.com$|protection\.outlook\.com$/i, "Microsoft 365"],
  [/zoho(eu|cloud)?\.com$/i, "Zoho Mail"],
  [/messagingengine\.com$/i, "Fastmail"],
  [/mailgun\.org$/i, "Mailgun"],
  [/pphosted\.com$|proofpoint/i, "Proofpoint"],
  [/mimecast\.com$/i, "Mimecast"],
  [/secureserver\.net$/i, "GoDaddy Email"],
  [/improvmx\.com$/i, "ImprovMX"],
  [/privateemail\.com$/i, "Namecheap Private Email"],
];

/**
 * Which mail provider, from MX.
 *
 * This is not trivia. Google Workspace versus Microsoft 365 changes how the Search Console
 * verification conversation goes on the call: a Workspace admin can often verify by signing in,
 * where a 365 shop has to add the TXT record by hand.
 */
export function detectMailProvider(mx: string[]): string | null {
  const hosts = mx.map((m) => m.split(" ").pop() ?? "").map((h) => h.replace(/\.$/, ""));
  for (const [pattern, name] of MAIL_RULES) {
    if (hosts.some((h) => pattern.test(h))) return name;
  }
  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// The gather
// ─────────────────────────────────────────────────────────────────────────────

const INTERESTING_HEADERS = [
  "server",
  "x-powered-by",
  "x-vercel-id",
  "cf-ray",
  "x-generator",
  "x-amz-cf-id",
  "x-served-by",
  "x-akamai-transformed",
];

async function fetchHomepage(
  domain: string
): Promise<{ html: string; headers: Record<string, string>; error?: string }> {
  const headers: Record<string, string> = {};
  try {
    const res = await withTimeout(
      fetch(`https://${domain}`, {
        redirect: "follow",
        headers: { "user-agent": "SRT-SiteIntel/1.0 (+https://srtagency.com)" },
      }),
      LOOKUP_TIMEOUT_MS,
      "homepage"
    );
    for (const key of INTERESTING_HEADERS) {
      const v = res.headers.get(key);
      if (v) headers[key] = v;
    }
    const text = await res.text();
    return { html: text.slice(0, HTML_BUDGET_BYTES), headers };
  } catch (e) {
    return { html: "", headers, error: (e as Error).message };
  }
}

export async function gatherSiteIntel(domain: string): Promise<SiteIntel> {
  const errors: string[] = [];
  const clean = domain.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "");

  const resolver: ResolveState = { failed: false };

  const [registration, apex, www, provider, page, learn, guide, reviews] = await Promise.all([
    fetchRegistration(clean),
    records(clean, resolver),
    records(`www.${clean}`, resolver),
    resolveDnsProvider(clean),
    fetchHomepage(clean),
    resolves(`learn.${clean}`, resolver),
    resolves(`guide.${clean}`, resolver),
    resolves(`reviews.${clean}`, resolver),
  ]);

  const resolverHealthy = !resolver.failed;

  if (registration.error) errors.push(`registration lookup: ${registration.error}`);
  if (page.error) errors.push(`homepage fetch: ${page.error}`);
  if (!resolverHealthy) {
    errors.push(
      "THE DNS RESOLVER DID NOT ANSWER. Every DNS field here is unreliable and no subdomain " +
        "decision was taken. Re-run this step; do not read an empty record as an absent one."
    );
  } else if (!apex.ns.length) {
    errors.push("no nameservers answered for the apex, so the DNS provider is unknown");
  }

  const ip = apex.a[0] ?? null;
  const [reverseDns, networkOrg] = await Promise.all([
    ip
      ? tryResolve(resolver, () => dns.reverse(ip), [] as string[]).then((r) => r[0] ?? null)
      : Promise.resolve(null),
    ip ? fetchNetworkOrg(ip) : Promise.resolve(null),
  ]);

  const { cms, evidence } = fingerprintCms(page.html, page.headers["x-generator"]);

  // ‼️ THE SUBDOMAIN DECISION IS TAKEN HERE, BEFORE THE CALL, NEVER ON IT. Runner v3 section 5.
  // If learn. already resolves, the clinic is using it for something and pointing a CNAME at us
  // would take down whatever that is. guide. is the documented alternative. If BOTH are taken
  // this returns null and refuses to choose, because there is no third convention and inventing
  // one on the call is how a hostname ends up somewhere nothing knows about.
  //
  // learn === null means the resolver failed, and `learn === false` is the ONLY thing that
  // licenses taking the name. Written as an explicit false comparison rather than `!learn`
  // precisely because null would pass a truthiness check and hand us somebody else's hostname.
  let subdomainConvention: "learn" | "guide" | null = null;
  if (resolverHealthy) {
    if (learn === false) subdomainConvention = "learn";
    else if (guide === false) subdomainConvention = "guide";

    if (subdomainConvention === "guide") {
      errors.push("learn. already resolves, so the convention is guide. — log the exception");
    }
    if (subdomainConvention === null) {
      errors.push("both learn. and guide. already resolve; this one needs a decision, not a default");
    }
    if (reviews === true) {
      errors.push("reviews. already resolves and the review tool needs that exact name");
    }
  }

  return {
    domain: clean,
    checkedAt: new Date().toISOString(),
    registration,
    apex,
    www,
    dnsProvider: provider.provider,
    nameservers: provider.nameservers,
    clickPath: clickPathFor(provider.provider, clean),
    hosting: {
      ip,
      reverseDns,
      networkOrg,
      headers: page.headers,
      cdn: detectCdn(page.headers),
    },
    cms,
    cmsEvidence: evidence,
    mailProvider: detectMailProvider(apex.mx),
    subdomains: { learn, guide, reviews },
    subdomainConvention,
    resolverHealthy,
    errors,
  };
}

/**
 * Delivery step 3. Gathers, stores, and posts a plain-language summary to the ops thread.
 *
 * Writes clients.subdomain_convention only when it is currently unset. Once a hostname has been
 * attached at Vercel and a CNAME is live, flipping the convention silently would orphan a
 * hostname the client's DNS still points at.
 */
export async function runSiteIntel(
  clientId: string
): Promise<{ ok: boolean; error?: string; intel?: SiteIntel }> {
  const { data: client } = await supabaseAdmin
    .from("clients")
    .select("id, domain, website, subdomain_convention, dns_provider")
    .eq("id", clientId)
    .maybeSingle();

  if (!client) return { ok: false, error: "client not found" };

  const domain =
    (client.domain as string | null) ??
    (client.website as string | null)?.replace(/^https?:\/\//, "").replace(/\/.*$/, "") ??
    null;

  if (!domain) return { ok: false, error: "no domain on the client" };

  const intel = await gatherSiteIntel(domain);

  const patch: Record<string, unknown> = {
    site_intel: intel,
    updated_at: new Date().toISOString(),
  };

  // dns_provider and dns_nameservers already exist for the DNS panel and stay authoritative
  // there. Refreshing them from the same lookup keeps one answer rather than two.
  // ‼️ Nothing DNS-derived is written when the resolver did not answer. Same doctrine as
  // checkRecord()'s not_found, which is never stored: an outage must change nothing rather than
  // overwrite a correct value with an empty one.
  if (intel.resolverHealthy) {
    if (intel.dnsProvider) patch.dns_provider = intel.dnsProvider;
    if (intel.nameservers.length) patch.dns_nameservers = intel.nameservers;
    if (!client.subdomain_convention && intel.subdomainConvention) {
      patch.subdomain_convention = intel.subdomainConvention;
    }
  }

  const { error } = await supabaseAdmin.from("clients").update(patch).eq("id", clientId);
  if (error) return { ok: false, error: error.message };

  return { ok: true, intel };
}

/** The ops-thread summary. Plain sentences, because this gets read out on a call. */
export function formatSiteIntel(intel: SiteIntel): string {
  const lines: string[] = [`:globe_with_meridians: *Site and DNS intelligence for ${intel.domain}*`];

  if (!intel.resolverHealthy) {
    lines.push(
      ":rotating_light: *The DNS resolver did not answer, so the DNS half of this is missing rather than empty.*",
      "Nothing was written to the client record from it and no subdomain was chosen. Re-run the step.",
      ""
    );
  }

  lines.push(
    `Registrar: ${intel.registration.registrar ?? "unknown"}${
      intel.registration.privacy ? " (registrant privacy is on)" : ""
    }`
  );
  if (intel.resolverHealthy) {
    lines.push(
      intel.dnsProvider
        ? `DNS is managed at *${intel.dnsProvider}*. That is the UI they open on the call.`
        : `DNS provider not recognised. Nameservers: ${
            intel.nameservers.join(", ") || "none answered"
          }. Read these to them rather than guessing.`
    );
  }
  if (intel.clickPath) lines.push(`Click path: ${intel.clickPath}`);
  lines.push(
    `Mail: ${
      !intel.resolverHealthy ? "not checked, the resolver did not answer" : intel.mailProvider ?? "not recognised from MX"
    }`
  );
  lines.push(
    `Hosting: ${intel.hosting.networkOrg ?? "unknown network"}${
      intel.hosting.cdn ? ` behind ${intel.hosting.cdn}` : ""
    }${intel.hosting.reverseDns ? ` (${intel.hosting.reverseDns})` : ""}`
  );
  lines.push(`Site built on: ${intel.cms ?? "no platform fingerprint matched"}`);
  lines.push(
    `Subdomain: ${
      intel.subdomainConvention
        ? `${intel.subdomainConvention}.${intel.domain}`
        : !intel.resolverHealthy
          ? "not chosen, the resolver did not answer"
          : "NEEDS A DECISION, both learn. and guide. are taken"
    }`
  );

  if (intel.errors.length) {
    lines.push("", "Worth knowing:");
    for (const e of intel.errors) lines.push(`· ${e}`);
  }

  return lines.join("\n");
}
