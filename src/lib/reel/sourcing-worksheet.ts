// Content Sourcing Worksheet — the single source of truth for "what real reference
// content does each workflow need, and where do we find it".
//
// Consumed by BOTH:
//   - scripts/generate-sourcing-worksheet.ts -> docs/WORKSHEET-content-sourcing.md
//   - the Slack `worksheet` / `sources` command (route.ts top-level + in-session)
// so the doc and the cards can never drift apart.
//
// Why this exists: every workflow's images are grounded on ITS OWN reference library
// (content_examples rows with workflow_id — dropped in the session thread). Sourcing
// real clips per workflow is what keeps generations on-subject and stops credits
// burning on garbage. The Ray-Ban Meta spec is the master style contract for POV.

import { listWorkflows, type Workflow } from "@/config/workflows";
import { slack } from "@/lib/slack-bot";

// ---- The Meta Ray-Ban POV master spec ---------------------------------------------------

export const RAYBAN_CHECKLIST: string[] = [
  "True eye-height first-person camera (not chest/body-cam, not hand-level phone, not helmet-high)",
  "Portrait 3:4 framing (the native 3024x4032 capture), or cleanly croppable to it — NOT 9:16",
  "Micro head-sway: EIS-smoothed organic drift/bob, not locked gimbal, not shaky-cam",
  "Hands enter from the BOTTOM of frame naturally when gesturing or working",
  "No visible camera, rig, phone, or mirror reveal anywhere in frame",
  "Mild edge softness / barrel distortion on wide scenes, sharpest in the center third",
  "Flat, slightly desaturated grade; highlights wash slightly in bright light",
  "Mixed ambient lighting (never studio-lit); can look flat/HDR-compressed indoors",
  "Gaze-centered framing: the subject sits center-frame because the wearer is LOOKING at it",
];

export const RAYBAN_STYLE_SPEC = [
  "### Technical spec (what \"authentic\" actually means)",
  "- Native photo capture 3024 x 4032 px — **3:4 portrait is the signature ratio, NOT 9:16.**",
  "- Video up to 3K UHD @ 30fps; wide eye-level FOV (~12-13mm full-frame equivalent), mild barrel distortion at the edges, no true fisheye.",
  "- Software EIS turns walking bounce into a gentle floaty drift (never gimbal-locked, never shaky).",
  "- Slight highlight washout and muted saturation in bright light; flat/HDR-compressed look indoors.",
  "- Hands enter from the bottom of frame; the camera looks where the wearer looks (gaze-centered framing).",
  "",
  "### The 9-point visual signature checklist (score every clip 1-5 on each)",
  ...RAYBAN_CHECKLIST.map((c, i) => `${i + 1}. ${c}`),
  "",
  "**Keep a clip only if it scores 4+ on at least 7 of the 9.** Target 20-30 keeper clips for the",
  "master Meta-glasses set; per workflow the gate is 3 references and the target is 6-10.",
  "",
  "### Where the raw look lives (authenticity sources, any subject)",
  "- IG/TikTok hashtags: `#metaglasses` `#raybanmeta` `#raybanmetaglasses` `#povglasses` — filter to clips showing a hand or mirror reflection to confirm authenticity",
  "- YouTube: \"Ray-Ban Meta camera test\", \"Ray-Ban Meta gen 2 review\", \"day in my life Ray-Ban Meta\" (reviewers show unedited sample segments)",
  "- Reddit: r/RayBanMeta — frequent RAW sample uploads, the best ground-truth baseline",
  "- Meta's own product pages — polished but framing-accurate",
].join("\n");

export const INVENTORY_TABLE_TEMPLATE = [
  "| # | Source | Link / exact search | Workflow | Shot covered | 9-pt score | Keep? |",
  "|---|--------|---------------------|----------|--------------|------------|-------|",
  "| 1 |        |                     |          |              |            |       |",
].join("\n");

// ---- Per-workflow search queries (deterministic; stable across re-runs) ------------------

const UNIVERSAL_QUERIES = [
  "IG/TikTok: #metaglasses #raybanmeta #povglasses (the authentic drift + hand entry, any subject)",
  "Reddit: r/RayBanMeta raw samples",
];

