// The buttons under "How can we help you today?", one route.
//
// Matthew, 2026-09-15: "It should start with 'how can we help you today?' and as buttons ... Get Free AI
// Visibility audit (3 min) and another button that says the lead magnet ... and a third option where they
// can type for help, always ask for email in case we lose connection ... and name."
//
//   contact       name + email, before anything else is handed over
//   magnet        the page's offer, handed over deterministically (no model decides what is given)
//   audit_start   a website, then the same self-serve scan srtagency.com/scan runs
//   audit_status  where that scan is, claimed with their email the moment its report exists
//
// ‼️ PUBLIC, SO THE SESSION IS THE GATE. Every action needs a session token, and a session is minted only
// by /api/concierge/start, which is where `enabled` and the preview grant are checked. The tenant, the
// audience and what has already been handed over are read off the row, never off this request.
//
// ‼️ WHOSE LEAD IT IS DEPENDS ON THE AUDIENCE. On SRT's own widget (owner) the visitor is OUR prospect, so
// the contact goes through ingestLead like every funnel. On a client's widget (patient) the visitor is the
// CLIENT's customer: they are kept on the session row only and never enter SRT's CRM or #hot-leads.

import { NextRequest, NextResponse } from "next/server";
import { loadConciergeConfig } from "@/lib/concierge/config";
import { conciergeAllowed, PREVIEW_TOKEN_PARAM } from "@/lib/concierge/preview-grant";
import { allowedMagnet } from "@/lib/concierge/engine";
import { deliveryUrlFor } from "@/lib/concierge/magnets";
import { appendMessage, captureLead, loadConciergeSession, loadMessages, recordDelivered } from "@/lib/concierge/session";
import { claimScan, isEmail, startScan } from "@/lib/scan/start-claim";
import { buildStatusPayload, clientIpFrom, getSession, hashIp } from "@/lib/scan/session";
import { supabaseAdmin } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";
export const maxDuration = 60;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function reply(body: Record<string, unknown>, status = 200): NextResponse {
  return NextResponse.json(body, { status, headers: { "cache-control": "no-store" } });
}

function clean(v: unknown, max: number): string {
  return String(v ?? "").replace(/\s+/g, " ").trim().slice(0, max);
}

async function note(sessionId: string, role: "user" | "assistant", text: string): Promise<void> {
  const history = await loadMessages(sessionId);
  await appendMessage(sessionId, role, text, history.length);
}

