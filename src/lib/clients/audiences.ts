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
  /**
   * Where the six nouns came from. ‼️ 'borrowed' is the weakest of the four and is kept distinct
   * from 'preset' on purpose: those words were copied off ANOTHER client's audience for the same
   * avatar slug, so it is the one a person should check before a card tells this client what their
   * own buyers are called.
   */
  vocabularySource: "preset" | "legacy_default" | "typed" | "borrowed" | null;
  vocabularyConfirmedAt: string | null;

  laneName: string | null;
  launcherLabel: string | null;
  hardLines: string[];
  presencePlatformKeys: string[];
  questionSetPreset: string | null;
  /**
   * The market this audience is ABOUT, for the competitor and content layers.
   *
   * ‼️ NULL IS A REAL ANSWER AND MUST NOT BE COALESCED. competitorAmmo already refuses with
   * "we do not know what this business sells yet", which is the honest failure. A default here
   * would file a second avatar's evidence under the first one's market, permanently.
   */
  buyerMarket: string | null;

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
  "seeded_from, confirmed_at, buyer_market";

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
      buyerMarket: str(row.buyer_market),
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
      buyer_market: preset.buyerMarket,
      vocabulary_source: "preset",
      seeded_from: args.presetKey,
      seeded_at: new Date().toISOString(),
    })
    .select("id")
    .single();

  if (error) return { ok: false, error: error.message };
  return { ok: true, audienceId: data.id as string };
}

// ─────────────────────────────────────────────────────────────────────────────
// Borrowing an avatar that some other client already aims at
// ─────────────────────────────────────────────────────────────────────────────

/**
 * One avatar this client could borrow, as the library knows it.
 *
 * ‼️ THE LIBRARY IS (vertical, avatar_slug) AND IT IS NOT A NEW TABLE. question_bank and
 * avatar_briefs are keyed that way with NO client_id, on purpose: "the whole value is that the
 * second med spa aiming at laser hair removal gets the first one's research". So borrowing is not
 * moving rows anywhere. It is one client_audiences row carrying that slug, after which the shared
 * research follows BY KEY, and audience_documents stay per client because they key on audience_id.
 */
export interface LibraryAvatar {
  vertical: string;
  avatarSlug: string;
  label: string;
  stance: Audience;
  /** The row its vocabulary would be copied from. See borrowAvatar for why a copy is needed. */
  sourceAudienceId: string;
  /** How many OTHER clients already aim at this avatar. */
  otherClients: number;
  /** Whether the shared bank actually holds research, which is most of why borrowing is worth it. */
  hasResearch: boolean;
  phrases: number;
}

/**
 * Every avatar in the database this client does not already have, newest evidence first.
 *
 * ‼️ IT EXCLUDES WHAT THE CLIENT ALREADY HAS, rather than listing it and letting the borrow fail.
 * client_audiences_client_slug is unique on (client_id, slug), so an already-held avatar cannot be
 * borrowed twice and offering it would be offering an action that can only error.
 *
 * `vertical` narrows to the client's own vertical, which is the sane default: an avatar from
 * another vertical shares no question_bank rows with this client, so borrowing it brings nothing
 * but its vocabulary. Passing null searches everything, which is the "select from the database"
 * case and is deliberately available.
 */
