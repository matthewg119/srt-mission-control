// The tool lane: one page of the build is a thing the reader USES, not a thing they read.
//
// Matthew, 2026-09-29: "what would we build to help this customer achieve X?" Simple or
// complex. A business-day date calculator is as valid as a dosing estimator.
//
// ‼️ THE TOOL IS THE EIGHTH PAGE, ITS OWN SLOT BESIDE THE SEVEN. Not one of the seven, and
// not a category a client collects: client_assets carries a unique index allowing one
// not-dropped row per client, because "the tool page" has to be unambiguous on the call and
// in step 21's verifier.
//
// ‼️ IT PICKS FROM A REVIEWED REGISTRY AND CANNOT INVENT ONE. src/config/tool-components.ts
// is the list of components somebody read before they shipped. A lane that let a model name
// a tool would be a lane that put an unreviewed interactive widget on a client's own domain.
// What is generated per client is WHICH of them suits this business, and why.
//
// ‼️ AND IT DOES NOT BUILD A SECOND IDEA GENERATOR. asset-ideas.ts already proposes assets
// from a real results page, and page-angles.ts already writes three ideas per planned page.
// This reads what those produced. The one thing it adds is the decision.

import { supabaseAdmin } from "@/lib/db";
import { toolsForVertical, getToolComponent, type ToolComponent } from "@/config/tool-components";
import type { KeywordReply } from "@/lib/clients/client-keywords";

/** A tool this client could have, and whether anybody has built it for their vertical before. */
export interface ToolOption {
  component: ToolComponent;
  /**
   * The vertical_assets row, when one already exists for this vertical.
   *
   * ‼️ THE REUSE PROMPT DEPENDS ON THIS AND IT IS THE POINT OF THE LIBRARY. "med_spa already
   * has a botox unit calculator, reuse and restyle or build new?" is a question worth asking
   * once per vertical; asking it with no answer is a question nobody can act on.
   */
  existingAssetId: string | null;
  /** Why this one, for this client. Read off their own keyword work, never invented here. */
  because: string | null;
}

interface ClientFacts {
  vertical: string | null;
  legalName: string;
}

async function factsFor(clientId: string): Promise<ClientFacts | null> {
  const { data } = await supabaseAdmin
    .from("clients")
    .select("id, legal_name, dba_name, vertical_slug, business_type")
    .eq("id", clientId)
    .maybeSingle();
  if (!data) return null;
  const vertical =
    (data.vertical_slug as string | null) ?? (data.business_type as string | null) ?? null;
  return {
    vertical,
    legalName: ((data.dba_name as string | null) || (data.legal_name as string | null)) ?? "this client",
  };
}

/**
 * The keywords whose results page wanted a tool, in this client's own words.
 *
 * ‼️ READ, NEVER GENERATED. keyword-strategy-rules.ts already writes `dominant_page_type` from
 * the SERP, and it returns "tool" when the results are products. That judgement was made while
 * somebody was looking at a real results page; re-deciding it here from a model would throw
 * that away and guess from less.
 */
export async function toolKeywords(clientId: string): Promise<string[]> {
  const { data, error } = await supabaseAdmin
    .from("keyword_serp_reads")
    .select("phrase, dominant_page_type, recommended_asset")
    .eq("client_id", clientId)
    .eq("dominant_page_type", "tool")
    .limit(20);

  // Not fatal. No readings means no evidence for a pick, which the card says out loud rather
  // than pretending the list came from somewhere.
  if (error) {
    console.error(`[tool-lane] serp reads unavailable: ${error.message}`);
    return [];
  }
  return (data ?? [])
    .map((r) => String((r as Record<string, unknown>).phrase ?? "").trim())
    .filter(Boolean);
}

/** What this client could have, in the order the card lists them. */
export async function toolOptions(clientId: string): Promise<ToolOption[]> {
  const facts = await factsFor(clientId);
  if (!facts) return [];

  const phrases = await toolKeywords(clientId);

  const { data: library } = await supabaseAdmin
    .from("vertical_assets")
    .select("id, component_key, vertical")
    .eq("vertical", facts.vertical ?? "");

  const byKey = new Map<string, string>();
  for (const r of (library ?? []) as Array<Record<string, unknown>>) {
    byKey.set(String(r.component_key), String(r.id));
  }

  return toolsForVertical(facts.vertical).map((component) => ({
    component,
    existingAssetId: byKey.get(component.key) ?? null,
    // The client's own phrase, when one of their tool-shaped keywords reads like this tool.
    because:
      phrases.find((p) => {
        const words = component.answers.toLowerCase().split(/\W+/).filter((w) => w.length > 4);
        return words.some((w) => p.toLowerCase().includes(w));
      }) ?? null,
  }));
}

