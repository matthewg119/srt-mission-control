"use client";

// The preview bar: open the website, and decide whether the assistant is on it.
//
// ‼️ IT IS A LINK BUILDER, NOT A SETTING, AND THE DISTINCTION IS THE WHOLE FILE.
// Nothing here writes. The switch changes one query parameter on the href, and
// /preview/[token] reads it per request. `concierge_configs.enabled` is untouched and keeps its
// exact meaning: the only thing that puts the widget on a client's real website, still defaulting
// false, never flipped by the preview lane (src/lib/concierge/preview-grant.ts states that rule and
// this file obeys it). A toggle in a dashboard that LOOKED like this one and quietly flipped
// `enabled` would put a live widget on somebody's domain from a control labelled "preview".
//
// ‼️ THE STATE IS NOT PERSISTED AND SHOULD NOT BE. It answers "what am I about to show this
// person, right now, on this call". Storing it would make the next person's preview depend on a
// choice somebody made in a different conversation for a different reason, with nothing on screen
// to say so.
//
// ‼️ THE SWITCH DOES NOT REACH THE CONCIERGE DEMO (kind=concierge), which is a separate link
// elsewhere. That view exists to BE the assistant; a switch that could empty it would be a
// control for breaking one thing from the page about another.

import { useState } from "react";

interface Props {
  /** Already signed and already carrying ?kind=. Null when no key is configured. */
  href: string;
  /** Which of the two site previews this is, so the button can say which. */
  kind: "launch" | "site";
  /** Whether this client has a domain attached yet, which changes what the button means. */
  hasHost: boolean;
}

export function PreviewBar({ href, kind, hasHost }: Props) {
  const [assistant, setAssistant] = useState(true);

  // href already has a `?kind=`, so this is always the second parameter onward.
  const open = assistant ? href : `${href}&assistant=0`;

  const label =
    kind === "site"
      ? "Preview their current site"
      : hasHost
        ? "Preview website (no domain needed)"
        : "Preview website";

  return (
    <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-3 rounded-xl border border-[rgba(255,255,255,0.1)] bg-[rgba(255,255,255,0.02)] px-4 py-3">
      <a
        href={open}
        target="_blank"
        rel="noopener noreferrer"
        className="rounded-lg border border-[rgba(245,166,35,0.35)] bg-[rgba(245,166,35,0.06)] px-3 py-1.5 text-xs text-[#F5A623] hover:text-white"
      >
        {label}
      </a>

      <div className="ml-auto flex items-center gap-3">
        <span className="text-xs text-[rgba(255,255,255,0.7)]">AI assistant</span>

        {/* A real <button role="switch">, not a styled checkbox: aria-checked is the thing a
            screen reader reads here, and this control has no form to submit to. */}
        <button
          type="button"
          role="switch"
          aria-checked={assistant}
          aria-label="Show the AI assistant on the preview"
          onClick={() => setAssistant((v) => !v)}
          className={`relative h-5 w-9 shrink-0 rounded-full transition-colors ${
            assistant ? "bg-[#00C9A7]" : "bg-[rgba(255,255,255,0.18)]"
          }`}
        >
          <span
            className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition-all ${
              assistant ? "left-[18px]" : "left-0.5"
            }`}
          />
        </button>

        <span className="w-6 text-xs tabular-nums text-[rgba(255,255,255,0.4)]">
          {assistant ? "On" : "Off"}
        </span>
      </div>

      {/* ‼️ SAID OUT LOUD, BECAUSE A TOGGLE IN A DASHBOARD READS AS A SETTING.
          Without this line the obvious conclusion from switching it off is that the client's
          widget has been turned off, which is not what happened and not something this lane can
          do. */}
      <p className="w-full text-[11px] text-[rgba(255,255,255,0.35)]">
        {assistant
          ? "The preview opens with the assistant in the corner. This changes the link only, never the client's own site."
          : "The preview opens without the assistant. Their live widget is unaffected either way."}
      </p>
    </div>
  );
}