export async function avatarLibrary(args: {
  clientId: string;
  vertical?: string | null;
}): Promise<LibraryAvatar[]> {
  const { data: mine } = await supabaseAdmin
    .from("client_audiences")
    .select("slug")
    .eq("client_id", args.clientId);
  const held = new Set((mine ?? []).map((r) => String((r as Row).slug ?? "")));

  let q = supabaseAdmin
    .from("client_audiences")
    .select(COLUMNS)
    .neq("client_id", args.clientId)
    .not("research_avatar_slug", "is", null);
  if (args.vertical) q = q.eq("research_vertical", args.vertical);

  const { data, error } = await q;
  if (error || !data) return [];

  // One entry per (vertical, slug). Several clients can aim at the same avatar, and the first
  // RESOLVABLE row is the one whose vocabulary would be copied: resolve() refuses a row missing
  // any of the six nouns, and copying from a refused row would produce a second refused row.
  const byKey = new Map<string, LibraryAvatar>();
  for (const row of data as unknown as Row[]) {
    const r = resolve(row);
    if (!r.ok) continue;
    const a = r.audience;
    const slug = a.researchAvatarSlug;
    if (!slug || held.has(slug)) continue;

    const key = `${a.researchVertical}::${slug}`;
    const existing = byKey.get(key);
    if (existing) {
      existing.otherClients += 1;
      continue;
    }
    byKey.set(key, {
      vertical: a.researchVertical,
      avatarSlug: slug,
      label: a.label,
      stance: a.stance,
      sourceAudienceId: a.id,
      otherClients: 1,
      hasResearch: false,
      phrases: 0,
    });
  }

  const out = [...byKey.values()];
  if (!out.length) return out;

  // What the shared bank actually holds for each, because "borrow this one" is only worth pressing
  // when something comes with it. Counted rather than assumed: avatar_briefs can hold a prompt and
  // no research at all, which is exactly what reuseAvatarResearch refuses on.
  const slugs = out.map((a) => a.avatarSlug);
  const [{ data: briefs }, { data: phrases }] = await Promise.all([
    supabaseAdmin.from("avatar_briefs").select("vertical, avatar_slug, research_text").in("avatar_slug", slugs),
    supabaseAdmin.from("question_bank").select("vertical, avatar").in("avatar", slugs),
  ]);

  for (const b of (briefs ?? []) as unknown as Row[]) {
    const hit = out.find((a) => a.vertical === b.vertical && a.avatarSlug === b.avatar_slug);
    if (hit) hit.hasResearch = Boolean(str(b.research_text));
  }
  for (const p of (phrases ?? []) as unknown as Row[]) {
    const hit = out.find((a) => a.vertical === p.vertical && a.avatarSlug === p.avatar);
    if (hit) hit.phrases += 1;
  }

  return out.sort((a, b) => b.phrases - a.phrases || a.label.localeCompare(b.label));
}

/**
 * Give this client an audience for an avatar another client already aims at.
 *
 * ‼️ seedClientAudience CANNOT DO THIS, AND THAT IS THE WHOLE REASON THIS FUNCTION EXISTS.
 * It is the PRESET door: it needs an AUDIENCE_PRESETS key, and resolve() refuses a row missing any
 * of the six vocabulary nouns. An avatar borrowed out of a vertical with no preset would produce a
 * row every reader refuses, which reads as the borrow having silently failed. So the nouns and the
 * stance are copied from the source audience and the row says so with vocabulary_source
 * 'borrowed'. Copying vocabulary is not copying client data: the nouns are what a buyer of that
 * kind is CALLED, which is the same word in both clients' mouths.
 *
 * ‼️ IT LANDS AS AN OPTION, NEVER AS THE PRIMARY. Promotion is a separate, deliberate act with an
 * ordering rule of its own (insert non-primary, demote, promote, because
 * client_audiences_one_primary is a partial unique index). Borrowing an avatar must not silently
 * re-aim everything the client already has.
 *
 * ‼️ IT COPIES NO RESEARCH. The research is already reachable: it is keyed on
 * (vertical, avatar_slug) and this row now carries both. reuseAvatarResearch remains the one door
 * that puts text through the extractor, and the caller runs it if it wants the phrases too.
 */
