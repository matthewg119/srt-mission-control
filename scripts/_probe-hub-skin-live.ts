// The live half of the hub skin: does the column exist, does a write round-trip, and does the
// renderer actually produce different HTML for a different template.
//
//   bunx tsx --env-file=.env.local scripts/_probe-hub-skin-live.ts
//   bunx tsx --env-file=.env.local scripts/_probe-hub-skin-live.ts "Some Client Name"
//
// ‼️ IT RESTORES WHATEVER IT FOUND, IN A finally. It writes to a REAL client row, because the
// thing worth proving is that this works against the real schema and the real renderer, not
// against a fixture. A probe that leaves a template applied to a live client is a probe that
// changed a real business's website to prove it could.
//
// It is deliberately separate from _probe-hub-skin.ts, which is pure and needs no key. Same
// split as _probe-gbp-audit.ts and _probe-gbp-live.ts.

import React from "react";
import { supabaseAdmin } from "../src/lib/db";
import { HubIndexBody } from "../src/components/hub/hub-bodies";
import { loadClientForPreview } from "../src/lib/hub/resolve";
import { readSkin, skinClass, skinStyle } from "../src/lib/hub/skin";
import { readTheme } from "../src/lib/hub/theme";
import {
  loadSkin,
  writeSkin,
  isSkinStep,
  designPreviewUrl,
  handleSkinThreadReply,
} from "../src/lib/clients/hub-skin";

// tsconfig sets jsx:"preserve" for Next, so tsx compiles the components with the classic
// transform and expects React in scope. Only true for a script rendering them by hand.
(globalThis as unknown as { React: unknown }).React = React;

let pass = 0;
let fail = 0;

function ok(label: string, cond: boolean, detail?: string): void {
  if (cond) {
    pass++;
    console.log(`  ok    ${label}`);
  } else {
    fail++;
    console.log(`  FAIL  ${label}${detail ? ` - ${detail}` : ""}`);
  }
}

async function themeOf(clientId: string) {
  const { data } = await supabaseAdmin
    .from("clients")
    .select("theme")
    .eq("id", clientId)
    .maybeSingle();
  return readTheme((data as { theme?: unknown } | null)?.theme);
}

