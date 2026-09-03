// GET /px.js  ->  the SRT first-party pixel.
//
// ‼️ A ROUTE HANDLER RATHER THAN A FILE IN public/, AND THAT IS A SECURITY DECISION RATHER THAN
// A STYLE ONE. Anything in public/ is served for EVERY hostname this deployment answers for,
// including the client hub hosts whose DNS a client controls. That is the exact trap
// public/robots.txt fell into (see CLAUDE.md), and the fix there was the same move: a handler.
//
// ‼️ NO `export const revalidate`. That is a FULL-ROUTE cache and revalidateTag() does not reach
// it, which is the lesson the hub's robots/sitemap handlers already record. `s-maxage` on the
// response is what keeps the CDN from hitting the origin for every page view on every client
// site, and it is short enough that a snippet fix propagates within the hour.

import { NextResponse } from "next/server";
import { pixelSource } from "@/lib/attribution/snippet";
import { appUrl } from "@/lib/onboarding2/constants";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const body = pixelSource(`${appUrl()}/api/px/collect`);
  return new NextResponse(body, {
    headers: {
      "Content-Type": "application/javascript; charset=utf-8",
      // The script is identical for every client: the key is an attribute on the tag, not in
      // this file, which is what makes one cached copy correct for the whole book.
      "Cache-Control": "public, max-age=300, s-maxage=3600",
      // It is loaded cross-origin from every client website by definition.
      "Access-Control-Allow-Origin": "*",
    },
  });
}