export async function borrowAvatar(args: {
  clientId: string;
  vertical: string;
  avatarSlug: string;
  by: string;
}): Promise<SeedResult> {
  const { data: clash } = await supabaseAdmin
    .from("client_audiences")
    .select("id")
    .eq("client_id", args.clientId)
    .eq("slug", args.avatarSlug)
    .maybeSingle();
  if (clash) {
    return {
      ok: false,
      error: `This client already has an audience for "${args.avatarSlug}". Pick it rather than borrowing it again.`,
    };
  }

  const { data: sources, error: readError } = await supabaseAdmin
    .from("client_audiences")
    .select(COLUMNS)
    .eq("research_vertical", args.vertical)
    .eq("research_avatar_slug", args.avatarSlug)
    .neq("client_id", args.clientId);
  if (readError) return { ok: false, error: `client_audiences is unreadable (${readError.message}).` };

  const usable = (sources ?? [])
    .map((row) => resolve(row as unknown as Row))
    .find((r): r is { ok: true; audience: ResolvedAudience } => r.ok);

  if (!usable) {
    return {
      ok: false,
      error:
        `Nothing in the database aims at "${args.avatarSlug}" in ${args.vertical} with a complete ` +
        "set of vocabulary nouns, so there is nothing to copy. Confirm the avatar on this client " +
        "instead, which seeds the words from a preset.",
    };
  }

  const src = usable.audience;
  const { data, error } = await supabaseAdmin
    .from("client_audiences")
    .insert({
      client_id: args.clientId,
      slug: args.avatarSlug,
      label: src.label,
      stance: src.stance,
      research_vertical: args.vertical,
      research_avatar_slug: args.avatarSlug,
      is_primary: false,
      buyer_noun_singular: src.vocabulary.buyerSingular,
      buyer_noun_plural: src.vocabulary.buyerPlural,
      offer_noun_singular: src.vocabulary.offerSingular,
      offer_noun_plural: src.vocabulary.offerPlural,
      business_noun: src.vocabulary.business,
      visit_noun: src.vocabulary.visit,
      lane_name: src.laneName,
      launcher_label: src.launcherLabel,
      hard_lines: src.hardLines,
      presence_platform_keys: src.presencePlatformKeys,
      question_set_preset: src.questionSetPreset,
      buyer_market: src.buyerMarket,
      // ‼️ NOT 'preset'. These nouns came from another client's row, which is a weaker claim than a
      // preset, and it is the one somebody should check before a card tells this client what their
      // own buyers are called.
      vocabulary_source: "borrowed",
      seeded_from: `borrowed:${src.id}`,
      seeded_at: new Date().toISOString(),
    })
    .select("id")
    .single();

  if (error) return { ok: false, error: error.message };
  return { ok: true, audienceId: data.id as string };
}

/**
 * Which audience a page is being written for, or a refusal naming the choice nobody made.
 *
 * ‼️ ONE AUDIENCE IS NOT A CHOICE, AND REFUSING THERE WOULD BE THEATRE. Every client today has
 * exactly one, so a gate that always asked would add a press to every page on the board and answer
 * nothing. The ambiguity this exists for begins at the SECOND audience, which borrowing an avatar
 * is designed to create.
 *
 * ‼️ AND AT TWO IT REFUSES RATHER THAN TAKING THE PRIMARY. Defaulting to
 * clients.primary_avatar_slug is the failure mode this whole lane keeps relearning: verticalFor,
 * runHarvest, buildContext and ingestResearch all refuse rather than guess, because work filed
 * against a buyer nobody chose cannot be told apart afterwards from work somebody aimed. A page is
 * the most expensive thing in the product to write against the wrong buyer.
 *
 * Zero audiences returns null rather than refusing: that client cannot write a page for other
 * reasons already (frameContext refuses "aimed at nobody"), and duplicating that refusal here
 * would report the wrong cause.
 */
export async function audienceForWrite(args: {
  clientId: string;
  audienceId?: string | null;
}): Promise<{ ok: true; audienceId: string | null } | { ok: false; error: string }> {
  if (args.audienceId) {
    const picked = await audienceById(args.audienceId);
    if (!picked.ok) return { ok: false, error: picked.error };
    if (picked.audience.clientId !== args.clientId) {
      // The composite foreign key would refuse this at the database too. Saying it here names the
      // mistake instead of surfacing a constraint violation.
      return {
        ok: false,
        error: "That audience belongs to a different client. A page can only be aimed at one of this client's own.",
      };
    }
    return { ok: true, audienceId: picked.audience.id };
  }

  const all = await audiencesFor(args.clientId);
  if (all.length <= 1) return { ok: true, audienceId: all[0]?.id ?? null };

  const list = all.map((a) => `\`${a.slug}\`${a.isPrimary ? " (primary)" : ""} ${a.label}`).join("\n");
  return {
    ok: false,
    error:
      `This client has ${all.length} audiences and nothing said which one this page is for. ` +
      "A page written for the wrong buyer cannot be told apart afterwards from one written for " +
      `the right one, so pick before writing:\n${list}`,
  };
}

