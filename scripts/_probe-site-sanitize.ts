/**
 * Probe: the pasted-site sanitiser removes behaviour and keeps design.
 *
 *   bun run scripts/_probe-site-sanitize.ts
 *
 * Needs no database and no network. Pure function in, string out.
 *
 * WHY IT EXISTS. sanitizeSiteHtml() is the only thing standing between a pasted page and a
 * client's own domain, and every one of its rules is a judgement that reads as obviously correct
 * and is worth nothing unless something runs it. Both halves are tested on purpose: a sanitiser
 * that strips everything passes every security check and ships unstyled text.
 */

import { sanitizeSiteHtml, normalizeSitePath } from "../src/lib/launch/site-pages";

let failures = 0;

function check(name: string, condition: boolean, detail?: string): void {
  if (condition) {
    console.log(`  ok    ${name}`);
  } else {
    failures += 1;
    console.error(`  FAIL  ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

console.log("\nPasted-site sanitiser\n");
console.log("BEHAVIOUR IS REMOVED");

{
  const { html, removed } = sanitizeSiteHtml(`<div><script>alert(1)</script><p>Hello</p></div>`);
  check("a <script> tag is gone", !/script/i.test(html), html);
  check("its CONTENTS are gone too, not flattened into text", !html.includes("alert(1)"), html);
  check("the removal is reported", removed.some((r) => r.includes("<script>")), removed.join("; "));
  check("the real content survives", html.includes("Hello"), html);
}

{
  // The classic defeat of a naive regex stripper: removing the inner <script> splices the outer
  // one back into existence. This is the single best reason not to hand-roll this.
  const { html } = sanitizeSiteHtml(`<p>hi</p><scr<script>ipt>alert(1)</script>`);
  check("nested/spliced script tags do not reassemble", !/<script/i.test(html), html);
}

{
  const { html, removed } = sanitizeSiteHtml(`<button onclick="steal()">Go</button>`);
  check("an inline event handler is gone", !/onclick/i.test(html), html);
  check("the button itself survives", html.includes("Go"), html);
  check("the handler removal is reported", removed.some((r) => r.includes("event handler")), removed.join("; "));
}

{
  const { html, removed } = sanitizeSiteHtml(
    `<form action="https://somewhere-else.example/collect" method="post"><input name="email"></form>`
  );
  check("an off-site form action is gone", !/somewhere-else/.test(html), html);
  check("the form and its input still render", /<form/i.test(html) && /<input/i.test(html), html);
  check("the action removal is reported", removed.some((r) => r.includes("form action")), removed.join("; "));
}

{
  const { html } = sanitizeSiteHtml(`<a href="javascript:alert(1)">x</a><a href="http://plain.example">y</a>`);
  check("a javascript: href is refused", !/javascript:/i.test(html), html);
  check("a bare http:// href is refused, https only", !/http:\/\/plain/.test(html), html);
}

{
  const { html } = sanitizeSiteHtml(`<iframe src="https://evil.example"></iframe><p>keep</p>`);
  check("an <iframe> is gone", !/iframe/i.test(html), html);
  check("content around it survives", html.includes("keep"), html);
}

{
  const { html } = sanitizeSiteHtml(`<a href="https://x.example" target="_blank">out</a>`);
  check("target=_blank gains rel=noopener", /noopener/.test(html), html);
}

console.log("\nDESIGN SURVIVES");

{
  const { html } = sanitizeSiteHtml(
    `<style>.hero{color:#fff;background:#000}</style><section class="hero" style="padding:4rem"><h1>Title</h1></section>`
  );
  check("a <style> block survives", html.includes(".hero{color:#fff"), html);
  check("a class attribute survives", /class="hero"/.test(html), html);
  check("an inline style attribute survives", /padding:4rem/.test(html), html);
  check("semantic structure survives", /<section/.test(html) && /<h1>/.test(html), html);
}

{
  const { html } = sanitizeSiteHtml(
    `<svg viewBox="0 0 24 24"><path d="M1 1L2 2" fill="currentColor"/></svg>`
  );
  check("inline SVG survives", /<svg/.test(html) && /<path/.test(html), html);
  check("the SVG path data survives", /M1 1L2 2/.test(html), html);
}

{
  const { html } = sanitizeSiteHtml(`<img src="data:image/png;base64,iVBORw0KGgo=" alt="logo">`);
  check("a data: URI image survives (inlined logos and fonts arrive this way)", /data:image\/png/.test(html), html);
}

{
  const { html } = sanitizeSiteHtml(`<picture><source srcset="https://x.example/a.webp"><img src="https://x.example/a.jpg" alt=""></picture>`);
  check("<picture>/<source> responsive images survive", /<picture/.test(html) && /<source/.test(html), html);
}

{
  const { removed } = sanitizeSiteHtml(`<p>nothing to see</p>`);
  check("a clean page reports nothing removed", removed.length === 0, removed.join("; "));
}

console.log("\nPATHS");

{
  check("bare / is the home page", normalizeSitePath("/").ok, "");
  check("index normalises to /", (() => { const r = normalizeSitePath("index"); return r.ok && r.path === "/"; })(), "");
  check("about gains a leading slash", (() => { const r = normalizeSitePath("about"); return r.ok && r.path === "/about"; })(), "");
  check("a trailing slash is trimmed", (() => { const r = normalizeSitePath("/about/"); return r.ok && r.path === "/about"; })(), "");
  check("/answers is reserved", !normalizeSitePath("/answers").ok, "");
  check("a nested path is refused", !normalizeSitePath("/a/b").ok, "");
  check("a dotted path is refused", !normalizeSitePath("/foo.php").ok, "");
  check("traversal is refused", !normalizeSitePath("/../api/clients").ok, "");
  check("/api is reserved", !normalizeSitePath("/api").ok, "");
  check("uppercase is folded, not refused", (() => { const r = normalizeSitePath("/About"); return r.ok && r.path === "/about"; })(), "");
}

console.log(failures === 0 ? "\nAll checks passed.\n" : `\n${failures} FAILED.\n`);
process.exit(failures === 0 ? 0 : 1);
