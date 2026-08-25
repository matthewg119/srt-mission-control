// Delivery step 10, the half of it a person runs.
//
// ‼️ IT IS MATTHEW'S THREE-MESSAGE CHATGPT FRAMEWORK NOW (2026-08-25). What it emits is three
// paste-ready blocks in his wording, in the language he runs them in, with the slots filled from
// this client's record. Message 1 sets the writer up, message 2 teaches it how to research by
// handing it his two documents, and message 3 asks it to write the deep-research prompt for the
// CONFIRMED AVATAR, which is the whole reason the avatar moved to step 8.
//
// The step is `auto_then_manual`: runHarvest() in ../harvest.ts is the automatic half and scrapes
// real phrasings off the pages the engines cited; this is the manual half. It emits a brief a
// person runs, and the result comes back into question_bank with source 'deep_research'.
//
// ─── THE BRIEF IS WRITTEN, NOT GENERATED ─────────────────────────────────────────────
//
// A model asked to "write a research brief" writes a different one every run, which makes two
// clients' phrase sets incomparable and makes a regression in the template invisible. So the
// template is code and the client's facts are interpolated into it. The test asserts
// buildDeepResearchBrief(x) === buildDeepResearchBrief(x), byte for byte, and that assertion is
// the whole reason this is a function and not a prompt.
//
// The two teaching documents are TEXT CONSTANTS in @/config/research-method for the same reason.
// A file read would make determinism a property of the filesystem, and a file read inside a
// lambda is a deployment concern on top of that.
//
// ─── VERBATIM MEANS VERBATIM ─────────────────────────────────────────────────────────
//
// The owner's own words for their objections, their ideal customer and who they do not want go in
// EXACTLY as typed, typos included. They are the most valuable strings in the file: an owner
// writing "im scared itll look fake" has told you the register their buyers think in, and tidying
// it into "concerns about unnatural results" throws that away and replaces it with agency
// language. The test checks for the typo on purpose.
//
// ─── WHY THE ENGLISH SPEC SURVIVED THE REWRITE ───────────────────────────────────────
//
// Message 3 asks the model to write a deep-research prompt and says to be as specific as
// possible. WHAT SPECIFIC MEANS is the block that was already here: six pages minimum, a source
// per claim, the three parts of the customer-awareness framework, the reading level, and a ranked
// list of twenty-five phrases with the source each came from. Matthew's call, made with both
// options stated. Deleting it would have thrown away the only part of this file that says what
// good output looks like, and it is also what fifteen assertions in
// scripts/test-onboarding-artifacts.ts check.

import { supabaseAdmin } from "@/lib/db";
import { RESEARCH_METHOD_DOCUMENTS } from "@/config/research-method";
import { deliverArtifact } from "./deliver";

export interface BriefInput {
  clinicName: string;
  city: string | null;
  state: string | null;
  /**
   * The confirmed avatar's label, which is what [PRODUCTO] in message 3 becomes.
   *
   * ‼️ OPTIONAL, AND ITS ABSENCE IS STATED RATHER THAN PAPERED OVER. Step 10 is blocked on the
   * confirmation so in practice it is always here; when it is not, the brief says which step
   * fills it instead of quietly researching "the business", which is what every brief did before
   * the avatar had a writer at all.
   */
  avatarLabel?: string | null;
  /** The treatment the money is in. Null when intake never recorded one. */
  primaryTreatment: string | null;
  services: string[];
  /** The owner's own words. Never summarised, never corrected. */
  objections: string | null;
  targetPatient: string | null;
  notWanted: string | null;
  triedBefore: string | null;
  /** Hosts the engines actually cited. The seed list, not a guess at one. */
  citedDomains: string[];
  /** Businesses the engines named instead of this one. */
  namedInstead: string[];
  /** The vertical, so message 1 can say what this business IS in one phrase. */
  vertical?: string | null;
}

/** An absent value says so rather than leaving a hole the reader has to interpret. */
const NOT_RECORDED = "not recorded";

function val(v: string | null | undefined): string {
  const s = (v ?? "").trim();
  return s.length > 0 ? s : NOT_RECORDED;
}

function list(items: string[], empty: string): string {
  return items.length > 0 ? items.map((i) => `- ${i}`).join("\n") : `- ${empty}`;
}

const RULE = "────────────────────────────────────────────────────────────";

/**
 * The brief. Deterministic: same input, same bytes.
 *
 * Three messages, in order, each fenced so it can be copied without picking up the one after it.
 */
