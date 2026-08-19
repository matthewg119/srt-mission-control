// The call sheet — delivery step 18, Runner v3 section 13. INTERNAL.
//
// This is the only document in the folder that is not for the client. It is what Matthew has in
// front of him for sixty minutes, and it is the difference between a call that ends with three
// DNS records live and one that ends with "I will have to look that up".
//
// ‼️ EVERY VALUE COMES FROM THE RECORD. NO PLACEHOLDERS. NO BLANKS FILLED IN LIVE.
// Runner v3 section 13. Anything we already know is PRINTED — the real DNS provider, the real
// click path, the real substituted questions, the real hostnames. The only empty boxes are for
// things that genuinely can only come from the client's mouth: a NAP correction, a substitution
// they say is wrong, the named person for the review cards. Those are `correctionBox`es, and
// they are a different thing from a placeholder.
//
// The last page is a CAPTURE PAGE holding everything that has to be written down, so nothing
// said on the call has to be reconstructed from memory afterwards.

import { supabaseAdmin } from "@/lib/db";
import { materializeAll, MATERIALIZATION_FALLBACKS } from "../question-sets";
import { canonicalFor, loadSweep, effectiveStatus } from "../presence-sweep";
import { canonicalAddress } from "../nap-compare";
import { selectedCompetitors } from "../competitors";
import { platformByKey } from "@/config/presence-platforms";
import { clickPathFor } from "../dns-records";
import { subdomainLabel } from "../normalize";
import type { SiteIntel } from "../site-intel";
import {
  startDoc,
  finishDoc,
  newPage,
  coverHeading,
  sectionHeading,
  paragraph,
  bulletList,
  keyValueTable,
  correctionBox,
  plainFooter,
  MUTED,
  AMBER,
  REEF,
  RED,
  type PageState,
} from "@/lib/pdf/kit";
import { deliverArtifact } from "./deliver";

interface CallSheetData {
  clientName: string;
  legalName: string;
  ownerEmail: string | null;
  language: string;
  canonical: Awaited<ReturnType<typeof canonicalFor>>;
  intel: SiteIntel | null;
  domain: string;
  hubHost: string;
  reviewsHost: string;
  cnameTarget: string;
  searchConsoleTxt: string | null;
  universal: string[];
  substitutions: Record<string, string>;
  competitors: Awaited<ReturnType<typeof selectedCompetitors>>;
  sweep: Awaited<ReturnType<typeof loadSweep>>;
  bookingSoftware: string | null;
  reviewMode: string | null;
  reviewOwner: string | null;
  reviewDestination: string;
  incentiveFlag: boolean;
}

function findings(state: PageState, d: CallSheetData) {
  sectionHeading(state, "0 to 15 · Findings");
  paragraph(state, "Ask for recording consent FIRST, before anything else.", {
    bold: true,
    color: AMBER,
    size: 10.5,
  });
  paragraph(
    state,
    "The recording feeds the timing log and the \"what do you actually do differently\" quotes that become answer pages. Do not skip it and do not summarise it afterwards.",
    { color: MUTED, size: 9 }
  );
  correctionBox(state, "Consent to record given (Y/N, time)");

  if (d.competitors.length) {
    paragraph(state, "Named instead of them:", { bold: true, size: 10 });
    keyValueTable(
      state,
      d.competitors.map((c) => ({
        label: c.name,
        value: c.timesNamed ? `named in ${c.timesNamed} of the questions` : "their own guess at intake",
        tone: "warn" as const,
      })),
      { labelWidth: 80 }
    );
  } else {
    paragraph(state, "No competitors selected yet. Do that before this call.", { color: RED, bold: true });
  }

  paragraph(state, "Print the findings screenshots and bring them. They do the work here, not the numbers.", {
    color: MUTED,
    size: 9,
  });
}

function nap(state: PageState, d: CallSheetData) {
  sectionHeading(state, "15 to 20 · Canonical NAP, read aloud field by field");
  paragraph(
    state,
    "Read each line out. Every directory is then made to match this exactly, so a wrong character here propagates everywhere.",
    { color: MUTED, size: 9 }
  );

  const c = d.canonical;
  correctionBox(state, "Legal name", { prefill: d.legalName });
  correctionBox(state, "DBA / trading name", { prefill: d.clientName });
  correctionBox(state, "Street", { prefill: c?.addressLine1 ?? null });
  correctionBox(state, "Suite / unit", { prefill: c?.addressLine2 ?? null });
  correctionBox(state, "City", { prefill: c?.city ?? null });
  correctionBox(state, "State", { prefill: c?.state ?? null });
  correctionBox(state, "Zip", { prefill: c?.postalCode ?? null });
  correctionBox(state, "Phone", { prefill: c?.phone ?? null });
  correctionBox(state, "Website", { prefill: d.domain });
  correctionBox(state, "Hours, including holiday policy", { lines: 2 });
}

