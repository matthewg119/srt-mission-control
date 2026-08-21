// One page, as a self-contained HTML file, posted into the client's ops thread.
//
// WHY IT IS A FILE AND NOT A LINK. The preview route already exists and is behind the
// dashboard session, which makes it exactly the wrong thing to open on a screen share: it
// asks you to log in to Mission Control in front of the client, and the page around it says
// Mission Control. A downloaded file opens in a browser tab that is nothing but their page,
// on their colours, with their name on it.
//
// ‼️ IT RENDERS THE PRODUCTION COMPONENTS. HubAnswerBody is imported, never reimplemented.
// hub-bodies.tsx's own header says why: "a preview that renders its own copy of the markup
// is a demo mode with extra steps, and it drifts silently, because nobody looks at a preview
// again after the call it was built for." Same argument applies one level up, so hub.css is
// READ OFF DISK at request time rather than copied into a template literal here.
//
// ‼️ IT PUBLISHES NOTHING. A file in Slack is not a page on a domain. The Day-0 wall on
// page_publish is untouched and this never calls setPublished.

import fs from "node:fs/promises";
import path from "node:path";
import React from "react";
import { supabaseAdmin } from "@/lib/db";
import { slack } from "@/lib/slack-bot";
import { HubAnswerBody } from "@/components/hub/hub-bodies";
import { activeTheme, readTheme, themeStyle } from "@/lib/hub/theme";
import { hostsFor } from "@/lib/hub/vercel-domains";
import type { HubClient } from "@/lib/hub/resolve";

export interface PreviewPage {
  slug: string;
  title: string;
  question: string;
  answerMd: string;
  publishedAt: string | null;
}

/**
 * hub.css, read from the file it is actually served from.
 *
 * Cached per process. A copy pasted into this module would be a second stylesheet that
 * looks right on the day it is written and is wrong by the next commit, which is the exact
 * failure hub-bodies.tsx exists to prevent for the markup.
 */