export function buildDeepResearchBrief(input: BriefInput): string {
  const where = [input.city, input.state].filter(Boolean).join(", ") || NOT_RECORDED;
  const avatar = (input.avatarLabel ?? "").trim();
  const producto = avatar || "[AVATAR NO CONFIRMADO]";
  const trade = (input.vertical ?? "").trim();

  // ‼️ [EXPLICA QUÉ ESTÁS VENDIENDO Y A QUIÉN] IS THE SLOT AND THIS IS WHAT FILLS IT. It is the
  // avatar, the trade, the city and what they sell, in one sentence, because that is the whole
  // job of message 1, and a slot left as a bracket is a slot somebody has to fill by hand at the
  // exact moment they are trying to paste.
  const selling = [
    `Vendo los servicios de ${input.clinicName}`,
    trade ? ` (${trade})` : "",
    where !== NOT_RECORDED ? ` en ${where}` : "",
    ". El cliente al que quiero atraer es: ",
    avatar || "todavía no hay un avatar confirmado, ver el paso 8 del tablero",
    ".",
    input.primaryTreatment ? ` El servicio donde está el dinero es ${input.primaryTreatment}.` : "",
    input.services.length ? ` También ofrecemos: ${input.services.join(", ")}.` : "",
  ].join("");

  return `DEEP RESEARCH BRIEF
${input.clinicName}${where !== NOT_RECORDED ? `, ${where}` : ""}
Avatar: ${avatar || "NOT CONFIRMED YET. Confirm it on the board, it is the step above this one."}

HOW TO RUN THIS

Three messages, in order, into one new conversation. Send message 1 and wait for the answer
before sending message 2. Everything between the rules is what gets pasted; nothing outside them
does.

Attach this client's own AI Visibility Scorecard PDF to message 1 as the sales page. It is filed
against the baseline scan step on the board.

${RULE}
MENSAJE 1
${RULE}

Eres mi redactor experto y te especializas en escribir textos altamente persuasivos de estilo de
respuesta directa para mi marca.

${selling}

Te voy a adjuntar la página de ventas de este negocio para que entiendas la oferta, el tono y las
promesas que ya estamos haciendo. Léela completa antes de responder.

Responde solamente confirmando que entendiste el producto y a quién se lo vendemos.

${RULE}
MENSAJE 2
${RULE}

Te voy a enviar dos documentos que enseñan cómo hacer una investigación profunda sobre tu
producto y sobre el mercado. Léelos completos. No resumas todavía: confirma que los entendiste y
dime en una línea cuál es el objetivo de la investigación.

${RESEARCH_METHOD_DOCUMENTS}

${RULE}
MENSAJE 3
${RULE}

Genial, ahora que entiendes correctamente cómo hacer investigación, quiero que crees un prompt
completo para la nueva herramienta de OpenAI llamada deep research para que realice esta
investigación para ${producto}. Por favor, sé lo más específico posible aquí para obtener la mejor
calidad de investigación. Incluye también que quieres que deep research compile toda la
investigación encontrada.

Esto es lo que ya sabemos del negocio, y esto es lo que el prompt tiene que pedir de vuelta.

WHAT I ALREADY KNOW

Business: ${input.clinicName}
Where: ${where}
The customer this is aimed at: ${val(avatar)}
The treatment the money is in: ${val(input.primaryTreatment)}
Services offered:
${list(input.services, NOT_RECORDED)}

The owner's own words, quoted exactly as they wrote them. Do not clean these up, do not
correct them, and do not treat them as sloppy. The register is the finding.

What customers object to: ${val(input.objections)}
Who they want more of: ${val(input.targetPatient)}
Who they do not want: ${val(input.notWanted)}
What they already tried: ${val(input.triedBefore)}

SEED SITES

These are the sources the AI engines actually cited when answering questions about this
market. Start here rather than with a fresh search, because these are the pages the engines
are already reading.

${list(input.citedDomains, "no cited sources recorded yet, so start from an open search")}

Businesses the engines named instead of this one:
${list(input.namedInstead, NOT_RECORDED)}

WHAT I WANT BACK

Minimum six pages. Cite a source for every claim. If you cannot source something, leave it
out and say you left it out. Do not invent a statistic and do not write marketing copy.

Part 1: Who the customer is

Who is actually buying this, in demographic and in situation. What is happening in their
life in the week before they start looking. What they call themselves, and what they would
never call themselves.

Part 2: What they are already using

What they have tried before this, including the things that are not competitors: the home
remedy, the cheaper substitute, doing nothing. Why each one stopped being enough. What they
believe about the professional option that is wrong.

Part 3: Curiosity and history

What they are quietly curious about and will not ask out loud. The horror stories that
circulate in this market, told the way buyers tell them rather than the way the trade
answers them. The external forces they blame for the problem, because a buyer who blames
their genetics and a buyer who blames their last provider need different pages. The
prejudices they hold about providers in this category, stated plainly even where they are
unfair.

For every phrase you report, give it word for word as somebody actually wrote or said it,
with the link. A paraphrase is worth nothing to me here. Note the reading level they write
at, because a page pitched above it does not get read.

Finish with a ranked list of the twenty-five phrases you would build pages around, most
commercially urgent first, each with the source it came from and one line on why it earns
its place.

${RULE}

Bring the answer back into this step's thread. Either paste it with \`research:\` in front of it,
or drop the PDF the tool gave you straight in: both file the phrases against this avatar.`;
}

