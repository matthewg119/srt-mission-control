// The words this niche uses, proposed from the client's own documents and confirmed by a person.
//
// ‼️ THIS IS WHAT MAKES THE LANE NICHE-AGNOSTIC, AND IT IS A PROPOSAL, NEVER A DERIVATION.
//
// src/config/audience-presets.ts opens with the rule this file exists to respect:
//
//     READ EXACTLY ONCE AND THEN WRITTEN TO A ROW. Nothing in a request path may read this file.
//
// and names the failure it is guarding against: mergeRowOverSeed() in verticals.ts, which does
// the same idea at READ time, so loadVertical('aeo-agency-med-spa') recomputes a Spanish termite
// kit on every call and no row anywhere records that it did. The same trap is available here and
// is worse, because the input is a model reading a PDF: if a request path ever calls
// proposeVocabulary(), the words a client's widget speaks become non-deterministic and nothing
// records which words were used on any given day.
//
// So the shape is fixed: PROPOSE once, a person CONFIRMS, the answer lives on the
// client_audiences row, and every reader reads the row. This file has exactly one writer
// (confirmVocabulary) and its proposer is only ever called from a step action.
//
// WHY NOT JUST ADD A PRESET PER NICHE. The presets stay, and stay the fast path: PRESET_BY_VERTICAL
// is a closed allowlist and a named vertical should keep resolving through it with no model call
// at all. But a preset per niche means a deploy per client, and `GENERIC_PRESET_KEY` deliberately
// returns `preset: null` and decides nothing — so today a roofer cannot be seeded at all
// (seedClientAudience refuses GENERIC by name). This is the writer that gap was waiting for.

import { callClaudeJSON, type ClaudeModel } from "@/lib/claude-calls";
import { hasBannedDash } from "@/lib/copy-guard";
import { supabaseAdmin } from "@/lib/db";
import { proposePreset, AUDIENCE_PRESETS, GENERIC_PRESET_KEY } from "@/config/audience-presets";
import { foundationText, type FoundationKind } from "./documents";

const VOCAB_MODEL: ClaudeModel = "claude-sonnet-4-6";

/** How much of each document the proposal is allowed to read. */
const PER_DOC_BUDGET = 24_000;

/**
 * ‼️ `stance` IS STRUCTURAL AND IS NOT A NICHE WORD.
 *
 * The column's CHECK is ('patient','owner') and the table comment says to read 'patient' as
 * "buys from the client", never as a medical word: a diner at la-casita and a homeowner calling a
 * roofer are both 'patient'. 'owner' means the visitor is a business owner and the widget is
 * selling them OUR service, which is a lane only SRT runs. A Launch Lane client sells to their
 * own customers, so this is always 'patient' and the model is never asked.
 */
const LAUNCH_STANCE = "patient" as const;

export interface VocabularyProposal {
  /** Short kebab-case identity for the audience row. */
  slug: string;
  label: string;
  buyerSingular: string;
  buyerPlural: string;
  offerSingular: string;
  offerPlural: string;
  businessNoun: string;
  visitNoun: string;
  /** What the concierge calls ITSELF on this client's site. */
  laneName: string;
  /** The few words on the launcher pill, before a stranger has agreed to anything. */
  launcherLabel: string;
  /** Absolute rules this trade's bot may never break. */
  hardLines: string[];
  /** Where the proposal came from, for the card that asks a person to confirm it. */
  rationale: string;
}

function isProposal(v: unknown): v is VocabularyProposal {
  if (!v || typeof v !== "object") return false;
  const p = v as Record<string, unknown>;
  const strings = [
    "slug",
    "label",
    "buyerSingular",
    "buyerPlural",
    "offerSingular",
    "offerPlural",
    "businessNoun",
    "visitNoun",
    "laneName",
    "launcherLabel",
    "rationale",
  ];
  if (!strings.every((k) => typeof p[k] === "string" && (p[k] as string).trim().length > 0)) return false;
  if (!Array.isArray(p.hardLines) || !p.hardLines.every((l) => typeof l === "string")) return false;
  return true;
}

const SCHEMA_HINT = `{
  "slug": "kebab-case, 2-4 words, identifies this audience",
  "label": "how a person would name this audience in a sentence",
  "buyerSingular": "one buyer",
  "buyerPlural": "many buyers",
  "offerSingular": "one thing they buy",
  "offerPlural": "many of them",
  "businessNoun": "what the premises or company is called",
  "visitNoun": "what the booked appointment is called",
  "laneName": "what the on-site assistant calls itself",
  "launcherLabel": "3-5 words on the launcher button",
  "hardLines": ["absolute rules the assistant may never break in this trade"],
  "rationale": "one or two sentences on where these words came from in the documents"
}`;

