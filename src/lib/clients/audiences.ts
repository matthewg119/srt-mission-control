// Who this client sells to, read from a row the client owns.
//
// ‼️ THIS MODULE IS THE ONE DOOR, AND src/config/verticals.ts IS NOT BEHIND IT. The whole
// client-side dependency on that file was three lines in client-headlines.ts, and cutting them is
// what stops DEFAULT_VERTICAL_ID reaching anything that writes a client's copy. verticals.ts keeps
// serving the reel and drop lanes, where a camera kit defaulting to pest control is a defensible
// thing for a camera kit to do.
//
// ‼️ IT REFUSES RATHER THAN DEFAULTS, EVERYWHERE, AND THAT IS THE POINT OF THE REWRITE.
// The probe found four silent coercions of the shape `x === "owner" ? "owner" : "patient"`, each
// with no log and no refusal: a card, a draft row and a Slack confirmation all stating "patient"
// with total confidence about a business nobody had classified. Every read here either returns a
// row or says why not, in a sentence naming the repair, the same shape verticalFor() uses.
//
// The cost of that is real and is worth stating: a missing noun now STOPS a step rather than
// shipping a page with the wrong word on it. That trade only pays because refusals land in a Slack
// thread with a fix line. Seeding at provisioning is what keeps the refusal about a word somebody
// has not typed rather than about a row that does not exist.

import { supabaseAdmin } from "@/lib/db";
import {
  AUDIENCE_PRESETS,
  GENERIC_PRESET_KEY,
  proposePreset,
  type AudiencePreset,
} from "@/config/audience-presets";
import type { Audience } from "@/lib/concierge/magnets";

/** The nouns a generator interpolates. Every one of them is required before copy may be written. */
export interface AudienceVocabulary {
  buyerSingular: string;
  buyerPlural: string;
  offerSingular: string;
  offerPlural: string;
  business: string;
  visit: string;
}

export interface ResolvedAudience {
  id: string;
  clientId: string;
  slug: string;
  label: string;
  /** Structural. 'patient' means "buys from the client", including a diner. See the table comment. */
  stance: Audience;
  isPrimary: boolean;

  /** The SHARED research key. Joins question_bank.vertical and avatar_briefs.vertical. */
  researchVertical: string;
  /** Null means "read the untagged question_bank rows", which evidenceRows() already does. */
  researchAvatarSlug: string | null;

  vocabulary: AudienceVocabulary;
  vocabularySource: "preset" | "legacy_default" | "typed" | null;
  vocabularyConfirmedAt: string | null;

  laneName: string | null;
  launcherLabel: string | null;
  hardLines: string[];
  presencePlatformKeys: string[];
  questionSetPreset: string | null;

  seededFrom: string | null;
  confirmedAt: string | null;
}

export type AudienceResult =
  | { ok: true; audience: ResolvedAudience }
  /** `error` names the repair. It is written to be pasted into a Slack thread unchanged. */
  | { ok: false; error: string };

const COLUMNS =
  "id, client_id, slug, label, stance, research_vertical, research_avatar_slug, is_primary, " +
  "buyer_noun_singular, buyer_noun_plural, offer_noun_singular, offer_noun_plural, " +
  "business_noun, visit_noun, vocabulary, vocabulary_source, vocabulary_confirmed_at, " +
  "lane_name, launcher_label, hard_lines, presence_platform_keys, question_set_preset, " +
  "seeded_from, confirmed_at";

type Row = Record<string, unknown>;

const str = (v: unknown): string | null => {
  const s = typeof v === "string" ? v.trim() : "";
  return s.length ? s : null;
};

/**
 * Turn a row into a resolved audience, or say which noun is missing.
 *
 * ‼️ A MISSING HOT NOUN IS A REFUSAL, NOT A BLANK. Interpolating an empty string into
 * "help them book a ${visit} with ${name}" produces a sentence that reads as finished and is
 * wrong, which is strictly worse than a step that stops and says which word nobody has typed.
 */
