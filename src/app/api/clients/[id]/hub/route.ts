// The hub actions on the client board: attach the hostnames, and write and publish pages.
//
// AUTHENTICATED. Middleware guards /dashboard/*, not /api/*, so this route checks the
// session itself — the same pattern as the dns, draft, delivery-step and time-log routes
// beside it. It is also unreachable on a client-controlled hostname: middleware refuses
// every /api path there except the review tool's submit endpoint.

import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/db";
import { registerClientHosts, loadClientHosts, hostsFor } from "@/lib/hub/vercel-domains";
import { savePage, setPublished, listAllForBoard, type PromptBlock } from "@/lib/hub/pages";
import { autoCompleteStep } from "@/lib/clients/delivery-checklist";
import { subdomainLabel } from "@/lib/clients/normalize";

export const dynamic = "force-dynamic";
// Attaching two domains means up to four Vercel calls plus the DNS writeback.
export const maxDuration = 120;

export async function POST(
  req: Request,
  { params }: { params: { id: string } }
): Promise<NextResponse> {
  const session = await auth().catch(() => null);
  if (!session?.user) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const clientId = params.id;
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ ok: false, error: "Bad request" }, { status: 400 });
  }

  const action = String(body.action ?? "");

  const { data: client } = await supabaseAdmin
    .from("clients")
    .select("id, legal_name, dba_name, domain, subdomain")
    .eq("id", clientId)
    .maybeSingle();

  if (!client) {
    return NextResponse.json({ ok: false, error: "That client does not exist." }, { status: 404 });
  }

  switch (action) {
    // ── Attach the hostnames and read back the real CNAME target ──────────────
    case "register": {
      if (!client.domain) {
        return NextResponse.json({
          ok: false,
          error: "This client has no domain yet. Intake step 1 sets it.",
        });
      }

      const result = await registerClientHosts(clientId);
      return NextResponse.json({
        ok: result.warnings.length === 0,
        hosts: result.hosts,
        warnings: result.warnings,
        rows: await loadClientHosts(clientId),
      });
    }

    // ── Write or update a page ────────────────────────────────────────────────
    case "page_save": {
      const result = await savePage({
        clientId,
        id: typeof body.id === "string" ? body.id : undefined,
        slug: String(body.slug ?? ""),
        title: String(body.title ?? ""),
        question: String(body.question ?? ""),
        promptBlock: (body.promptBlock as PromptBlock | null) ?? null,
        answerMd: String(body.answerMd ?? ""),
        metaDescription: typeof body.metaDescription === "string" ? body.metaDescription : null,
        sourceReportId: typeof body.sourceReportId === "string" ? body.sourceReportId : null,
      });

      if (!result.ok) return NextResponse.json({ ok: false, error: result.error });
      return NextResponse.json({ ok: true, id: result.id, pages: await listAllForBoard(clientId) });
    }

    // ── Publish or unpublish ──────────────────────────────────────────────────
    case "page_publish":
    case "page_unpublish": {
      const pageId = String(body.pageId ?? "");
      if (!pageId) return NextResponse.json({ ok: false, error: "Which page?" }, { status: 400 });

      const publish = action === "page_publish";
      const result = await setPublished(clientId, pageId, publish);
      if (!result.ok) return NextResponse.json({ ok: false, error: result.error });

      let pageUrl: string | null = null;

      if (publish && client.domain) {
        const label = subdomainLabel(client.subdomain as string | null, client.domain as string);
        pageUrl = `https://${label}.${client.domain}/${result.slug}`;

        // Ticking first_page is what posts the notify_first_page draft, and it now has a
        // real URL behind it. autoCompleteStep is reused rather than reimplemented: it owns
        // the tick, the checklist refresh and the draft in one place.
        await autoCompleteStep(clientId, "first_page", `Published ${pageUrl}`).catch((e) => {
          console.error("[clients/hub] first_page tick failed:", (e as Error).message);
        });
      }

      return NextResponse.json({
        ok: true,
        pageUrl,
        pages: await listAllForBoard(clientId),
      });
    }

    default:
      return NextResponse.json({ ok: false, error: `Unknown action: ${action}` }, { status: 400 });
  }
}

/** The board reads the current state on render; this is here for a manual refresh. */
export async function GET(
  _req: Request,
  { params }: { params: { id: string } }
): Promise<NextResponse> {
  const session = await auth().catch(() => null);
  if (!session?.user) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const { data: client } = await supabaseAdmin
    .from("clients")
    .select("id, domain, subdomain")
    .eq("id", params.id)
    .maybeSingle();

  return NextResponse.json({
    ok: true,
    wanted: client
      ? hostsFor(client as { subdomain: string | null; domain: string | null })
      : [],
    rows: await loadClientHosts(params.id),
    pages: await listAllForBoard(params.id),
  });
}