/** Keyed on workflow id substring — first match wins. Queries are written to be pasted
 *  straight into the platform search box. */
const KEYWORD_QUERIES: Array<{ match: string; queries: string[] }> = [
  {
    match: "wasp",
    queries: [
      "TikTok/IG: #wasptok #waspnestremoval #pestcontrolpov",
      'YouTube: "wasp nest removal POV", "hornet nest removal glove cam", "wasp nest under eave removal no commentary"',
      "Reddit: r/pestcontrol wasp posts (techs post raw phone/GoPro clips)",
    ],
  },
  {
    match: "attic",
    queries: [
      "TikTok/IG: #atticinspection #rodentremoval #pestcontrolpov",
      'YouTube: "attic rodent inspection POV", "attic droppings inspection flashlight", "rodent proofing attic before after"',
      "Reddit: r/pestcontrol attic/rodent threads",
    ],
  },
  {
    match: "spray_indoor",
    queries: [
      "TikTok/IG: #pestcontrol #antproblem #baseboardspray",
      'YouTube: "interior pest treatment POV", "ant trail kitchen baseboard treatment", "crack and crevice treatment"',
    ],
  },
  {
    match: "spray_outdoor",
    queries: [
      "TikTok/IG: #perimeterspray #pestcontrolservice #satisfyingwork",
      'YouTube: "pest control perimeter spray POV", "exterior barrier treatment foundation", "power spray perimeter"',
    ],
  },
  {
    match: "vent",
    queries: [
      "TikTok/IG: #ductcleaning #ventcleaning #satisfyingcleaning",
      'YouTube: "duct cleaning satisfying", "vent cleaning before after", "dryer vent bird nest removal"',
    ],
  },
  {
    match: "day_in_life",
    queries: [
      "TikTok/IG: #dayinthelife #pestcontrol #bluecollartok",
      'YouTube: "day in my life Ray-Ban Meta", "day in the life exterminator", "pest control tech route day"',
      'Reddit: r/RayBanMeta "work day" samples (the strongest source for authentic drift + hand entry)',
    ],
  },
  {
    match: "storytime",
    queries: [
      'TikTok/IG: #storytime + #pestcontrol, #contractorstorytime, "the call we almost skipped" trade storytimes',
      'YouTube: "pest control storytime", "exterminator crazy call story", "crawlspace inspection found" (b-roll style)',
      'Reddit: r/pestcontrol "worst call" threads (often with clips)',
    ],
  },
  {
    match: "indoctrination",
    queries: [
      "TikTok/IG: #hiddenpests #whatsinyourwalls #macrovideo",
      'YouTube: "ants inside wall macro", "termite damage behind drywall", "pest evidence homeowners miss"',
    ],
  },
  {
    match: "propaganda",
    queries: [
      "TikTok/IG: #pestcontrolmarketing #localbusiness b-roll compilations",
      'YouTube: "pest control b-roll", "home service brand b-roll pack"',
    ],
  },
  {
    match: "local_owner_pain",
    queries: [
      "TikTok/IG: #pestcontrolpov #bluecollartok (work-only b-roll, different angles per clip)",
      'YouTube: "pest control POV", "exterminator glove cam", "pest tech treating baseboards"',
      "Reddit: r/pestcontrol raw job clips",
    ],
  },
];

export function buildSearchQueries(wf: Workflow): string[] {
  const hit = KEYWORD_QUERIES.find((k) => wf.id.includes(k.match) || String(wf.subcategory ?? "").includes(k.match));
  const base = hit?.queries ?? [
    `TikTok/IG: #pestcontrol + "${wf.name}"-adjacent tags`,
    `YouTube: "${wf.name} pest control" (raw/no-commentary clips)`,
  ];
  return String(wf.category) === "pov" ? [...base, ...UNIVERSAL_QUERIES] : base;
}

// ---- The reusable AI research prompt ------------------------------------------------------

