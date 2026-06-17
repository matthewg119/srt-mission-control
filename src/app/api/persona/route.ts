// Bot persona — live-editable stage prompts + style profile.
//
//   GET            → all active persona rows for the tenant (stage 1..4 + base/null)
//   PUT {stage, prompt, style_profile, updated_by}
//                  → deactivate the current active row for that (tenant, stage) and
//                    insert a new active row (version bumped). Order matters: the
//                    partial-unique index rejects two active rows per (tenant, stage).
//
// The next draft picks up the change immediately — no deploy.

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/db";
import { resolveTenantId } from "@/lib/persona";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const tenantId = await resolveTenantId();
  if (!tenantId) return NextResponse.json({ error: "tenant not found" }, { status: 500 });

  const { data, error } = await supabaseAdmin
    .from("bot_persona")
    .select("id, stage, prompt, style_profile, version, updated_by, updated_at")
    .eq("tenant_id", tenantId)
    .eq("is_active", true)
    .order("stage", { ascending: true, nullsFirst: true });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ persona: data ?? [] });
}

export async function PUT(req: NextRequest) {
  const body = await req.json().catch(() => null);
  if (!body || typeof body.prompt !== "string" || !body.prompt.trim()) {
    return NextResponse.json({ error: "prompt required" }, { status: 400 });
  }
  const tenantId = await resolveTenantId();
  if (!tenantId) return NextResponse.json({ error: "tenant not found" }, { status: 500 });

  const rawStage = body.stage;
  const stage = rawStage === null || rawStage === undefined || rawStage === "" ? null : Math.max(1, Math.min(4, Number(rawStage)));
  const styleProfile = body.style_profile ?? null;
  const updatedBy = (body.updated_by as string | undefined) ?? "simulator";

  // Find the current active row for this (tenant, stage) to compute next version.
  let priorQuery = supabaseAdmin
    .from("bot_persona")
    .select("id, version")
    .eq("tenant_id", tenantId)
    .eq("is_active", true);
  priorQuery = stage === null ? priorQuery.is("stage", null) : priorQuery.eq("stage", stage);
  const { data: prior } = await priorQuery.maybeSingle();

  // Deactivate the old active row FIRST (partial-unique index needs this order).
  if (prior?.id) {
    const { error: deErr } = await supabaseAdmin
      .from("bot_persona")
      .update({ is_active: false })
      .eq("id", prior.id);
    if (deErr) return NextResponse.json({ error: deErr.message }, { status: 500 });
  }

  const nextVersion = (prior?.version as number | undefined) ? (prior!.version as number) + 1 : 1;

  const { data, error } = await supabaseAdmin
    .from("bot_persona")
    .insert({
      tenant_id: tenantId,
      stage,
      prompt: body.prompt.trim(),
      style_profile: styleProfile,
      is_active: true,
      version: nextVersion,
      updated_by: updatedBy,
    })
    .select("id, stage, prompt, style_profile, version, updated_by, updated_at")
    .single();
  if (error) {
    // If the unique index tripped, surface it clearly.
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ persona: data });
}