export type PickResult =
  | { ok: true; message: string }
  | { ok: false; error: string };

/**
 * Pick the tool this client gets.
 *
 * ‼️ IT WRITES THE LIBRARY ROW AND THE INSTANCE, IN THAT ORDER, AND A REUSED ASSET IS SAID SO.
 * A vertical_assets row is what a med spa calculator IS; a client_assets row is this client's
 * instance of it. The second client in a vertical reuses the first one's definition and gets
 * their own instance, which is what "restyled per client, never served as another client's
 * live page" means in schema terms.
 */
export async function pickTool(clientId: string, index: number, by: string): Promise<PickResult> {
  const options = await toolOptions(clientId);
  if (options.length === 0) {
    return { ok: false, error: "There are no tools in the registry that suit this client." };
  }

  const chosen = options[index - 1];
  if (!chosen) {
    return { ok: false, error: `Pick a number between one and ${options.length}. \`tools\` lists them.` };
  }

  const facts = await factsFor(clientId);
  const vertical = facts?.vertical ?? "general";

  // The library row, reused when the vertical already has one.
  let assetId = chosen.existingAssetId;
  let reused = assetId !== null;

  if (!assetId) {
    const { data, error } = await supabaseAdmin
      .from("vertical_assets")
      .insert({
        vertical,
        slug: chosen.component.key,
        kind: "calculator",
        title: chosen.component.label,
        what_it_does: chosen.component.answers,
        inputs: chosen.component.inputs,
        output: chosen.component.output,
        component_key: chosen.component.key,
        source_keyword: chosen.because,
      })
      .select("id")
      .maybeSingle();

    if (error || !data) {
      return { ok: false, error: `The library row was not written: ${error?.message ?? "no row came back"}` };
    }
    assetId = String(data.id);
    reused = false;
  }

  // ‼️ UPSERT ON THE CLIENT, BECAUSE THE INDEX ALLOWS ONE NOT-DROPPED ROW EACH. Picking a
  // second tool REPLACES the first rather than failing on a constraint somebody then has to
  // go and read. The tool is one slot; changing your mind about which tool fills it is an
  // ordinary thing to do before the call.
  const { error: dropErr } = await supabaseAdmin
    .from("client_assets")
    .update({ status: "dropped", updated_at: new Date().toISOString() })
    .eq("client_id", clientId)
    .neq("status", "dropped");

  if (dropErr) return { ok: false, error: `The previous pick was not cleared: ${dropErr.message}` };

  const { error: insErr } = await supabaseAdmin.from("client_assets").insert({
    client_id: clientId,
    vertical_asset_id: assetId,
    status: "picked",
  });

  if (insErr) return { ok: false, error: `The pick was not saved: ${insErr.message}` };

  return {
    ok: true,
    message: [
      `:hammer_and_wrench: *${chosen.component.label}* is this client's tool, picked by ${by}.`,
      reused
        ? `Reused from the ${vertical} library and restyled for them. It is not another client's page: they get their own instance and their own theme.`
        : `New in the ${vertical} library, so the next client in this vertical is offered it.`,
      "",
      `It answers: _${chosen.component.answers}_`,
      `It asks for: ${chosen.component.inputs.join(", ")}.`,
      `It gives back: ${chosen.component.output}`,
      `It is wrong when: ${chosen.component.limits}`,
      "",
      "*Next:* at step twenty-one the tool page is the eighth slot, and `supports auto` writes the " +
        "pages that point at it.",
    ].join("\n"),
  };
}

/** The tool this client has picked, for the step card and the verifier. */
export async function clientTool(
  clientId: string
): Promise<{ componentKey: string; status: string; pageId: string | null } | null> {
  const { data } = await supabaseAdmin
    .from("client_assets")
    .select("status, page_id, vertical_assets!inner(component_key)")
    .eq("client_id", clientId)
    .neq("status", "dropped")
    .maybeSingle();

  if (!data) return null;
  const row = data as unknown as {
    status: string;
    page_id: string | null;
    vertical_assets: { component_key: string } | { component_key: string }[];
  };
  const asset = Array.isArray(row.vertical_assets) ? row.vertical_assets[0] : row.vertical_assets;
  if (!asset) return null;
  return { componentKey: asset.component_key, status: row.status, pageId: row.page_id };
}

