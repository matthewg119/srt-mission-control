// The pages a client hub publishes, and the one path that publishes them.
//
// Reads are cached and tagged per client, so publishing invalidates that client's hub and
// nobody else's. Writes go through this file only.

import { unstable_cache, revalidateTag } from "next/cache";
import { supabaseAdmin } from "@/lib/db";
import { pagesTag } from "@/lib/hub/resolve";

export type PageStatus = "draft" | "published" | "archived";
export type PromptBlock = "SERVICIO" | "COMPARATIVO" | "INFO" | "MARCA";

export interface ClientPage {
  id: string;
  slug: string;
  title: string;
  question: string;
  promptBlock: PromptBlock | null;
  answerMd: string;
  metaDescription: string | null;
  status: PageStatus;
  publishedAt: string | null;
  updatedAt: string | null;
}

const COLUMNS =
  "id, slug, title, question, prompt_block, answer_md, meta_description, status, published_at, updated_at";

function toPage(row: Record<string, unknown>): ClientPage {
  return {
    id: row.id as string,
    slug: row.slug as string,
    title: row.title as string,
    question: (row.question as string) ?? "",
    promptBlock: (row.prompt_block as PromptBlock | null) ?? null,
    answerMd: (row.answer_md as string) ?? "",
    metaDescription: (row.meta_description as string | null) ?? null,
    status: row.status as PageStatus,
    publishedAt: (row.published_at as string | null) ?? null,
    updatedAt: (row.updated_at as string | null) ?? null,
  };
}

/**
 * Every published page for one client, newest first.
 *
 * Throws on failure rather than returning []. An empty list renders as "this hub has no
 * pages", which during an outage would strip a client's sitemap down to nothing — the same
 * class of quiet damage as 404-ing a live host. See resolveHost's header.
 */
export const listPublished = (clientId: string) =>
  unstable_cache(
    async (): Promise<ClientPage[]> => {
      const { data, error } = await supabaseAdmin
        .from("client_pages")
        .select(COLUMNS)
        .eq("client_id", clientId)
        .eq("status", "published")
        .order("published_at", { ascending: false });

      if (error) throw new Error(`[hub/pages] list failed: ${error.message}`);
      return (data ?? []).map(toPage);
    },
    ["hub-pages-published", clientId],
    { revalidate: 300, tags: [pagesTag(clientId)] }
  )();

/** One published page. `null` is a genuine miss; a failure throws. */
export const getPublished = (clientId: string, slug: string) =>
  unstable_cache(
    async (): Promise<ClientPage | null> => {
      const { data, error } = await supabaseAdmin
        .from("client_pages")
        .select(COLUMNS)
        .eq("client_id", clientId)
        .eq("slug", slug)
        .eq("status", "published")
        .maybeSingle();

      if (error) throw new Error(`[hub/pages] get failed: ${error.message}`);
      return data ? toPage(data as Record<string, unknown>) : null;
    },
    ["hub-page", clientId, slug],
    { revalidate: 300, tags: [pagesTag(clientId)] }
  )();

/** Everything, including drafts. For the board only — never rendered on a hub host. */
export async function listAllForBoard(clientId: string): Promise<ClientPage[]> {
  const { data, error } = await supabaseAdmin
    .from("client_pages")
    .select(COLUMNS)
    .eq("client_id", clientId)
    .order("updated_at", { ascending: false });

  if (error) {
    console.error("[hub/pages] board list failed:", error.message);
    return [];
  }
  return (data ?? []).map(toPage);
}

/**
 * A URL-safe slug. Reuses the shape slugify() already produces for client slugs, but kept
 * separate because this one is part of a public URL a crawler will index: it must not
 * silently change for an existing page.
 */
export function pageSlug(input: string): string {
  return input
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80)
    .replace(/-+$/g, "");
}

export interface SavePageInput {
  clientId: string;
  id?: string;
  slug: string;
  title: string;
  question: string;
  promptBlock?: PromptBlock | null;
  answerMd: string;
  metaDescription?: string | null;
  sourceReportId?: string | null;
}

export async function savePage(input: SavePageInput): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const slug = pageSlug(input.slug || input.title);
  if (!slug) return { ok: false, error: "That title does not produce a usable web address." };
  if (!input.title.trim()) return { ok: false, error: "A title is required." };
  if (!input.question.trim()) return { ok: false, error: "The question this page answers is required." };
  if (!input.answerMd.trim()) return { ok: false, error: "An answer is required." };

  const row = {
    client_id: input.clientId,
    slug,
    title: input.title.trim(),
    question: input.question.trim(),
    prompt_block: input.promptBlock ?? null,
    answer_md: input.answerMd,
    meta_description: input.metaDescription?.trim() || null,
    source_report_id: input.sourceReportId ?? null,
    updated_at: new Date().toISOString(),
  };

  const query = input.id
    ? supabaseAdmin.from("client_pages").update(row).eq("id", input.id).eq("client_id", input.clientId)
    : supabaseAdmin.from("client_pages").insert(row);

  const { data, error } = await query.select("id").maybeSingle();

  if (error) {
    // 23505 on (client_id, lower(slug)). Worth naming: two pages sharing a slug is the one
    // collision a person will actually hit, and "duplicate key" tells them nothing.
    if (error.code === "23505") {
      return { ok: false, error: `This client already has a page at /${slug}.` };
    }
    return { ok: false, error: error.message };
  }

  const id = (data?.id as string | undefined) ?? input.id;
  if (!id) return { ok: false, error: "The page was not saved." };

  revalidateTag(pagesTag(input.clientId));
  return { ok: true, id };
}

/**
 * Publish or unpublish.
 *
 * published_at is set once and kept: it is the date the page first went live, which the
 * sitemap and any future freshness signal depend on. Re-publishing an unpublished page
 * does not reset it, because that would claim the content is newer than it is.
 */
export async function setPublished(
  clientId: string,
  pageId: string,
  published: boolean
): Promise<{ ok: true; slug: string } | { ok: false; error: string }> {
  const { data: existing, error: readError } = await supabaseAdmin
    .from("client_pages")
    .select("id, slug, published_at")
    .eq("id", pageId)
    .eq("client_id", clientId)
    .maybeSingle();

  if (readError) return { ok: false, error: readError.message };
  if (!existing) return { ok: false, error: "That page does not exist." };

  const patch: Record<string, unknown> = {
    status: published ? "published" : "draft",
    updated_at: new Date().toISOString(),
  };
  if (published && !existing.published_at) patch.published_at = new Date().toISOString();

  const { error } = await supabaseAdmin
    .from("client_pages")
    .update(patch)
    .eq("id", pageId)
    .eq("client_id", clientId);

  if (error) return { ok: false, error: error.message };

  revalidateTag(pagesTag(clientId));
  return { ok: true, slug: existing.slug as string };
}
