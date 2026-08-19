// The client's visual theme, and the two identity fields the hub renders.
//
// AUTHENTICATED. Middleware guards /dashboard/*, not /api/*, so this route checks the
// session itself — the same pattern as the hub, dns, draft and delivery-step routes.
//
// Four actions:
//   extract  — read the client's homepage and PROPOSE logo/accent/font. Never confirms.
//   set      — a human types or corrects a value. Never confirms.
//   confirm  — 5f: "Theme confirmed by me in the dashboard before the preview is shown."
//   name     — legal_name / dba_name, because those are what the hub's <h1>, <title> and
//              LocalBusiness schema render, and until now they were writable only at
//              provisioning and intake step 1. A client's own typo became their schema
//              name with no way to fix it short of SQL. That happened.

import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/db";
import { researchWebsite } from "@/lib/audit-engine/site-research";
import { revalidateClientHub } from "@/lib/hub/resolve";
import {
  readTheme,
  extractThemeFromHtml,
  safeColor,
  safeFontFamily,
  safeUrl,
  type StoredTheme,
} from "@/lib/hub/theme";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";
// One homepage fetch and a parse. Generous, because a slow client site is common.
export const maxDuration = 60;

export async function POST(
  req: Request,
  { params }: { params: { id: string } }
): Promise<NextResponse> {
  const session = await auth().catch(() => null);
  if (!session?.user) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const actor = session.user.name ?? session.user.email ?? null;
  const clientId = params.id;

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ ok: false, error: "Bad request" }, { status: 400 });
  }

  const { data: client } = await supabaseAdmin
    .from("clients")
    .select("id, legal_name, dba_name, website, domain, theme")
    .eq("id", clientId)
    .maybeSingle();

  if (!client) {
    return NextResponse.json({ ok: false, error: "That client does not exist." }, { status: 404 });
  }

  const stored = readTheme(client.theme);
  const action = String(body.action ?? "");

  switch (action) {
    // ── Propose, from their own homepage ────────────────────────────────────
    case "extract": {
      const site = (client.website as string | null) ?? (client.domain as string | null);
      if (!site) {
        return NextResponse.json({
          ok: false,
          error: "No website on this client yet. Intake step 1 sets it.",
        });
      }

      let found: ReturnType<typeof extractThemeFromHtml>;
      let from: string;
      try {
        // Reuse the audit engine's fetcher rather than adding a second one. The parse
        // itself is pure, the same shape site-signals.ts uses over the same HTML.
        const research = await researchWebsite(site);
        // researchWebsite is always given a real URL here, so it always echoes one back;
        // the nullable type exists for the no-website audit path, which never reaches this.
        from = research.website ?? site;
        found = extractThemeFromHtml(research.homepageHtml, research.website ?? site);
      } catch (e) {
        return NextResponse.json({
          ok: false,
          error: `Could not read ${site}: ${(e as Error).message}`,
        });
      }

      // Merge, do not clobber: a value a human already typed outranks a scrape. And this
      // never sets confirmedAt — extraction proposes, a person confirms.
      const next: StoredTheme = {
        ...stored,
        logoUrl: stored.logoUrl ?? found.logoUrl,
        accent: stored.accent ?? found.accent,
        fontFamily: stored.fontFamily ?? found.fontFamily,
        extractedFrom: from,
        extractedAt: new Date().toISOString(),
      };

      await save(clientId, next);
      return NextResponse.json({ ok: true, theme: next, found });
    }

    // ── A human types or corrects one ───────────────────────────────────────
    case "set": {
      const next: StoredTheme = {
        ...stored,
        logoUrl: "logoUrl" in body ? safeUrl(body.logoUrl) : stored.logoUrl,
        accent: "accent" in body ? safeColor(body.accent) : stored.accent,
        accentSoft: "accentSoft" in body ? safeColor(body.accentSoft) : stored.accentSoft,
        fontFamily:
          "fontFamily" in body ? safeFontFamily(body.fontFamily) : stored.fontFamily,
        // Editing a confirmed theme un-confirms it. The confirmation is a statement about
        // a specific set of values, not a permanent flag on the row, and a colour changed
        // afterwards is a colour nobody has looked at.
        confirmedAt: null,
        confirmedBy: null,
      };

      await save(clientId, next);
      return NextResponse.json({ ok: true, theme: next });
    }

    // ── 5f: confirmed by a human, before the client sees anything ───────────
    case "confirm": {
      const next: StoredTheme = {
        ...stored,
        confirmedAt: new Date().toISOString(),
        confirmedBy: actor,
      };
      await save(clientId, next);
      return NextResponse.json({ ok: true, theme: next });
    }

    case "unconfirm": {
      const next: StoredTheme = { ...stored, confirmedAt: null, confirmedBy: null };
      await save(clientId, next);
      return NextResponse.json({ ok: true, theme: next });
    }

    // ── The two fields the hub renders as the business's identity ───────────
    case "name": {
      const legal = typeof body.legalName === "string" ? body.legalName.trim() : "";
      const dbaRaw = typeof body.dbaName === "string" ? body.dbaName.trim() : "";

      if (!legal) {
        return NextResponse.json({ ok: false, error: "Legal name cannot be empty." });
      }

      const { error } = await supabaseAdmin
        .from("clients")
        .update({
          legal_name: legal,
          // Empty means "no trading name", not an empty string, because displayName falls
          // back to legal_name on null and would render "" on "".
          dba_name: dbaRaw || null,
          updated_at: new Date().toISOString(),
        })
        .eq("id", clientId);

      if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });

      revalidateClientHub();
      return NextResponse.json({ ok: true });
    }

    default:
      return NextResponse.json({ ok: false, error: `Unknown action: ${action}` }, { status: 400 });
  }
}

async function save(clientId: string, theme: StoredTheme): Promise<void> {
  const { error } = await supabaseAdmin
    .from("clients")
    .update({ theme, updated_at: new Date().toISOString() })
    .eq("id", clientId);

  if (error) throw new Error(error.message);

  // The theme travels inside the cached host resolution, so a confirmed colour that does
  // not appear for five minutes looks exactly like a colour that did not save.
  revalidateClientHub();
}