async function main(): Promise<void> {
  const wanted = process.argv[2] ?? null;

  console.log("\nThe column");

  const probe = await supabaseAdmin.from("clients").select("id, hub_skin").limit(1);
  if (probe.error) {
    console.log(`  FAIL  clients.hub_skin is readable - ${probe.error.message}`);
    console.log("\nThe migration has not run. docs/2026-09-02-hub-skin.sql");
    process.exit(1);
  }
  ok("clients.hub_skin is readable", true);

  const { data: pick, error: pickErr } = await supabaseAdmin
    .from("clients")
    .select("id, legal_name, dba_name")
    .order("created_at", { ascending: false })
    .limit(50);

  if (pickErr || !pick?.length) {
    console.log(`  FAIL  could not list clients - ${pickErr?.message ?? "none found"}`);
    process.exit(1);
  }

  const row =
    (wanted
      ? pick.find((c) =>
          `${c.dba_name ?? ""} ${c.legal_name ?? ""}`.toLowerCase().includes(wanted.toLowerCase())
        )
      : pick[0]) ?? pick[0];

  const clientId = row.id as string;
  const name = (row.dba_name as string | null) || (row.legal_name as string) || clientId;
  console.log(`  using: ${name} (${clientId})`);

  // ‼️ THE REAL CHECK IS THE HOT-PATH SELECT, NOT THE COLUMN. resolve.ts names hub_skin in the
  // select every hub request goes through, and PostgREST fails the WHOLE select on one unknown
  // name - so a half-applied migration shows up here and nowhere else.
  console.log("\nThe hot-path select");
  const live = await loadClientForPreview(clientId);
  ok("resolve.ts's select survives (the live host path)", live !== null);
  const pending0 = await loadClientForPreview(clientId, { pending: true });
  ok("the internal preview loads with pending: true", pending0 !== null);

  console.log("\nWrite, read, render");

  const before = await loadSkin(clientId);
  const beforeTheme = await themeOf(clientId);
  console.log(`  will restore: template=${before.template} source=${before.source}`);

  try {
    const res = await writeSkin(
      clientId,
      { ...readSkin({ template: "bold" }), source: "template", sourceNote: "live probe" },
      "the live probe"
    );
    ok("writeSkin succeeds against the real row", res.ok, res.error);

    const after = await loadSkin(clientId);
    ok("the template read back is what was written", after.template === "bold", after.template);

    // ‼️ THE ONE THAT MAKES THE LOOP WORK. Every skin write clears theme.confirmedAt, which is
    // what puts hub_preview's [Done] back in front of a person.
    const themeAfter = await themeOf(clientId);
    ok("the write un-confirmed the theme", themeAfter.confirmedAt === null);
    ok("the theme's own four fields survived", themeAfter.accent === beforeTheme.accent);

    const seenPending = await loadClientForPreview(clientId, { pending: true });
    const seenLive = await loadClientForPreview(clientId);
    ok("the internal preview renders the unconfirmed skin", seenPending?.skin?.template === "bold");
    ok("the client-facing path refuses it until confirmed", seenLive?.skin === null);

    // ── The renderer ────────────────────────────────────────────────────────
    const { renderToStaticMarkup } = await import("react-dom/server");
    const pages = [
      { id: "1", slug: "q", title: "A question with an answer", question: "a question" },
    ];

    const html = (template: string): string => {
      const skin = readSkin({ template });
      const c = { ...(seenPending as NonNullable<typeof seenPending>), skin };
      const body = renderToStaticMarkup(
        React.createElement(HubIndexBody, { client: c, host: "learn.example.com", pages })
      );
      const style = Object.entries(skinStyle(skin) as Record<string, string>)
        .map(([k, v]) => `${k}: ${v}`)
        .join("; ");
      return `<div class="hub-root ${skinClass(skin)}" style="${style}">${body}</div>`;
    };

    const doc = html("document");
    const bold = html("bold");
    const clinic = html("clinic");

    console.log("\nThe renderer");
    ok("the template lands in the class attribute", bold.includes("hub-tpl-bold"));
    ok("two templates produce different HTML", doc !== bold);
    ok("three templates produce three different HTML", new Set([doc, bold, clinic]).size === 3);

    // ‼️ THE MARKUP IS THE PRODUCT. Whatever a skin does, the JSON-LD and the masthead have to
    // survive it, or the hub stops being worth publishing.
    for (const [label, out] of [
      ["document", doc],
      ["bold", bold],
      ["clinic", clinic],
    ] as const) {
      ok(`${label} still emits its JSON-LD`, out.includes("application/ld+json"));
      ok(`${label} still emits the masthead header`, out.includes('<header class="hub-head">'));
      ok(`${label} still emits the NAP block`, out.includes('class="hub-nap"'));
      ok(`${label} still emits exactly one h1`, (out.match(/<h1/g) ?? []).length === 1);
    }

    // ── The Slack grammar, against this client ──────────────────────────────
    console.log("\nThe thread grammar");
    ok("step 15 is a design step", isSkinStep("hub_preview"));
    ok("step 16 is a design step", isSkinStep("review_tool_preview"));
    ok("an unrelated step is not", !isSkinStep("avatar_harvest"));

    const menu = await handleSkinThreadReply({
      clientId,
      stepKey: "hub_preview",
      text: "template",
      by: "the live probe",
    });
    ok("`template` returns the menu", Boolean(menu?.message.includes("template clinic")));
    ok(
      "the menu links the internal preview",
      Boolean(menu?.message.includes(designPreviewUrl(clientId)))
    );

    const applied = await handleSkinThreadReply({
      clientId,
      stepKey: "hub_preview",
      text: "template editorial",
      by: "the live probe",
    });
    ok("`template editorial` applies it", Boolean(applied?.message.includes("Editorial")));
    ok("and it is what the row now says", (await loadSkin(clientId)).template === "editorial");

    const wrong = await handleSkinThreadReply({
      clientId,
      stepKey: "hub_preview",
      text: "template brutalist",
      by: "the live probe",
    });
    ok(
      "an unknown template is refused, not applied",
      Boolean(wrong?.message.includes("no template called"))
    );
    ok("and the row is unchanged", (await loadSkin(clientId)).template === "editorial");

    const elsewhere = await handleSkinThreadReply({
      clientId,
      stepKey: "avatar_harvest",
      text: "template clinic",
      by: "the live probe",
    });
    ok("the same words in another step fall through", elsewhere === null);

    const prose = await handleSkinThreadReply({
      clientId,
      stepKey: "hub_preview",
      text: "the editorial template looks better to me",
      by: "the live probe",
    });
    ok("a sentence that merely mentions a template falls through", prose === null);

    const reset = await handleSkinThreadReply({
      clientId,
      stepKey: "hub_preview",
      text: "skin reset",
      by: "the live probe",
    });
    ok("`skin reset` goes back to Document", Boolean(reset));
    ok("and the row says so", (await loadSkin(clientId)).template === "document");
  } finally {
    // ‼️ RESTORE, ALWAYS, AND BOTH OBJECTS. writeSkin cleared confirmedAt, so putting only the
    // skin back would leave a real client's hub rendering SRT's defaults on their own domain.
    await supabaseAdmin
      .from("clients")
      .update({ hub_skin: before.source === "default" ? null : before, theme: beforeTheme })
      .eq("id", clientId);

    const restoredSkin = await loadSkin(clientId);
    const restoredTheme = await themeOf(clientId);
    console.log(
      `\n  restored: template=${restoredSkin.template} source=${restoredSkin.source} ` +
        `themeConfirmedAt=${restoredTheme.confirmedAt ?? "null"}`
    );
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
