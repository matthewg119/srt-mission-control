// Choosing the character that sits in the corner of a client's website.
//
// Matthew, 2026-09-16: "the rest will have another animation that has more to do with it for clients I
// actually want them to select it so give them a menu of items to select always give me the 6 prompts to
// select the different concepts for AI concierge avatars so they can select from a few options ... make
// sure I can skip this step if I want and if i do leave as default ... make sure we have at least 3
// options for avatars selected for that specific client ... and I need to be able to show them 3 preview
// links with each one."
//
// ‼️ THE MENU IS MODELLED ON universeMenu() IN hub-skin.ts, ON PURPOSE. That lane already answers the
// same question for the hub's look: a numbered list where every option carries its own link, shown on
// this client, and one word in the thread keeps one. Two different shapes for "pick one of these and
// look at it first" is two things to explain on a call.
//
// ‼️ A CONCEPT IS NOT A MASCOT UNTIL IT HAS FILES. `mascot concepts` writes six characters and the
// prompts that would generate them, and that is all it writes. Nothing is selectable until somebody has
// generated the art and pasted it back, because a preview link for a character with no images is a link
// to an empty corner. `ready` is the word for "has files"; everything else is `proposed`.
//
// ‼️ THE BUILT-INS ARE NEVER READ OUT OF THE DATABASE. mascotAssets() resolves them from static imports
// so they are served from /_next/static with no function invocation per page view, on a client's own
// domain. The mascot_concepts rows for them exist to describe them in the menu and to keep the prompts
// that made them. If those two ever disagree, the code is right.

import { supabaseAdmin } from "@/lib/db";
import { callClaudeJSON, type ClaudeModel } from "@/lib/claude-calls";
import { hasBannedDash } from "@/lib/copy-guard";
import { DEFAULT_MASCOT, MASCOTS, mascotKeys } from "@/lib/concierge/mascot";
import { conciergeTenant } from "@/lib/concierge/for-client";
import {
  cleanCommand,
  CONCEPT_COUNT,
  isLauncherCorner,
  MASCOT_GRAMMAR,
  MASCOT_STEP,
  SHORTLIST,
} from "./mascot-grammar";

export { CONCEPT_COUNT, MASCOT_STEP, SHORTLIST } from "./mascot-grammar";
export { isMascotCommand } from "./mascot-grammar";

export interface MascotOption {
  key: string;
  name: string;
  blurb: string;
  /** Built-ins ship with the app; generated ones were made for this client. */
  builtin: boolean;
  /** Has enough art to be previewed. A built-in always has. */
  ready: boolean;
  imagePrompt: string | null;
  statePrompts: Record<string, string>;
}

interface ConceptRow {
  key: string;
  name: string;
  blurb: string | null;
  image_prompt: string | null;
  state_prompts: Record<string, string> | null;
  assets: Record<string, string> | null;
  source: string;
  status: string;
}

function model(): ClaudeModel {
  return (process.env.ANTHROPIC_MODEL as ClaudeModel) || "claude-sonnet-4-6";
}

// ─────────────────────────────────────────────────────────────────────────────
// The catalogue
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Every character this client could be shown, built-ins first.
 *
 * ‼️ A GENERATED CHARACTER WITH THE SAME KEY AS A BUILT-IN WINS FOR THIS CLIENT. The unique index
 * allows it deliberately (a wizard cat drawn for one clinic is not the shared one), so the merge has
 * to pick, and the more specific row is the one a person made for this client on purpose.
 */