/** What confirming an avatar did to the client's audiences, said in words for the card. */
export type AudienceLink =
  | { ok: true; audienceId: string; created: boolean; note: string }
  | { ok: false; note: string };

/**
 * Confirming an avatar on a client IS choosing that client's audience. Make it the primary one.
 *
 * Matthew, 2026-09-15: an audience is "the avatars in which THAT specific customer is looking to
 * target", and a client can have several (SRT: med spa owners AND plumbers; a med spa: women in
 * their 30s for rejuvenation AND women over 60 for a lift). One is worked at a time, the rest stay
 * on file as options.
 *
 * ‼️ THIS IS THE FIRST CODE PATH THAT EVER CREATES A client_audiences ROW. Measured 2026-09-15:
 * seedClientAudience had no caller. SRT's one row came from the migration's one-time backfill, so
 * the next client onboarded would have had none, and concierge-setup refuses without one ("Seed
 * the audience first"), which strands pre_call_pages behind concierge_preview. Headlines degrade
 * too: no audience means no shared quotes and no approved numbers, so every figure is unbacked.
 *
 * ‼️ A CHANGE DEMOTES, IT NEVER DELETES. The previous primary stays as a non-primary row, which is
 * exactly "one of the options". Research sharing is unaffected: the row carries
 * (research_vertical, research_avatar_slug), the key avatar_briefs and question_bank already use.
 *
 * ‼️ ORDER: INSERT AS NON-PRIMARY, DEMOTE THE OLD ONE, PROMOTE THE NEW ONE. client_audiences_one_primary
 * is a partial unique index, so promoting before demoting fails. A failure between the last two
 * writes leaves the client with no primary, which audienceFor reports out loud and a re-confirm
 * repairs (the row already exists, so it takes the promote branch). The reverse order would be the
 * same failure with a row missing.
 *
 * Never throws. A confirmation must not fail because the audience could not be written; the card
 * says what happened instead.
 */
export async function ensurePrimaryAudienceForAvatar(args: {
  clientId: string;
  avatarSlug: string;
  avatarLabel: string;
  by: string;
}): Promise<AudienceLink> {
  try {
    const { data: existing, error: readErr } = await supabaseAdmin
      .from("client_audiences")
      .select("id, is_primary")
      .eq("client_id", args.clientId)
      .eq("slug", args.avatarSlug)
      .maybeSingle();

    if (readErr) {
      return {
        ok: false,
        note: `The audience could not be recorded: client_audiences is unreadable (${readErr.message}).`,
      };
    }

    if (existing) {
      if (existing.is_primary) {
        return {
          ok: true,
          audienceId: existing.id as string,
          created: false,
          note: `*${args.avatarLabel}* was already this client's primary audience.`,
        };
      }
      const promoted = await promote(args.clientId, existing.id as string);
      return promoted
        ? {
            ok: false,
            note: `*${args.avatarLabel}* is on file as an audience but could not be made primary: ${promoted}`,
          }
        : {
            ok: true,
            audienceId: existing.id as string,
            created: false,
            note: `*${args.avatarLabel}* is now the primary audience. The previous one stays on file as an option.`,
          };
    }

    const { data: client } = await supabaseAdmin
      .from("clients")
      .select("vertical_slug, business_type")
      .eq("id", args.clientId)
      .maybeSingle();

    const { verticalFor } = await import("./harvest");
    const resolved = await verticalFor(args.clientId);
    if (!resolved.ok) {
      return { ok: false, note: `No audience was created: ${resolved.error}` };
    }

    const proposal = proposePreset(
      (client?.vertical_slug as string | null) ?? null,
      (client?.business_type as string | null) ?? null
    );
    if (!proposal.preset) {
      return {
        ok: false,
        note:
          `:warning: No audience was created, so the concierge and the headline bank have nothing ` +
          `to work from. ${proposal.reason} ${AUDIENCE_REPAIR}`,
      };
    }

    const seeded = await seedClientAudience({
      clientId: args.clientId,
      presetKey: proposal.presetKey,
      slug: args.avatarSlug,
      label: args.avatarLabel,
      researchVertical: resolved.vertical,
      researchAvatarSlug: args.avatarSlug,
      isPrimary: false,
      by: args.by,
    });
    if (!seeded.ok || !seeded.audienceId) {
      return { ok: false, note: `:warning: The audience could not be created: ${seeded.error ?? "no id returned"}` };
    }

    const promoted = await promote(args.clientId, seeded.audienceId);
    if (promoted) {
      return {
        ok: false,
        note: `:warning: The audience was created but could not be made primary: ${promoted} Confirm the avatar again to retry.`,
      };
    }

    return {
      ok: true,
      audienceId: seeded.audienceId,
      created: true,
      note:
        `Audience created: *${args.avatarLabel}*, spoken to as a ${proposal.preset.buyer[0]}, from the ` +
        `\`${proposal.presetKey}\` preset.` +
        (proposal.unambiguous ? "" : ` :warning: ${proposal.reason}`),
    };
  } catch (e) {
    return { ok: false, note: `:warning: The audience could not be recorded: ${(e as Error).message}` };
  }
}

