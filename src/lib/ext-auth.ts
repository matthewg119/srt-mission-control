// Auth + CORS for the TextWin Chrome extension (/api/ext/*).
//
// The extension has no NextAuth session cookie — it authenticates with a
// per-tenant bearer token (tenants.api_token, see docs/2026-06-20-ext-tokens.sql).
// requireExtTenant() replaces auth() for these routes. Do NOT mix the two.
//
// CORS: chrome-extension origins are opaque; we echo the validated origin (never
// "*"). In practice all extension fetches go through the background service
// worker, which has host_permissions for mission.srtagency.com, so the browser
// does not enforce CORS on them — but we send correct headers anyway so the
// routes also work from an extension page / direct fetch.

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/db";

// Chrome extension IDs are 32 chars from a-p (base-16 of the public key).
const EXT_ORIGIN_RE = /^chrome-extension:\/\/[a-p]{32}$/;

export function corsHeaders(origin: string | null): Record<string, string> {
  const h: Record<string, string> = {
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "authorization, content-type",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
  if (origin && EXT_ORIGIN_RE.test(origin)) {
    h["Access-Control-Allow-Origin"] = origin;
  }
  return h;
}

export function preflight(req: NextRequest): NextResponse {
  return new NextResponse(null, {
    status: 204,
    headers: corsHeaders(req.headers.get("origin")),
  });
}

export function jsonCors(req: NextRequest, body: unknown, status = 200): NextResponse {
  return NextResponse.json(body, {
    status,
    headers: corsHeaders(req.headers.get("origin")),
  });
}

export interface ExtTenant {
  tenantId: string;
  slug: string;
}

// Returns the tenant for a valid Bearer token, or null (caller returns 401).
export async function requireExtTenant(req: NextRequest): Promise<ExtTenant | null> {
  const header = req.headers.get("authorization") || "";
  const m = header.match(/^Bearer\s+(.+)$/i);
  const token = m?.[1]?.trim();
  if (!token) return null;

  const { data, error } = await supabaseAdmin
    .from("tenants")
    .select("id, slug")
    .eq("api_token", token)
    .maybeSingle();

  if (error) {
    console.error("[ext-auth] token lookup failed:", error.message);
    return null;
  }
  if (!data?.id) return null;
  return { tenantId: data.id as string, slug: data.slug as string };
}
