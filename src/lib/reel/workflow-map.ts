// Visual inventory (v2) — the workflow library as a mermaid flowchart, rendered to an IMAGE.
//
// Decision (2026-07-02): the `map` / `library` command shows ONLY the workflows (not the whole
// Slack conversation), each labeled with what matters when picking one: how many shots/images it
// needs, total seconds, where on the screen its texts sit, aspect (9:16, or 3:4 for Meta-glasses
// POV), status, and the production gate (references collected / in production). The mermaid is
// rendered via mermaid.ink into a PNG and uploaded to Slack so it is VISIBLE in place; the raw
// fenced block is the fallback when the render fetch fails. Mirrored into
// docs/CONTENT-ENGINE-MAP.md by hand when it changes shape.

import { slack } from "@/lib/slack-bot";
import { listWorkflows, type Workflow } from "@/config/workflows";
import { SEED_VERTICALS } from "@/config/verticals";
import { workflowAspect } from "@/lib/reel/render-spec";

function clean(s: string): string {
  return s.replace(/["[\]{}#|`]/g, " ").replace(/\s+/g, " ").trim() || "untitled";
}

function avatarName(verticalId: string): string {
  return clean(SEED_VERTICALS[verticalId]?.name ?? verticalId);
}

/** The one-line spec label a node carries: shots · seconds · aspect · text positions. */
function workflowLabel(w: Workflow): string {
  const shots = w.render_spec?.shots.length ?? w.render_options?.max_shots ?? w.scenes.length ?? 0;
  const dur = w.render_spec?.duration_seconds;
  const positions = Array.from(
    new Set((w.copy_structure ?? []).map((r) => r.position).filter((p): p is string => Boolean(p)))
  );
  const refs = w.reference_media?.length ?? 0;
  const vars = (w.approved_variations ?? []).length;
  const prod =
    w.production_status === "live"
      ? "LIVE"
      : w.production_status === "in_production"
        ? `IN PRODUCTION ${vars}/4`
        : `refs ${refs}/3`;
  const specBits = [
    shots ? `${shots} shots/images` : "no shots yet",
    dur ? `${dur}s` : "",
    workflowAspect(w),
  ].filter(Boolean);
  const desc = w.description
    ? clean(w.description.length > 80 ? `${w.description.slice(0, 77)}...` : w.description)
    : "";
  const rows = [
    clean(w.name),
    desc,
    specBits.join(" · "),
    positions.length ? `text: ${positions.join(", ")}` : "",
    `${w.status}${w.status === "active" ? "" : " (needs config)"} · ${prod}`,
  ].filter(Boolean);
  return rows.join("<br/>");
}

/**
 * Build a mermaid FLOWCHART of the workflow library: avatar -> category -> one rich node per
 * workflow. Pass a verticalId to scope to one avatar, or omit for all. status defaults to "all"
 * so drafts show up in the map too.
 */
export async function buildWorkflowMermaid(
  verticalId?: string,
  opts: { status?: "active" | "draft" | "all" } = {}
): Promise<string> {
  const workflows = await listWorkflows(verticalId, { status: opts.status ?? "all" });

  const lines: string[] = ["flowchart TD", '  ROOT(["Content Workflows"])'];
  if (!workflows.length) {
    lines.push('  ROOT --> EMPTY["No workflows yet"]');
    return lines.join("\n");
  }

  // avatar -> category -> workflows
  const tree = new Map<string, Map<string, Workflow[]>>();
  for (const w of workflows) {
    const a = w.vertical_id;
    const c = String(w.category || "other");
    if (!tree.has(a)) tree.set(a, new Map());
    const cat = tree.get(a)!;
    if (!cat.has(c)) cat.set(c, []);
    cat.get(c)!.push(w);
  }

  let ai = 0;
  for (const [a, cats] of tree) {
    ai++;
    const aid = `A${ai}`;
    lines.push(`  ROOT --> ${aid}["${avatarName(a)}"]`);
    let ci = 0;
    for (const [c, ws] of cats) {
      ci++;
      const cid = `${aid}C${ci}`;
      lines.push(`  ${aid} --> ${cid}["${clean(c)}"]`);
      ws.forEach((w, wi) => {
        const wid = `${cid}W${wi + 1}`;
        lines.push(`  ${cid} --> ${wid}["${workflowLabel(w)}"]`);
        if (w.production_status === "live") {
          lines.push(`  style ${wid} fill:#0d4d2b,stroke:#00C9A7,stroke-width:2px`);
        } else if (w.production_status === "in_production") {
          lines.push(`  style ${wid} fill:#14331a,stroke:#3a8a4a`);
        } else if (w.status !== "active") {
          lines.push(`  style ${wid} fill:#33261a,stroke:#8a6a3a`);
        }
      });
    }
  }
  return lines.join("\n");
}

/**
 * A single workflow's structure as a mermaid flowchart: copy roles (label + timing + position)
 * -> the shots they land on -> the production gates chain. Rendered by the dashboard editor
 * (mermaid.ink img, same as the library map) so the whole recipe is visible at a glance.
 */
export function buildWorkflowDetailMermaid(w: Workflow): string {
  const lines: string[] = ["flowchart LR"];
  const shots = w.render_spec?.shots ?? [];
  const roles = w.copy_structure ?? [];

  lines.push(`  WF["${workflowLabel(w)}"]`);

  if (shots.length) {
    for (const s of [...shots].sort((a, b) => a.i - b.i)) {
      const scene = w.scenes[s.i - 1];
      const label = [`Shot ${s.i}`, `${s.start}s to ${s.end}s`, scene?.role ? clean(scene.role) : ""]
        .filter(Boolean)
        .join("<br/>");
      lines.push(`  WF --> S${s.i}["${label}"]`);
    }
  } else if (w.scenes.length) {
    w.scenes.forEach((scene, i) => {
      lines.push(`  WF --> S${i + 1}["Shot ${i + 1}<br/>${clean(scene.role)}"]`);
    });
  }

  roles.forEach((r, i) => {
    const label = [
      clean(r.label),
      r.at_second !== undefined ? `${r.at_second}s${r.out_second !== undefined ? ` to ${r.out_second}s` : ""}` : "",
      r.position ? clean(r.position) : "",
    ]
      .filter(Boolean)
      .join("<br/>");
    const rid = `R${i + 1}`;
    lines.push(`  ${rid}(["${label}"])`);
    lines.push(r.shot ? `  ${rid} --> S${r.shot}` : `  ${rid} --> WF`);
  });

  const refs = w.reference_media?.length ?? 0;
  const vars = (w.approved_variations ?? []).length;
  lines.push(`  WF --> G1["refs ${refs}/3"]`);
  lines.push(`  G1 --> G2["in production"]`);
  lines.push(`  G2 --> G3["variations ${vars}/4"]`);
  lines.push(`  G3 --> G4["LIVE"]`);
  if (w.production_status === "live") lines.push("  style G4 fill:#0d4d2b,stroke:#00C9A7,stroke-width:2px");
  else if (w.production_status === "in_production") lines.push("  style G2 fill:#14331a,stroke:#3a8a4a");
  else if (refs > 0) lines.push("  style G1 fill:#33261a,stroke:#8a6a3a");

  return lines.join("\n");
}

/** Render a mermaid block to a PNG via mermaid.ink. Returns null on any failure. */
async function renderMermaidPng(mermaid: string): Promise<Buffer | null> {
  try {
    const encoded = Buffer.from(mermaid, "utf8").toString("base64url");
    const res = await fetch(`https://mermaid.ink/img/${encoded}?type=png&bgColor=1a1a2a`, {
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    return buf.length > 0 ? buf : null;
  } catch (e) {
    console.error("[workflow-map] mermaid.ink render failed:", (e as Error).message);
    return null;
  }
}

/** Post the library map to Slack as an image (mermaid.ink), falling back to the fenced mermaid
 *  block when the render fails. `map` = all avatars; `map <avatar>` scoped. */
export async function postWorkflowMap(channel: string, verticalId?: string): Promise<void> {
  const mermaid = await buildWorkflowMermaid(verticalId, { status: "all" });
  const scope = verticalId ? avatarName(verticalId) : "all avatars";
  const png = await renderMermaidPng(mermaid);
  if (png) {
    await slack.uploadFile(channel, `workflow-map-${verticalId ?? "all"}.png`, png, "image/png");
    return;
  }
  await slack.postMessage(
    channel,
    [
      `*Workflow inventory* (${scope}). Image render failed; paste into a mermaid viewer:`,
      "```",
      mermaid,
      "```",
    ].join("\n")
  );
}

/** Wrap the mermaid map for a Slack message (fenced so it is readable even unrendered). */
export async function buildWorkflowMapForSlack(verticalId?: string): Promise<string> {
  const mermaid = await buildWorkflowMermaid(verticalId, { status: "all" });
  const scope = verticalId ? avatarName(verticalId) : "all avatars";
  return [
    `*Workflow inventory* (${scope}). Paste into a mermaid viewer or GitHub to see the map:`,
    "```",
    mermaid,
    "```",
  ].join("\n");
}
