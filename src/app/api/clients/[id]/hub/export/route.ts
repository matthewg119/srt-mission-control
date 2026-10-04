// Download a page, or the whole set, as a file.
//
// ‼️ A GET THAT RETURNS A FILE, AND IT IS BEHIND THE DASHBOARD SESSION LIKE EVERY OTHER
// /api/clients/* ROUTE. The files are the client's, but the person downloading them is SRT:
// there is no client-facing surface here and this route must never grow one, because a
// tokenless GET returning every page a client has written is the shape of a scraper.
//
// ‼️ IT PUBLISHES NOTHING AND WRITES NOTHING. Listed in NOT_GATED in page-gate.ts with the
// reasoning. No status change, no destination_id, no delivery step, no client_messages row.

import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { exportPage, exportPageSet, type ExportFormat } from "@/lib/hub/page-export";

export const dynamic = "force-dynamic";

// supabase-js calls the global fetch, which Next patches, so reads land in the DATA cache.
// dynamic = "force-dynamic" governs the ROUTE cache and does not cover it. A stale read here
// hands somebody an export of a page as it was minutes ago, which is the one thing an export
// must not do: they are about to paste it into their own site.
export const fetchCache = "force-no-store";

const FORMATS: ReadonlySet<string> = new Set(["html", "md", "jsonld", "sheet", "standalone"]);

export async function GET(
  req: Request,
  { params }: { params: { id: string } }
): Promise<NextResponse> {
  const session = await auth().catch(() => null);
  if (!session?.user) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const clientId = params.id;
  const url = new URL(req.url);
  const pageId = url.searchParams.get("pageId");
  const format = url.searchParams.get("format") ?? "html";

  // The whole set. No pageId, because a zip of one page is a zip nobody wanted.
  if (!pageId) {
    const res = await exportPageSet(clientId);
    if (!res.ok) return NextResponse.json({ ok: false, error: res.error }, { status: 400 });
    return fileResponse(res.file.filename, res.file.contentType, Buffer.from(res.file.body, "base64"));
  }

  if (!FORMATS.has(format)) {
    return NextResponse.json(
      { ok: false, error: `Unknown format. One of: ${[...FORMATS].join(", ")}.` },
      { status: 400 }
    );
  }

  const res = await exportPage(clientId, pageId, format as ExportFormat);
  if (!res.ok) return NextResponse.json({ ok: false, error: res.error }, { status: 400 });

  return fileResponse(res.file.filename, res.file.contentType, Buffer.from(res.file.body, "utf8"));
}

/**
 * ‼️ attachment, ALWAYS, AND THE FILENAME IS QUOTED. An exported page is HTML that renders,
 * and served inline it would run in the dashboard's own origin -- the body is markdown a
 * person typed, so `inline` here is a stored XSS on Mission Control itself. The quoting
 * matters for the same class of reason: a slug is constrained, but a header built by
 * concatenation is a header somebody eventually gets to write.
 */
function fileResponse(filename: string, contentType: string, body: Buffer): NextResponse {
  const safe = filename.replace(/[^A-Za-z0-9._-]/g, "-");
  // Buffer is a Uint8Array view, and NextResponse's BodyInit does not accept Node's Buffer
  // type directly under this TS lib. The bytes are the same; only the declared type changes.
  const bytes = new Uint8Array(body);
  return new NextResponse(bytes, {
    status: 200,
    headers: {
      "Content-Type": contentType,
      "Content-Disposition": `attachment; filename="${safe}"`,
      "Content-Length": String(bytes.byteLength),
      "Cache-Control": "no-store",
      // The file is a page body; nothing in it should ever be sniffed into something active.
      "X-Content-Type-Options": "nosniff",
    },
  });
}
