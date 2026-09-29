// The pasted marketing site: what is stored, and what is taken out on the way in.
//
// ‼️ SANITISING HAPPENS ON WRITE. THERE IS ONE DOOR AND THIS IS IT.
// Not at render time, for the reason page-evidence.ts gives about isFirstParty(): a second copy
// of a rule is how two surfaces quietly start disagreeing. storeSitePage() is the only writer,
// the column holds what was cleaned, and the renderer trusts the column.
//
// WHAT THE THREAT ACTUALLY IS, STATED HONESTLY.
// The person pasting is an authenticated operator pasting a page they had built themselves. This
// is not a visitor-input XSS boundary and pretending otherwise would be theatre. The real risks
// are duller and likelier:
//   - a generated page arriving with an analytics snippet, a font loader or a chat widget nobody
//     asked for, now running on a client's own domain under the client's name;
//   - a <form action> pointing at wherever the page was mocked up, quietly posting a client's
//     leads to somebody else's endpoint;
//   - a page that ships its own JavaScript next to the concierge iframe, on a domain we own,
//     where anything it does is attributable to us.
// None of those needs an attacker. All of them are silent.
//
// ‼️ THE LIBRARY DOES THE PARSING, NOT A REGULAR EXPRESSION.
// A hand-rolled HTML stripper that looks right is the single most reliably wrong thing in this
// category: HTML is not a regular language, and `<scr<script>ipt>`, attribute-splitting and
// entity-encoded handlers all defeat the obvious implementation. sanitize-html tokenises
// properly. It is a dependency worth having rather than a function worth writing.
//
// THE ALLOWLIST IS DELIBERATELY WIDE. This has to keep a real designed page looking like itself,
// so structure, tables, media, SVG, inline style attributes and <style> blocks all survive. What
// does not survive is behaviour: script, event handlers, and anything that sends data somewhere
// we did not choose.

import sanitizeHtml from "sanitize-html";
import { supabaseAdmin } from "@/lib/db";

export interface SitePage {
  id: string;
  clientId: string;
  path: string;
  title: string;
  html: string;
  metaDescription: string | null;
  navLabel: string | null;
  navOrder: number | null;
  status: "draft" | "published" | "archived";
  publishedAt: string | null;
  sanitizedNote: string | null;
}

const COLUMNS =
  "id, client_id, path, title, html, meta_description, nav_label, nav_order, status, " +
  "published_at, sanitized_note";