export async function mascotCatalogue(clientId: string): Promise<MascotOption[]> {
  const { data } = await supabaseAdmin
    .from("mascot_concepts")
    .select("key, name, blurb, image_prompt, state_prompts, assets, source, status")
    .or(`client_id.eq.${clientId},client_id.is.null`)
    .neq("status", "dropped")
    .order("created_at", { ascending: true });

  const rows = (data ?? []) as ConceptRow[];
  const byKey = new Map<string, MascotOption>();

  for (const key of mascotKeys()) {
    const row = rows.find((r) => r.key === key && r.source === "builtin");
    byKey.set(key, {
      key,
      name: row?.name ?? key,
      blurb: row?.blurb ?? "",
      builtin: true,
      ready: true,
      imagePrompt: row?.image_prompt ?? null,
      statePrompts: row?.state_prompts ?? {},
    });
  }

  for (const row of rows) {
    if (row.source === "builtin") continue;
    const assets = row.assets ?? {};
    byKey.set(row.key, {
      key: row.key,
      name: row.name,
      blurb: row.blurb ?? "",
      builtin: false,
      ready: row.status === "ready" || row.status === "picked" || Boolean(assets.idle),
      imagePrompt: row.image_prompt,
      statePrompts: row.state_prompts ?? {},
    });
  }

  return [...byKey.values()];
}

/**
 * The assets for a key that was generated for this client, or null when it is a built-in.
 *
 * The widget resolves built-ins from code; this is the other half, and it is what makes a pasted-back
 * character renderable without a deploy. See abs() in embed.js: an absolute URL is used as it stands.
 */
