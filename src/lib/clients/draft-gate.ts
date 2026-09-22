// What must be true before the model writes a page, and what to say when it is not.
//
// Matthew, 2026-09-21: "make sure whenever we create posts by drafting in the onboarding or after
// we always select the avatar that we are building the traffic for and the offer, and if we dont
// have it we need to upload the documents."
//
// ‼️ ONLY `draft` IS GATED. `ask`, `add:`, `replace:`, dictation and voice notes are not, and that
// is the load-bearing half of this file rather than an omission. Writing down what a person
// actually said is the best input this product ever gets; blocking it because a template has not
// been pasted teaches people to take their notes somewhere else, and then the context never arrives
// at all. Only the model-driven `draft` needs this, because it is the only one that INVENTS: given
// no avatar and no offer it writes a page about the topic, aimed at nobody, in nobody's words.
//
// ‼️ AND IT IS A PRECONDITION ON A COMMAND, NOT A STATE A PAGE MOVES THROUGH. There is deliberately
// no fourth client_pages.status here. CLAUDE.md refuses a fourth status value twice, and a page
// that cannot be drafted yet is not in a different state: the CLIENT is.

import type { DocumentKind } from "./audience-documents";

/**
 * What the four documents and the two client facts add up to, as booleans.
 *
 * Resolved by `draftReadiness` and handed to `missingPreconditions`, which is pure so a probe can
 * drive every combination without a database.
 */
export interface DraftContext {
  /** An audience row exists and somebody confirmed the avatar. Documents hang off the audience. */
  avatarConfirmed: boolean;
  /** An offer is locked. `short_offer` and `necessary_beliefs` cannot even be STORED without one. */
  offerLocked: boolean;
  deepResearch: boolean;
  avatarSheet: boolean;
  shortOffer: boolean;
  necessaryBeliefs: boolean;
}

export type PreconditionKey =
  | "avatar"
  | "offer"
  | "deep_research"
  | "avatar_sheet"
  | "short_offer"
  | "necessary_beliefs";

export interface Precondition {
  key: PreconditionKey;
  label: string;
  /** Why a page written without it is worse than no page. One sentence, no em dash. */
  why: string;
  /** The exact thing to do next. An existing verb, never a new one. */
  how: string;
}

/**
 * ‼️ THE ORDER IS A DEPENDENCY ORDER AND HIS OWN DOCUMENTS PROVE IT.
 *
 * The belief chain is written FROM the avatar sheet and the short offer, and his prompt for it says
 * so in capitals: "ADJUNTA LA HOJA DE AVATAR, EL RESUMEN DE OFERTA Y LOS DOCUMENTOS DE
 * INVESTIGACION". Asking for beliefs before the sheet exists produces beliefs invented from
 * nothing, which is the exact poisoning W0 was built to prevent, arriving through a different door.
 *
 * The two client facts come first for a harder reason than tidiness: `storeDocument` REFUSES an
 * offer-scoped kind when no offer is on file ("this document belongs to an offer, and no offer is
 * on file for this audience yet"), and every kind is addressed by audience id. So asking for the
 * short offer before the offer is locked is asking for something the database will not accept.
 */
const ORDER: readonly PreconditionKey[] = [
  "avatar",
  "offer",
  "deep_research",
  "avatar_sheet",
  "short_offer",
  "necessary_beliefs",
];

const SPEC: Record<PreconditionKey, Omit<Precondition, "key">> = {
  avatar: {
    label: "a confirmed avatar",
    why: "a page written for nobody in particular is written in nobody's words",
    how: "confirm the avatar on the avatar step, then come back",
  },
  offer: {
    label: "a locked offer",
    why: "every page argues toward the offer, and without one it argues toward the treatment",
    how: "lock the offer on the offer step (`offer:` then `terms:`)",
  },
  deep_research: {
    label: "the deep research",
    why: "it is where the buyer's own language comes from, and a page without it is written in ours",
    how: "paste it in step 11's thread as `research:`",
  },
  avatar_sheet: {
    label: "the avatar sheet",
    why: "the demographics, the fears and the verbatim quotes every headline is chosen against",
    how: "paste it in step 11's thread as `avatar sheet:`",
  },
  short_offer: {
    label: "the short offer summary",
    why: "the big idea, the unique mechanism and the objection list this page has to answer",
    how: "paste it in step 11's thread as `short offer:`",
  },
  necessary_beliefs: {
    label: "the belief chain",
    why: "this is what the page is supposed to install, and there is nothing on file to install",
    how: "paste it in step 11's thread as `beliefs:`, after the sheet and the short offer",
  },
};

const HAS: Record<PreconditionKey, (c: DraftContext) => boolean> = {
  avatar: (c) => c.avatarConfirmed,
  offer: (c) => c.offerLocked,
  deep_research: (c) => c.deepResearch,
  avatar_sheet: (c) => c.avatarSheet,
  short_offer: (c) => c.shortOffer,
  necessary_beliefs: (c) => c.necessaryBeliefs,
};

/** What is missing, in the order it has to be answered. Pure. */
export function missingPreconditions(ctx: DraftContext): Precondition[] {
  return ORDER.filter((k) => !HAS[k](ctx)).map((k) => ({ key: k, ...SPEC[k] }));
}