function resolve(row: Row): AudienceResult {
  const nouns: Array<[keyof AudienceVocabulary, string, string]> = [
    ["buyerSingular", "buyer_noun_singular", "what one buyer is called"],
    ["buyerPlural", "buyer_noun_plural", "what several buyers are called"],
    ["offerSingular", "offer_noun_singular", "what one thing they sell is called"],
    ["offerPlural", "offer_noun_plural", "what several are called"],
    ["business", "business_noun", "what the business itself is called"],
    ["visit", "visit_noun", "what the booking is called"],
  ];

  const vocabulary = {} as AudienceVocabulary;
  const missing: string[] = [];
  for (const [key, column, describe] of nouns) {
    const value = str(row[column]);
    if (!value) missing.push(`${column} (${describe})`);
    else vocabulary[key] = value;
  }

  if (missing.length) {
    return {
      ok: false,
      error:
        `The audience "${str(row.slug) ?? "(unnamed)"}" is missing ${missing.length} word` +
        `${missing.length === 1 ? "" : "s"} nothing can be written without: ${missing.join(", ")}. ` +
        `Set them on the audience card, or re-seed it from a preset.`,
    };
  }

  const stance = str(row.stance);
  if (stance !== "patient" && stance !== "owner") {
    return {
      ok: false,
      error:
        `The audience "${str(row.slug) ?? "(unnamed)"}" has an unreadable stance (${String(row.stance)}). ` +
        `It must be 'owner' (buys from us) or 'patient' (buys from the client).`,
    };
  }

  const vertical = str(row.research_vertical);
  if (!vertical) {
    return {
      ok: false,
      error:
        `The audience "${str(row.slug) ?? "(unnamed)"}" has no research_vertical, so it cannot ` +
        `read the shared question bank or the shared quotes. Set it to the client's vertical slug.`,
    };
  }

  return {
    ok: true,
    audience: {
      id: String(row.id),
      clientId: String(row.client_id),
      slug: str(row.slug) ?? "",
      label: str(row.label) ?? "",
      stance,
      isPrimary: Boolean(row.is_primary),
      researchVertical: vertical,
      researchAvatarSlug: str(row.research_avatar_slug),
      vocabulary,
      vocabularySource: (str(row.vocabulary_source) as ResolvedAudience["vocabularySource"]) ?? null,
      vocabularyConfirmedAt: str(row.vocabulary_confirmed_at),
      laneName: str(row.lane_name),
      launcherLabel: str(row.launcher_label),
      hardLines: Array.isArray(row.hard_lines) ? (row.hard_lines as string[]) : [],
      presencePlatformKeys: Array.isArray(row.presence_platform_keys)
        ? (row.presence_platform_keys as string[])
        : [],
      questionSetPreset: str(row.question_set_preset),
      seededFrom: str(row.seeded_from),
      confirmedAt: str(row.confirmed_at),
    },
  };
}

/** The client's primary audience, or why there is not one. */
export async function audienceFor(clientId: string): Promise<AudienceResult> {
  const { data, error } = await supabaseAdmin
    .from("client_audiences")
    .select(COLUMNS)
    .eq("client_id", clientId)
    .eq("is_primary", true)
    .maybeSingle();

  if (error) {
    return {
      ok: false,
      error:
        `client_audiences is unreadable (${error.message}). If this names a column, ` +
        `docs/2026-09-14-client-audiences.sql has not been run.`,
    };
  }
  if (!data) {
    // ‼️ THE REFUSAL CARRIES THE PROPOSAL, so the card can show a button instead of a dead end.
    const { data: client } = await supabaseAdmin
      .from("clients")
      .select("slug, vertical_slug, business_type")
      .eq("id", clientId)
      .maybeSingle();

    const proposal = proposePreset(
      (client?.vertical_slug as string | null) ?? null,
      (client?.business_type as string | null) ?? null
    );
    return {
      ok: false,
      error:
        `No audience is set for ${(client?.slug as string) ?? clientId}, so nothing knows who this ` +
        `client sells to. ${proposal.reason}`,
    };
  }

  return resolve(data as unknown as Row);
}

/** Every audience this client has, primary first. Empty is a real answer and is not an error. */
export async function audiencesFor(clientId: string): Promise<ResolvedAudience[]> {
  const { data, error } = await supabaseAdmin
    .from("client_audiences")
    .select(COLUMNS)
    .eq("client_id", clientId)
    .order("is_primary", { ascending: false })
    .order("created_at", { ascending: true });

  if (error || !data) return [];
  const out: ResolvedAudience[] = [];
  for (const row of data as unknown as Row[]) {
    const r = resolve(row);
    if (r.ok) out.push(r.audience);
  }
  return out;
}

export async function audienceById(id: string): Promise<AudienceResult> {
  const { data, error } = await supabaseAdmin
    .from("client_audiences")
    .select(COLUMNS)
    .eq("id", id)
    .maybeSingle();

  if (error) return { ok: false, error: `client_audiences is unreadable (${error.message}).` };
  if (!data) return { ok: false, error: `No audience with id ${id}.` };
  return resolve(data as unknown as Row);
}

export interface SeedResult {
  ok: boolean;
  audienceId?: string;
  error?: string;
}

/**
 * Create a client's audience from a preset. THE ONLY READER OF A PRESET.
 *
 * ‼️ NOTHING ELSE MAY IMPORT audience-presets.ts, AND THAT IS ENFORCED BY REVIEW, NOT BY A TYPE.
 * The moment a request-time reader falls back to a preset, this design becomes mergeRowOverSeed()
 * with a different table name. seeded_from and seeded_at are written here so a row can always say
 * where its words came from.
 */