export function buildResearchPrompt(wf: Workflow): string {
  const isPov = String(wf.category) === "pov";
  const roles = (wf.scenes ?? []).map((s) => s.role).filter(Boolean).slice(0, 3);
  const shotLines = roles.length
    ? roles.map((r, i) => `${i + 1}. ${r}`)
    : ["1. the setup shot", "2. the work/complication shot", "3. the payoff shot"];
  return [
    "You are a short-form content researcher. I make " +
      (isPov ? "first-person Ray-Ban Meta smart-glasses POV" : "documentary b-roll") +
      " content for a pest control brand. I need REAL reference clips of:",
    `${wf.description ?? wf.name}`,
    "",
    "My piece has exactly 3 shots. Find footage that covers each:",
    ...shotLines,
    "",
    "Give me 15-20 specific places to look: exact hashtags, exact YouTube search strings,",
    "exact subreddits or creator accounts. For each, say what I should expect to find and",
    "which shot it covers.",
    "",
    "Before I save any clip, score it 1-5 on each point of this visual checklist:",
    ...RAYBAN_CHECKLIST.map((c, i) => `${i + 1}. ${c}`),
    ...(isPov
      ? []
      : ["(For this format the clips must be third-person documentary b-roll with a muted grade — apply points 6-9 only.)"]),
    "Keep only clips scoring 4+ on at least 7 points (b-roll: 3+ of the 4 applied points).",
    "",
    "Return a table: source | link or exact search | shot covered | expected content | score notes.",
  ].join("\n");
}

// ---- Per-workflow section (markdown) + Slack card ----------------------------------------

function refCount(wf: Workflow): number {
  return wf.reference_media?.length ?? 0;
}

export function buildWorkflowSection(wf: Workflow): string {
  const isPov = String(wf.category) === "pov";
  const rules = (wf.visual_rules ?? []).slice(0, 4);
  const roles = (wf.scenes ?? []).map((s) => s.role).filter(Boolean);
  return [
    `### ${wf.name} — \`${wf.id}\` (${wf.category}${isPov ? "" : ", NOT POV"})  ·  refs ${refCount(wf)}/3`,
    "",
    `**The look:** ${wf.description ?? "(no description yet — set it in the editor)"}`,
    ...(rules.length ? ["", "**House rules:**", ...rules.map((r) => `- ${r}`)] : []),
    "",
    "**Where to look:**",
    ...buildSearchQueries(wf).map((q) => `- ${q}`),
    "",
    "**What to capture:** one screenshot per shot role, at the exact beat that matches it:",
    ...(roles.length ? roles.map((r, i) => `${i + 1}. ${r}`) : ["(no scene roles configured yet)"]),
    isPov
      ? "Screenshot for the POV feel (hand entry, eye-height, drift) as much as the subject."
      : "Screenshot for the GRADE (muted, documentary) as much as the subject.",
    "",
    "**How many:** minimum 3 (unlocks the production gate), target 6-10 from 3+ different creators.",
    "",
    "**How to drop them:** in #content-full open a session (`vektor " +
      wf.vertical_id +
      "` → pick this workflow) and drop the screenshots/clips in the session thread. Each drop counts toward refs N/3 AND grounds every future image this workflow generates.",
    "",
    "**Research prompt (paste into Claude/ChatGPT):**",
    "```",
    buildResearchPrompt(wf),
    "```",
  ].join("\n");
}

export function buildSourcingCard(wf: Workflow): string {
  const isPov = String(wf.category) === "pov";
  const roles = (wf.scenes ?? []).map((s) => s.role).filter(Boolean);
  return [
    `*Sourcing card — ${wf.name}*  (refs ${refCount(wf)}/3)`,
    "",
    `*The look:* ${wf.description ?? "(no description yet)"}`,
    "",
    "*Where to look:*",
    ...buildSearchQueries(wf).map((q) => `• ${q}`),
    "",
    "*Capture one screenshot per shot:*",
    ...(roles.length ? roles.map((r, i) => `${i + 1}. ${r}`) : ["(no scene roles configured)"]),
    isPov ? "_Screenshot for the POV feel (hand entry, eye-height, drift), not just the subject._" : "_Screenshot for the muted documentary grade, not just the subject._",
    "",
    "*Drop them in this workflow's session thread* — minimum 3, target 6-10. Every drop counts toward refs N/3 AND grounds all future images.",
    "Full worksheet + research prompt: docs/WORKSHEET-content-sourcing.md (repo) or `worksheet` for this card again.",
  ].join("\n");
}

