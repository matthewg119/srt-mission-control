export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { setLeadStatus } from "@/lib/crm";
import { STAGE_NAMES } from "@/config/stage-display";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth().catch(() => null);
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const status = String(body.status ?? "").trim();
  if (!status) {
    return NextResponse.json({ error: "status is required" }, { status: 400 });
  }
  if (!STAGE_NAMES.includes(status)) {
    return NextResponse.json(
      { error: `Unknown status "${status}"`, validStatuses: STAGE_NAMES },
      { status: 400 }
    );
  }

  const res = await setLeadStatus({
    contactId: id,
    status,
    reason: body.reason ? String(body.reason) : undefined,
    origin: "mission_control",
    actor: session.user.email ?? "mission_control",
  });

  if (!res.ok) {
    return NextResponse.json({ error: res.error ?? "status update failed" }, { status: 500 });
  }
  return NextResponse.json({ ...res, ok: true });
}