export async function generatedAssets(clientId: string, key: string): Promise<Record<string, string> | null> {
  const { data } = await supabaseAdmin
    .from("mascot_concepts")
    .select("assets")
    .eq("client_id", clientId)
    .eq("key", key)
    .maybeSingle();
  const assets = (data?.assets ?? null) as Record<string, string> | null;
  return assets && assets.idle ? assets : null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Links
// ─────────────────────────────────────────────────────────────────────────────

/** One character's preview link: their themed page, with that character in the corner. */
export async function mascotPreviewUrl(clientId: string, key: string): Promise<string | null> {
  try {
    const [{ signOnboardingToken }, { PREVIEW_TOKEN_TTL_DAYS }, { previewOrigin }] = await Promise.all([
      import("./token"),
      import("./referral-engine-preview"),
      import("@/lib/concierge/origin"),
    ]);
    const { token } = signOnboardingToken(clientId, PREVIEW_TOKEN_TTL_DAYS, "preview");
    return `${previewOrigin()}/preview/${encodeURIComponent(token)}?kind=concierge&mascot=${encodeURIComponent(key)}`;
  } catch (e) {
    console.error("[mascot-studio] preview link not minted:", (e as Error).message);
    return null;
  }
}

/** All of them, one line each with a link, so they can be compared without a screenshot. */
export async function mascotMenu(clientId: string): Promise<string[]> {
  const options = await mascotCatalogue(clientId);
  const lines: string[] = [];
  for (const o of options) {
    const url = o.ready ? await mascotPreviewUrl(clientId, o.key) : null;
    lines.push(
      `  • *${o.name}* (\`mascot ${o.key}\`): ${o.blurb}` +
        (url ? ` ${url}` : " _no art yet. Paste the images into this thread._")
    );
  }
  return lines;
}

// ─────────────────────────────────────────────────────────────────────────────
// Proposing six
// ─────────────────────────────────────────────────────────────────────────────

const CONCEPT_SYSTEM = [
  "You name mascot characters for a small business's website assistant. The mascot sits in the corner of",
  "the page, about 96 pixels tall, and opens a chat when it is clicked. It is the first thing a visitor",
  "sees, so it has to read instantly at that size and belong to that business.",
  "",
  "RULES",
  "1. Six characters, all different animals or objects. No two from the same family.",
  "2. Each one must make sense for THIS business's visitor. A clinic's patients are not an agency's buyers.",
  "3. Readable as a silhouette at 96 pixels: one clear shape, one prop at most, strong colour separation.",
  "4. Nothing medical, nothing clinical, no needles, no syringes, no lab coats, no before-and-after skin.",
  "5. No human characters and nothing that could read as a specific real person.",
  "6. Never use an em dash or an en dash in any text you return.",
  "7. The image prompt must end with the background instruction it is given, word for word.",
].join("\n");

function conceptUser(args: {
  business: string;
  city: string | null;
  audience: "patient" | "owner";
  buyer: string;
  offer: string | null;
  background: string;
  style: string;
  taken: string[];
}): string {
  return [
    `Business: ${args.business}${args.city ? ` in ${args.city}` : ""}`,
    `The visitor this mascot greets: ${args.buyer}`,
    args.offer ? `What the business sells them: ${args.offer}` : "",
    `Art style for every prompt: ${args.style}`,
    `Background instruction every image prompt must end with, word for word: "${args.background}"`,
    args.taken.length ? `Keys already taken, do not reuse: ${args.taken.join(", ")}` : "",
    "",
    `Write ${CONCEPT_COUNT} characters.`,
    "",
    "For each one:",
    "  key: lowercase, hyphenated, two words, e.g. spa-otter",
    "  name: two or three words a person would say out loud",
    "  blurb: one sentence, under 90 characters, what it is and why it fits this business",
    "  image_prompt: a full prompt for an image tool, ending with the background instruction above",
    "  state_prompts: an object with idle, talk and one flourish of your own invention, each one",
    "    sentence describing a short looping motion for a video tool. The flourish key is a short",
    "    lowercase word.",
    "",
    'Return JSON: { "concepts": [ { "key", "name", "blurb", "image_prompt", "state_prompts" } ] }',
  ]
    .filter((l) => l !== "")
    .join("\n");
}

/**
 * The house look, per audience.
 *
 * ‼️ THE BACKGROUND INSTRUCTION IS NOT DECORATION, IT IS WHAT MAKES THE CLIP CONVERTIBLE.
 * scripts/mascot/key-mascot.py removes the background by flood-filling the flat region connected to the
 * frame's edge. A generated clip on a busy or gradient background cannot be keyed at all, and the first
 * anybody would know is a square of checkerboard sitting on a client's homepage. So every prompt this
 * writes ends with the same sentence, and the model is told to end with it word for word.
 */
const BACKGROUND = "on a plain flat white background with no shadow and no floor";
const STYLE_BY_AUDIENCE: Record<string, string> = {
  owner: "16-bit pixel art sprite, bold outline, limited palette, full body, facing camera",
  patient: "soft 3D render, rounded friendly shapes, pastel palette, full body, facing camera",
};

export async function proposeConcepts(
  clientId: string,
  by: string
): Promise<{ ok: true; lines: string[] } | { ok: false; error: string }> {
  const tenant = await conciergeTenant(clientId);
  if (!tenant) {
    const { stepNumber } = await import("@/config/delivery-steps");
    return {
      ok: false,
      error: `this client has no concierge row yet. Retry step ${stepNumber(MASCOT_STEP)} on the board first.`,
    };
  }

  const { data: client } = await supabaseAdmin
    .from("clients")
    .select("legal_name, dba_name, city, state")
    .eq("id", clientId)
    .maybeSingle();
  const business =
    (client?.dba_name as string) || (client?.legal_name as string) || "this business";
  const city = client?.city ? `${client.city}${client.state ? `, ${client.state}` : ""}` : null;

  const { audienceById } = await import("./audiences");
  const resolved = tenant.audienceId ? await audienceById(tenant.audienceId) : null;
  const buyer =
    resolved && resolved.ok
      ? resolved.audience.vocabulary.buyerPlural || resolved.audience.vocabulary.buyerSingular
      : tenant.audience === "owner"
        ? "business owners"
        : "patients";

  const { loadOffer } = await import("./offers");
  const offer = await loadOffer(clientId).catch(() => null);

  const existing = await mascotCatalogue(clientId);

  let concepts: Array<Record<string, unknown>>;
  try {
    const res = await callClaudeJSON<{ concepts: Array<Record<string, unknown>> }>({
      model: model(),
      system: CONCEPT_SYSTEM,
      user: conceptUser({
        business,
        city,
        audience: tenant.audience,
        buyer,
        offer: offer?.treatment ?? null,
        background: BACKGROUND,
        style: STYLE_BY_AUDIENCE[tenant.audience] ?? STYLE_BY_AUDIENCE.owner,
        taken: existing.map((o) => o.key),
      }),
      maxTokens: 3000,
      temperature: 0.8,
      validate: (v): v is { concepts: Array<Record<string, unknown>> } =>
        Array.isArray((v as { concepts?: unknown } | null)?.concepts),
      describeInvalid: () => 'Return { "concepts": [ ...six... ] }.',
      timeoutMs: 120_000,
    });
    concepts = res.data.concepts;
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }

  const rows = concepts.slice(0, CONCEPT_COUNT).map((c) => {
    const key = String(c.key ?? "")
      .toLowerCase()
      .replace(/[^a-z0-9-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40);
    const prompts = (c.state_prompts ?? {}) as Record<string, unknown>;
    const clean = (v: unknown) => (typeof v === "string" ? v.trim() : "");
    return {
      client_id: clientId,
      key,
      name: clean(c.name).slice(0, 60) || key,
      blurb: clean(c.blurb).slice(0, 140),
      audience: null as string | null,
      vertical: tenant.vertical,
      image_prompt: clean(c.image_prompt),
      state_prompts: Object.fromEntries(
        Object.entries(prompts)
          .map(([k, v]) => [k.toLowerCase().replace(/[^a-z0-9_]+/g, "_"), clean(v)])
          .filter(([, v]) => v !== "")
      ),
      source: "generated",
      status: "proposed",
      created_by: by,
      updated_at: new Date().toISOString(),
    };
  });

  // Rule 6 in code, not only in the prompt. copy-guard is the enforcement everywhere else in the app.
  const dashed = rows.filter((r) => hasBannedDash(`${r.name} ${r.blurb} ${r.image_prompt}`));
  const usable = rows.filter((r) => r.key && !dashed.includes(r));
  if (usable.length === 0) return { ok: false, error: "the model returned no usable concept." };

  const { error } = await supabaseAdmin
    .from("mascot_concepts")
    .upsert(usable, { onConflict: "client_id,key", ignoreDuplicates: false });
  if (error) {
    return {
      ok: false,
      error: `the concepts could not be filed: ${error.message}. If this names mascot_concepts, docs/2026-09-16-mascot-catalogue.sql has not been run.`,
    };
  }

  const lines: string[] = [
    `:art: *${usable.length} concepts for ${business}.* Generate the art, paste it back here, then shortlist three.`,
    "",
  ];
  usable.forEach((r, i) => {
    lines.push(`*${i + 1}. ${r.name}* (\`${r.key}\`)`, `  ${r.blurb}`, "  Image prompt:", "```" + r.image_prompt + "```");
    const states = Object.entries(r.state_prompts);
    if (states.length) {
      lines.push(
        "  Then one clip per state, same character, same background:",
        ...states.map(([s, p]) => `    • \`${s}\`: ${p}`)
      );
    }
    lines.push("");
  });
  lines.push(
    "*Paste the art back here* with the character's key in the message, for example `mascot " +
      `${usable[0].key} idle\` with the file attached. Images and clips both work.`,
    `Then \`mascot pick ${usable.slice(0, SHORTLIST).map((r) => r.key).join(", ")}\` shortlists three and posts a preview link for each.`,
    "Skipping is fine: `mascot skip` keeps the default and the step still ticks."
  );
  return { ok: true, lines };
}

// ─────────────────────────────────────────────────────────────────────────────
// Choosing
// ─────────────────────────────────────────────────────────────────────────────

async function writeConfig(clientId: string, patch: Record<string, unknown>): Promise<string | null> {
  const { error } = await supabaseAdmin
    .from("concierge_configs")
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq("client_id", clientId);
  if (error) return error.message;
  const { revalidateTag } = await import("next/cache");
  try {
    revalidateTag("concierge-config");
  } catch {
    /* outside a request the five minute cache covers it */
  }
  return null;
}

/** Shortlist up to three, and post a preview link for each. */
export async function pickCandidates(
  clientId: string,
  keys: string[],
  by: string
): Promise<{ ok: boolean; message: string }> {
  const options = await mascotCatalogue(clientId);
  const wanted = keys.map((k) => k.trim().toLowerCase()).filter(Boolean);
  const unknown = wanted.filter((k) => !options.some((o) => o.key === k));
  if (unknown.length) {
    return { ok: false, message: `:warning: Nothing shortlisted. No character called ${unknown.join(", ")}. \`mascot\` lists them.` };
  }
  if (wanted.length > SHORTLIST) {
    return { ok: false, message: `:warning: Nothing shortlisted. That is ${wanted.length}; the call shows ${SHORTLIST}.` };
  }
  // ‼️ A CHARACTER WITH NO ART CANNOT BE SHORTLISTED. The whole point of the shortlist is three links
  // somebody opens on a call, and a link to an empty corner is worse than one fewer option.
  const empty = wanted.filter((k) => !options.find((o) => o.key === k)?.ready);
  if (empty.length) {
    return {
      ok: false,
      message: `:warning: Nothing shortlisted. ${empty.join(", ")} has no art yet. Paste the images into this thread first.`,
    };
  }

  const err = await writeConfig(clientId, { mascot_candidates: wanted });
  if (err) return { ok: false, message: `:warning: Not shortlisted: ${err}` };

  const lines = [`:white_check_mark: *${wanted.length} shortlisted* by ${by}. One link each, walk them on the call:`];
  for (const k of wanted) {
    const o = options.find((x) => x.key === k)!;
    const url = await mascotPreviewUrl(clientId, k);
    lines.push(`  • *${o.name}*: ${url ?? "link not minted"}`);
  }
  lines.push("", "On the call, `mascot <key>` keeps the one they chose.");
  await logClient(clientId, by, `mascot pick ${wanted.join(", ")}`);
  return { ok: true, message: lines.join("\n") };
}

/** Keep one. This is what actually appears on their pages once the widget goes live. */
export async function chooseMascot(
  clientId: string,
  key: string,
  by: string
): Promise<{ ok: boolean; message: string }> {
  const wanted = key.trim().toLowerCase();
  const options = await mascotCatalogue(clientId);
  const option = options.find((o) => o.key === wanted);
  if (!option) return { ok: false, message: `:warning: There is no character called ${wanted}. \`mascot\` lists them.` };
  if (!option.ready) {
    return { ok: false, message: `:warning: ${option.name} has no art yet. Paste the images into this thread first.` };
  }

  const err = await writeConfig(clientId, { mascot: wanted });
  if (err) return { ok: false, message: `:warning: Not kept: ${err}` };
  if (!option.builtin) {
    await supabaseAdmin
      .from("mascot_concepts")
      .update({ status: "picked", updated_at: new Date().toISOString() })
      .eq("client_id", clientId)
      .eq("key", wanted);
  }

  const url = await mascotPreviewUrl(clientId, wanted);
  await logClient(clientId, by, `mascot ${wanted}`);
  return {
    ok: true,
    message:
      `:white_check_mark: *${option.name} kept* by ${by}. It appears on their pages at the \`concierge_live\` step, after the call.` +
      (url ? `\nOn their preview now: ${url}` : ""),
  };
}

/**
 * Skip the choice.
 *
 * ‼️ IT WRITES THE DEFAULT RATHER THAN LEAVING THE COLUMN ALONE. Matthew: "make sure I can skip this
 * step if I want and if i do leave as default". A column default only applies at insert, and step 18
 * creates the row long before anybody gets here, so "leave it alone" would mean a client keeps whatever
 * the row happened to be created with. Writing it means the decision is recorded and reads the same in
 * the database as a deliberate pick of the same character.
 */
export async function skipMascot(clientId: string, by: string): Promise<{ ok: boolean; message: string }> {
  const err = await writeConfig(clientId, { mascot: DEFAULT_MASCOT });
  if (err) return { ok: false, message: `:warning: Not set: ${err}` };
  const name = MASCOTS[DEFAULT_MASCOT] ? (await mascotCatalogue(clientId)).find((o) => o.key === DEFAULT_MASCOT)?.name : null;
  await logClient(clientId, by, "mascot skip");
  return {
    ok: true,
    message: `:white_check_mark: *Kept the default* (${name ?? DEFAULT_MASCOT}), ${by}. Nothing else is blocked. \`mascot\` reopens the menu whenever.`,
  };
}

async function logClient(clientId: string, by: string, text: string): Promise<void> {
  const { logClientEvent } = await import("./client-events");
  await logClientEvent({
    clientId,
    stepKey: MASCOT_STEP,
    source: "slack",
    kind: "command",
    author: by,
    text,
    payload: { handler: "mascot-studio" },
  }).catch(() => {});
}

// ─────────────────────────────────────────────────────────────────────────────
// The thread
// ─────────────────────────────────────────────────────────────────────────────

const { MENU, CONCEPTS, PICK, SKIP, CORNER, KEEP } = MASCOT_GRAMMAR;

export async function handleMascotThreadReply(input: {
  clientId: string;
  stepKey: string | null;
  text: string;
  by: string;
}): Promise<{ message: string; after?: () => Promise<void> } | null> {
  if (input.stepKey !== MASCOT_STEP) return null;
  const t = cleanCommand(input.text);
  const refresh = async () => {
    const { postStep } = await import("./step-engine");
    await postStep(input.clientId, MASCOT_STEP).catch(() => {});
  };
  const say = async (text: string) => {
    const { notifyStep } = await import("./step-board");
    await notifyStep(input.clientId, MASCOT_STEP, text).catch(() => {});
  };

  // ‼️ THE RESERVED WORDS ARE TESTED BEFORE THE BARE KEY, AND THE ORDER IS THE WHOLE GRAMMAR.
  // `mascot skip` is a valid key shape, so a KEEP-first order would look for a character called "skip",
  // fail to find one, and answer "there is no character called skip" to somebody skipping the step.
  if (CONCEPTS.test(t)) {
    return {
      message: `:hourglass_flowing_sand: Writing ${CONCEPT_COUNT} character concepts for this client, with the prompt for each. About half a minute.`,
      after: async () => {
        const res = await proposeConcepts(input.clientId, input.by);
        await say(res.ok ? res.lines.join("\n") : `:warning: No concepts: ${res.error}`);
        await refresh();
      },
    };
  }

  if (MENU.test(t)) {
    const lines = await mascotMenu(input.clientId);
    return {
      message: [
        "*The characters this client can have in the corner:*",
        ...lines,
        "",
        `\`mascot concepts\` writes ${CONCEPT_COUNT} new ones for this client. \`mascot pick a, b, c\` shortlists ${SHORTLIST} for the call.`,
        "`mascot skip` keeps the default. `mascot corner bottom-left` moves where it sits.",
      ].join("\n"),
    };
  }

  const skip = SKIP.exec(t);
  if (skip) {
    const res = await skipMascot(input.clientId, input.by);
    return { message: res.message, after: refresh };
  }

  const corner = CORNER.exec(t);
  if (corner) {
    const value = `${corner[1].toLowerCase()}-${corner[2].toLowerCase()}`;
    if (!isLauncherCorner(value)) return { message: `:warning: ${value} is not one of the four corners.` };
    const err = await writeConfig(input.clientId, { launcher_corner: value });
    return {
      message: err
        ? `:warning: Not moved: ${err}`
        : `:white_check_mark: *The assistant rests in the ${value.replace("-", " ")}.* Dragging it on the preview moves it too.`,
      after: refresh,
    };
  }

  const pick = PICK.exec(t);
  if (pick) {
    const res = await pickCandidates(input.clientId, pick[1].split(/[,\s]+/), input.by);
    return { message: res.message, after: refresh };
  }

  const keep = KEEP.exec(t);
  if (keep) {
    const res = await chooseMascot(input.clientId, keep[1], input.by);
    return { message: res.message, after: refresh };
  }

  return null;
}
