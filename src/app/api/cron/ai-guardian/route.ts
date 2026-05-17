export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const maxDuration = 300;

async function handle(_req: NextRequest) {
  return NextResponse.json({ ok: false, disabled: true, reason: "guardian paused" }, { status: 200 });
}

export async function GET(req: NextRequest) { return handle(req); }
export async function POST(req: NextRequest) { return handle(req); }
