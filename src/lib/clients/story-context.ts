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
    };
  } catch (e) {
    console.error(`[story-context] ${clientId}: ${(e as Error).message}`);
    return EMPTY_STORY_CONTEXT;
  }
}
