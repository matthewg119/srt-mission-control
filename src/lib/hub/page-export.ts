// Export: the page as a file, for a client who is not publishing through us.
//
// ‼️ EXPORT IS AVAILABLE TO EVERY CLIENT, ALWAYS, AND IS NOT A DESTINATION. There is no
// client_hosts row for it, nothing has to be wired first, and no access has to be granted.
// A client on Wix, a client whose developer will not add a proxy rule, and a client who
// simply wants to read what we wrote all get the same files.
//
// ‼️ AND IT WRITES NOTHING. Not client_pages.status, not published_at, not destination_id,
// not a delivery step. A file is not a publication: nobody has put anything on a domain, so
// claiming a page is live would make the day 30/60/90 baseline describe a page that may
// never go up. The Day-0 wall and the quality gate are untouched here precisely because
// there is nothing for them to protect -- see NOT_GATED in page-gate.ts.
//
// ‼️ NOTHING HERE COMPOSES MARKUP OR SCHEMA. The body comes from renderPageBody(), which
// renders the production component, and the JSON-LD is EXTRACTED from that body rather than
// rebuilt. A second composition would be a file that looks like the page and is not it, and
// the client would paste it into their own site under their own name.

import { supabaseAdmin } from "@/lib/db";
import { renderPageBody, hubStyleAttr, hubStylesheet, type PreviewPage } from "@/lib/hub/page-preview";
import { hubRootClass } from "@/lib/hub/skin";
import { siteUrl, destinationForPage, type Destination } from "@/lib/hub/destinations";

export type ExportFormat = "html" | "md" | "jsonld" | "sheet" | "standalone";

export interface ExportFile {
  filename: string;
  contentType: string;
  body: string;
}

interface PageRow {
  id: string;
  slug: string;
  title: string;
  question: string;
  answer_md: string;
  meta_description: string | null;
  status: string;
  published_at: string | null;
  destination_id: string | null;
}

const PAGE_COLUMNS =
  "id, slug, title, question, answer_md, meta_description, status, published_at, destination_id";

function asPreviewPage(row: PageRow): PreviewPage {
  return {
    slug: row.slug,
    title: row.title,
    question: row.question,
    answerMd: row.answer_md,
    publishedAt: row.published_at,
  };
}

/**
 * The ld+json blocks the rendered page actually carries.
 *
 * ‼️ EXTRACTED, NEVER REBUILT, AND THAT IS THE WHOLE POINT OF DOING IT THIS WAY. The live
 * page emits questionAnswerJsonLd plus a BreadcrumbList from hub-bodies.tsx, while
 * page-gate.ts validates against schemaForPage, which returns Article + FAQPage once a page
 * has sections. Those two are already different answers to "what schema does this page
 * have". A third composition here would be a third, and it would be the one the client
 * pastes into their own site -- so this reads what shipped rather than deciding again.
 */
function extractJsonLd(bodyHtml: string): string[] {
  const out: string[] = [];
  const re = /<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(bodyHtml)) !== null) {
    const raw = m[1].trim();
    if (raw) out.push(raw);
  }
  return out;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/**
 * Where this page would live, for the sheet and for any absolute URL in the files.
 *
 * A page that has never been published has no destination, and the honest answer is the
 * subdomain hub it would go to -- flagged as "would be" rather than stated as fact.
 */
async function whereFor(clientId: string, row: PageRow): Promise<Destination | null> {
  return destinationForPage(clientId, row.destination_id);
}

/** One page, in one format. */
export async function exportPage(
  clientId: string,
  pageId: string,
  format: ExportFormat
): Promise<{ ok: true; file: ExportFile } | { ok: false; error: string }> {
  const { data, error } = await supabaseAdmin
    .from("client_pages")
    .select(PAGE_COLUMNS)
    .eq("id", pageId)
    .eq("client_id", clientId)
    .maybeSingle();

  if (error) return { ok: false, error: error.message };
  if (!data) return { ok: false, error: "That page does not exist." };

  const row = data as unknown as PageRow;
  const file = await buildFile(clientId, row, format);
  return file.ok ? { ok: true, file: file.file } : file;
}