const SYSTEM = [
  "You read a business's own research documents and report the words that business and its",
  "customers actually use. You are naming things, not marketing them.",
  "",
  "RULES.",
  "1. Use the words that appear IN THE DOCUMENTS. If the documents call them a homeowner, they",
  "   are a homeowner, not a client and not a customer. You are reporting usage, not choosing it.",
  "2. Never use medical words for a business that is not medical. 'patient' and 'treatment' are",
  "   correct for a clinic and wrong for a roofer, a restaurant or a law firm.",
  "3. hardLines are ABSOLUTE rules for this trade, in the imperative, each one a sentence an",
  "   assistant could actually obey. Think about what this trade must never promise: a diagnosis,",
  "   a final price before an inspection, a legal outcome, an allergen guarantee. Return an empty",
  "   list rather than inventing rules that do not apply.",
  "4. laneName is what the assistant on their website calls itself. It should name the JOB it does",
  "   for a visitor in that trade. Keep it short and plain.",
  "5. NEVER use an em dash or an en dash anywhere in your output. Use a comma, a colon or a full",
  "   stop. This is enforced in code and a dash will cause the whole proposal to be rejected.",
  "6. Invent no facts about the business. Every word you return must be supported by the documents.",
].join("\n");

export type ProposalOutcome =
  | { ok: true; proposal: VocabularyProposal; from: "preset" | "documents"; presetKey?: string }
  | { ok: false; error: string };

/**
 * Propose the vocabulary for this client.
 *
 * ‼️ THE PRESET IS TRIED FIRST AND WINS WHEN IT IS UNAMBIGUOUS. A named vertical resolves with no
 * model call, no latency and no variance, which is strictly better; the model is the fallback for
 * a trade nobody has written down yet. That ordering is also what stops this becoming the
 * default path and quietly retiring the allowlist.
 */
export async function proposeVocabulary(clientId: string): Promise<ProposalOutcome> {
  const { data: client, error } = await supabaseAdmin
    .from("clients")
    .select("legal_name, dba_name, vertical_slug, business_type, city, state")
    .eq("id", clientId)
    .maybeSingle();

  if (error || !client) return { ok: false, error: "That client could not be read." };

  const verticalSlug = (client.vertical_slug as string | null) ?? null;
  const businessType = (client.business_type as string | null) ?? null;

  // 1. The cheap, deterministic path.
  const named = proposePreset(verticalSlug, businessType);
  if (named.unambiguous && named.preset && named.presetKey !== GENERIC_PRESET_KEY) {
    const p = AUDIENCE_PRESETS[named.presetKey];
    return {
      ok: true,
      from: "preset",
      presetKey: named.presetKey,
      proposal: {
        slug: named.presetKey.replace(/_/g, "-"),
        label: `${p.buyer[0]} of ${(client.dba_name as string) || (client.legal_name as string)}`,
        buyerSingular: p.buyer[0],
        buyerPlural: p.buyer[1],
        offerSingular: p.offer[0],
        offerPlural: p.offer[1],
        businessNoun: p.business,
        visitNoun: p.visit,
        laneName: p.laneName,
        launcherLabel: p.launcher,
        hardLines: [...p.hardLines],
        rationale: named.reason,
      },
    };
  }

  // 2. The documents.
  const docs = await foundationText(clientId);
  if (docs === null) return { ok: false, error: "The foundation documents could not be read." };
  if (docs.length === 0) {
    return {
      ok: false,
      error:
        "No foundation documents are on file, and no preset matches this vertical. Upload the four " +
        "documents first: they are what the words are read out of.",
    };
  }

  const name = (client.dba_name as string) || (client.legal_name as string) || "this business";
  const where = [client.city, client.state].filter(Boolean).join(", ");

  const user = [
    `BUSINESS: ${name}${where ? ` in ${where}` : ""}.`,
    businessType ? `It describes itself as: ${businessType}.` : "",
    "",
    "Its own research documents follow. Report the words IT and ITS CUSTOMERS use.",
    "",
    ...docs.map(
      (d) => `--- ${d.kind.replace(/_/g, " ").toUpperCase()} ---\n${d.content.slice(0, PER_DOC_BUDGET)}`
    ),
  ]
    .filter(Boolean)
    .join("\n");

  let proposal: VocabularyProposal;
  try {
    const result = await callClaudeJSON<VocabularyProposal>({
      model: VOCAB_MODEL,
      system: SYSTEM,
      user,
      maxTokens: 1500,
      schemaHint: SCHEMA_HINT,
      validate: isProposal,
      describeInvalid: (parsed) => {
        const p = (parsed ?? {}) as Record<string, unknown>;
        const missing = [
          "slug",
          "label",
          "buyerSingular",
          "buyerPlural",
          "offerSingular",
          "offerPlural",
          "businessNoun",
          "visitNoun",
          "laneName",
          "launcherLabel",
          "rationale",
        ].filter((k) => typeof p[k] !== "string" || !(p[k] as string).trim());
        return missing.length
          ? `these fields were missing or empty: ${missing.join(", ")}`
          : "hardLines was not a list of strings";
      },
    });
    proposal = result.data;
  } catch (e) {
    return { ok: false, error: `The proposal could not be generated: ${(e as Error).message}` };
  }

  // ‼️ THE DASH RULE IS ENFORCED ON MODEL OUTPUT, NOT JUST ASKED FOR.
  // guard() in copy-guard.ts throws at module evaluation for hardcoded copy, which is why no
  // literal in this repo carries one. Model output never passes through guard(), so without this
  // an em dash reaches a client's own website through the one route that has no compile-time
  // check at all.
  const dashed = Object.entries(proposal).filter(([, v]) =>
    Array.isArray(v) ? v.some((s) => hasBannedDash(String(s))) : hasBannedDash(String(v))
  );
  if (dashed.length) {
    return {
      ok: false,
      error:
        `The proposal came back with a dash in: ${dashed.map(([k]) => k).join(", ")}. ` +
        "Run it again. The house rule is no em dashes in anything that reaches a client.",
    };
  }

  return { ok: true, from: "documents", proposal };
}

