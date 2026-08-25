export const dynamic = "force-dynamic";
// What the panel polls while a run is going.
//
// Returns the run row and nothing else: the drafts, the angle, and the questions the scan actually
// asked. ‼️ THE QUESTIONS AND VERDICTS ARE PART OF THE RESPONSE, not just of the Slack card. The DM
// states one finding as fact and the only way to know whether that fact is right is to see what it
// came from, and the person about to press send is looking at this panel, not at Slack.

import { NextRequest } from "next/server";
import { requireExtTenant, jsonCors, preflight } from "@/lib/ext-auth";
import { supabaseAdmin } from "@/lib/db";
import { dmSubjectOf } from "@/lib/audit-engine/dm-pitch";
import { factsFromRow, leadUrl, profileUrl, type IgRunRow } from "@/lib/instagram/dm-run";

export const runtime = "nodejs";
export const maxDuration = 30;

export function OPTIONS(req: NextRequest) {
  return preflight(req);
}

export async function GET(req: NextRequest, ctx: { params: Promise<{ runId: string }> }) {
  const tenant = await requireExtTenant(req);
  if (!tenant) return jsonCors(req, { ok: false, error: "unauthorized" }, 401);

  const { runId } = await ctx.params;

  const { data } = await supabaseAdmin
    .from("ig_dm_runs")
    .select("id, contact_id, handle, website, status, lane, angle, check_json, variants, error_detail, created_at")
    // Tenant-scoped, so a token can only ever read its own runs.
    .eq("tenant_id", tenant.tenantId)
    .eq("id", runId)
    .maybeSingle();

  const row = data as IgRunRow | null;
  if (!row) return jsonCors(req, { ok: false, error: "Run not found" }, 404);

  // The business name is only needed to rebuild no-website facts, where it is not on the check.
  const { data: contact } = row.contact_id
    ? await supabaseAdmin
        .from("contacts")
        .select("business_name")
        .eq("id", row.contact_id)
        .maybeSingle()
    : { data: null };

  const facts = factsFromRow(row, (contact?.business_name as string) ?? row.handle);
  const subject = facts ? dmSubjectOf(facts) : null;

  return jsonCors(req, {
    ok: true,
    runId: row.id,
    status: row.status,
    lane: row.lane,
    angle: row.angle,
    handle: row.handle,
    website: row.website,
    profileUrl: profileUrl(row.handle),
    contactId: row.contact_id,
    leadUrl: leadUrl(row.contact_id),
    variants: Array.isArray(row.variants) ? row.variants : [],
    error: row.error_detail,
    // What the claim rests on. Shown under the drafts in the panel.
    evidence: subject
      ? {
          businessName: subject.businessName,
          trade: subject.trade,
          city: subject.city,
          measuredCount: subject.measuredCount,
          appearedCount: subject.appearedCount,
          topRivals: subject.topRivals,
          // The panel says whether this was a local scan or a national one, because "absent in
          // Coral Gables" and "absent in the United States" are very different findings.
          cityless: subject.cityless,
          questions: subject.questions,
        }
      : null,
  });
}