export async function seedClientAudience(args: {
  clientId: string;
  presetKey: string;
  slug: string;
  label: string;
  researchVertical: string;
  researchAvatarSlug?: string | null;
  isPrimary?: boolean;
  by: string;
}): Promise<SeedResult> {
  const preset: AudiencePreset | undefined = AUDIENCE_PRESETS[args.presetKey];
  if (!preset || args.presetKey === GENERIC_PRESET_KEY) {
    return {
      ok: false,
      error:
        `"${args.presetKey}" is not a preset that decides anything. Pick one of ` +
        `${Object.keys(AUDIENCE_PRESETS).join(", ")}, or say which buyer this client sells to.`,
    };
  }
  if (!preset.stance) {
    return { ok: false, error: `The preset "${args.presetKey}" refuses to choose a stance.` };
  }

  const { data, error } = await supabaseAdmin
    .from("client_audiences")
    .insert({
      client_id: args.clientId,
      slug: args.slug,
      label: args.label,
      stance: preset.stance,
      research_vertical: args.researchVertical,
      research_avatar_slug: args.researchAvatarSlug ?? null,
      is_primary: args.isPrimary ?? false,
      buyer_noun_singular: preset.buyer[0],
      buyer_noun_plural: preset.buyer[1],
      offer_noun_singular: preset.offer[0],
      offer_noun_plural: preset.offer[1],
      business_noun: preset.business,
      visit_noun: preset.visit,
      lane_name: preset.laneName,
      launcher_label: preset.launcher,
      hard_lines: preset.hardLines,
      presence_platform_keys: preset.presence,
      question_set_preset: preset.questionSet,
      vocabulary_source: "preset",
      seeded_from: args.presetKey,
      seeded_at: new Date().toISOString(),
    })
    .select("id")
    .single();

  if (error) return { ok: false, error: error.message };
  return { ok: true, audienceId: data.id as string };
}

/**
 * A person has looked at the words and says they are right.
 *
 * ‼️ CONFIRMING THE VOCABULARY IS A SEPARATE FACT FROM CONFIRMING THE AUDIENCE, and both are
 * recorded, because a defaulted value and a chosen one are otherwise indistinguishable. That is the
 * same reason concierge_configs.audience_confirmed_at exists at all.
 */
export async function confirmClientAudience(
  audienceId: string,
  by: string
): Promise<{ ok: boolean; error?: string }> {
  const now = new Date().toISOString();
  const { error } = await supabaseAdmin
    .from("client_audiences")
    .update({
      confirmed_at: now,
      confirmed_by: by,
      vocabulary_confirmed_at: now,
      vocabulary_confirmed_by: by,
      updated_at: now,
    })
    .eq("id", audienceId);

  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

export interface SharedBank {
  /** [{text, source, source_url}] shared across every client selling to this audience. */
  vocQuotes: Array<{ text: string; source?: string; source_url?: string | null }>;
  /** The ONLY figures copy may state. An empty list forbids all of them, visibly. */
  approvedNumbers: Array<{ value: string; source_url?: string | null }>;
}

/**
 * The shared bank behind an audience, from avatar_briefs.
 *
 * ‼️ TIER 2 ONLY, AND THERE IS NO TIER 3. The client's own CUSTOMER_REVIEW rows in page_sources
 * always win; this tops them up; and after it there is nothing. No seed, no default, nothing
 * inherited from another audience. verticals.ts's own doctrine, which survives this rewrite intact:
 * a wrong bank is worse than an empty one, because an empty one is visible.
 *
 * ‼️ A NULL avatar_slug READS THE VERTICAL'S '_default' ROW. That is where a vertical's shared
 * vocabulary lives before anybody has confirmed a buyer, because "patient / treatment / clinic" is
 * true of every med spa regardless of which avatar it aims at.
 */
export async function sharedBankFor(audience: ResolvedAudience): Promise<SharedBank> {
  const empty: SharedBank = { vocQuotes: [], approvedNumbers: [] };

  const { data, error } = await supabaseAdmin
    .from("avatar_briefs")
    .select("voc_quotes, approved_numbers")
    .eq("vertical", audience.researchVertical)
    .eq("avatar_slug", audience.researchAvatarSlug ?? "_default")
    .maybeSingle();

  if (error) {
    console.error("[audiences] avatar_briefs unreadable:", error.message);
    return empty;
  }
  if (!data) return empty;

  const quotes = Array.isArray(data.voc_quotes) ? data.voc_quotes : [];
  const numbers = Array.isArray(data.approved_numbers) ? data.approved_numbers : [];

  return {
    vocQuotes: (quotes as Array<Record<string, unknown>>)
      .map((q) => ({
        text: String(q?.text ?? "").trim(),
        source: str(q?.source) ?? undefined,
        source_url: str(q?.source_url),
      }))
      .filter((q) => q.text.length > 0),
    approvedNumbers: (numbers as Array<Record<string, unknown>>)
      .map((n) => ({ value: String(n?.value ?? "").trim(), source_url: str(n?.source_url) }))
      .filter((n) => n.value.length > 0),
  };
}