function questions(state: PageState, d: CallSheetData) {
  sectionHeading(state, "20 to 28 · The question set");
  paragraph(state, "Approve once. Add anything missing. The addition is the point, not a formality.", {
    bold: true,
    size: 10,
  });
  paragraph(
    state,
    "These are the twenty as they will actually run, with your values substituted in. A correction here is logged, and the question it changes is marked not-like-for-like at the next measurement.",
    { color: MUTED, size: 9 }
  );

  keyValueTable(
    state,
    Object.entries(d.substitutions).map(([k, v]) => ({ label: k, value: v })),
    { labelWidth: 55, size: 8.5 }
  );

  d.universal.forEach((q, i) => {
    correctionBox(state, `${i + 1}.`, { prefill: q, lines: 1 });
  });

  paragraph(state, "The custom set is drafted at step 12 and prints here once it exists.", {
    color: MUTED,
    size: 9,
  });
}

function access(state: PageState, d: CallSheetData) {
  sectionHeading(state, "28 to 43 · Access");

  const srtEmail = process.env.SRT_ACCESS_EMAIL || "matthew@srtagency.com";

  bulletList(state, [
    `Google Business Profile: open business.google.com, select ${d.clientName}, Users, Add, invite ${srtEmail} as Manager.`,
    `Search Console: open search.google.com/search-console, add ${d.domain} as a Domain property. That needs the TXT record below.`,
    `Analytics: open analytics.google.com, Admin, Property Access Management, add ${srtEmail} as Editor.`,
  ]);

  paragraph(state, "The four blockers, and what each one costs:", { bold: true, size: 10 });
  bulletList(state, [
    "Unclaimed GBP — claim it together, live, on this call. Instant, and it is a credibility moment.",
    "Old agency holds the GBP — start Google's ownership request ON THE CALL. Fixed seven-day wait, usually the long pole.",
    "Duplicate GBP — file the merge or removal now. Two to three weeks, so start early.",
    "Registrar unknown — already answered below. Do not ask them.",
  ]);

  correctionBox(state, "GBP access granted", { lines: 1 });
  correctionBox(state, "Search Console granted", { lines: 1 });
  correctionBox(state, "Analytics granted", { lines: 1 });
  correctionBox(state, "Blockers hit", { lines: 2 });
}

function dns(state: PageState, d: CallSheetData) {
  sectionHeading(state, "DNS · three records, two CNAMEs and one TXT");

  const i = d.intel;

  if (i && !i.resolverHealthy) {
    paragraph(
      state,
      "THE DNS LOOKUP DID NOT COMPLETE, so the provider below is not confirmed. Re-run step 3 before this call.",
      { color: RED, bold: true }
    );
  }

  keyValueTable(state, [
    { label: "Registrar", value: i?.registration.registrar ?? "not identified" },
    {
      label: "DNS actually managed at",
      value: i?.dnsProvider ?? `not recognised — nameservers: ${i?.nameservers.join(", ") || "unknown"}`,
      tone: i?.dnsProvider ? "good" : "warn",
    },
    { label: "Mail", value: i?.mailProvider ?? "not recognised from MX" },
    { label: "Site built on", value: i?.cms ?? "no platform fingerprint matched" },
  ]);

  const path = clickPathFor(i?.dnsProvider ?? null, d.domain);
  if (path) {
    paragraph(state, `${i?.dnsProvider}: ${path}`, { bold: true, size: 10, color: REEF });
  } else {
    // ‼️ Never guess a click path. Reading the nameservers out lets the owner recognise the
    // company themselves, which is a real answer; naming the wrong registrar wastes the call.
    paragraph(
      state,
      `We do not have a click path for this provider. Read them the nameservers and let them recognise it: ${
        i?.nameservers.join(", ") || "none on file"
      }`,
      { bold: true, color: AMBER, size: 10 }
    );
  }

  paragraph(state, "Never ask for registrar credentials. They drive; we read the values out.", {
    color: MUTED,
    size: 9,
  });

  keyValueTable(
    state,
    [
      { label: `CNAME  ${d.hubHost}`, value: d.cnameTarget },
      { label: `CNAME  ${d.reviewsHost}`, value: d.cnameTarget },
      { label: `TXT    ${d.domain}`, value: d.searchConsoleTxt ?? "generated in Search Console on the call" },
    ],
    { labelWidth: 70, size: 9 }
  );

  paragraph(
    state,
    "All three go in today even though the reviews host has nothing on it yet. An unattached CNAME simply does not resolve, and getting somebody back into their registrar six weeks later is much worse than a record sitting idle for a fortnight.",
    { color: MUTED, size: 9 }
  );
}