/**
 * Write the confirmed vocabulary to the client's primary audience row.
 *
 * ‼️ THIS IS THE ONLY WRITER, AND IT ONLY EVER RUNS BEHIND A PERSON.
 * `vocabulary_source: 'documents'` records how these words were arrived at, which is the whole
 * point of that column and the reason a fourth value was added rather than reusing 'typed'.
 * `confirmed_at` is what every downstream reader gates on.
 */
export async function confirmVocabulary(args: {
  clientId: string;
  proposal: VocabularyProposal;
  /** 'preset' when a named vertical supplied it, 'documents' when the model read the files. */
  from: "preset" | "documents";
  presetKey?: string;
  by: string;
}): Promise<{ ok: true; audienceId: string } | { ok: false; error: string }> {
  const { proposal: p } = args;

  const { data: client, error: clientErr } = await supabaseAdmin
    .from("clients")
    .select("vertical_slug, business_type")
    .eq("id", args.clientId)
    .maybeSingle();

  if (clientErr || !client) return { ok: false, error: "That client could not be read." };

  // `research_vertical` is NOT NULL and is what avatar_briefs and question_bank are keyed on.
  const researchVertical = (
    ((client.vertical_slug as string | null) || (client.business_type as string | null)) ?? ""
  ).trim();
  if (!researchVertical) {
    return {
      ok: false,
      error:
        "This client has no vertical recorded, and an audience is filed under one. Set the niche " +
        "on the intake step first. A harvest filed under a guessed vertical poisons the shared " +
        "question bank for every real client in it, and question_bank has no client_id to unpick it by.",
    };
  }

  const slug = p.slug
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  if (!slug) return { ok: false, error: "That proposal has no usable slug." };

  const now = new Date().toISOString();

  const row = {
    client_id: args.clientId,
    slug,
    label: p.label,
    stance: LAUNCH_STANCE,
    research_vertical: researchVertical,
    is_primary: true,
    buyer_noun_singular: p.buyerSingular,
    buyer_noun_plural: p.buyerPlural,
    offer_noun_singular: p.offerSingular,
    offer_noun_plural: p.offerPlural,
    business_noun: p.businessNoun,
    visit_noun: p.visitNoun,
    lane_name: p.laneName,
    launcher_label: p.launcherLabel,
    hard_lines: p.hardLines,
    vocabulary_source: args.from === "preset" ? "preset" : "documents",
    vocabulary_confirmed_at: now,
    vocabulary_confirmed_by: args.by,
    seeded_from: args.from === "preset" ? (args.presetKey ?? "preset") : "foundation_documents",
    seeded_at: now,
    confirmed_at: now,
    confirmed_by: args.by,
    updated_at: now,
  };

  // ‼️ THE PARTIAL UNIQUE INDEX ON (client_id) WHERE is_primary MEANS THE OLD PRIMARY MUST GO
  // FIRST. Upserting a second primary against a client that already has one violates it, and the
  // error PostgREST returns for that reads like a bug rather than like "there is already one".
  const { error: demoteErr } = await supabaseAdmin
    .from("client_audiences")
    .update({ is_primary: false, updated_at: now })
    .eq("client_id", args.clientId)
    .eq("is_primary", true)
    .neq("slug", slug);

  if (demoteErr) return { ok: false, error: `The existing audience could not be stood down: ${demoteErr.message}` };

  const { data, error } = await supabaseAdmin
    .from("client_audiences")
    .upsert(row, { onConflict: "client_id,slug" })
    .select("id")
    .maybeSingle();

  if (error) return { ok: false, error: error.message };
  if (!data) return { ok: false, error: "The audience row was not written back." };

  return { ok: true, audienceId: data.id as string };
}

/** The document kinds the proposal actually read, for the card that shows its working. */
export function proposalSources(docs: { kind: FoundationKind }[]): string {
  return docs.map((d) => d.kind.replace(/_/g, " ")).join(", ");
}
