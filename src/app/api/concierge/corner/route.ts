// Where the launcher rests, set by dragging it on our own preview.
//
// Matthew, 2026-09-16: "Also allow me to move the concierge around."
//
// ‼️ A PREVIEW TOKEN, NOT `conciergeAllowed`, AND THAT IS THE WHOLE SECURITY OF THIS ROUTE. Every
// other route in the lane asks "may this caller talk to a switched-off tenant", and answers yes for
// a live one. This one is a WRITE against tenant configuration, so an enabled tenant must not be a
// reason to accept it: otherwise any visitor to any client's live site could move that client's
// widget for everybody by posting here. Only somebody holding a link we minted for this client in
// the last fourteen days may write, which is Matthew on the demo page and nobody else.
//
// ‼️ IT PERSISTS THE CORNER AND NOTHING ELSE. Not a pixel offset. The widget snaps to one of four on
// release (see embed.js), because the panel is 580px tall and has to open on the far side of the
// launcher from the nearest edge. Storing free coordinates would let a person park a widget half off
// the bottom of a phone and would give this route an unbounded value to validate.

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/db";
import { isLauncherCorner, loadConciergeConfig } from "@/lib/concierge/config";
import { previewGrant, PREVIEW_TOKEN_PARAM } from "@/lib/concierge/preview-grant";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const token = new URL(req.url).searchParams.get(PREVIEW_TOKEN_PARAM);
  if (!token) return NextResponse.json({ ok: false }, { status: 404 });

  let body: { c?: unknown; corner?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ ok: false }, { status: 400 });
  }

  const slug = typeof body.c === "string" ? body.c.trim().toLowerCase() : "";
  const corner = body.corner;
  if (!slug || !isLauncherCorner(corner)) return NextResponse.json({ ok: false }, { status: 400 });

  const config = await loadConciergeConfig(slug);
  // 404 for an unknown tenant AND for a token that does not belong to it, for the reason
  // preview-grant.ts gives: a different answer per reason is a way to learn what exists.
  if (!config || !previewGrant(token, config.clientId)) {
    return NextResponse.json({ ok: false }, { status: 404 });
  }

  const { error } = await supabaseAdmin
    .from("concierge_configs")
    .update({ launcher_corner: corner, updated_at: new Date().toISOString() })
    .eq("client_id", config.clientId);
  if (error) return NextResponse.json({ ok: false }, { status: 500 });

  const { revalidateTag } = await import("next/cache");
  try {
    revalidateTag("concierge-config");
  } catch {
    /* outside a request the five minute cache covers it */
  }

  return NextResponse.json({ ok: true, corner }, { headers: { "cache-control": "no-store" } });
}