function reviewMechanism(state: PageState, d: CallSheetData) {
  sectionHeading(state, "43 to 50 · The review mechanism");

  keyValueTable(state, [
    { label: "Booking / messaging software", value: d.bookingSoftware ?? "not recorded at intake" },
    { label: "Request mode", value: d.reviewMode ?? "to be decided on this call" },
    { label: "Destination", value: d.reviewDestination },
  ]);

  correctionBox(state, "Automated request, or card_only — circle one", { lines: 1 });
  correctionBox(state, "Named person for the review tool (a NAME, not \"the front desk\")", {
    prefill: d.reviewOwner,
  });

  paragraph(state, "Restate once, in these words:", { bold: true, size: 10 });
  bulletList(state, [
    "Every patient gets a card. Not the happy ones, every one.",
    "She fills it in at home, on her own phone.",
    "Nothing is offered in return. No discount, no gift, no draw.",
    "Nobody is asked for their name.",
  ]);

  if (d.incentiveFlag) {
    // ‼️ Intake flagged an incentive or a lobby tablet. PILOT section 6 says this is a
    // conversation here and it STOPS. Not a note to follow up on.
    paragraph(
      state,
      "STOP. Intake flagged either an incentive or a lobby tablet. That is a conversation to have right now, and it stops before anything else moves.",
      { color: RED, bold: true, size: 11 }
    );
    correctionBox(state, "What was actually happening, and what they agreed to stop", { lines: 3 });
  }
}

function preview(state: PageState, d: CallSheetData) {
  sectionHeading(state, "50 to 55 · Preview walkthrough");
  bulletList(state, [
    `Hub preview, themed. Their pages, their colours, on our domain, not live yet.`,
    "Review tool preview, same theme. Type a demo answer live. Never show pre-filled sample answers.",
    "The printed card.",
    "Then the page candidates — mark which they want first.",
  ]);
  correctionBox(state, "Pages they picked", { lines: 3 });
}

function consent(state: PageState) {
  sectionHeading(state, "55 to 60 · Consent, confirmed aloud");
  paragraph(state, "Read the consent block from the pilot doc section 16.4 verbatim. Confirm aloud.", {
    size: 10,
  });
  correctionBox(state, "Consent confirmed aloud (Y/N)", { lines: 1 });
  correctionBox(state, "Day-30 report date agreed", { lines: 1 });
}

function capturePage(state: PageState) {
  newPage(state);
  sectionHeading(state, "Capture page — everything that has to be written down");
  paragraph(
    state,
    "One page. If it was said on the call and it matters, it goes here before you hang up.",
    { color: MUTED, size: 9 }
  );

  correctionBox(state, "NAP corrections", { lines: 3 });
  correctionBox(state, "Question substitutions corrected", { lines: 3 });
  correctionBox(state, "Named person for reviews", { lines: 1 });
  correctionBox(state, "Booking software", { lines: 1 });
  correctionBox(state, "Review destination", { lines: 1 });
  correctionBox(state, "Access granted, per platform", { lines: 3 });
  correctionBox(state, "Blockers hit", { lines: 2 });
  correctionBox(state, "Pages selected", { lines: 3 });
  correctionBox(state, "Day-30 date", { lines: 1 });

}

export function renderCallSheet(d: CallSheetData): Buffer {
  const state = startDoc({
    title: `${d.clientName} — call sheet (internal)`,
    footer: plainFooter("SRT internal · not for the client · every value from the tenant record"),
  });

  coverHeading(state, {
    eyebrow: "Onboarding call sheet · internal",
    title: d.clientName,
    subtitle: `${d.legalName} · ${d.canonical ? canonicalAddress(d.canonical) : "no address on file"} · language: ${d.language}`,
  });

  const unswept = d.sweep.filter((r) => effectiveStatus(r) === "not_checked");
  if (unswept.length) {
    paragraph(
      state,
      `${unswept.length} of ${d.sweep.length} platforms are still unchecked (${unswept
        .slice(0, 6)
        .map((r) => platformByKey(r.platform)?.label ?? r.platform)
        .join(", ")}${unswept.length > 6 ? ", and more" : ""}). The findings doc says so, so do not claim otherwise on the call.`,
      { color: AMBER, size: 9 }
    );
  }

  findings(state, d);
  nap(state, d);
  questions(state, d);
  access(state, d);
  dns(state, d);
  reviewMechanism(state, d);
  preview(state, d);
  consent(state);
  capturePage(state);

  return finishDoc(state);
}

