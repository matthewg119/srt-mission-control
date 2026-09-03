// Carry what we already measured about a business onto the record we will actually message.
//
// ‼️ THE SEAM THIS CLOSES. The scraper knows how visible a business is and nothing about who to
// email. The follow-up operator knows an email address and nothing about visibility. Measured
// before this file: scraper_rows holds 613 rows with dominance and optimization scores, 0 emails,
// 6 company-name matches into contacts and 3 place-id matches into any lead table. The scores are
// rendered into a Slack card, written to dominant.csv for a separate project, and then dropped.
//
// ‼️ IT LINKS FEW ROWS TODAY AND THAT IS THE HONEST OUTCOME. The temptation is to widen the match
// until the number looks better, which here means matching on company name and city. That is
// exactly the guess the identity spine refuses everywhere else: a name collision across two cities
// is what the corroboration rule exists to catch, and there is nothing independent here to check it
// against. A place id is an identifier rather than a description, so it needs no corroboration and
// it is the only key used. The value of this file is forward-looking: from here on the scores reach
// the business instead of dying at the card.

import { supabaseAdmin } from "@/lib/db";

export interface CarriedScores {
  gbp_place_id: string | null;
  dominance_score: number | null;
  score_components: unknown;
  optimization_score: number | null;
  optimization_components: unknown;
  presence_score: number | null;
}

/** Nothing measured. Distinct from "measured and scored zero", which is a finding. */
export const NO_SCORES: CarriedScores = {
  gbp_place_id: null,
  dominance_score: null,
  score_components: null,
  optimization_score: null,
  optimization_components: null,
  presence_score: null,
};

function hasAnything(s: CarriedScores): boolean {
  return s.dominance_score !== null || s.optimization_score !== null;
}

/**
 * The scores already stored against a contact, if any.
 *
 * Read from contacts rather than recomputed. Recomputing would mean buying a SERP again for a
 * business we already paid to measure, which is the cost this whole lane exists to stop repeating.
 */
export async function scoresForContact(contactId: string | null): Promise<CarriedScores> {
  if (!contactId) return NO_SCORES;

  // Cast because the select list is a concatenated string rather than a literal, which is all
  // supabase-js needs to give up on inferring the row and hand back GenericStringError instead.
  const { data: raw } = await supabaseAdmin
    .from("contacts")
    .select(
      "google_place_id, dominance_score, score_components, optimization_score, " +
        "optimization_components, presence_score"
    )
    .eq("id", contactId)
    .maybeSingle();

  const data = raw as unknown as Record<string, unknown> | null;
  if (!data) return NO_SCORES;

  return {
    gbp_place_id: (data.google_place_id as string | null) ?? null,
    dominance_score: (data.dominance_score as number | null) ?? null,
    score_components: data.score_components ?? null,
    optimization_score: (data.optimization_score as number | null) ?? null,
    optimization_components: data.optimization_components ?? null,
    presence_score: (data.presence_score as number | null) ?? null,
  };
}

/**
 * Copy a scraper row's scores onto the contact it is linked to.
 *
 * ‼️ ONLY ONTO A CONTACT THE ROW IS ALREADY LINKED TO. This does not decide identity, it moves data
 * along a link the spine backfill established under its own two guards. Keeping the two jobs apart
 * is what stops "carry the scores" from quietly becoming a second, looser matcher.
 *
 * scores_updated_at is the write guard: a contact scored once is not re-stamped by a later, thinner
 * scrape of the same business.
 */
export async function carryScraperRowToContact(scraperRowId: string): Promise<boolean> {
  const { data: rawRow } = await supabaseAdmin
    .from("scraper_rows")
    .select(
      "contact_id, gbp_place_id, dominance_score, score_components, " +
        "optimization_score, optimization_components"
    )
    .eq("id", scraperRowId)
    .maybeSingle();

  const row = rawRow as unknown as Record<string, unknown> | null;
  if (!row?.contact_id || row.dominance_score === null) return false;

  const { error } = await supabaseAdmin
    .from("contacts")
    .update({
      google_place_id: row.gbp_place_id ?? null,
      dominance_score: row.dominance_score,
      score_components: row.score_components,
      optimization_score: row.optimization_score,
      optimization_components: row.optimization_components,
      scores_updated_at: new Date().toISOString(),
    })
    .eq("id", row.contact_id as string)
    .is("scores_updated_at", null);

  if (error) {
    console.error(`[carry-scores] contact update: ${error.message}`);
    return false;
  }
  return true;
}

/**
 * Put whatever we know about a business onto the prospect at enrollment.
 *
 * Called from the two doors that mint prospects. Best effort by design: a prospect with no scores
 * is the normal case, gets no signal ammo, and is not an error. Returns whether anything landed.
 */
export async function attachScoresToProspect(
  prospectId: string,
  contactId: string | null
): Promise<boolean> {
  const scores = await scoresForContact(contactId);
  if (!hasAnything(scores)) return false;

  const { error } = await supabaseAdmin
    .from("outreach_prospects")
    .update({
      gbp_place_id: scores.gbp_place_id,
      dominance_score: scores.dominance_score,
      score_components: scores.score_components,
      optimization_score: scores.optimization_score,
      optimization_components: scores.optimization_components,
      presence_score: scores.presence_score,
      scores_updated_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", prospectId);

  if (error) {
    console.error(`[carry-scores] prospect update: ${error.message}`);
    return false;
  }
  return true;
}
