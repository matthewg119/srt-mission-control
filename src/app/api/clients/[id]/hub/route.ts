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
import { autoCompleteStep, stepByKey } from "@/lib/clients/delivery-checklist";
import { subdomainLabel } from "@/lib/clients/normalize";
import { assertDay0Archived, isDay0Error, DAY_ZERO_STEP_KEY } from "@/lib/clients/day-zero";

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
    // ── Draft a page for a person to edit ──────────────────────────────
    //
    // ‼️ IT RETURNS THE DRAFT, IT DOES NOT SAVE IT AND IT CANNOT PUBLISH IT.
    // The text lands in the form for editing and the person still presses Save, then
    // Publish, and Publish is still behind the Day-0 wall. Saving straight from here would
    // put copy nobody read into client_pages, and one careless Publish later that is live
    // on the client's own domain under their name.
    case "page_draft": {
      const { draftPage } = await import("@/lib/hub/draft-page");
      const result = await draftPage(clientId, String(body.question ?? ""));
      if (!result.ok) return NextResponse.json({ ok: false, error: result.error });

      // The preview goes to Slack even though nothing was saved, and the file says so. The
      // point of this file is the screen share on the call, and the moment you want it is
      // the moment you have something to look at, not one Save later.
      const { postPagePreview } = await import("@/lib/hub/page-preview");
      const { pageSlug } = await import("@/lib/hub/pages");
      await postPagePreview(
        clientId,
        {
          slug: pageSlug(result.page.title),
          title: result.page.title,
          question: String(body.question ?? ""),
          answerMd: result.page.answerMd,
          publishedAt: null,
        },
        { saved: false }
      ).catch(() => {});

      return NextResponse.json({ ok: true, draft: result.page });
    }

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

      // ‼️ READ BACK FROM THE ROW, not from the request body. savePage normalises the slug
      // and trims the fields, so previewing the request would show a page at an address that
      // does not exist. This file gets opened in front of a client; the URL on it has to be
      // the real one.
      const { data: saved } = await supabaseAdmin
        .from("client_pages")
        .select("slug, title, question, answer_md, published_at")
        .eq("id", result.id)
        .maybeSingle();

      if (saved) {
        const { postPagePreview } = await import("@/lib/hub/page-preview");
        await postPagePreview(
          clientId,
          {
            slug: saved.slug as string,
            title: saved.title as string,
            question: saved.question as string,
            answerMd: saved.answer_md as string,
            publishedAt: (saved.published_at as string | null) ?? null,
          },
          { saved: true }
        ).catch(() => {});
      }

      return NextResponse.json({ ok: true, id: result.id, pages: await listAllForBoard(clientId) });
    }

    // ── Publish or unpublish ──────────────────────────────────────────────────
    case "page_publish":
    case "page_unpublish": {
      const pageId = String(body.pageId ?? "");
      if (!pageId) return NextResponse.json({ ok: false, error: "Which page?" }, { status: 400 });

      const publish = action === "page_publish";

      // ‼️ THE DAY 0 WALL. Runner v3's one hard rail.
      //
      // BEFORE setPublished, not after, and that ordering is the whole point: publishing
      // is not one write. It flips client_pages.status, then autoCompleteStep('first_page')
      // ticks a delivery step, refreshes the Slack checklist, posts a thread reply and
      // INSERTS a client_messages row telling the client their page is live. A check
      // placed after any of that has already told the client something that should not
      // have happened yet.
      //
      // Unpublishing is never gated. Taking a page down is the remedy, not the harm.
      if (publish) {
        try {
          await assertDay0Archived(
            clientId,
            (client.dba_name as string | null) ?? (client.legal_name as string),
            // Quote the checklist row back at them in its own words, so the error names
            // the thing they have to go and tick rather than a paraphrase of it.
            stepByKey(DAY_ZERO_STEP_KEY)?.label
          );
        } catch (e) {
          if (!isDay0Error(e)) throw e;
          return NextResponse.json(
            {
              ok: false,
              error: e.message,
              blockedBy: e.stepKey,
              // The board turns this into the waive control rather than hard-coding the
              // step key in the component.
              waivable: true,
            },
            { status: 409 }
          );
        }
      }

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