// ─────────────────────────────────────────────────────────────────────────────
// The generator the registry calls
// ─────────────────────────────────────────────────────────────────────────────

interface AutoResult {
  ok: boolean;
  error?: string;
  docId?: string;
  note?: string;
}

/**
 * Assemble this client's facts, render the brief, file it and post it.
 *
 * Ends the same way every other artifact does, through deliverArtifact: stored first,
 * step output_ref second, Slack last. The bot is not a member of the onboarding channel, so
 * the upload is expected to fail and the thread gets a link instead. That is documented at
 * length in deliver.ts and is a workspace fact rather than a bug here.
 */
export async function generateDeepResearchBrief(clientId: string): Promise<AutoResult> {
  const { data: client } = await supabaseAdmin
    .from("clients")
    .select("legal_name, dba_name, city, state, contact_id, domain, services, ideal_patient, business_type")
    .eq("id", clientId)
    .maybeSingle();

  if (!client) return { ok: false, error: "client not found" };

  // Intake bags. Free text the owner typed, read straight through without interpretation.
  const services = (client.services ?? {}) as Record<string, unknown>;
  const ideal = (client.ideal_patient ?? {}) as Record<string, unknown>;

  const str = (v: unknown): string | null => {
    const s = typeof v === "string" ? v.trim() : "";
    return s.length > 0 ? s : null;
  };

  const serviceList = Array.isArray(services.services)
    ? (services.services as unknown[]).map((s) => String(s)).filter(Boolean)
    : str(services.services)
      ? [str(services.services) as string]
      : [];

  // The seed sites and the competitors both come from measured runs rather than from
  // anybody's opinion. An empty list is reported as empty; it is never padded.
  const { citedDomains, namedInstead } = await measuredContext(
    clientId,
    (client.contact_id as string | null) ?? null,
    (client.domain as string | null) ?? null
  );

  // The confirmed avatar is what [PRODUCTO] in message 3 becomes, and it is the reason this step
  // now runs AFTER the confirmation rather than two steps before it.
  const { confirmedAvatarFor, recordAvatarPrompt } = await import("../avatars");
  const { verticalFor } = await import("../harvest");
  const avatar = await confirmedAvatarFor(clientId);
  const resolvedVertical = await verticalFor(clientId);

  const brief = buildDeepResearchBrief({
    clinicName: (client.dba_name as string) || (client.legal_name as string) || "This business",
    city: (client.city as string | null) ?? null,
    state: (client.state as string | null) ?? null,
    avatarLabel: avatar?.label ?? null,
    // ‼️ THE PROSE ONE, NOT THE KEY. business_type reads "AI visibility (AEO) marketing agency
    // for local businesses"; vertical_slug reads "aeo-agency". Message 1 is a sentence somebody
    // pastes into a chat, and a slug in the middle of it tells the model less than the phrase the
    // classifier already wrote. verticalFor() is still what KEYS everything, and it is unchanged.
    vertical:
      ((client.business_type as string | null) ?? "").trim() ||
      (resolvedVertical.ok ? resolvedVertical.vertical : null),
    primaryTreatment: str(services.primary_treatment) ?? str(services.primaryTreatment),
    services: serviceList,
    objections: str(ideal.objections),
    targetPatient: str(ideal.target),
    notWanted: str(ideal.not_wanted),
    triedBefore: str(ideal.tried_before),
    citedDomains,
    namedInstead,
  });

  // ‼️ THE RENDERED PROMPT IS FILED AGAINST THE AVATAR, NOT AGAINST THE CLIENT. That is the
  // reuse mechanism: the next client in this vertical aiming at the same buyer is offered this
  // back instead of spending the research run again. It never overwrites research somebody has
  // already brought back, and it is skipped entirely when there is no avatar to file it under.
  if (avatar && resolvedVertical.ok) {
    await recordAvatarPrompt({
      vertical: resolvedVertical.vertical,
      avatarSlug: avatar.slug,
      avatarLabel: avatar.label,
      promptText: brief,
      clientId,
    });
  }

  const result = await deliverArtifact({
    clientId,
    stepKey: "avatar_harvest",
    filename: "deep-research-brief.txt",
    buffer: Buffer.from(brief, "utf8"),
    contentType: "text/plain; charset=utf-8",
    message: avatar
      ? `Deep research brief for *${avatar.label}*. Three messages, in order, into one new ` +
        "conversation. Bring the answer back into this thread: paste it with `research:` in " +
        "front of it, or drop the PDF straight in. The step stays open until that lands."
      : "Deep research brief. No avatar is confirmed, so message 3 has no product in it: " +
        "confirm one on the board and un-tick this step to regenerate.",
  });

  return { ok: result.ok, error: result.error, docId: result.docId };
}

