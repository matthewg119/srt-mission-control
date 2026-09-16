// Renders the real HubIndexBody and HubAnswerBody in each universe to static HTML, for screenshots and review.
//
//   bun run scripts/_render-universes.tsx <out-dir>
import fs from "node:fs";
import path from "node:path";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

(globalThis as unknown as { React: unknown }).React = React;

const ROOT = path.resolve(import.meta.dirname ?? __dirname, "..");
const OUT = process.argv[2] ?? path.join(ROOT, ".universe-shots");
fs.mkdirSync(OUT, { recursive: true });

const { HubIndexBody, HubAnswerBody } = await import(path.join(ROOT, "src/components/hub/hub-bodies.tsx"));
const { UniverseTop, UniverseBand } = await import(path.join(ROOT, "src/components/hub/universe-chrome.tsx"));
const { GHOST_PAGES, ghostAnswerPage } = await import(path.join(ROOT, "src/lib/hub/ghost-content.ts"));
const { HUB_UNIVERSES } = await import(path.join(ROOT, "src/lib/hub/universes.ts"));
const { hubRootClass, readSkin } = await import(path.join(ROOT, "src/lib/hub/skin.ts"));

const css = fs.readFileSync(path.join(ROOT, "src/app/hub/[host]/hub.css"), "utf8") + "\n" + fs.readFileSync(path.join(ROOT, "src/app/hub/[host]/universes.css"), "utf8");

const FONT: Record<string, { link: string; vars: string }> = {
  blueprint: { link: "Big+Shoulders+Display:wght@600;800&family=Archivo:wght@400;600&family=IBM+Plex+Mono:wght@400;600", vars: "--u-display:'Big Shoulders Display';--u-text:'Archivo';--u-mono:'IBM Plex Mono'" },
  atelier: { link: "Cormorant+Garamond:ital,wght@0,300;0,500;1,300;1,500&family=Karla:wght@400;600&family=IBM+Plex+Mono", vars: "--u-display:'Cormorant Garamond';--u-text:'Karla';--u-mono:'IBM Plex Mono'" },
  magazine: { link: "Playfair+Display:ital,wght@0,700;0,900;1,700&family=Source+Serif+4:wght@400;600&family=IBM+Plex+Mono", vars: "--u-display:'Playfair Display';--u-text:'Source Serif 4';--u-mono:'IBM Plex Mono'" },
  brutalist: { link: "Archivo+Black&family=Space+Grotesk:wght@400;600&family=Space+Mono:wght@400;700", vars: "--u-display:'Archivo Black';--u-text:'Space Grotesk';--u-mono:'Space Mono'" },
  noir: { link: "Sora:wght@300;600;700&family=Archivo:wght@400;600&family=JetBrains+Mono:wght@400;600", vars: "--u-display:'Sora';--u-text:'Archivo';--u-mono:'JetBrains Mono'" },
  botanica: { link: "Fraunces:wght@400;600&family=Nunito+Sans:wght@400;600&family=DM+Serif+Display", vars: "--u-display:'Fraunces';--u-text:'Nunito Sans';--u-mono:'DM Serif Display'" },
};

const client = {
  id: "c1",
  displayName: "SRT Agency LLC",
  city: "Greensboro",
  state: "NC",
  addressLine1: "2701 Seabiscuit Ln",
  addressLine2: null,
  postalCode: "27410",
  phone: "+17862822937",
  website: "https://srtagency.com",
  language: "en",
  theme: { logoUrl: null, accent: "#2dd4bf", accentSoft: null, fontFamily: null },
  skin: null,
};

for (const u of HUB_UNIVERSES) {
  for (const which of ["index", "answer"]) {
    const skin = readSkin({ universe: u });
    const body =
      which === "index"
        ? renderToStaticMarkup(React.createElement(HubIndexBody, { client, host: "learn.srtagency.com", pages: GHOST_PAGES, linkBase: "#" }))
        : renderToStaticMarkup(React.createElement(HubAnswerBody, { client, host: "learn.srtagency.com", page: ghostAnswerPage("lorem-ipsum-1"), linkBase: "#", homeHref: "#" }));
    const top = renderToStaticMarkup(React.createElement(UniverseTop, { universe: u, name: client.displayName, where: "Greensboro, NC", pages: 6 }));
    const band = renderToStaticMarkup(React.createElement(UniverseBand, { universe: u, name: client.displayName, where: null, pages: 6 }));
    const html = `<!doctype html><html><head><meta charset="utf-8">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=${FONT[u].link}&display=swap">
<style>body{margin:0}${css}</style></head><body>
<div class="${hubRootClass(skin)}" style="${FONT[u].vars};--hub-accent:#2dd4bf">${top}<div class="hub-wrap">${body}</div>${band}</div>
</body></html>`;
    fs.writeFileSync(path.join(OUT, `${u}-${which}.html`), html);
  }
}
console.log("written", HUB_UNIVERSES.length * 2);