/**
 * Put this client's tool ON a page, which is the half of the lane that was owed.
 *
 * ‼️ THIS IS THE WRITER THE LANE WAS MISSING, AND ITS ABSENCE WAS VISIBLE FROM BOTH ENDS.
 * _probe-dead-wires.ts recorded client_assets.page_id and client_pages.component_key as written
 * nowhere ("the lane is half built ... what is owed is the renderer that serves the asset"), and
 * step twenty one refused with "the tool is picked but has no page yet. Draft its page in the page
 * studio and set its component key" against a setter that did not exist. A tool picked at step
 * twelve could therefore never reach a page at all.
 *
 * ‼️ BOTH COLUMNS OR NEITHER. client_pages.component_key is what the renderer reads and
 * client_assets.page_id is what the verifier and the card read, so one without the other is a
 * tool that renders with nothing knowing where it went, or a pointer at a page that renders
 * nothing. The page write goes first because it is the one that can fail on a CHECK: the column
 * is constrained to a component-key shape, and a key not in the registry renders nothing by
 * design.
 *
 * ‼️ IT NEVER PICKS THE TOOL. Which tool a client gets is pickTool's decision at step twelve,
 * made in front of the keyword evidence. This only answers WHERE it goes.
 */
export async function bindToolToPage(args: {
  clientId: string;
  pageId: string;
  by: string;
}): Promise<{ ok: true; componentKey: string } | { ok: false; error: string }> {
  const tool = await clientTool(args.clientId);
  if (!tool) {
    return {
      ok: false,
      error: "No tool has been picked for this client yet. `tools` lists them and `tool pick <n>` chooses one.",
    };
  }
  if (!getToolComponent(tool.componentKey)) {
    return {
      ok: false,
      error:
        `\`${tool.componentKey}\` is not in the component registry, so it would render nothing. ` +
        "Pick again with `tool pick <n>`.",
    };
  }

  const { error: pageErr } = await supabaseAdmin
    .from("client_pages")
    .update({ component_key: tool.componentKey, updated_at: new Date().toISOString() })
    .eq("id", args.pageId)
    .eq("client_id", args.clientId);

  if (pageErr) {
    return { ok: false, error: `The page did not take the component key: ${pageErr.message}` };
  }

  // ‼️ SCOPED TO THE NOT-DROPPED ROW, which the unique index guarantees is at most one. Writing by
  // client_id alone would also stamp the rows a previous pick dropped, and those point at whatever
  // page that earlier tool was on.
  const { error: assetErr } = await supabaseAdmin
    .from("client_assets")
    .update({ page_id: args.pageId, status: "ready", updated_at: new Date().toISOString() })
    .eq("client_id", args.clientId)
    .neq("status", "dropped");

  if (assetErr) {
    return { ok: false, error: `The page was set but the asset did not record it: ${assetErr.message}` };
  }

  console.log(`[tool-lane] ${tool.componentKey} bound to page ${args.pageId} by ${args.by}`);
  return { ok: true, componentKey: tool.componentKey };
}

const TOOLS = /^\s*[`*_]*tools?[`*_]*\s*$/i;
const PICK = /^\s*[`*_]*tool\s+pick\s+(\d{1,2})[`*_]*\s*$/i;

/**
 * `tools` and `tool pick N`, in step twelve's thread.
 *
 * ‼️ STEP TWELVE, NOT STEP TWENTY-ONE, AND THAT IS THE WHOLE POINT OF THE PLACEMENT. The
 * decision is made while somebody is looking at the keywords and the results pages behind
 * them, which is where the evidence for it is. By step twenty-one the pages are being drafted
 * and a tool is a thing to squeeze in.
 *
 * Returns null when the text is not one of these, so the caller's chain carries on.
 */
export async function handleToolThreadReply(args: {
  clientId: string;
  stepKey: string | null;
  text: string;
  by: string;
}): Promise<KeywordReply | null> {
  if (args.stepKey !== "keyword_set") return null;

  if (TOOLS.test(args.text)) {
    const options = await toolOptions(args.clientId);
    if (options.length === 0) {
        return { message: "There are no tools in the registry that suit this client yet." };
    }
    const current = await clientTool(args.clientId);
    return { message: [
      "*The tool this client could have.* One page of the build is a thing the reader uses.",
      "",
      ...options.flatMap((o, i) => [
        `*${i + 1}.* ${o.component.label}${o.existingAssetId ? "  _already in the library for this vertical_" : ""}`,
        `     ${o.component.answers}`,
        o.because ? `     _They rank for:_ ${o.because}` : "",
      ]),
      "",
      current
        ? `Picked: \`${current.componentKey}\`. \`tool pick <n>\` changes it.`
        : "`tool pick <n>` picks one. It becomes the eighth page, beside the seven.",
    ]
      .filter((l) => l !== "")
      .join("\n") };
  }

  const pick = PICK.exec(args.text);
  if (pick) {
    const res = await pickTool(args.clientId, Number(pick[1]), args.by);
    return { message: res.ok ? res.message : `:warning: ${res.error}` };
  }

  return null;
}

/** Exported for the probe: an unknown key can never resolve to a component. */
export { getToolComponent };
