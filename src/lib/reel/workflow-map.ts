// Visual inventory (v1) — render the workflow library as a Mermaid mind-map.
//
// Decision (2026-07-03): keep the library simple as mermaid for now (no dashboard page yet).
// Grouped avatar -> category -> subcategory -> workflow name (status). Post the block from
// Slack (`map` / `library` keyword) and mirror it into docs/CONTENT-ENGINE-MAP.md. Because
// mermaid mind-map labels choke on parens/brackets/colons, all labels are sanitized.

import { listWorkflows, type Workflow } from "@/config/workflows";
import { SEED_VERTICALS } from "@/config/verticals";

function clean(s: string): string {
  return s.replace(/[()[\]{}:;#|]/g, " ").replace(/\s+/g, " ").trim() || "untitled";
}

function avatarName(verticalId: string): string {
  return clean(SEED_VERTICALS[verticalId]?.name ?? verticalId);
}

/**
 * Build a Mermaid mind-map string for the workflow inventory. Pass a verticalId to scope to one
 * avatar, or omit for all. status defaults to "all" so drafts show up in the map too.
 */
export async function buildWorkflowMermaid(
  verticalId?: string,
  opts: { status?: "active" | "draft" | "all" } = {}
): Promise<string> {
  const workflows = await listWorkflows(verticalId, { status: opts.status ?? "all" });

  // avatar -> category -> subcategory -> workflows
  const tree = new Map<string, Map<string, Map<string, Workflow[]>>>();
  for (const w of workflows) {
    const a = w.vertical_id;
    const c = String(w.category || "other");
    const sub = clean(w.subcategory || "general");
    if (!tree.has(a)) tree.set(a, new Map());
    const cat = tree.get(a)!;
    if (!cat.has(c)) cat.set(c, new Map());
    const subs = cat.get(c)!;
    if (!subs.has(sub)) subs.set(sub, []);
    subs.get(sub)!.push(w);
  }

  const lines: string[] = ["mindmap", "  root((Content Workflows))"];
  if (tree.size === 0) {
    lines.push("    No workflows yet");
    return lines.join("\n");
  }

  for (const [a, cats] of tree) {
    lines.push(`    ${avatarName(a)}`);
    for (const [c, subs] of cats) {
      lines.push(`      ${clean(c)}`);
      for (const [sub, ws] of subs) {
        lines.push(`        ${sub}`);
        for (const w of ws) {
          const tag = w.status === "active" ? "active" : `${w.status} needs config`;
          lines.push(`          ${clean(w.name)} ${tag}`);
        }
      }
    }
  }
  return lines.join("\n");
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
