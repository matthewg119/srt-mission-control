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

/**
 * Open an EMPTY draft for a question somebody just claimed.
 *
 * ‼️ THIS IS THE ONE PATH WHERE AN EMPTY BODY IS LEGAL, AND savePage IS RIGHT TO REFUSE ONE.
 * savePage is a form submission: a body arrives all at once and an empty one is a mistake.
 * The page studio is the opposite shape — the row is opened the moment a question is claimed
 * and then filled over the next few minutes, one dictated sentence at a time. Refusing at
 * creation would mean holding the whole dictation in Slack and writing it in one go at the
 * end, which is exactly the failure mode that loses it.
 *
 * ‼️ IT RESUMES RATHER THAN DUPLICATING. Claiming the same question twice is a fat finger,
 * not a request for a second page, and the (client_id, lower(slug)) unique index would refuse
 * it anyway with a message about a web address that explains nothing. An existing unpublished
 * page for the same question is returned as-is, with everything already dictated into it.
 * A PUBLISHED page is deliberately not resumed: appending to something already live is a
 * different act, and it happens on the board where the body is visible.
 *
 * The question is stored VERBATIM, for the reason the migration gives: audit_reports.prompts
 * is regenerated by every run, so a reference rather than a copy would let the next audit turn
 * a published page into the answer to a question nobody asked.
 *
 * Not gated. A draft is not published — see NOT_GATED in clients/day-zero.ts.
 */
export async function startPageDraft(input: {
  clientId: string;
  question: string;
  sourceReportId?: string | null;
}): Promise<{ ok: true; id: string; slug: string; resumed: boolean } | { ok: false; error: string }> {
  const question = input.question.trim();
  if (!question) return { ok: false, error: "There is no question to open a page for." };

  const slug = pageSlug(question);
  if (!slug) return { ok: false, error: "That question does not produce a usable web address." };

  const { data: existing, error: readError } = await supabaseAdmin
    .from("client_pages")
    .select("id, slug, status")
    .eq("client_id", input.clientId)
    .eq("question", question)
    .neq("status", "published")
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (readError) return { ok: false, error: readError.message };
  if (existing) {
    return { ok: true, id: existing.id as string, slug: existing.slug as string, resumed: true };
  }

  const now = new Date().toISOString();
  const { data, error } = await supabaseAdmin
    .from("client_pages")
    .insert({
      client_id: input.clientId,
      slug,
      // The question is the working title. A page whose title is still its question is a page
      // nobody has finished, which is a more useful thing for the board to show than a blank.
      title: question.slice(0, 200),
      question,
      answer_md: "",
      source_report_id: input.sourceReportId ?? null,
      updated_at: now,
    })
    .select("id, slug")
    .maybeSingle();

  if (error) {
    // A slug collision here means a PUBLISHED page already answers this question, since an
    // unpublished one would have been resumed above. Say that, rather than "duplicate key".
    if (error.code === "23505") {
      return {
        ok: false,
        error: `A published page already sits at /${slug}. Edit it on the board rather than opening a second one.`,
      };
    }
    return { ok: false, error: error.message };
  }
  if (!data?.id) return { ok: false, error: "The draft was not opened." };

  revalidateTag(pagesTag(input.clientId));
  return { ok: true, id: data.id as string, slug: data.slug as string, resumed: false };
}

/**
 * Append to a draft's body, VERBATIM.
 *
 * ‼️ NOTHING IN THIS FUNCTION READS THE TEXT. It is the point of the whole page lane: what
 * he types or dictates is what lands in the body, and a model only touches it when he asks
 * for that by name. The only edit made here is a blank line between chunks, so two dictated
 * paragraphs do not run together into one.
 *
 * Refuses on a published page. Appending unreviewed dictation to something already serving on
 * a client's own domain is not what this lane is for, and the board is where that decision
 * has the body in front of it.
 */
export async function appendPageBody(
  clientId: string,
  pageId: string,
  text: string
): Promise<{ ok: true; words: number } | { ok: false; error: string }> {
  const addition = text.trim();
  if (!addition) return { ok: false, error: "There was nothing to add." };

  const { data: existing, error: readError } = await supabaseAdmin
    .from("client_pages")
    .select("id, answer_md, status")
    .eq("id", pageId)
    .eq("client_id", clientId)
    .maybeSingle();

  if (readError) return { ok: false, error: readError.message };
  if (!existing) return { ok: false, error: "That page does not exist." };
  if (existing.status === "published") {
    return { ok: false, error: "That page is published. Edit it on the client board instead." };
  }

  const current = ((existing.answer_md as string | null) ?? "").trimEnd();
  const next = current ? `${current}\n\n${addition}` : addition;

  const { error } = await supabaseAdmin
    .from("client_pages")
    .update({ answer_md: next, updated_at: new Date().toISOString() })
    .eq("id", pageId)
    .eq("client_id", clientId);

  if (error) return { ok: false, error: error.message };

  revalidateTag(pagesTag(clientId));
  return { ok: true, words: next.split(/\s+/).filter(Boolean).length };
}