// ---- The whole document -------------------------------------------------------------------

export function buildWorksheetMarkdown(workflows: Workflow[], generatedOn: string): string {
  const byVertical = new Map<string, Workflow[]>();
  for (const w of workflows) {
    const list = byVertical.get(w.vertical_id) ?? [];
    list.push(w);
    byVertical.set(w.vertical_id, list);
  }
  const sections: string[] = [
    `# Content Sourcing Worksheet`,
    "",
    `_Generated ${generatedOn} from the live workflow library by \`scripts/generate-sourcing-worksheet.ts\` — re-run it after any workflow change. Do not hand-edit._`,
    "",
    "Goal: every workflow gets its OWN reference library (real clips, not our generated output).",
    "References drop in the workflow's #content-full session thread; they count toward the refs N/3",
    "gate AND visually ground every image the workflow generates from then on.",
    "",
    "## Section 1 — The Meta Ray-Ban POV look (the master spec)",
    "",
    RAYBAN_STYLE_SPEC,
    "",
    "### Inventory table (duplicate rows as you collect)",
    "",
    INVENTORY_TABLE_TEMPLATE,
    "",
    "## Section 2 — Per-workflow sourcing pages",
  ];
  for (const [vertical, list] of byVertical) {
    sections.push("", `---`, "", `## Avatar: ${vertical}`);
    for (const wf of list) sections.push("", buildWorkflowSection(wf), "");
  }
  return sections.join("\n");
}

// ---- Slack command support ------------------------------------------------------------------

/** Resolve a `worksheet <arg>` argument against the library: number (list order), exact name,
 *  or unique substring. Returns the workflow, a disambiguation list, or null (unknown). */
export async function resolveWorksheetArg(
  arg: string | undefined,
  verticalId?: string
): Promise<{ wf?: Workflow; ambiguous?: Workflow[]; all: Workflow[] }> {
  const all = (await listWorkflows(verticalId, { status: "all" })).filter((w) => w.status !== "archived");
  if (!arg) return { all };
  const t = arg.trim().toLowerCase();
  const n = /^\d{1,2}$/.test(t) ? parseInt(t, 10) : null;
  if (n && all[n - 1]) return { wf: all[n - 1], all };
  const exact = all.find((w) => w.name.toLowerCase() === t || w.id === t);
  if (exact) return { wf: exact, all };
  const partial = all.filter((w) => w.name.toLowerCase().includes(t) || w.id.includes(t));
  if (partial.length === 1) return { wf: partial[0], all };
  if (partial.length > 1) return { ambiguous: partial, all };
  return { all };
}

/** Post the sourcing card (or the index when no/ambiguous arg) to a channel/thread. */
export async function postSourcingCard(args: {
  channel: string;
  threadTs?: string;
  arg?: string;
  workflowId?: string;
  verticalId?: string;
}): Promise<void> {
  const post = (text: string) =>
    args.threadTs ? slack.postThreadReply(args.channel, args.threadTs, text) : slack.postMessage(args.channel, text);

  if (args.workflowId && !args.arg) {
    const all = await listWorkflows(undefined, { status: "all" });
    const wf = all.find((w) => w.id === args.workflowId);
    if (wf) {
      await post(buildSourcingCard(wf));
      return;
    }
  }
  const { wf, ambiguous, all } = await resolveWorksheetArg(args.arg, args.verticalId);
  if (wf) {
    await post(buildSourcingCard(wf));
    return;
  }
  if (ambiguous?.length) {
    await post(
      ["That matches more than one workflow:", ...ambiguous.map((w) => `• ${w.name}`), "Reply `worksheet <exact name>`."].join("\n")
    );
    return;
  }
  await post(
    [
      "*Content sourcing worksheet* — reply `worksheet <name or number>` for a workflow's card:",
      ...all.map((w, i) => `${i + 1}. ${w.name}  (${w.vertical_id} · refs ${refCount(w)}/3)`),
      "",
      "Full doc with the Ray-Ban spec + research prompts: docs/WORKSHEET-content-sourcing.md",
    ].join("\n")
  );
}