let cachedCss: string | null = null;
async function hubCss(): Promise<string> {
  if (cachedCss !== null) return cachedCss;
  try {
    cachedCss = await fs.readFile(
      path.join(process.cwd(), "src", "app", "hub", "[host]", "hub.css"),
      "utf8"
    );
  } catch {
    // Never fatal. An unstyled preview still shows the words, the headings and the shape,
    // and saying "the CSS could not be read" beats posting nothing at all.
    cachedCss = "";
  }
  return cachedCss;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** The four theme custom properties, as an inline style string. */
function styleAttr(theme: ReturnType<typeof activeTheme>): string {
  const style = themeStyle(theme) as Record<string, string>;
  const parts = Object.entries(style).map(([k, v]) => `${k}: ${v}`);
  return parts.length ? ` style="${escapeHtml(parts.join("; "))}"` : "";
}

interface Loaded {
  client: HubClient;
  host: string;
  themed: boolean;
  channel: string;
  threadTs: string;
}

async function load(clientId: string): Promise<Loaded | { error: string }> {
  const channel = process.env.SLACK_CLIENT_ONBOARDING_CHANNEL;
  if (!channel) return { error: "SLACK_CLIENT_ONBOARDING_CHANNEL is not set." };

  const { data } = await supabaseAdmin
    .from("clients")
    .select(
      "id, legal_name, dba_name, domain, subdomain, city, state, address_line1, address_line2, postal_code, phone, email, website, hours, language, theme, ops_thread_ts, review_destination_primary, review_workflow"
    )
    .eq("id", clientId)
    .maybeSingle();

  if (!data) return { error: "That client could not be read." };
  if (!data.ops_thread_ts) return { error: "This client has no ops thread to post into." };
  if (!data.domain) return { error: "No domain on file, so there is no hostname to preview." };

  const stored = readTheme(data.theme);
  const theme = activeTheme(stored);
  const hub = hostsFor({
    subdomain: (data.subdomain as string | null) ?? null,
    domain: data.domain as string,
  }).find((h) => h.kind === "hub");

  // Every field, mapped rather than cast. A partial object behind an `as HubClient` renders
  // a preview that is missing the NAP block the live page shows, which is the one thing on
  // this page a client reads closely.
  const client: HubClient = {
    id: data.id as string,
    displayName: ((data.dba_name || data.legal_name) as string) ?? "",
    legalName: (data.legal_name as string) ?? "",
    domain: (data.domain as string | null) ?? null,
    website: (data.website as string | null) ?? null,
    addressLine1: (data.address_line1 as string | null) ?? null,
    addressLine2: (data.address_line2 as string | null) ?? null,
    city: (data.city as string | null) ?? null,
    state: (data.state as string | null) ?? null,
    postalCode: (data.postal_code as string | null) ?? null,
    phone: (data.phone as string | null) ?? null,
    email: (data.email as string | null) ?? null,
    hours: data.hours ?? null,
    language: (data.language as string | null) ?? "en",
    reviewDestinationPrimary: (data.review_destination_primary as string | null) ?? null,
    reviewWorkflow: (data.review_workflow as Record<string, unknown> | null) ?? null,
    theme,
  };

  return {
    client,
    host: hub?.host ?? (data.domain as string),
    themed: theme !== null,
    channel,
    threadTs: data.ops_thread_ts as string,
  };
}

/**
 * Build the standalone file. Exported so it can be rendered without posting.
 */
export async function renderPagePreview(
  clientId: string,
  page: PreviewPage
): Promise<{ ok: true; html: string; host: string; themed: boolean } | { ok: false; error: string }> {
  const loaded = await load(clientId);
  if ("error" in loaded) return { ok: false, error: loaded.error };

  // ‼️ IMPORTED HERE, NOT AT THE TOP OF THE FILE. Next 14 refuses a static react-dom/server
  // import anywhere in the RSC graph ("You're importing a component that imports
  // react-dom/server"), and this module is reached from a route handler. The rule is aimed at
  // components rendering themselves to a string on the server; rendering a page to a FILE is
  // the legitimate case it does not have an exception for, so the import goes inside.
  const { renderToStaticMarkup } = await import("react-dom/server");

  const body = renderToStaticMarkup(
    React.createElement(HubAnswerBody, {
      client: loaded.client,
      host: loaded.host,
      page,
    })
  );

  const css = await hubCss();
  const title = `${page.title} · ${loaded.client.displayName}`;

  // The banner is the one thing here the live page does not have, and it is deliberate:
  // this file is going to be opened on a screen share in front of a paying client, so it
  // has to be impossible to mistake for something already published. It sits OUTSIDE
  // .hub-root so it cannot inherit or disturb the client's theme.
  const banner = [
    `<div class="srt-banner">`,
    `<strong>Preview.</strong> This page is not live yet. It goes up at `,
    `<code>${escapeHtml(`${loaded.host}/${page.slug}`)}</code> when it is published.`,
    loaded.themed ? "" : ` <em>The theme is not confirmed, so these are SRT's colours, not theirs.</em>`,
    `</div>`,
  ].join("");

  const html = `<!doctype html>
<html lang="${escapeHtml(loaded.client.language ?? "en")}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>${escapeHtml(title)}</title>
<style>
.srt-banner{font:14px/1.5 system-ui,sans-serif;background:#fff6e5;color:#7a4b00;border-bottom:1px solid #f0d9ac;padding:10px 16px}
.srt-banner code{background:#00000010;padding:1px 5px;border-radius:3px}
${css}
</style>
</head>
<body>
${banner}
<div class="hub-root" lang="${escapeHtml(loaded.client.language ?? "en")}"${styleAttr(loaded.client.theme)}>
<div class="hub-wrap">${body}</div>
</div>
</body>
</html>`;

  return { ok: true, html, host: loaded.host, themed: loaded.themed };
}

/**
 * Render it and drop it in the client's ops thread.
 *
 * Best effort by contract: every caller is a route that has already done the real work, and
 * a Slack hiccup must never turn a saved page into a failed save. Callers `.catch(() => {})`
 * this and the return value says what happened for the log.
 */
export async function postPagePreview(
  clientId: string,
  page: PreviewPage,
  opts: { saved: boolean }
): Promise<{ ok: boolean; error?: string }> {
  const loaded = await load(clientId);
  if ("error" in loaded) return { ok: false, error: loaded.error };

  const rendered = await renderPagePreview(clientId, page);
  if (!rendered.ok) return { ok: false, error: rendered.error };

  const where = `${rendered.host}/${page.slug}`;
  const lines = [
    `:page_facing_up: *Preview: ${page.title}*`,
    opts.saved
      ? `Saved as a draft. It goes live at \`${where}\` when you publish it from the client board.`
      : `Drafted, *not saved*. It is sitting in the form on the client board until you press Save.`,
    "",
    `Open the file to see the page exactly as it will render, on their colours. That is the`,
    `one to screen share on the call.`,
  ];

  if (!rendered.themed) {
    lines.push("");
    lines.push(
      ":warning: The theme is not confirmed, so this renders in SRT's colours rather than theirs. " +
        "Confirm it on the client board before you show this to anybody."
    );
  }

  // Text first, file second: a file upload with a comment renders the comment small and
  // under the attachment, which is the wrong way round for something read on a call.
  await slack.postThreadReply(loaded.channel, loaded.threadTs, lines.join("\n")).catch(() => {});

  const res = await slack
    .uploadFile(
      loaded.channel,
      `${page.slug || "page"}-preview.html`,
      Buffer.from(rendered.html, "utf8"),
      "text/html",
      loaded.threadTs
    )
    .catch((e) => ({ ok: false, error: (e as Error).message }));

  if (!res || res.ok !== true) {
    return { ok: false, error: String((res as { error?: string })?.error ?? "upload failed") };
  }

  return { ok: true };
}
