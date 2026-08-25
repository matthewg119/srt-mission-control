export const dynamic = "force-dynamic";
// Regenerate: new wording, same measured facts.
//
// ‼️ THIS IS THE WHOLE REASON THE SCAN IS STORED ON THE RUN ROW. Matthew asked for variations
// because three identical DMs read as a bot, and variations are only useful if getting another one
// is cheap. Re-running the scan would be a crawl, a classify, four engine calls and an extractor
// pass for a rewording; reading check_json back costs one model call and about four seconds.
//
// It also makes a stronger guarantee than cheapness: a redraft CANNOT drift onto different facts.
// There is exactly one scan behind a run, so every variant Matthew has ever seen for this profile
// rests on the same measured answers, and the angle is re-derived from them by the same gates.

import { NextRequest } from "next/server";
import { requireExtTenant, jsonCors, preflight } from "@/lib/ext-auth";
import { supabaseAdmin } from "@/lib/db";
import { draftDmVariants } from "@/lib/audit-engine/dm-pitch";
import { firstNameFrom } from "@/lib/instagram/profile";
import { factsFromRow, publishDmSet, type IgRunRow } from "@/lib/instagram/dm-run";

export const runtime = "nodejs";
// Drafting alone is one model call. It fits, so this one answers with the drafts rather than
// making the panel poll again.
export const maxDuration = 60;

export function OPTIONS(req: NextRequest) {
  return preflight(req);
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ runId: string }> }) {
  const tenant = await requireExtTenant(req);
  if (!tenant) return jsonCors(req, { ok: false, error: "unauthorized" }, 401);

  const { runId } = await ctx.params;

  let instructions: string | null = null;
  try {
    const body = (await req.json()) as { instructions?: string | null };
    instructions = body?.instructions?.trim() || null;
  } catch {
    // A bare POST with no body is the normal case: the Regenerate button sends nothing.
  }

  const { data } = await supabaseAdmin
    .from("ig_dm_runs")
    .select("id, contact_id, handle, website, status, lane, angle, check_json, variants, error_detail, created_at")
    .eq("tenant_id", tenant.tenantId)
    .eq("id", runId)
    .maybeSingle();

  const row = data as IgRunRow | null;
  if (!row) return jsonCors(req, { ok: false, error: "Run not found" }, 404);

  const { data: contact } = row.contact_id
    ? await supabaseAdmin
        .from("contacts")
        .select("business_name, first_name")
        .eq("id", row.contact_id)
        .maybeSingle()
    : { data: null };

  const businessName = (contact?.business_name as string) ?? row.handle;
  const facts = factsFromRow(row, businessName);
  if (!facts) {
    return jsonCors(
      req,
      {
        ok: false,
        error:
          "This run has no stored scan to redraft from, so there is nothing to reword. Start it again from the profile.",
      },
      409
    );
  }

  // The stored first name, not a re-derivation off the display name: if Matthew corrected it on
  // the lead, the correction is the better source and every redraft should use it.
  const firstName = (contact?.first_name as string) ?? null;
  const usableFirstName =
    firstName && firstName !== row.handle ? firstNameFrom(firstName) ?? firstName : null;

  const set = await draftDmVariants(facts, usableFirstName, 3, instructions);

  // writeNote:false — the timeline already carries this run. A note per press would bury the
  // scan's own entry under a stack of rewordings of the same finding.
  await publishDmSet({
    runId: row.id,
    contactId: row.contact_id,
    handle: row.handle,
    facts,
    set,
    writeNote: false,
  });

  return jsonCors(req, {
    ok: true,
    runId: row.id,
    status: "done",
    angle: set.angle,
    lane: set.lane,
    variants: set.variants,
    allRejected: set.allRejected,
  });
}