export async function generateCallSheet(
  clientId: string
): Promise<{ ok: boolean; error?: string; docId?: string }> {
  // The select list is wide enough that supabase-js gives up on inferring a row type and hands
  // back GenericStringError. Read it as a plain record and pull fields explicitly, which is what
  // the rest of this file was doing anyway.
  const { data: row } = await supabaseAdmin
    .from("clients")
    .select("*")
    .eq("id", clientId)
    .maybeSingle();

  const client = row as Record<string, unknown> | null;
  if (!client) return { ok: false, error: "client not found" };
  if (!client.domain) return { ok: false, error: "no domain on the client, so the DNS block cannot be printed" };

  const canonical = await canonicalFor(clientId);
  const sweep = await loadSweep(clientId);
  const competitors = await selectedCompetitors(clientId);

  const { data: dnsRows } = await supabaseAdmin
    .from("client_dns_records")
    .select("host, type, value")
    .eq("client_id", clientId);

  const cname = (dnsRows ?? []).find((r) => r.type === "CNAME");
  const txt = (dnsRows ?? []).find((r) => r.type === "TXT");

  const domain = client.domain as string;
  const label = subdomainLabel((client.subdomain as string) ?? "learn", domain);

  const services = (client.services ?? {}) as Record<string, unknown>;
  const ideal = (client.ideal_patient ?? {}) as Record<string, string>;

  // ‼️ The substitutions are FROZEN VALUES, printed so a wrong one can be corrected on the call.
  // materializeAll is already built and tested; this never re-implements it.
  const substitutions = {
    city: (client.city as string) ?? "",
    state: (client.state as string) ?? "",
    treatmentPrimary: ideal.highest_margin ?? String(services.primary_service ?? "") ?? "",
    clientName: ((client.dba_name || client.legal_name) as string) ?? "",
    competitorIntake1: String(services.competitors ?? "").split(/[\n,;]/)[0]?.trim() ?? "",
    concern: MATERIALIZATION_FALLBACKS.concern,
    devicePrimary: MATERIALIZATION_FALLBACKS.devicePrimary,
  };

  const universal = materializeAll(substitutions);

  const data: CallSheetData = {
    clientName: ((client.dba_name || client.legal_name) as string) ?? "",
    legalName: (client.legal_name as string) ?? "",
    ownerEmail: (client.email as string | null) ?? null,
    language: (client.language as string) ?? "en",
    canonical,
    intel: (client.site_intel as SiteIntel | null) ?? null,
    domain,
    hubHost: `${label}.${domain}`,
    reviewsHost: `reviews.${domain}`,
    cnameTarget: (cname?.value as string) ?? process.env.HUB_CNAME_TARGET ?? "cname.vercel-dns.com",
    searchConsoleTxt: (txt?.value as string | null) ?? null,
    universal,
    substitutions,
    competitors,
    sweep,
    bookingSoftware: (client.booking_software as string | null) ?? null,
    reviewMode: (client.review_request_mode as string | null) ?? null,
    reviewOwner: (client.review_owner_name as string | null) ?? null,
    reviewDestination: (client.review_destination_primary as string) ?? "google",
    incentiveFlag: (client.review_incentive_flag as boolean) ?? false,
  };

  let buffer: Buffer;
  try {
    buffer = renderCallSheet(data);
  } catch (e) {
    return { ok: false, error: `render failed: ${(e as Error).message}` };
  }

  const warnings: string[] = [];
  if (!competitors.length) warnings.push("no competitors selected");
  if (!data.intel) warnings.push("site intelligence has not run, so the DNS provider is blank");
  if (data.intel && !data.intel.resolverHealthy) warnings.push("the DNS lookup failed, so the provider is unconfirmed");
  if (!data.searchConsoleTxt) warnings.push("no Search Console TXT value yet");
  if (data.incentiveFlag) warnings.push("intake flagged an incentive or a lobby tablet — that stops the call");

  const result = await deliverArtifact({
    clientId,
    stepKey: "call_sheet",
    filename: `Call sheet (internal) - ${data.clientName}.pdf`,
    buffer,
    message: [
      `:memo: Call sheet for *${data.clientName}*. Internal — do not send this to the client.`,
      `DNS: ${data.intel?.dnsProvider ?? "provider not identified"}. Hub: ${data.hubHost}. Reviews: ${data.reviewsHost}.`,
      warnings.length ? `:warning: ${warnings.join(" · ")}` : "Everything it needs is on the record.",
    ].join("\n"),
  });

  return { ok: result.ok, error: result.error, docId: result.docId };
}