/**
 * The refusal, as the thread sees it.
 *
 * ‼️ IT HANDS BACK THE NEXT MOVE, NOT A COMPLAINT, and it points at step 11's thread rather than
 * printing the templates here. do-this-now.ts already says "Four documents, four messages:
 * `research:`, `avatar sheet:`, `short offer:`, `beliefs:`", promptsFromGaps already builds those
 * four prompts pre-filled with what is on file, and they are already answered in that thread. A
 * second prompt lane in the studio would be a second place for the same four templates to drift.
 */
export function refusalLines(missing: readonly Precondition[]): string[] {
  if (!missing.length) return [];

  const lines = [
    `:no_entry: *\`draft\` needs ${missing.length} thing${missing.length === 1 ? "" : "s"} first.* ` +
      "Everything else in this thread still works: `ask`, `add:`, `replace:` and dictation are not blocked.",
    "",
  ];
  for (const m of missing) {
    lines.push(`  • *${m.label}* ${m.why}.`);
    lines.push(`     :arrow_right: ${m.how}.`);
  }
  lines.push("");
  lines.push(
    "_They are listed in the order they have to be answered: the belief chain is written from the " +
      "avatar sheet and the short offer, so asking for it first produces beliefs invented from nothing._"
  );
  return lines;
}

/** The four document kinds this gate reads, in dependency order. */
export const GATED_DOCUMENTS: readonly DocumentKind[] = [
  "deep_research",
  "avatar_sheet",
  "short_offer",
  "necessary_beliefs",
];

/**
 * Read the six facts for this client.
 *
 * ‼️ "ON FILE", NOT "ON FILE AND APPROVED", AND THAT IS A MEASUREMENT RATHER THAN A SHORTCUT.
 * Measured on production 2026-09-22: `approveDocument` is called from exactly two places, for
 * `awareness_ladder` and for `sales_letter`. NOTHING approves `deep_research`, `avatar_sheet`,
 * `short_offer` or `necessary_beliefs`, and no code path exists that could. The whole table held
 * three rows, one of them a `deep_research` sitting at `draft`. Gating on `approved` would be a
 * gate no client can ever pass, which is the "confirmation card that is theatre" failure wearing a
 * different hat: it would block every draft in the product forever and look like a rule.
 *
 * If these kinds should need approving, the approve path has to be built FIRST and this line
 * changed in the same commit. Do not add `&& status === "approved"` on its own.
 *
 * ‼️ EACH READ IS ITS OWN TOLERANT CALL AND A FAILED READ IS NOT AN ABSENCE. currentDocument
 * returns `{ok:false}` when the table is unreadable, which is different from "no document", and
 * reporting unreadable as missing would tell somebody to paste a document they already pasted.
 */
export async function draftReadiness(
  clientId: string
): Promise<
  | { ok: true; ctx: DraftContext; missing: Precondition[] }
  | { ok: false; error: string }
> {
  const { audienceFor } = await import("./audiences");
  const { loadOffer, loadOfferForAudience, isLocked } = await import("./offers");
  const { currentDocument } = await import("./audience-documents");

  const aud = await audienceFor(clientId);
  if (!aud.ok) {
    // No audience row at all. Every document is addressed by audience id, so there is nowhere to
    // put any of them yet and the only honest answer is the avatar.
    return {
      ok: true,
      ctx: {
        avatarConfirmed: false,
        offerLocked: false,
        deepResearch: false,
        avatarSheet: false,
        shortOffer: false,
        necessaryBeliefs: false,
      },
      missing: missingPreconditions({
        avatarConfirmed: false,
        offerLocked: false,
        deepResearch: false,
        avatarSheet: false,
        shortOffer: false,
        necessaryBeliefs: false,
      }),
    };
  }

  const audienceId = aud.audience.id;
  const own = await loadOfferForAudience(audienceId);
  const offer = own ?? (await loadOffer(clientId));
  const offerLocked = isLocked(offer);
  const offerId = offer.id ?? null;

  const read = async (kind: DocumentKind, forOffer: boolean): Promise<boolean | null> => {
    // An offer-scoped kind cannot be addressed before an offer exists. That is not "missing
    // because nobody pasted it", it is "not askable yet", and the offer line above already says so.
    if (forOffer && !offerId) return false;
    const res = await currentDocument({ audienceId, offerId: forOffer ? offerId : null, kind });
    if (!res.ok) return null;
    return Boolean(res.doc);
  };

  const [research, sheet, short, beliefs] = await Promise.all([
    read("deep_research", false),
    read("avatar_sheet", false),
    read("short_offer", true),
    read("necessary_beliefs", true),
  ]);

  if (research === null || sheet === null || short === null || beliefs === null) {
    return {
      ok: false,
      error: "the documents on file could not be read, so what is missing is unknown rather than empty.",
    };
  }

  const ctx: DraftContext = {
    avatarConfirmed: aud.audience.confirmedAt !== null,
    offerLocked,
    deepResearch: research,
    avatarSheet: sheet,
    shortOffer: short,
    necessaryBeliefs: beliefs,
  };

  return { ok: true, ctx, missing: missingPreconditions(ctx) };
}
