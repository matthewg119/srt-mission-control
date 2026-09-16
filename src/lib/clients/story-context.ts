// What a page's stories are tuned with: the buyer, the offer, its necessary beliefs and the avatar sheet.
//
// One loader for the skeleton (draftOutline), the draft (draftPage) and the headlines, so the three never
// disagree about which beliefs a story installs.
//
// ‼️ NEVER THROWS AND NEVER REFUSES. Stories and headlines were written before any of this existed, and a
// client whose framework has not come back (or a database that has not run
// docs/2026-09-15-offers-and-framework.sql) gets an empty context: stories with no belief ids, headlines
// from the offer alone. A missing document is a thinner prompt, not a failed page.

import { supabaseAdmin } from "@/lib/db";
import { avatarNotesFrom, EMPTY_STORY_CONTEXT, type StoryBelief, type StoryContext } from "@/lib/hub/page-stories";

type Parsed = { sections?: Record<string, string>; subs?: Record<string, string> } | null;

/**
 * The six objections a story should be aimed at: what prospects said on our calls first, then the owner's
 * own intake words, then the seed list. Never a research heading or a competitor's copy (phrase-kind.ts).
 */
async function objectionsFor(clientId: string, vertical: string | null): Promise<Array<{ text: string; belief: string | null }>> {
  try {
    const { BELIEF_THEMES } = await import("@/config/objections/aeo-agency-owner");
    const label = (key: unknown) =>
      typeof key === "string" && key in BELIEF_THEMES ? BELIEF_THEMES[key as keyof typeof BELIEF_THEMES].label : null;
    const out: Array<{ text: string; belief: string | null }> = [];
    const seen = new Set<string>();
    const add = (text: string, belief: string | null) => {
      const key = text.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
      if (!key || seen.has(key) || out.length >= 6) return;
      seen.add(key);
      out.push({ text, belief });
    };

    if (vertical) {
      const { data } = await supabaseAdmin
        .from("question_bank")
        .select("phrase, source, belief_key, frequency_score")
        .eq("vertical", vertical)
        .eq("kind", "objection")
        .in("source", ["sales_call", "seed"])
        .is("excluded_at", null)
        .order("frequency_score", { ascending: false })
        .limit(40);
      const rows = (data ?? []) as Array<Record<string, unknown>>;
      for (const r of rows.filter((x) => x.source === "sales_call")) add(String(r.phrase), label(r.belief_key));
      const { data: client } = await supabaseAdmin.from("clients").select("ideal_patient").eq("id", clientId).maybeSingle();
      const ip = (client?.ideal_patient ?? {}) as Record<string, unknown>;
      for (const k of ["objection_1", "objection_2", "objection_3"]) {
        if (typeof ip[k] === "string" && (ip[k] as string).trim()) add((ip[k] as string).trim(), null);
      }
      for (const r of rows.filter((x) => x.source === "seed")) add(String(r.phrase), label(r.belief_key));
    }
    return out;
  } catch (e) {
    console.error(`[story-context] objections for ${clientId}: ${(e as Error).message}`);
    return [];
  }
}

export async function storyContextFor(clientId: string): Promise<StoryContext> {
  try {
    const [{ audienceFor }, { loadOffer }, { currentDocument }] = await Promise.all([
      import("./audiences"),
      import("./offers"),
      import("./audience-documents"),
    ]);
    const [aud, offer] = await Promise.all([audienceFor(clientId), loadOffer(clientId)]);
    if (!aud.ok) return { ...EMPTY_STORY_CONTEXT, offer: offer.treatment ?? null };
    const audience = aud.audience;

    const [sheetDoc, beliefsDoc] = await Promise.all([
      currentDocument({ audienceId: audience.id, offerId: null, kind: "avatar_sheet" }),
      offer.id && offer.audienceId === audience.id
        ? currentDocument({ audienceId: audience.id, offerId: offer.id, kind: "necessary_beliefs" })
        : Promise.resolve(null),
    ]);

    // The client's own sheet first; the shared one only when this client has none, the same order
    // dataset-completeness.ts reads research in.
    let sheet: Parsed = sheetDoc.ok ? ((sheetDoc.doc?.parsed as Parsed) ?? null) : null;
    if (!sheet && audience.researchAvatarSlug) {
      const { data, error } = await supabaseAdmin
        .from("avatar_briefs")
        .select("avatar_sheet_parsed")
        .eq("vertical", audience.researchVertical)
        .eq("avatar_slug", audience.researchAvatarSlug)
        .maybeSingle();
      if (!error) sheet = ((data?.avatar_sheet_parsed as Parsed) ?? null);
    }

    const rawBeliefs = beliefsDoc && beliefsDoc.ok ? beliefsDoc.doc?.parsed?.beliefs : null;
    const beliefs: StoryBelief[] = Array.isArray(rawBeliefs)
      ? (rawBeliefs as Array<Record<string, unknown>>)
          .filter((b) => typeof b?.id === "string" && typeof b?.text === "string")
          .map((b) => ({ id: String(b.id), text: String(b.text) }))
      : [];

    return {
      audienceLabel: audience.label,
      buyer: audience.vocabulary.buyerSingular || null,
      offer: offer.treatment ?? null,
      beliefs,
      avatarNotes: avatarNotesFrom(sheet),
      objections: await objectionsFor(clientId, audience.researchVertical),
    };
  } catch (e) {
    console.error(`[story-context] ${clientId}: ${(e as Error).message}`);
    return EMPTY_STORY_CONTEXT;
  }
}
