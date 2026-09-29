// Paste one page of the built website in, or take one down.
//
// The HTML is sanitised on the way in by storeSitePage(), which is the only writer, and what was
// removed comes back in the response so the removal is a visible fact rather than a silent one.

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { storeSitePage, deleteSitePage, listSitePages, normalizeSitePath } from "@/lib/hub/site-pages";
import { revalidateClientHub } from "@/lib/hub/resolve";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth().catch(() => null);
  if (!session?.user) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  try {
    const pages = await listSitePages(id, true);
    // The HTML itself is not sent back to the list: a page is easily half a megabyte and the
    // panel only needs to know it exists.
    return NextResponse.json({
      ok: true,
      pages: pages.map(({ html, ...rest }) => ({ ...rest, bytes: html.length })),
    });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth().catch(() => null);
  if (!session?.user) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });

  const { id } = await params;

  let body: {
    path?: unknown;
    title?: unknown;
    html?: unknown;
    metaDescription?: unknown;
    navLabel?: unknown;
    navOrder?: unknown;
    publish?: unknown;
  };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ ok: false, error: "Bad request." }, { status: 400 });
  }

  const path = typeof body.path === "string" ? body.path : "/";
  const normalized = normalizeSitePath(path);
  if (!normalized.ok) return NextResponse.json({ ok: false, error: normalized.error }, { status: 400 });

  if (typeof body.html !== "string" || !body.html.trim()) {
    return NextResponse.json({ ok: false, error: "There was no HTML to store." }, { status: 400 });
  }

  const result = await storeSitePage({
    clientId: id,
    path: normalized.path,
    title: typeof body.title === "string" ? body.title : "",
    html: body.html,
    metaDescription: typeof body.metaDescription === "string" ? body.metaDescription.slice(0, 300) : null,
    navLabel: typeof body.navLabel === "string" ? body.navLabel.slice(0, 60) : null,
    navOrder: typeof body.navOrder === "number" ? body.navOrder : null,
    publish: body.publish !== false,
    by: session.user.name ?? session.user.email ?? "the dashboard",
  });

  if (!result.ok) return NextResponse.json(result, { status: 400 });

  // The hub resolves hosts and pages behind unstable_cache, so a page pasted now would otherwise
  // not appear on the live domain until the tag happened to expire.
  await revalidateClientHub();

  return NextResponse.json({
    ok: true,
    page: { ...result.page, html: undefined, bytes: result.page.html.length },
    removed: result.removed,
  });
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth().catch(() => null);
  if (!session?.user) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const path = new URL(req.url).searchParams.get("path") ?? "";
  const normalized = normalizeSitePath(path);
  if (!normalized.ok) return NextResponse.json({ ok: false, error: normalized.error }, { status: 400 });

  const result = await deleteSitePage(id, normalized.path);
  if (result.ok) await revalidateClientHub();
  return NextResponse.json(result, { status: result.ok ? 200 : 500 });
}