/**
 * Cited hosts and the businesses named instead, off this client's most recent run.
 *
 * ‼️ MATCHED ON client_id FIRST, AND THE ORDER MATTERS MORE THAN IT LOOKS.
 *
 * An earlier revision of this file avoided `audit_reports.client_id` on the grounds that
 * docs/2026-08-19-artifact-plumbing.sql had not been applied and PostgREST fails the whole
 * query on one unknown column. That migration IS applied — verified against production with
 * scripts/_probe-schema.ts — so the workaround is now the risk rather than the protection.
 *
 * contact_id and domain are FALLBACKS, not equivalents. Both can match a `prospect_audit`: the
 * one-engine prospecting run the audit bot fires at a lead, which A2 D-P14 says may appear in
 * findings only as "the audit you already saw" and never as a baseline. Seeding a research brief
 * from one is not a scorecard contamination, but it does mean the brief's "sources the engines
 * actually cited" would describe a different run than the one this client's numbers come from.
 * client_id is the only link that says "this run was fired FOR this client".
 */
async function measuredContext(
  clientId: string,
  contactId: string | null,
  domain: string | null
): Promise<{ citedDomains: string[]; namedInstead: string[] }> {
  const empty = { citedDomains: [], namedInstead: [] };

  const base = () =>
    supabaseAdmin.from("audit_reports").select("id").order("created_at", { ascending: false }).limit(1);

  let { data: report } = await base().eq("client_id", clientId).maybeSingle();

  if (!report && contactId) ({ data: report } = await base().eq("contact_id", contactId).maybeSingle());
  if (!report && domain) ({ data: report } = await base().ilike("website", `%${domain}%`).maybeSingle());
  if (!report) return empty;

  const { data: runs } = await supabaseAdmin
    .from("audit_runs")
    .select("citations, recommended")
    .eq("report_id", report.id as string)
    .eq("status", "ok");

  const hosts = new Map<string, number>();
  const named = new Map<string, number>();

  for (const row of runs ?? []) {
    // citations is jsonb and has carried both bare strings and {url} objects over the life
    // of the table. Handle both rather than assuming the newer shape.
    for (const c of Array.isArray(row.citations) ? (row.citations as unknown[]) : []) {
      const url = typeof c === "string" ? c : ((c as { url?: string })?.url ?? "");
      if (!url) continue;
      try {
        const host = new URL(url).hostname.replace(/^www\./, "").toLowerCase();
        hosts.set(host, (hosts.get(host) ?? 0) + 1);
      } catch {
        // A malformed citation is skipped rather than reported. It is one seed site.
      }
    }

    for (const r of Array.isArray(row.recommended) ? (row.recommended as unknown[]) : []) {
      const name = typeof r === "string" ? r.trim() : String((r as { name?: string })?.name ?? "").trim();
      if (name) named.set(name, (named.get(name) ?? 0) + 1);
    }
  }

  const rank = (m: Map<string, number>, n: number) =>
    [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, n).map(([k]) => k);

  return { citedDomains: rank(hosts, 12), namedInstead: rank(named, 8) };
}