/** The sentence every "no audience" refusal ends with, so the repair is always named the same way. */
export const AUDIENCE_REPAIR =
  `Reply \`audience: <preset>\` in the avatar step's thread to create it by hand (one of ` +
  `${Object.keys(AUDIENCE_PRESETS).join(", ")}).`;

/** `audience: restaurant_diner`. Its own prefix; `avatar:` names a buyer, this names the words for them. */
export const AUDIENCE_PREFIX = /^\s*audience\s*:/i;

/**
 * Create the client's primary audience from a preset a PERSON named, for the confirmed avatar.
 *
 * ‼️ THE REPAIR THAT DID NOT EXIST. ensurePrimaryAudienceForAvatar creates an audience only when
 * proposePreset maps the client's vertical, so a client whose vertical is not in PRESET_BY_VERTICAL
 * got no audience and no command could ever create one. Every later step that needs an audience (the
 * concierge today, the offer from the client_offers cutover on) would then refuse with nowhere to go.
 *
 * ‼️ IT NEVER OVERWRITES AN EXISTING AUDIENCE'S WORDS. If this avatar already has an audience seeded
 * from a different preset, somebody may have edited its nouns since, so this refuses and says so
 * rather than re-seeding over them. Same preset: it is only promoted.
 */
export async function seedAudienceByHand(args: {
  clientId: string;
  presetKey: string;
  by: string;
}): Promise<{ ok: boolean; message: string }> {
  const key = args.presetKey.trim();
  const preset = AUDIENCE_PRESETS[key];
  if (!preset || key === GENERIC_PRESET_KEY) {
    return { ok: false, message: `:warning: "${key}" is not a preset. ${AUDIENCE_REPAIR}` };
  }

  const { confirmedAvatarFor } = await import("./avatars");
  const avatar = await confirmedAvatarFor(args.clientId);
  if (!avatar) {
    return {
      ok: false,
      message:
        ":warning: No avatar is confirmed yet, and an audience is a client aiming at an avatar. " +
        "Confirm the avatar first (`avatar: <who>`), then this.",
    };
  }

  const { data: existing, error: readErr } = await supabaseAdmin
    .from("client_audiences")
    .select("id, is_primary, seeded_from")
    .eq("client_id", args.clientId)
    .eq("slug", avatar.slug)
    .maybeSingle();
  if (readErr) {
    return { ok: false, message: `:warning: client_audiences is unreadable (${readErr.message}).` };
  }

  if (existing) {
    if ((existing.seeded_from as string | null) !== key) {
      return {
        ok: false,
        message:
          `:warning: *${avatar.label}* already has an audience, seeded from \`${String(existing.seeded_from)}\`. ` +
          "Nothing was changed: re-seeding would overwrite its words, which somebody may have edited.",
      };
    }
    if (existing.is_primary) {
      return { ok: true, message: `*${avatar.label}* already has this audience, and it is primary.` };
    }
    const failed = await promote(args.clientId, existing.id as string);
    return failed
      ? { ok: false, message: `:warning: The audience is on file but could not be made primary: ${failed}` }
      : { ok: true, message: `:white_check_mark: *${avatar.label}* is now the primary audience.` };
  }

  const { verticalFor } = await import("./harvest");
  const resolved = await verticalFor(args.clientId);
  if (!resolved.ok) {
    return { ok: false, message: `:warning: No audience was created: ${resolved.error}` };
  }

  const seeded = await seedClientAudience({
    clientId: args.clientId,
    presetKey: key,
    slug: avatar.slug,
    label: avatar.label,
    researchVertical: resolved.vertical,
    researchAvatarSlug: avatar.slug,
    isPrimary: false,
    by: args.by,
  });
  if (!seeded.ok || !seeded.audienceId) {
    return { ok: false, message: `:warning: The audience could not be created: ${seeded.error ?? "no id returned"}` };
  }

  const failed = await promote(args.clientId, seeded.audienceId);
  if (failed) {
    return {
      ok: false,
      message: `:warning: The audience was created but could not be made primary: ${failed} Send the same command again to retry.`,
    };
  }

  return {
    ok: true,
    message:
      `:white_check_mark: Audience created by hand: *${avatar.label}*, spoken to as a ${preset.buyer[0]}, ` +
      `from the \`${key}\` preset, by ${args.by}.`,
  };
}

