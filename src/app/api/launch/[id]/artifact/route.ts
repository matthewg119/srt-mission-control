// File an artifact against a Launch Lane step: a screenshot, a scan, a photo of the cards.
//
// ‼️ THIS IS HOW THE FILED TIER EXISTS AT ALL IN A LANE WITH NO SLACK.
// Four steps are confirmed by evidence a person produces rather than state the app can observe:
// the Day-0 archive, GBP access, GBP buildout and the review cards. In the Slack lane those
// arrive as files in a step thread and `client_docs.delivery_step_key` records which step they
// belong to. That column is free text and shared, so the same mechanism works here with a launch
// step key in it, and every existing reader keeps working.
//
// `source: 'board'` and not 'generated'. The second would say WE produced the screenshot, which
// is backwards, and doc-text.ts excludes 'generated' from the buyer evidence corpus.

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/db";
import { isLaunchStepKey } from "@/config/launch-steps";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

const BUCKET = "onboarding";
const MAX_BYTES = 25 * 1024 * 1024;

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth().catch(() => null);
  if (!session?.user) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const stepKey = new URL(req.url).searchParams.get("stepKey") ?? "";

  let q = supabaseAdmin
    .from("client_docs")
    .select("id, filename, delivery_step_key, uploaded_at, uploaded_by")
    .eq("client_id", id);
  if (stepKey) q = q.eq("delivery_step_key", stepKey);

  // ‼️ uploaded_at, NEVER created_at. client_docs has no created_at column, and one unknown name
  // fails the whole PostgREST select while supabase-js RETURNS rather than throws.
  const { data, error } = await q.order("uploaded_at", { ascending: false });
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, artifacts: data ?? [] });
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth().catch(() => null);
  if (!session?.user) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });

  const { id } = await params;

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ ok: false, error: "Send this as multipart form data." }, { status: 400 });
  }

  const stepKey = String(form.get("stepKey") ?? "");
  if (!isLaunchStepKey(stepKey)) {
    return NextResponse.json({ ok: false, error: `"${stepKey}" is not a Launch Lane step.` }, { status: 400 });
  }

  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ ok: false, error: "No file was attached." }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json(
      { ok: false, error: `That file is ${Math.round(file.size / 1024 / 1024)}MB. The limit is 25MB.` },
      { status: 400 }
    );
  }

  const ext = (file.name.split(".").pop() || "bin").toLowerCase().replace(/[^a-z0-9]/g, "");
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const key = `${id}/board/${stepKey}-${stamp}.${ext}`;

  const bytes = Buffer.from(await file.arrayBuffer());
  const up = await supabaseAdmin.storage.from(BUCKET).upload(key, bytes, {
    contentType: file.type || "application/octet-stream",
    upsert: false,
  });
  if (up.error) {
    return NextResponse.json({ ok: false, error: `Upload failed: ${up.error.message}` }, { status: 500 });
  }

  const { data, error } = await supabaseAdmin
    .from("client_docs")
    .insert({
      client_id: id,
      filename: file.name,
      content_type: file.type || "application/octet-stream",
      size_bytes: bytes.byteLength,
      storage_ref: key,
      // The bucket is private, so a stored URL would be a dead link. Minted on request instead.
      web_url: null,
      delivery_step_key: stepKey,
      source: "board",
      slack_file_id: null,
      slack_thread_ts: null,
      uploaded_by: session.user.name ?? session.user.email ?? "the dashboard",
    })
    .select("id, filename")
    .maybeSingle();

  if (error) {
    // The bytes are already in the bucket. Left there deliberately: an orphan object costs
    // storage, and deleting it on a failed insert risks removing one that a concurrent retry has
    // just succeeded with. The purge story for this bucket is a separate concern.
    return NextResponse.json(
      {
        ok: false,
        error:
          /client_docs_source_check/.test(error.message)
            ? "client_docs.source does not allow 'board' yet. Section 7 of docs/2026-09-30-launch-lane.sql has not been run against this database."
            : error.message,
      },
      { status: 500 }
    );
  }

  return NextResponse.json({ ok: true, artifact: data });
}
