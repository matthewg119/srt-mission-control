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
  /**
   * The lead magnet this page was written toward, by `lead_magnets.magnet_key`.
   *
   * ‼️ CHOSEN BEFORE THE PAGE IS DRAFTED, NOT GUESSED AFTER IT EXISTS (Matthew, 2026-09-03). The
   * concierge ladder in lib/concierge/magnets.ts answers "what would we offer a visitor standing
   * here", which is a ranking over placement columns. This is the other question: what is this
   * page for. It is a key rather than a foreign key because `city_rivals` is seeded twice and the
   * page is naming the offer, not one row of it.
   *
   * Null means the ladder decides, which is every page written before this column existed.
   */
  leadMagnetKey: string | null;
  status: PageStatus;
  publishedAt: string | null;
  updatedAt: string | null;
}

// ‼️ ONE STRING LITERAL, NOT A CONCATENATION. supabase-js parses this at the type level, and
// "a" + "b" widens to `string`, which turns every read here into GenericStringError.
const COLUMNS =
  "id, slug, title, question, prompt_block, answer_md, meta_description, lead_magnet_key, status, published_at, updated_at";

function toPage(row: Record<string, unknown>): ClientPage {
  return {
    id: row.id as string,
    slug: row.slug as string,
    title: row.title as string,
    question: (row.question as string) ?? "",
    promptBlock: (row.prompt_block as PromptBlock | null) ?? null,
    answerMd: (row.answer_md as string) ?? "",
    metaDescription: (row.meta_description as string | null) ?? null,
    leadMagnetKey: (row.lead_magnet_key as string | null) ?? null,
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
  /**
   * The magnet this page is written toward. Same undefined/null split as `evidenceMap` below:
   * `undefined` is "this save says nothing about it" and leaves the stored key alone, `null`
   * clears it. The page studio sets it through `setPageMagnet` rather than through here.
   */
  leadMagnetKey?: string | null;
  /**
   * What each claim rests on, from the drafter. `[{ claim, sourceRef }]`.
   *
   * ‼️ UNDEFINED AND NULL MEAN DIFFERENT THINGS HERE AND THE WRITE BELOW DEPENDS ON IT.
   * `undefined` is "this save says nothing about provenance", which is every ordinary form
   * submission, and the stored map is left alone. `null` is "this body was written by hand and
   * has no map", which is a real statement and clears it. Collapsing the two would mean editing
   * a title through the form silently erased the provenance of a drafted page, and the gate
   * would then read the page as hand-written and skip the check that matters most.
   */
  evidenceMap?: unknown[] | null;
}

/**
 * Bust the per-client page cache, and never let that undo a write that already succeeded.
 *
 * ‼️ OUTSIDE A REQUEST CONTEXT `revalidateTag` THROWS, AND TWO OF THIS FILE'S CALLERS ARE NOW
 * OUTSIDE ONE. `startPageDraft` and `appendPageBody` are reached from `handlePageStudioEvent`,
 * which `api/slack/events/route.ts` invokes inside `waitUntil`. The throw lands AFTER the row is
 * written, so the failure mode is the worst shape available: the draft exists, the thread never
 * confirms it, and `page_studio_sessions.page_id` is never set, leaving a session that can never
 * be claimed and a user looking at nothing.
 *
 * Same guard and the same reasoning as `revalidateClientHub()` in hub/resolve.ts and the attach
 * path in hub/vercel-domains.ts, both of which already wrote this down. The tag expires on its
 * own; a lost write does not.
 */
function bustPages(clientId: string): void {
  try {
    revalidateTag(pagesTag(clientId));
  } catch {
    // Not in a request (the Slack lane's waitUntil, a cron, a script). The TTL covers it.
  }
}

export async function savePage(input: SavePageInput): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const slug = pageSlug(input.slug || input.title);
  if (!slug) return { ok: false, error: "That title does not produce a usable web address." };
  if (!input.title.trim()) return { ok: false, error: "A title is required." };
  if (!input.question.trim()) return { ok: false, error: "The question this page answers is required." };
  if (!input.answerMd.trim()) return { ok: false, error: "An answer is required." };

  const row: Record<string, unknown> = {
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

  // Only when the caller actually said something about it. See SavePageInput.leadMagnetKey.
  if (input.leadMagnetKey !== undefined) {
    row.lead_magnet_key = input.leadMagnetKey?.trim() || null;
  }

  // Only when the caller actually said something about it. See SavePageInput.evidenceMap.
  if (input.evidenceMap !== undefined) {
    row.evidence_map = input.evidenceMap;
  } else if (input.id) {
    // ‼️ A CHANGED BODY WITH AN UNCHANGED MAP IS A MAP THAT LIES, so the map is dropped.
    //
    // The map says "every claim on this page traces to a source". Edit a paragraph by hand and
    // that sentence is about text that is no longer there, but `unbacked_claims` would keep
    // reading it and keep passing. Clearing it moves that check to `skip`, which is the honest
    // state for a body a person wrote, and the model read-through still checks the real words.
    //
    // A page nobody edited keeps its map: the read below compares the actual bodies rather than
    // assuming an update touched one.
    const { data: before } = await supabaseAdmin
      .from("client_pages")
      .select("answer_md")
      .eq("id", input.id)
      .eq("client_id", input.clientId)
      .maybeSingle();

    const previous = ((before?.answer_md as string | null) ?? "").trim();
    if (previous && previous !== input.answerMd.trim()) row.evidence_map = null;
  }

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

  bustPages(input.clientId);
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

  bustPages(clientId);
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
  /**
   * The plan row's working title, when the page came off an approved plan. It becomes the title
   * AND the source of the slug, because a slug built from a harvested question carries the
   * question's quote marks and length into a public URL a crawler indexes. Without one the
   * question is the working title, as before.
   */
  title?: string | null;
}): Promise<{ ok: true; id: string; slug: string; resumed: boolean } | { ok: false; error: string }> {
  const question = input.question.trim();
  if (!question) return { ok: false, error: "There is no question to open a page for." };

  const workingTitle = input.title?.trim() || question;
  const slug = pageSlug(workingTitle);
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
      // The plan's working title, or the question when there is no plan. A page whose title is
      // still its question is a page nobody has finished, which beats a blank on the board.
      title: workingTitle.slice(0, 200),
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

  bustPages(input.clientId);
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
    .update({
      answer_md: next,
      // Dictating into a drafted page makes its claim map describe a body that no longer
      // exists. Same reasoning as savePage: a map that no longer matches is worse than none,
      // because `unbacked_claims` would keep passing on it. The dictation itself is filed as a
      // source by the page studio, so nothing about where these words came from is lost.
      evidence_map: null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", pageId)
    .eq("client_id", clientId);

  if (error) return { ok: false, error: error.message };

  bustPages(clientId);
  return { ok: true, words: next.split(/\s+/).filter(Boolean).length };
}

/**
 * Take the last appended chunk back out of a draft.
 *
 * ‼️ THE ONE WAY OUT OF A WRONG APPEND THAT DOES NOT NEED THE BOARD. Matthew typed "1" meaning
 * "magnet 1", the lane appended it verbatim (correctly: a bare digit after a claim is dictation),
 * and the only way to get it back out was the board's Edit form. The chunk boundary is the blank
 * line appendPageBody itself writes between appends. A single message that itself contained a
 * blank line therefore comes back out one paragraph per `undo`, which errs toward removing too
 * little rather than too much.
 *
 * Refuses on a published page for the reason appendPageBody does. Drops the evidence map for the
 * reason it does too: the map described a body that no longer exists.
 */
export async function undoLastAppend(
  clientId: string,
  pageId: string
): Promise<{ ok: true; removed: string; words: number } | { ok: false; error: string }> {
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

  const chunks = ((existing.answer_md as string | null) ?? "").trim().split(/\n{2,}/);
  const removed = (chunks.pop() ?? "").trim();
  if (!removed) return { ok: false, error: "The page is already empty, so there is nothing to undo." };

  const next = chunks.join("\n\n");
  const { error } = await supabaseAdmin
    .from("client_pages")
    .update({ answer_md: next, evidence_map: null, updated_at: new Date().toISOString() })
    .eq("id", pageId)
    .eq("client_id", clientId);

  if (error) return { ok: false, error: error.message };

  bustPages(clientId);
  return { ok: true, removed, words: next.split(/\s+/).filter(Boolean).length };
}

// ─────────────────────────────────────────────────────────────────────────────
// The outline a page is written from
//
// ‼️ IT LIVES IN client_pages.outline AND NEVER IN answer_md. A model writes it, and machine text in
// the body with no evidence map behind it is the one thing the gate cannot see: a null map reads
// as hand-written and skips unbacked_claims. The gaps are answered as page_sources and `draft`
// writes the body from those, with a map, so the gate keeps working on every page.
//
// ‼️ READ AND WRITTEN SEPARATELY FROM COLUMNS, for blast radius. COLUMNS feeds the published hub
// on every client's domain, and PostgREST fails a whole select on one unknown column, so adding
// outline there would take live pages down in the window before docs/2026-09-11-page-plan.sql runs.
// ─────────────────────────────────────────────────────────────────────────────

export interface OutlineSection {
  heading: string;
  bullets: string[];
}

export interface OutlineGap {
  /** "G1", "G2"... referenced in the bullets as [G1]. */
  id: string;
  /** Asked out loud, in the second person, the same way an interview topic is. */
  prompt: string;
  /** "client" files the answer in the client library, for every later page. */
  scope: "page" | "client";
}

export interface PageOutline {
  sections: OutlineSection[];
  gaps: OutlineGap[];
  writtenAt: string;
}

/** The stored outline, validated. Drop, never repair: a half-valid outline is no outline. */
export function readOutline(raw: unknown): PageOutline | null {
  if (!raw || typeof raw !== "object") return null;
  const bag = raw as Record<string, unknown>;
  if (!Array.isArray(bag.sections) || !Array.isArray(bag.gaps)) return null;

  const sections = bag.sections
    .map((s) => s as Record<string, unknown>)
    .filter((s) => typeof s?.heading === "string" && Array.isArray(s?.bullets))
    .map((s) => ({
      heading: String(s.heading).trim(),
      bullets: (s.bullets as unknown[]).filter((b): b is string => typeof b === "string" && b.trim() !== ""),
    }))
    .filter((s) => s.heading !== "");

  const gaps = bag.gaps
    .map((g) => g as Record<string, unknown>)
    .filter((g) => typeof g?.id === "string" && typeof g?.prompt === "string")
    .map((g) => ({
      id: String(g.id).trim(),
      prompt: String(g.prompt).trim(),
      scope: (g.scope === "client" ? "client" : "page") as "page" | "client",
    }))
    .filter((g) => g.id !== "" && g.prompt !== "");

  if (sections.length === 0) return null;
  return { sections, gaps, writtenAt: typeof bag.writtenAt === "string" ? bag.writtenAt : "" };
}

export async function readPageOutline(clientId: string, pageId: string): Promise<PageOutline | null> {
  const { data, error } = await supabaseAdmin
    .from("client_pages")
    .select("outline")
    .eq("id", pageId)
    .eq("client_id", clientId)
    .maybeSingle();

  if (error) {
    console.error(
      `[hub/pages] outline read failed (${error.message}). If this names outline, ` +
        `docs/2026-09-11-page-plan.sql has not been run on this database.`
    );
    return null;
  }
  return readOutline(data?.outline);
}

/** Not gated. An outline is not published and never reaches the hub. */
export async function setPageOutline(
  clientId: string,
  pageId: string,
  outline: PageOutline | null
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { error } = await supabaseAdmin
    .from("client_pages")
    .update({ outline, updated_at: new Date().toISOString() })
    .eq("id", pageId)
    .eq("client_id", clientId);

  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

/**
 * Name the magnet a draft is being written toward, from the page studio.
 *
 * ‼️ A SEPARATE WRITER RATHER THAN A savePage CALL, for the reason startPageDraft and
 * appendPageBody are also separate: the Slack lane holds a page id and one field, not a whole
 * form, and routing it through savePage would make it re-send a title, a question and a body it
 * never read. It is also the only writer here that touches a PUBLISHED page on purpose. Changing
 * which free thing a live page offers is not editing the page, it is editing the offer, and
 * refusing it would mean unpublishing a page to fix a mislabelled pill.
 *
 * Not gated. Naming an offer is not publishing — see NOT_GATED in clients/day-zero.ts.
 */
export async function setPageMagnet(
  clientId: string,
  pageId: string,
  magnetKey: string | null
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { error } = await supabaseAdmin
    .from("client_pages")
    .update({ lead_magnet_key: magnetKey?.trim() || null, updated_at: new Date().toISOString() })
    .eq("id", pageId)
    .eq("client_id", clientId);

  if (error) return { ok: false, error: error.message };

  bustPages(clientId);
  return { ok: true };
}