async function buildFile(
  clientId: string,
  row: PageRow,
  format: ExportFormat
): Promise<{ ok: true; file: ExportFile } | { ok: false; error: string }> {
  const base = row.slug || "page";

  if (format === "md") {
    return { ok: true, file: { filename: `${base}.md`, contentType: "text/markdown; charset=utf-8", body: markdownFor(row) } };
  }

  const rendered = await renderPageBody(clientId, asPreviewPage(row));
  if (!rendered.ok) return { ok: false, error: rendered.error };

  if (format === "html") {
    return {
      ok: true,
      file: { filename: `${base}.html`, contentType: "text/html; charset=utf-8", body: rendered.body },
    };
  }

  if (format === "jsonld") {
    const blocks = extractJsonLd(rendered.body);
    if (blocks.length === 0) {
      return { ok: false, error: "This page rendered no structured data, so there is nothing to export." };
    }
    // One block stays a bare object; several become an array, which is what a <script> tag
    // accepts and what every validator reads. Re-serialising through JSON.parse would be a
    // chance to change what shipped, so the blocks are joined as they came out.
    const body = blocks.length === 1 ? blocks[0] : `[\n${blocks.join(",\n")}\n]`;
    return {
      ok: true,
      file: { filename: `${base}.jsonld`, contentType: "application/ld+json; charset=utf-8", body },
    };
  }

  if (format === "standalone") {
    const css = await hubStylesheet();
    const html = `<!doctype html>
<html lang="${escapeHtml(rendered.client.language ?? "en")}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(row.title)}</title>
${row.meta_description ? `<meta name="description" content="${escapeHtml(row.meta_description)}">\n` : ""}<style>
${css}
</style>
</head>
<body>
<div class="${hubRootClass(rendered.client.skin)}" lang="${escapeHtml(rendered.client.language ?? "en")}"${hubStyleAttr(rendered.client)}>
<div class="hub-wrap">${rendered.body}</div>
</div>
</body>
</html>`;
    return {
      ok: true,
      file: { filename: `${base}-standalone.html`, contentType: "text/html; charset=utf-8", body: html },
    };
  }

  // sheet
  const dest = await whereFor(clientId, row);
  const blocks = extractJsonLd(rendered.body);
  return {
    ok: true,
    file: {
      filename: `${base}-paste-here.md`,
      contentType: "text/markdown; charset=utf-8",
      body: sheetFor(row, dest, blocks.length),
    },
  };
}

function markdownFor(row: PageRow): string {
  const lines = [`# ${row.title}`, ""];
  if (row.meta_description) {
    lines.push(`> ${row.meta_description}`, "");
  }
  lines.push(row.answer_md.trim(), "");
  return lines.join("\n");
}

/**
 * The one-page instruction sheet that goes with a CMS export.
 *
 * ‼️ IT NAMES THE FIELDS OF A CMS, NOT THE COLUMNS OF OUR DATABASE. The person reading it is
 * a client or their web person, looking at WordPress or Squarespace, and "meta_description"
 * is not a box on their screen.
 *
 * ‼️ AND IT DOES NOT CLAIM THE PAGE IS LIVE. An export writes nothing, so the URL here is
 * where the page WOULD live if it were published through us -- said in those words, because
 * a client who reads it as a live link will check it, find nothing, and stop trusting the
 * rest of the sheet.
 */
