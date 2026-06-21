export const dynamic = "force-dynamic";
import { NextRequest } from "next/server";
import { requireExtTenant, jsonCors, preflight } from "@/lib/ext-auth";

export const runtime = "nodejs";

export function OPTIONS(req: NextRequest) {
  return preflight(req);
}

// Used by the extension Options page "Test connection" button.
export async function GET(req: NextRequest) {
  const tenant = await requireExtTenant(req);
  if (!tenant) return jsonCors(req, { ok: false, error: "unauthorized" }, 401);
  return jsonCors(req, { ok: true, tenant: { slug: tenant.slug } });
}
