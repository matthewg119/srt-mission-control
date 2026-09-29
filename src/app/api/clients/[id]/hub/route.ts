// The hub actions on the client board: attach the hostnames, and write and publish pages.
//
// AUTHENTICATED. Middleware guards /dashboard/*, not /api/*, so this route checks the
// session itself — the same pattern as the dns, draft, delivery-step and time-log routes
// beside it. It is also unreachable on a client-controlled hostname: middleware refuses
// every /api path there except the AI Referral Engine's submit endpoint.

import { NextResponse } from "next/server";
import { hasBannedDash } from "@/lib/copy-guard";
import { auth } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/db";
import { registerClientHosts, loadClientHosts, hostsFor } from "@/lib/hub/vercel-domains";
import { savePage, setPublished, listAllForBoard, type PromptBlock } from "@/lib/hub/pages";
import { autoCompleteStep, stepByKey } from "@/lib/clients/delivery-checklist";
import { subdomainLabel } from "@/lib/clients/normalize";
import { assertDay0Archived, isDay0Error, DAY_ZERO_STEP_KEY } from "@/lib/clients/day-zero";
import { assertGatePassed, isGateError, runGate, waiveGate, latestGateRun } from "@/lib/hub/page-gate";
import { capturePage } from "@/lib/clients/page-dataset";
import { publishPage } from "@/lib/hub/publish-page";
import {
  loadEvidenceFor,
  verifySource,
  deleteSource,
  recordSource,
  type SourceType,
} from "@/lib/clients/page-evidence";
import { magnetsForClient } from "@/lib/concierge/for-client";

/**
 * Whatever the picker sent, as a key the database can hold.
 *
 * ‼️ IT USED TO MINT, AND THAT WHOLE LANE IS GONE (2026-09-29). A `cand:<uuid>` value meant
 * one of five offers written for this page, with no magnet_key until somebody chose it, so
 * saving the page approved the candidate and minted it into lead_magnets. Offers are not
 * invented per page any more; the picker offers the house offers, which already have keys.
 *
 * A stored `cand:` value can still arrive from a stale tab. It resolves to null rather than
 * being written, because a key magnetByKey cannot resolve is a page reporting an offer that
 * hands over nothing, which is exactly what the publish gate block tier exists to catch.
 */