function sheetFor(row: PageRow, dest: Destination | null, schemaBlocks: number): string {
  const would = dest ? siteUrl(dest, row.slug) : null;

  const lines = [
    `# Where each piece of "${row.title}" goes`,
    "",
    "Five fields. Everything here is already written; nothing needs rewriting to fit.",
    "",
    "## 1. The page address (the slug)",
    "",
    "```",
    row.slug,
    "```",
    "",
    "Use exactly this. The links between these pages point at each other by this name, so a",
    "different one breaks them quietly.",
    "",
    "## 2. The page title",
    "",
    "```",
    row.title,
    "```",
    "",
    "This is the title tag, the one that shows in a browser tab and in a search result. Some",
    "editors call it SEO title. It is not the same box as the heading on the page.",
    "",
    "## 3. The meta description",
    "",
  ];

  if (row.meta_description) {
    lines.push("```", row.meta_description, "```", "");
  } else {
    lines.push(
      "This page has none yet. Leave the box empty rather than inventing one: an editor will",
      "write something from the first sentence, which is better than a description that",
      "promises something the page does not answer.",
      ""
    );
  }

  lines.push(
    "## 4. The body",
    "",
    `Paste \`${row.slug}.html\` into the editor's HTML or code view, not the visual one. The`,
    "visual editor rewrites the markup and drops the structure the engines read.",
    "",
    `If your editor has no HTML view, use \`${row.slug}.md\` instead and paste it into a`,
    "markdown block.",
    "",
    "## 5. The structured data",
    ""
  );

  if (schemaBlocks > 0) {
    lines.push(
      `\`${row.slug}.jsonld\` holds ${schemaBlocks === 1 ? "one block" : `${schemaBlocks} blocks`} of structured data. It goes inside a`,
      "`<script type=\"application/ld+json\">` tag in the page head. Most SEO plugins have a box",
      "for custom head code.",
      "",
      "This is the part that tells an answer engine what the page is and who wrote it. The page",
      "works without it and is worth noticeably less.",
      ""
    );
  } else {
    lines.push("This page carries no structured data, so there is nothing to paste here.", "");
  }

  lines.push("---", "");

  if (would) {
    lines.push(
      `If this page were published through us it would live at ${would}. It is not there:`,
      "exporting a page puts it in a file and nowhere else. Once you have pasted it in, the",
      "address above is whatever address you gave it on your own site.",
      ""
    );
  } else {
    lines.push(
      "Nothing is published anywhere by exporting. Once you have pasted it in, the page lives",
      "at whatever address you gave it on your own site.",
      ""
    );
  }

  return lines.join("\n");
}

/**
 * Every page this client has, as one zip.
 *
 * ‼️ DRAFTS ARE INCLUDED AND ARE LABELLED. The set is what has been WRITTEN, which is what
 * somebody asking for the whole set wants; filtering to published would hand a client on
 * their own CMS an empty file, because publishing through us is exactly what they are not
 * doing. Each draft carries the word in its filename so nobody pastes an unfinished one.
 */
export async function exportPageSet(
  clientId: string
): Promise<{ ok: true; file: ExportFile } | { ok: false; error: string }> {
  const { data, error } = await supabaseAdmin
    .from("client_pages")
    .select(PAGE_COLUMNS)
    .eq("client_id", clientId)
    .neq("status", "archived")
    .order("published_at", { ascending: true, nullsFirst: false });

  if (error) return { ok: false, error: error.message };
  const rows = (data ?? []) as unknown as PageRow[];
  if (rows.length === 0) return { ok: false, error: "This client has no pages to export." };

  const JSZip = (await import("jszip")).default;
  const zip = new JSZip();

  for (const row of rows) {
    const folder = `${row.status === "published" ? "" : "draft-"}${row.slug || "page"}`;
    for (const format of ["html", "md", "jsonld", "sheet"] as const) {
      const built = await buildFile(clientId, row, format);
      // ‼️ ONE PAGE FAILING MUST NOT EMPTY THE ZIP. A page with no structured data has no
      // .jsonld and that is a real answer, not an error to abort twenty pages over.
      if (built.ok) zip.file(`${folder}/${built.file.filename}`, built.file.body);
    }
  }

  const buf = await zip.generateAsync({ type: "nodebuffer" });
  return {
    ok: true,
    file: {
      filename: "pages.zip",
      contentType: "application/zip",
      // Base64 so the caller can hand it to a Response without this module importing one.
      body: buf.toString("base64"),
    },
  };
}
