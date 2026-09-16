// The decoration a universe draws around the page: a top bar and a closing band.
//
// ‼️ aria-hidden, NO HEADINGS, NO LINKS, NO NUMBERS THAT ARE NOT COUNTED. It sits outside .hub-wrap, so the
// body a crawler reads (the JSON-LD, the h1, the answers, the NAP) is exactly the shared component in
// hub-bodies.tsx. What is written here is the client's own name and city, a count of their pages, and fixed
// labels, so nothing a model invented can land on a client's domain through a design.
// _probe-hub-universes.ts renders it and asserts all of that.

import type { HubUniverse } from "@/lib/hub/universes";

interface ChromeProps {
  universe: HubUniverse | null | undefined;
  name: string;
  where: string | null;
  pages: number;
}

const LABELS: Record<HubUniverse, { top: string[]; band: string }> = {
  blueprint: { top: ["Answer sheet", "Rev. A", "Scale 1:1"], band: "Drawn to be read and quoted" },
  atelier: { top: ["Maison", "Questions & answers"], band: "With care, in full" },
  magazine: { top: ["The answers issue", "Vol. 1"], band: "Read the whole story" },
  brutalist: { top: ["Questions", "Answers"], band: "Straight answers" },
  noir: { top: ["System online", "Answers indexed"], band: "Signal, not noise" },
  botanica: { top: ["Welcome", "Your questions, answered"], band: "Take your time" },
};

export function UniverseTop({ universe, name, where, pages }: ChromeProps) {
  if (!universe) return null;
  const l = LABELS[universe];
  return (
    <div className="u-top" aria-hidden="true">
      <span className="u-top-name">{name}</span>
      {where && <span className="u-top-where">{where}</span>}
      {l.top.map((t) => (
        <span key={t} className="u-top-label">
          {t}
        </span>
      ))}
      {/* Only a counted number is printed. A caller that has not counted passes -1 and nothing shows. */}
      {pages >= 0 && <span className="u-top-count">{pages} {pages === 1 ? "answer" : "answers"}</span>}
    </div>
  );
}

export function UniverseBand({ universe, name }: ChromeProps) {
  if (!universe) return null;
  return (
    <div className="u-band" aria-hidden="true">
      <span className="u-band-line">{LABELS[universe].band}</span>
      <span className="u-band-name">{name}</span>
    </div>
  );
}