function resolveMagnetChoice(raw: string): string | null {
  const value = raw.trim();
  if (!value) return null;
  if (value.startsWith("cand:")) return null;
  return value;
}

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
  // Who is doing this, for the columns that record a human act. Same shape as page_gate_runs.run_by.
  const actor = session.user.email || session.user.name || "the board";

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
      const result = await draftPage(clientId, String(body.question ?? ""), {
        // The page id, when the board is drafting into an existing row, so the drafter reads
        // that page's own evidence and not just the client library.
        pageId: typeof body.pageId === "string" ? body.pageId : null,
        // The offer chosen before the page is written. It never lands in the body; it tells the
        // drafter where to stop. See draftPage's header.
        //
        magnetKey: resolveMagnetChoice(
          typeof body.leadMagnetKey === "string" ? body.leadMagnetKey : ""
        ),
      });
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
      // ‼️ REFUSED, NOT STRIPPED. The CTA sentence is rendered on the client's live page and read out
      // by the widget, so it is copy, and copy-guard is a throw everywhere else in this repo. Rewriting
      // somebody's words quietly would teach them the rule has exceptions here. savePage caps the
      // length, which is arithmetic; a dash is a decision and belongs back with whoever typed it.
      if (typeof body.ctaLine === "string" && hasBannedDash(body.ctaLine)) {
        return NextResponse.json({
          ok: false,
          error:
            'That call to action has an em dash, an en dash or a "--" in it. SRT copy uses commas, ' +
            "periods and single hyphens.",
        });
      }

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
        // Carried straight through from page_draft, and ONLY when the form actually sends it.
        // savePage treats undefined as "this save says nothing about provenance" and null as
        // "written by hand", and the difference is what stops a title edit erasing a drafted
        // page's claim map. See SavePageInput.evidenceMap.
        evidenceMap: Array.isArray(body.evidenceMap) ? (body.evidenceMap as unknown[]) : undefined,
        // Same undefined/null discipline as evidenceMap directly above: a form that says nothing
        // about the magnet leaves the stored key alone, and an empty string clears it.
        //
        // ‼️ A STALE `cand:` VALUE RESOLVES TO NULL RATHER THAN BEING STORED. See
        // resolveMagnetChoice. Undefined stays undefined.
        leadMagnetKey:
          typeof body.leadMagnetKey === "string" ? resolveMagnetChoice(body.leadMagnetKey) : undefined,
        // Checked for a banned dash at the top of this case. Undefined leaves the stored sentence
        // alone; an empty string clears it back to the magnet-templated lines.
        ctaLine: typeof body.ctaLine === "string" ? body.ctaLine : undefined,
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
    //
    // ‼️ THE ORDERING MOVED INTO @/lib/hub/publish-page AND THAT IS THE ONLY CHANGE.
    // Both rails, their order, and the reasoning for it now live in ONE function, because the
    // Slack approval card added 2026-09-22 has to publish through the same path. The objection
    // recorded in the actions route was that a second publisher would be "a second place to get
    // the ordering wrong"; sharing the implementation is what answers it. setPublished and
    // assertGatePassed each still have exactly one caller, and both are in that module.
    case "page_publish":
    case "page_unpublish": {
      const pageId = String(body.pageId ?? "");
      if (!pageId) return NextResponse.json({ ok: false, error: "Which page?" }, { status: 400 });

      const res = await publishPage({
        clientId,
        pageId,
        publish: action === "page_publish",
        by: actor,
        // Absent until the picker has been touched, which is the normal case for a client
        // with one destination. publishPage refuses rather than guessing when there are
        // several, and hands back the list to render.
        destinationId: typeof body.destinationId === "string" ? body.destinationId : null,
      });

      if (!res.ok) {
        const r = res.refusal;
        if (r.blockedBy === "not_found") return NextResponse.json({ ok: false, error: r.error });
        // ‼️ NOT A 409, AND NOT waivable. The other two refusals are rails: something is
        // wrong and the page must not go live. This one is a question, so it is a 400 with
        // the options attached and no waive control anywhere near it -- a "publish anyway"
        // here would have to pick a domain on somebody's behalf.
        if (r.blockedBy === "destination") {
          return NextResponse.json(
            { ok: false, error: r.error, blockedBy: "destination", choices: r.choices },
            { status: 400 }
          );
        }
        // The board turns blockedBy into the waive control rather than hard-coding the step key.
        return NextResponse.json(
          r.blockedBy === "day_0"
            ? { ok: false, error: r.error, blockedBy: r.stepKey, waivable: true }
            : {
                ok: false,
                error: r.error,
                blockedBy: "quality_gate",
                gateReason: r.gateReason,
                checks: r.checks,
                waivable: r.waivable,
              },
          { status: 409 }
        );
      }

      return NextResponse.json({
        ok: true,
        pageUrl: res.pageUrl,
        pages: await listAllForBoard(clientId),
      });
    }

    // ── Run the quality gate ──────────────────────────────────────────────────
    //
    // Separate from publishing on purpose. The gate is something you run WHILE writing, several
    // times, and folding it into the Publish button would mean the only way to find out what is
    // wrong with a page is to try to put it on a client's domain.
    case "page_check": {
      const pageId = String(body.pageId ?? "");
      if (!pageId) return NextResponse.json({ ok: false, error: "Which page?" }, { status: 400 });

      const result = await runGate(clientId, pageId, {
        runBy: session.user.email ?? session.user.name ?? null,
      });
      if (!result.ok) return NextResponse.json({ ok: false, error: result.error });

      return NextResponse.json({ ok: true, run: result.run });
    }

    // ── Publish over a refusal, on purpose, with a reason ─────────────────────
    case "page_waive_gate": {
      const pageId = String(body.pageId ?? "");
      if (!pageId) return NextResponse.json({ ok: false, error: "Which page?" }, { status: 400 });

      const result = await waiveGate({
        clientId,
        pageId,
        reason: String(body.reason ?? ""),
        by: session.user.email ?? session.user.name ?? null,
      });
      if (!result.ok) return NextResponse.json({ ok: false, error: result.error });

      return NextResponse.json({ ok: true, run: await latestGateRun(pageId) });
    }

    // ── The evidence behind a page ────────────────────────────────────────────
    case "sources_list": {
      const pageId = typeof body.pageId === "string" ? body.pageId : null;
      return NextResponse.json({ ok: true, sources: await loadEvidenceFor(clientId, pageId) });
    }

    case "source_add": {
      // Typed on the board rather than dictated in Slack. Same table, same verbatim rule: a
      // pasted policy or an emailed price list is evidence in exactly the way a voice note is.
      //
      // The type is whitelisted rather than trusted. It is what isFirstParty() reads, and a
      // request that could set its own type could label outside research as the client's own
      // words and satisfy the first-party floor with somebody else's page.
      //
      // ‼️ CUSTOMER_REVIEW IS DELIBERATELY NOT ON THIS LIST, and it is the one omission likely
      // to look like an oversight. A review quote is only worth anything if it is what the
      // customer actually published, and the guarantee that it is comes from being TRANSCRIBED
      // off the screenshot it was read from, then confirmed against that picture. A free text
      // box types an approximation and calls it a quote, with nothing to check it against. The
      // page studio's `review` command is the one door, on purpose.
      const ALLOWED: SourceType[] = [
        "CLIENT_VOICE",
        "CLIENT_DOCUMENT",
        "CLIENT_WEBSITE",
        "FIRST_PARTY_DATA",
        "EXTERNAL_RESEARCH",
      ];
      const requested = String(body.sourceType ?? "CLIENT_DOCUMENT") as SourceType;
      if (!ALLOWED.includes(requested)) {
        return NextResponse.json({ ok: false, error: `Not a source type: ${requested}` }, { status: 400 });
      }

      const result = await recordSource({
        clientId,
        pageId: typeof body.pageId === "string" ? body.pageId : null,
        sourceType: requested,
        sourceContent: String(body.sourceContent ?? ""),
        topic: typeof body.topic === "string" ? body.topic : null,
        sourceUrl: typeof body.sourceUrl === "string" ? body.sourceUrl : null,
        collectedBy: session.user.email ?? session.user.name ?? null,
        collectedVia: "board",
      });
      if (!result.ok) return NextResponse.json({ ok: false, error: result.error });

      return NextResponse.json({
        ok: true,
        sources: await loadEvidenceFor(clientId, typeof body.pageId === "string" ? body.pageId : null),
      });
    }

    case "source_verify": {
      const result = await verifySource(
        String(body.sourceId ?? ""),
        session.user.email ?? session.user.name ?? null
      );
      if (!result.ok) return NextResponse.json({ ok: false, error: result.error });

      return NextResponse.json({
        ok: true,
        sources: await loadEvidenceFor(clientId, typeof body.pageId === "string" ? body.pageId : null),
      });
    }

    case "source_delete": {
      const result = await deleteSource(clientId, String(body.sourceId ?? ""));
      if (!result.ok) return NextResponse.json({ ok: false, error: result.error });

      return NextResponse.json({
        ok: true,
        sources: await loadEvidenceFor(clientId, typeof body.pageId === "string" ? body.pageId : null),
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

  const pages = await listAllForBoard(params.id);

  // The latest verdict per page, in one query rather than one per page. Ordered newest first
  // and kept on first sight, which is the latest for that page.
  const { data: runs } = await supabaseAdmin
    .from("page_gate_runs")
    .select("page_id, verdict, checks, body_hash, created_at")
    .eq("client_id", params.id)
    .order("created_at", { ascending: false });

  const latestByPage: Record<string, unknown> = {};
  for (const r of runs ?? []) {
    const key = r.page_id as string;
    if (!latestByPage[key]) latestByPage[key] = r;
  }

  return NextResponse.json({
    ok: true,
    wanted: client
      ? hostsFor(client as { subdomain: string | null; domain: string | null })
      : [],
    rows: await loadClientHosts(params.id),
    pages,
    gateRuns: latestByPage,
    sources: await loadEvidenceFor(params.id, null),
    magnets: await magnetsForClient(params.id),
    // The five written for each page, so the picker offers this client's own offers above the
    // shared catalogue. Keyed by page id because the board renders every page at once.
  });
}
