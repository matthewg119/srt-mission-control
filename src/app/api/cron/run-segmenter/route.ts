import { NextRequest, NextResponse } from "next/server";
import { runSegmenter } from "@/lib/ai-intel/sequence-segmenter";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = req.headers.get("authorization") ?? "";
    if (auth !== `Bearer ${secret}`) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
  }

  try {
    const result = await runSegmenter();
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    console.error("[cron/run-segmenter] failed:", (e as Error).message);
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}

// Allow manual trigger from browser during dev
export async function GET(req: NextRequest) {
  return POST(req);
}