export async function POST(req: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return reply({ error: "Bad request" }, 400);
  }

  const session = await loadConciergeSession(String(body.token ?? ""));
  if (!session) return reply({ error: "Not found" }, 404);

  const { data: client } = await supabaseAdmin.from("clients").select("slug").eq("id", session.clientId).maybeSingle();
  const config = client?.slug ? await loadConciergeConfig(String(client.slug)) : null;
  const previewToken = new URL(req.url).searchParams.get(PREVIEW_TOKEN_PARAM);
  if (!config || !conciergeAllowed(config, previewToken)) return reply({ error: "Not found" }, 404);

  const action = String(body.action ?? "");

  // ── contact ────────────────────────────────────────────────────────────────
  if (action === "contact") {
    const name = clean(body.name, 60);
    const email = clean(body.email, 120).toLowerCase();
    if (name.length < 2 || /[<>{}]|https?:/i.test(name)) return reply({ ok: false, field: "name", message: "What should we call you?" }, 400);
    if (!isEmail(email)) return reply({ ok: false, field: "email", message: "That email does not look right." }, 400);

    const already = session.email === email;
    await captureLead(session, { firstName: name, email });
    const picked = clean(body.picked, 20);
    await note(session.id, "user", `${name} <${email}>${picked ? ` (picked: ${picked})` : ""}`);

    if (config.audience === "owner" && !already) {
      const { ingestLead } = await import("@/lib/lead-intake");
      const parts = name.split(" ").filter(Boolean);
      const where = [clean(body.host, 200), clean(body.path, 300)].join("");
      const { contactId } = await ingestLead({
        firstName: parts[0] ?? "",
        lastName: parts.slice(1).join(" "),
        email,
        source: "concierge",
        speedToLead: false,
        noteTitle: "AI concierge conversation",
        headline: `:cat: *Started a conversation with the concierge*${where ? ` on ${where}` : ""} and gave their email.`,
        detailLines: [picked ? `Picked: ${picked}` : "", where ? `Page: ${where}` : "", "SMS consent: not collected (the concierge asks for email only)"],
      }).catch((e) => {
        console.error(`[concierge/action] ingestLead failed: ${(e as Error).message}`);
        return { contactId: null };
      });
      if (contactId) {
        await supabaseAdmin.from("concierge_sessions").update({ contact_id: contactId }).eq("id", session.id);
      }
    }
    return reply({ ok: true, firstName: name.split(" ")[0] });
  }

  // Everything below hands something over, and nothing is handed over before a way to reach them.
  if (!session.email) return reply({ ok: false, needContact: true }, 400);

  // ── magnet ─────────────────────────────────────────────────────────────────
  if (action === "magnet") {
    const magnet = await allowedMagnet({ config, session });
    if (!magnet || !magnet.magnetKey) {
      return reply({ ok: true, magnet: null, message: "I have already sent you everything I have for this page. Ask me anything else." });
    }
    const url = await deliveryUrlFor(magnet);
    if (!url) return reply({ ok: true, magnet: null, message: "That one is not ready to send yet. Type your question and I will help directly." });
    await recordDelivered(session, magnet.magnetKey, magnet.id);
    await note(session.id, "assistant", `Sent: ${magnet.title}`);
    return reply({ ok: true, magnet: { title: magnet.title, promise: magnet.promise, url, cta: magnet.ctaLabel || "Open it" } });
  }

  // The audit is SRT's product, offered to a business owner. It is not a button a patient ever sees.
  if ((action === "audit_start" || action === "audit_status") && config.audience !== "owner") {
    return reply({ error: "Not found" }, 404);
  }

  // ── audit_start ────────────────────────────────────────────────────────────
  if (action === "audit_start") {
    const website = clean(body.website, 300);
    const started = await startScan({ url: website, ipHash: hashIp(clientIpFrom(req)) });
    if (!started.ok) return reply({ ok: false, message: started.message ?? "That site could not be scanned." }, started.status);
    await note(session.id, "user", `Audit: ${started.domain}`);
    return reply({ ok: true, scanId: started.id, domain: started.domain, cached: started.cached });
  }

  // ── audit_status ───────────────────────────────────────────────────────────
  if (action === "audit_status") {
    const scanId = clean(body.scanId, 40);
    if (!UUID.test(scanId)) return reply({ error: "Not found" }, 404);
    const scan = await getSession(scanId);
    if (!scan) return reply({ error: "Not found" }, 404);

    // Claimed the moment a report row exists, because finish-report.ts reads requester_email when the run
    // ENDS (see the claim route's header): a claim after that drafts nothing.
    let reportUrl: string | null = null;
    if (scan.report_id || scan.status === "done") {
      const claimed = await claimScan({
        sessionId: scanId,
        email: session.email,
        name: session.firstName ?? "",
        source: "concierge",
        funnel: `concierge (${config.slug})`,
      });
      if (claimed.ok) reportUrl = claimed.reportUrl;
    }
    const payload = await buildStatusPayload(scan);
    // A subset: the stepped page's payload also carries competitor names and prompts, which belong on the
    // report the email unlocks, not in a chat bubble before it.
    return reply({
      ok: true,
      status: payload.status,
      reportUrl,
      step: payload.activeStep,
      engine: payload.engine,
      error: payload.error,
    });
  }

  return reply({ error: "Unknown action" }, 400);
}