/** `audience: <preset>` in the avatar step's thread. Null on a miss, so conversation falls through. */
export async function handleAudienceThreadReply(args: {
  clientId: string;
  stepKey: string | null;
  text: string;
  by: string;
}): Promise<{ ok: boolean; message: string } | null> {
  if (args.stepKey !== "avatar_confirmed") return null;
  const lines = args.text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (!lines.length || !AUDIENCE_PREFIX.test(lines[0])) return null;
  // One command per message, like offer: and terms: (e9b0f3e).
  if (lines.length > 1) {
    return { ok: false, message: ":warning: Nothing changed. `audience:` takes one preset on one line, on its own." };
  }
  const key = lines[0].replace(AUDIENCE_PREFIX, "").trim();
  if (!key) return { ok: false, message: `:warning: Which preset? ${AUDIENCE_REPAIR}` };
  return seedAudienceByHand({ clientId: args.clientId, presetKey: key, by: args.by });
}

/**
 * Demote whatever is primary, then promote this one. Returns an error sentence, or null.
 *
 * ‼️ THE OFFER FOLLOWS, AS A PROPOSAL. The offer lives under the primary audience (client_offers), so a
 * new primary audience with no offer would leave every [treatment] reading nothing. The previous
 * primary's treatment is carried across as a PROPOSAL, never a lock, because the lock was agreed for a
 * different buyer, and the prep call's thread is told so. Never fails the promotion.
 */
async function promote(clientId: string, audienceId: string): Promise<string | null> {
  const { data: previous } = await supabaseAdmin
    .from("client_audiences")
    .select("id")
    .eq("client_id", clientId)
    .eq("is_primary", true)
    .maybeSingle();
  const previousId = (previous?.id as string | undefined) ?? null;

  const failed = await swapPrimary(clientId, audienceId);
  if (failed || !previousId || previousId === audienceId) return failed;

  try {
    const { carryOfferToAudience } = await import("./offers");
    const carried = await carryOfferToAudience({ clientId, fromAudienceId: previousId, toAudienceId: audienceId });
    if (carried) {
      const { notifyStep } = await import("./step-board");
      await notifyStep(
        clientId,
        "offer_locked",
        `:arrows_counterclockwise: The avatar changed, so the offer is proposed for the new audience as *${carried}*, ` +
          "not locked: the lock was agreed for a different buyer. `offer: yes` locks it for this one, and " +
          "that re-aims everything downstream the usual way."
      ).catch(() => {});
    }
  } catch (e) {
    console.error("[audiences] offer not carried to the new primary audience:", (e as Error).message);
  }
  return null;
}

async function swapPrimary(clientId: string, audienceId: string): Promise<string | null> {
  const { error: demoteErr } = await supabaseAdmin
    .from("client_audiences")
    .update({ is_primary: false, updated_at: new Date().toISOString() })
    .eq("client_id", clientId)
    .eq("is_primary", true)
    .neq("id", audienceId);
  if (demoteErr) return demoteErr.message;

  const { error: promoteErr } = await supabaseAdmin
    .from("client_audiences")
    .update({ is_primary: true, updated_at: new Date().toISOString() })
    .eq("id", audienceId);
  return promoteErr ? promoteErr.message : null;
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
