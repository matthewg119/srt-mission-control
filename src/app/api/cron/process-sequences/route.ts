export const dynamic = "force-dynamic";
import { NextResponse } from "next/server";

export async function GET() {
  return NextResponse.json({ ok: false, disabled: true, reason: "email marketing paused" });
}
