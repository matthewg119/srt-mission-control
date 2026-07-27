// POST /api/audit/public-intake — secret-gated intake for the srtagency.com
// "Free Audit" funnel (a static-site form → api/free-audit-notify.js → here).
// Same trust model as /api/leads/funnel: server-to-server only, x-funnel-secret
// gated with the existing FUNNEL_NOTIFY_SECRET (no new secret needed).
//
// Two payload shapes, discriminated by `stage`:
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

  // Awaited, not backgrounded: the whole point is that the lead is in Slack and
  // Zoho before the audit starts, so a pipeline failure can never swallow it.
  const { contactId } = await ingestLead({
    firstName,
    lastName,
    email,
    phone,
    website,
    source,
    zohoLeadSource: ZOHO_LEAD_SOURCE,
    noteTitle: "Free AI Visibility Audit request",
    headline: `:mag: *AI visibility audit running now* on ${website}. The report lands in this thread in a few minutes.`,
    detailLines: [
      `Website: ${website}`,
      qStage ? `Stage: ${STAGE_LABELS[qStage] ?? qStage}` : "",
      qInvest ? `Ready to invest: ${INVEST_LABELS[qInvest] ?? qInvest}` : "",
      body.smsConsent === true
        ? `SMS consent: agreed${consentTs ? ` at ${consentTs}` : ""}`
        : "SMS consent: not given",
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
      allowLowConfidenceCity: true,
      onError: async (message) => console.error("[audit/public-intake] pipeline error:", message),
    })
  );

  return NextResponse.json({ ok: true, contactId });
}