function toPage(row: Record<string, unknown>): SitePage {
  return {
    id: row.id as string,
    clientId: row.client_id as string,
    path: row.path as string,
    title: (row.title as string) ?? "",
    html: (row.html as string) ?? "",
    metaDescription: (row.meta_description as string | null) ?? null,
    navLabel: (row.nav_label as string | null) ?? null,
    navOrder: (row.nav_order as number | null) ?? null,
    status: (row.status as SitePage["status"]) ?? "draft",
    publishedAt: (row.published_at as string | null) ?? null,
    sanitizedNote: (row.sanitized_note as string | null) ?? null,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Paths
// ─────────────────────────────────────────────────────────────────────────────

/**
 * ‼️ THE SAME SHAPE AS HUB_SLUG IN src/middleware.ts, AND THE DATABASE SAYS IT A THIRD TIME.
 * One segment, no slash, no dot. A path that cannot be served must not be storable: a row that
 * exists and 404s is an afternoon somebody spends looking for a page that was always there.
 */
const SITE_PATH = /^\/[a-z0-9](?:[a-z0-9-]{0,78}[a-z0-9])?$/;

/**
 * Paths a site page may not claim.
 *
 * `/answers` because a static Next segment beats a dynamic one, so that is where this client's
 * answer pages are published and a site page there would render as an unexplainable 404.
 *
 * `/api` because it is shape-legal here and would be confusing rather than dangerous: the
 * middleware allowlist refuses anything starting `/api/`, but the bare word has no slash and so
 * passes HUB_SLUG. It would serve a client's marketing page at their own /api, which nobody
 * intends and somebody would eventually debug.
 */
const RESERVED_PATHS = new Set(["/answers", "/api"]);

export function normalizeSitePath(input: string): { ok: true; path: string } | { ok: false; error: string } {
  let p = (input ?? "").trim().toLowerCase();
  if (!p || p === "/" || p === "/index" || p === "index") return { ok: true, path: "/" };

  if (!p.startsWith("/")) p = `/${p}`;
  p = p.replace(/\/+$/, "");
  if (p === "") return { ok: true, path: "/" };

  if (RESERVED_PATHS.has(p)) {
    return {
      ok: false,
      error: `${p} is reserved: it is where this client's answer pages are published. Pick another path.`,
    };
  }
  if (!SITE_PATH.test(p)) {
    return {
      ok: false,
      error:
        `"${input}" is not a usable path. One segment, lowercase letters, numbers and hyphens, ` +
        "for example /about or /water-damage. Nested paths are not served on a client hostname.",
    };
  }
  return { ok: true, path: p };
}

// ─────────────────────────────────────────────────────────────────────────────
// Sanitising
// ─────────────────────────────────────────────────────────────────────────────

const ALLOWED_TAGS = [
  ...sanitizeHtml.defaults.allowedTags,
  "img", "picture", "source", "figure", "figcaption",
  "section", "article", "aside", "header", "footer", "nav", "main",
  "h1", "h2", "h3", "h4", "h5", "h6",
  "span", "div", "small", "mark", "time", "address", "hgroup",
  "button", "label", "form", "input", "textarea", "select", "option", "fieldset", "legend",
  "video", "audio", "track",
  "style",
  "svg", "path", "g", "circle", "rect", "line", "polyline", "polygon", "ellipse", "defs",
  "linearGradient", "radialGradient", "stop", "use", "symbol", "title", "desc", "clipPath", "mask",
];

/**
 * ‼️ `form` AND `input` ARE ALLOWED BUT `action` IS NOT.
 * A pasted page usually carries a contact form, and dropping it silently would remove the thing
 * the page exists for. Keeping the markup while refusing the destination means the form renders,
 * is visibly inert, and gets wired to something real on purpose rather than posting a client's
 * leads to whatever endpoint the mock-up happened to name.
 */
const ALLOWED_ATTRS: Record<string, string[]> = {
  "*": ["class", "id", "style", "title", "role", "lang", "dir", "hidden", "tabindex", "aria-*", "data-*"],
  a: ["href", "name", "target", "rel", "download"],
  img: ["src", "srcset", "sizes", "alt", "width", "height", "loading", "decoding"],
  source: ["src", "srcset", "sizes", "type", "media"],
  video: ["src", "poster", "width", "height", "controls", "muted", "loop", "playsinline", "preload"],
  audio: ["src", "controls", "loop", "preload"],
  track: ["src", "kind", "srclang", "label", "default"],
  input: ["type", "name", "placeholder", "value", "required", "checked", "disabled", "readonly", "min", "max", "step", "autocomplete"],
  textarea: ["name", "placeholder", "rows", "cols", "required", "disabled", "readonly"],
  select: ["name", "required", "disabled", "multiple"],
  option: ["value", "selected", "disabled"],
  button: ["type", "disabled", "name", "value"],
  form: ["method"],
  th: ["colspan", "rowspan", "scope"],
  td: ["colspan", "rowspan"],
  svg: ["xmlns", "viewbox", "viewBox", "width", "height", "fill", "stroke", "preserveaspectratio", "preserveAspectRatio"],
  path: ["d", "fill", "stroke", "stroke-width", "stroke-linecap", "stroke-linejoin", "fill-rule", "clip-rule", "opacity", "transform"],
  g: ["fill", "stroke", "transform", "opacity", "clip-path", "mask"],
  circle: ["cx", "cy", "r", "fill", "stroke", "stroke-width", "opacity", "transform"],
  ellipse: ["cx", "cy", "rx", "ry", "fill", "stroke", "stroke-width", "opacity", "transform"],
  rect: ["x", "y", "width", "height", "rx", "ry", "fill", "stroke", "stroke-width", "opacity", "transform"],
  line: ["x1", "y1", "x2", "y2", "stroke", "stroke-width", "stroke-linecap", "opacity", "transform"],
  polyline: ["points", "fill", "stroke", "stroke-width", "opacity", "transform"],
  polygon: ["points", "fill", "stroke", "stroke-width", "opacity", "transform"],
  stop: ["offset", "stop-color", "stop-opacity"],
  linearGradient: ["id", "x1", "y1", "x2", "y2", "gradientUnits", "gradienttransform", "gradientTransform"],
  radialGradient: ["id", "cx", "cy", "r", "fx", "fy", "gradientUnits"],
  use: ["href", "x", "y", "width", "height"],
  symbol: ["id", "viewBox", "viewbox"],
  clipPath: ["id"],
  mask: ["id"],
  time: ["datetime"],
};

export interface SanitizeReport {
  html: string;
  /** What was taken out, in the words the panel shows. Empty when nothing was. */
  removed: string[];
}

/**
 * Clean one pasted page and report what changed.
 *
 * ‼️ IT REPORTS RATHER THAN FAILING. A page that quietly lost its analytics tag is a page whose
 * owner believes analytics is running. The note is stored on the row and rendered next to the
 * page so the removal is a visible fact rather than a silent one.
 */
export function sanitizeSiteHtml(input: string): SanitizeReport {
  const raw = input ?? "";
  const removed: string[] = [];

  // Counted BEFORE sanitising, because afterwards there is nothing left to count. These are
  // detections for the report only: the sanitiser below is what actually removes them, and it is
  // the thing that has to be correct.
  const scripts = (raw.match(/<script\b/gi) ?? []).length;
  if (scripts) removed.push(`${scripts} <script> block${scripts === 1 ? "" : "s"}`);

  const handlers = new Set((raw.match(/\son[a-z]+\s*=/gi) ?? []).map((h) => h.trim().replace(/\s*=$/, "")));
  if (handlers.size) removed.push(`inline event handlers (${[...handlers].slice(0, 6).join(", ")})`);

  const iframes = (raw.match(/<iframe\b/gi) ?? []).length;
  if (iframes) {
    removed.push(
      `${iframes} <iframe>${iframes === 1 ? "" : "s"}. The concierge mounts itself; it does not need one here`
    );
  }

  const actions = (raw.match(/<form\b[^>]*\saction\s*=\s*["'][^"']*["']/gi) ?? []).length;
  if (actions) {
    removed.push(
      `${actions} form action${actions === 1 ? "" : "s"}. The form still renders and is inert until it is wired up on purpose`
    );
  }

  const links = (raw.match(/<link\b/gi) ?? []).length;
  if (links) removed.push(`${links} <link> tag${links === 1 ? "" : "s"}. Inline the CSS instead`);

  const html = sanitizeHtml(raw, {
    allowedTags: ALLOWED_TAGS,
    allowedAttributes: ALLOWED_ATTRS,
    // ‼️ `style` IS ALLOWED AS A TAG, WHICH sanitize-html CALLS VULNERABLE, AND THE FLAG IS HOW
    // IT MAKES YOU SAY SO OUT LOUD. The risk it names is CSS that exfiltrates via attribute
    // selectors and background: url(). That is a real technique and it is not a threat here: the
    // author of this CSS is the operator publishing the page, and a page whose <style> block was
    // stripped is not a designed page any more, it is unstyled text. Without this the whole
    // feature would deliver something nobody would ship.
    allowVulnerableTags: true,
    // Not in allowedTags, but named here so their CONTENT goes too rather than being flattened
    // into visible text. A stripped <script> that leaves its source code on the page as words is
    // worse-looking than the script was.
    nonTextTags: ["script", "noscript", "template", "textarea-placeholder"],
    allowedSchemes: ["https", "mailto", "tel"],
    // data: URIs are how an inlined logo or an embedded font arrives, and a pasted page is full
    // of them. They cannot execute in an img src.
    allowedSchemesByTag: { img: ["https", "data"], source: ["https", "data"], video: ["https", "data"], audio: ["https", "data"] },
    allowProtocolRelative: false,
    // ‼️ EVERY OUTBOUND LINK GETS rel=noopener. target=_blank without it hands the opened page a
    // window.opener reference back to the client's own site.
    transformTags: {
      a: (tagName, attribs) => {
        const out = { ...attribs };
        if (out.target === "_blank") out.rel = [out.rel, "noopener", "noreferrer"].filter(Boolean).join(" ");
        return { tagName, attribs: out };
      },
    },
  });

  return { html, removed };
}

// ─────────────────────────────────────────────────────────────────────────────
// Reading
// ─────────────────────────────────────────────────────────────────────────────

/** One published page for a host. Null on a miss; THROWS on a read failure. */
export async function publishedSitePage(clientId: string, path: string): Promise<SitePage | null> {
  const { data, error } = await supabaseAdmin
    .from("client_site_pages")
    .select(COLUMNS)
    .eq("client_id", clientId)
    .eq("path", path)
    .eq("status", "published")
    .maybeSingle();

  // ‼️ A MISS AND A FAILURE ARE DIFFERENT AND COLLAPSING THEM IS THE EXPENSIVE MISTAKE.
  // resolveHost() draws exactly this line and says why: a 404 served during a Supabase blip, on
  // pages Google has already indexed, is how a client's site gets quietly deindexed. A miss is a
  // 404; a throw reaches the error boundary and becomes a 5xx, which tells a crawler to come back.
  if (error) throw new Error(`client_site_pages unreadable: ${error.message}`);
  return data ? toPage(data as unknown as Record<string, unknown>) : null;
}

/** Published pages for a client, nav order first. Throws on a read failure, same reasoning. */
export async function listSitePages(clientId: string, includeDrafts = false): Promise<SitePage[]> {
  let q = supabaseAdmin.from("client_site_pages").select(COLUMNS).eq("client_id", clientId);
  if (!includeDrafts) q = q.eq("status", "published");

  const { data, error } = await q.order("nav_order", { ascending: true, nullsFirst: false });
  if (error) throw new Error(`client_site_pages unreadable: ${error.message}`);
  return (data ?? []).map((r) => toPage(r as unknown as Record<string, unknown>));
}

// ─────────────────────────────────────────────────────────────────────────────
// Writing
// ─────────────────────────────────────────────────────────────────────────────

export async function storeSitePage(args: {
  clientId: string;
  path: string;
  title: string;
  html: string;
  metaDescription?: string | null;
  navLabel?: string | null;
  navOrder?: number | null;
  publish?: boolean;
  by: string;
}): Promise<{ ok: true; page: SitePage; removed: string[] } | { ok: false; error: string }> {
  const path = normalizeSitePath(args.path);
  if (!path.ok) return { ok: false, error: path.error };

  const title = (args.title ?? "").trim();
  if (!title) return { ok: false, error: "A page needs a title: it is the browser tab and the search result." };

  const { html, removed } = sanitizeSiteHtml(args.html ?? "");
  if (!html.trim()) {
    return {
      ok: false,
      error:
        "Nothing survived sanitising, so there is no page to store. If the design was entirely " +
        "inside a <script>, it needs to be pasted as rendered HTML instead.",
    };
  }

  const publish = args.publish !== false;
  const now = new Date().toISOString();

  const { data, error } = await supabaseAdmin
    .from("client_site_pages")
    .upsert(
      {
        client_id: args.clientId,
        path: path.path,
        title,
        html,
        meta_description: args.metaDescription ?? null,
        nav_label: args.navLabel ?? (path.path === "/" ? "Home" : title),
        nav_order: args.navOrder ?? null,
        status: publish ? "published" : "draft",
        // The CHECK pairs these: published has a time, a draft claims none.
        published_at: publish ? now : null,
        sanitized_note: removed.length ? removed.join("; ") : null,
        created_by: args.by,
        updated_at: now,
      },
      { onConflict: "client_id,path" }
    )
    .select(COLUMNS)
    .maybeSingle();

  if (error) return { ok: false, error: error.message };
  if (!data) return { ok: false, error: "The page was not written back." };

  return { ok: true, page: toPage(data as unknown as Record<string, unknown>), removed };
}

export async function deleteSitePage(clientId: string, path: string): Promise<{ ok: boolean; error?: string }> {
  const { error } = await supabaseAdmin
    .from("client_site_pages")
    .delete()
    .eq("client_id", clientId)
    .eq("path", path);
  return error ? { ok: false, error: error.message } : { ok: true };
}
