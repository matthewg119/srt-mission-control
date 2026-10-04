"use client";

// The customise panel: switch nav items off, and move them within their section.
//
// ‼️ IT EDITS A DRAFT AND SAVES ON "Done", rather than writing on every tap. Reordering is several
// moves in a row, and persisting each one means a half-finished order is what survives if somebody
// closes the panel mid-thought.
//
// ‼️ IT MOVES ITEMS WITHIN A SECTION AND NEVER BETWEEN THEM. The sections are what make a
// twenty-item sidebar readable, and an item that can leave its group turns "Operations" into a
// label that no longer describes what is under it. Hiding is the escape hatch for anything in the
// wrong place.

import { useState } from "react";
import { ArrowDown, ArrowUp, RotateCcw, X } from "lucide-react";
import type { NavSection } from "@/config/nav";
import { applyOrder, type NavPrefs } from "@/lib/nav-prefs";

function move<T>(list: readonly T[], from: number, to: number): T[] {
  if (to < 0 || to >= list.length) return [...list];
  const out = [...list];
  const [item] = out.splice(from, 1);
  out.splice(to, 0, item);
  return out;
}

export function NavCustomize({
  sections,
  prefs,
  onSave,
  onReset,
  onClose,
}: {
  sections: readonly NavSection[];
  prefs: NavPrefs;
  onSave: (next: NavPrefs) => void;
  onReset: () => void;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState<NavPrefs>(prefs);
  const hidden = new Set(draft.hidden);

  function toggle(href: string) {
    setDraft((d) => ({
      ...d,
      hidden: d.hidden.includes(href) ? d.hidden.filter((h) => h !== href) : [...d.hidden, href],
    }));
  }

  function shift(section: NavSection, href: string, by: 1 | -1) {
    setDraft((d) => {
      const current = applyOrder(section.items, d.order[section.label] ?? []).map((i) => i.href);
      const at = current.indexOf(href);
      if (at < 0) return d;
      return { ...d, order: { ...d.order, [section.label]: move(current, at, at + by) } };
    });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
      <div className="flex max-h-[85vh] w-full max-w-md flex-col rounded-2xl border border-[rgba(255,255,255,0.12)] bg-[#0f0f0f]">
        <div className="flex shrink-0 items-center justify-between border-b border-[rgba(255,255,255,0.08)] px-5 py-4">
          <div>
            <h2 className="text-sm font-semibold text-white">Customise the sidebar</h2>
            <p className="mt-0.5 text-[11px] text-[rgba(255,255,255,0.4)]">
              Saved in this browser only.
            </p>
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="text-[rgba(255,255,255,0.45)] transition-colors hover:text-white"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          {sections.map((section) => {
            const ordered = applyOrder(section.items, draft.order[section.label] ?? []);
            return (
              <div key={section.label} className="mb-5 last:mb-0">
                <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-[rgba(255,255,255,0.25)]">
                  {section.label}
                </p>
                <ul className="flex flex-col gap-1">
                  {ordered.map((item, i) => {
                    const off = hidden.has(item.href);
                    return (
                      <li
                        key={item.href}
                        className="flex items-center gap-2 rounded-md bg-[rgba(255,255,255,0.03)] px-2.5 py-2"
                      >
                        <input
                          type="checkbox"
                          checked={!off}
                          onChange={() => toggle(item.href)}
                          aria-label={`Show ${item.label}`}
                          className="h-[15px] w-[15px] shrink-0 accent-[#00C9A7]"
                        />
                        <span
                          className={`flex-1 truncate text-[13px] ${off ? "text-[rgba(255,255,255,0.3)] line-through" : "text-white"}`}
                        >
                          {item.label}
                        </span>
                        <button
                          onClick={() => shift(section, item.href, -1)}
                          disabled={i === 0}
                          aria-label={`Move ${item.label} up`}
                          className="text-[rgba(255,255,255,0.4)] transition-colors hover:text-white disabled:opacity-20"
                        >
                          <ArrowUp className="h-4 w-4" />
                        </button>
                        <button
                          onClick={() => shift(section, item.href, 1)}
                          disabled={i === ordered.length - 1}
                          aria-label={`Move ${item.label} down`}
                          className="text-[rgba(255,255,255,0.4)] transition-colors hover:text-white disabled:opacity-20"
                        >
                          <ArrowDown className="h-4 w-4" />
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </div>
            );
          })}
        </div>

        <div className="flex shrink-0 items-center justify-between gap-3 border-t border-[rgba(255,255,255,0.08)] px-5 py-4">
          <button
            onClick={onReset}
            className="flex items-center gap-1.5 text-[12px] text-[rgba(255,255,255,0.45)] transition-colors hover:text-white"
          >
            <RotateCcw className="h-3.5 w-3.5" />
            Reset to default
          </button>
          <button
            onClick={() => onSave(draft)}
            className="rounded-lg bg-[#00C9A7] px-4 py-2 text-[13px] font-semibold text-[#04252b] transition hover:opacity-90"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
