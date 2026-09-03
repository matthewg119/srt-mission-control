// Test mode. The whole funnel runs; nothing escapes the funnel.
//
// ‼️ DECIDED SERVER-SIDE, FROM THE HOST, AND THE CLIENT CANNOT ASK FOR IT.
// The first version of this was a client-side flag that skipped the POST entirely, which meant
// the one thing you could not test on a preview was the signature: no PDF, no chatbot handoff,
// no booking screen. That is backwards. Everything now runs for real and the SIDE EFFECTS are
// what get suppressed, so a preview walk-through exercises the same code production will.
//
// ‼️ THERE IS NO WAY TO TURN THIS ON IN PRODUCTION AND NO WAY TO TURN IT OFF ON A PREVIEW.
// A ?demo=1 escape hatch on production would let a real signer produce a signature that looks
// valid, renders a PDF, emails nothing and provisions nothing. A ?live=1 hatch on a preview
// would let a stray click take one of six client seats. Both directions are refused: the host
// decides, full stop.
//
// WHAT DEMO MODE STILL DOES: writes the signing, the initials, the chat turns and the lead row,
// flagged is_demo, because the session token has to resolve to a row for any of this to work at
// all. It renders the real PDF from the real snapshot and serves it. The assistant answers for
// real and costs real tokens, which is the point of testing it.
//
// WHAT IT NEVER DOES: no startPilot, so no clients row and no seat taken out of six. No
// ingestLead, so nothing reaches contacts, the CRM, #hot-leads or Speed to Lead. No Slack post
// of any kind. No email to the signer and none to matthew@. No onboarding token minted.
//
// Purge everything a week of testing produced (the two logs cascade, the lead row does not):
//
//   delete from public.onboarding2_leads where is_demo;
//   delete from public.onboarding2_signings where is_demo;

import type { NextRequest } from "next/server";

/** Hosts where a walk-through must never touch anything real. */
export function isDemoHost(host: string | null | undefined): boolean {
  const h = (host ?? "").toLowerCase().split(":")[0];
  if (!h) return false;
  return h === "localhost" || h === "127.0.0.1" || h.endsWith(".vercel.app");
}

/**
 * ‼️ READS THE `host` HEADER, NOT x-forwarded-host.
 *
 * x-forwarded-host is caller-supplied and would let anybody put production into demo mode by
 * hand-crafting one header, which turns every signature that day into a no-op nobody notices.
 * On Vercel, `host` is the deployment or custom domain actually serving the request. Production
 * reaches this app as mission.srtagency.com even for srtagency.com/onboarding2, because that is
 * a rewrite rather than a redirect, so production never matches the preview test.
 */
export function isDemoRequest(req: NextRequest): boolean {
  return isDemoHost(req.headers.get("host"));
}
