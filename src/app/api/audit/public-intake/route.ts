// POST /api/audit/public-intake — secret-gated intake for the srtagency.com
// "Free Audit" funnel (a static-site form → api/free-audit-notify.js → here).
// Same trust model as /api/leads/funnel: server-to-server only, x-funnel-secret
// gated with the existing FUNNEL_NOTIFY_SECRET (no new secret needed).
//
// Three payload shapes, discriminated by `stage`:
//
//   "lead" (the default, and what /contact sends with no stage at all) — the
//     full inbound-lead stack via ingestLead (Supabase contact + Zoho lead +
//     #hot-leads thread + Speed-to-Lead), THEN the audit. The lead lands in
//     Slack within seconds; the finished report replies in that same thread
//     minutes later (see finish-report.ts).
//
//   "answers" — the two post-lead quiz answers, joined on email. Appends to the
//     lead that already exists. Never starts a second audit.
//
//   "partial" — the /PDF med spa guide funnel, which collects contact details
//     across three points instead of one. Goes through ingestLead, NOT
//     enrichLead: enrichLead can only write a Zoho note, and this funnel asks
//     for the phone on its last screen, so the phone would never reach the Zoho
//     Phone field or Speed-to-Lead. ingestLead matches the existing contact on
//     email and updates it, so calling it more than once per lead is safe. It
//     never starts an audit; only "lead" does.
//
// Unlike the Slack /audit command, this has no thread to ask a follow-up
// question in — so a low-confidence city doesn't block the run, it just
// proceeds on the best guess (see runAuditPipeline's allowLowConfidenceCity).

import { NextRequest, NextResponse } from "next/server";
import { waitUntil } from "@vercel/functions";
import { runAuditPipeline } from "@/lib/audit-engine/run-audit-pipeline";
import { ingestLead, enrichLead } from "@/lib/lead-intake";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const ZOHO_LEAD_SOURCE = "AI Visibility Audit";
const ZOHO_LEAD_SOURCE_GUIDE = "Med Spa Guide";

/** The /PDF funnel and the /audit funnel both land here; keep them separable in Zoho. */
function zohoLeadSourceFor(source: string): string {
  return source === "pdf" ? ZOHO_LEAD_SOURCE_GUIDE : ZOHO_LEAD_SOURCE;
}

function clean(v: unknown, max = 200): string {
  if (v === undefined || v === null) return "";
  return String(v).replace(/\s+/g, " ").trim().slice(0, max);
}

function isEmail(v: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v);
}

function isUrl(v: string): boolean {
  try {
    const u = new URL(/^https?:\/\//i.test(v) ? v : `https://${v}`);
    return !!u.hostname && u.hostname.includes(".");
  } catch {
    return false;
  }
}

// Funnel answer values → what a human wants to read in Slack and Zoho.
const STAGE_LABELS: Record<string, string> = {
  new: "Brand new and bootstrapping",
  referrals: "Established but all referrals",
  paying: "Established and already paying to grow",
};
const INVEST_LABELS: Record<string, string> = {
  ready: "Ready to invest in getting patients",
  setup: "Focused on setup first, growth later",
};
const PAYING_LABELS: Record<string, string> = {
  agency: "Yes, has a marketing agency",
  self: "No, does everything on their own",
  inhouse: "Has an in house team",
  frontdesk: "Front desk handles appointments and new clients",
  other: "Other",
};
const BREAKS_LABELS: Record<string, string> = {
  phones: "Phones / front desk",
  schedule: "Schedule",
  followup: "Follow-up",
  nothing: "Nothing, could handle it",
};
// /PDF guide funnel only.
const B1_LABELS: Record<string, string> = {
  yes_checked: "Has asked ChatGPT, and checked whether their clinic came up",
  yes_unchecked: "Has asked ChatGPT, but never checked their own clinic",
  no: "Did not know patients ask AI for a provider",
};
/** The belief answers, rendered for Slack and the Zoho note. Blanks are dropped downstream. */
function beliefLines(body: Record<string, unknown>): string[] {
  const b1 = clean(body.b1, 40);
  const paying = clean(body.paying, 40);
  const payingOther = clean(body.payingOther, 80);
  const breaks = clean(body.breaks, 40);
  return [
    b1 ? `Asked ChatGPT themselves: ${B1_LABELS[b1] ?? b1}` : "",
    paying
      ? `Pays anyone to bring patients in: ${PAYING_LABELS[paying] ?? paying}${
          payingOther ? `, ${payingOther}` : ""
        }`
      : "",
    breaks ? `Breaks first at 20 new patients: ${BREAKS_LABELS[breaks] ?? breaks}` : "",
  ];
}

export async function POST(req: NextRequest) {
  const secret = process.env.FUNNEL_NOTIFY_SECRET;
  if (!secret || req.headers.get("x-funnel-secret") !== secret) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "bad_json" }, { status: 400 });
  }

  const stage = clean(body.stage, 20) || "lead";
  const email = clean(body.email, 120).toLowerCase();

  // ── Post-lead quiz answers: append to the existing lead, no audit. ──
  if (stage === "answers") {
    if (!email || !isEmail(email)) {
      return NextResponse.json({ ok: false, error: "missing_or_invalid_email" }, { status: 400 });
    }
    const paying = clean(body.paying, 40);
    const payingOther = clean(body.payingOther, 80);
    const breaks = clean(body.breaks, 40);

    const found = await enrichLead({
      email,
      headline: ":clipboard: *Funnel answers* (after the audit kicked off)",
      noteTitle: "AI Visibility Audit — funnel answers",
      detailLines: [
        paying
          ? `Pays anyone to bring patients in: ${PAYING_LABELS[paying] ?? paying}${
              payingOther ? ` — ${payingOther}` : ""
            }`
          : "",
        breaks ? `Breaks first at 20 new patients: ${BREAKS_LABELS[breaks] ?? breaks}` : "",
      ],
    }).catch((err) => {
      console.error("[audit/public-intake] enrich failed:", err instanceof Error ? err.message : err);
      return false;
    });

    return NextResponse.json({ ok: true, matched: found });
  }

  // ── /PDF guide funnel: progress posts either side of the lead. No audit. ──
  if (stage === "partial") {
    if (!email || !isEmail(email)) {
      return NextResponse.json({ ok: false, error: "missing_or_invalid_email" }, { status: 400 });
    }
    const step = clean(body.step, 20) === "complete" ? "complete" : "contact";
    const partialSource = clean(body.source, 40) || "pdf";
    const partialRaw = clean(body.website, 200);
    const partialSite = isUrl(partialRaw)
      ? partialRaw.startsWith("http")
        ? partialRaw
        : `https://${partialRaw}`
      : "";
    const partialName = clean(body.name, 80).split(" ").filter(Boolean);
    const partialPhone = clean(body.phone, 20).replace(/[^\d+]/g, "");
    const qStagePartial = clean(body.qStage, 40);
    const qInvestPartial = clean(body.qInvest, 40);

    const isComplete = step === "complete";
    // The complete step deliberately carries no phone: the lead beacon already
    // delivered it and fired Speed-to-Lead, so re-sending would only bounce off
    // the 30 minute cooldown. Do NOT reintroduce a "no phone given" line here,
    // it would read as fact on every guide lead while their number sits in the
    // lead card two messages up.
    const { contactId: partialContactId } = await ingestLead({
      firstName: partialName[0] || "",
      lastName: partialName.slice(1).join(" ") || "",
      email,
      phone: partialPhone,
      website: partialSite,
      source: partialSource,
      zohoLeadSource: zohoLeadSourceFor(partialSource),
      noteTitle: isComplete ? "Clinic guide, funnel completed" : "Clinic guide, funnel started",
      headline: isComplete
        ? ":white_check_mark: *Guide funnel completed.* Everything below is their own words from the questions."
        : `:page_facing_up: *Clinic guide requested* for ${partialSite || "their site"}. Still answering the questions.`,
      detailLines: isComplete
        ? [...beliefLines(body), `Funnel: /${partialSource}`]
        : [
            partialSite ? `Website: ${partialSite}` : "",
            qStagePartial ? `Stage: ${STAGE_LABELS[qStagePartial] ?? qStagePartial}` : "",
            qInvestPartial ? `Ready to invest: ${INVEST_LABELS[qInvestPartial] ?? qInvestPartial}` : "",
            `Funnel: /${partialSource}`,
          ],
    });

    return NextResponse.json({ ok: true, step, contactId: partialContactId });
  }

  // ── The lead itself. ──
  const name = clean(body.name, 80);
  const phone = clean(body.phone, 20).replace(/[^\d+]/g, "");
  const rawWebsite = clean(body.website, 200);
  const website = isUrl(rawWebsite)
    ? rawWebsite.startsWith("http")
      ? rawWebsite
      : `https://${rawWebsite}`
    : "";

  if (!website) {
    return NextResponse.json({ ok: false, error: "missing_or_invalid_website" }, { status: 400 });
  }
  if (!email || !isEmail(email)) {
    return NextResponse.json({ ok: false, error: "missing_or_invalid_email" }, { status: 400 });
  }

  const nameParts = name.split(" ").filter(Boolean);
  const firstName = nameParts[0] || "";
  const lastName = nameParts.slice(1).join(" ") || "";
  const qStage = clean(body.qStage, 40);
  const qInvest = clean(body.qInvest, 40);
  const source = clean(body.source, 40) || "audit";
  const consentTs = clean(body.consentTs, 40);

  const isGuide = source === "pdf";

  // Awaited, not backgrounded: the whole point is that the lead is in Slack and
  // Zoho before the audit starts, so a pipeline failure can never swallow it.
  const { contactId } = await ingestLead({
    firstName,
    lastName,
    email,
    phone,
    website,
    source,
    zohoLeadSource: zohoLeadSourceFor(source),
    noteTitle: isGuide ? "Clinic guide request" : "Free AI Visibility Audit request",
    headline: isGuide
      ? `:mag: *Audit running now* on ${website} to build their guide. The report goes to #ai-visibility-audits; this thread keeps the lead and their answers.`
      : `:mag: *AI visibility audit running now* on ${website}. The report lands in this thread in a few minutes.`,
    detailLines: [
      `Website: ${website}`,
      qStage ? `Stage: ${STAGE_LABELS[qStage] ?? qStage}` : "",
      qInvest ? `Ready to invest: ${INVEST_LABELS[qInvest] ?? qInvest}` : "",
      // The /PDF funnel stopped asking for SMS consent, so it always posts false.
      // Say so plainly rather than silently: this contact is callable, not textable.
      isGuide
        ? "SMS consent: not collected (guide funnel asks for the number only)"
        : body.smsConsent === true
          ? `SMS consent: agreed${consentTs ? ` at ${consentTs}` : ""}`
          : "SMS consent: not given",
      // Guide leads answer the belief questions AFTER this beacon, so these are
      // empty here and arrive on the stage:"partial" step:"complete" post.
      ...(isGuide ? beliefLines(body) : []),
      `Funnel: /${source}`,
    ],
  });

  // Ack now; the audit (research → classify → 20 prompts → report) runs in the
  // background and posts back into the thread we just opened.
  waitUntil(
    runAuditPipeline({
      website,
      requesterName: name || undefined,
      requesterEmail: email,
      requesterPhone: phone || undefined,
      contactId: contactId ?? undefined,
      leadSource: source,
      allowLowConfidenceCity: true,
      onError: async (message) => console.error("[audit/public-intake] pipeline error:", message),
    })
  );

  return NextResponse.json({ ok: true, contactId });
}
