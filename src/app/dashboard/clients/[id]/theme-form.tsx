"use client";

// The Identity panel: what the hub calls this business, and what it looks like.
//
// It sits above Hub because it is upstream of everything the Hub panel does — the name is
// the <h1>, the <title> and the LocalBusiness schema, and the theme is what makes the
// review tool read as the clinic's page rather than an agency's.
//
// ‼️ VISUAL ONLY. There is no field here for copy, a headline, a button label or a review
// destination, and there is deliberately nowhere to add one: the theme object has four
// visual keys (Runner v3 5g). If somebody wants per-client wording, that is a conversation,
// not a text input.
//
// ‼️ EXTRACT PROPOSES, A PERSON CONFIRMS. 5f: "Theme confirmed by me in the dashboard
// before the preview is shown." An unconfirmed theme is not applied to any page, so an
// accent scraped out of a cookie banner is a thing you look at here, never a thing a client
// discovers on a call. Editing a confirmed theme un-confirms it.

import { useState } from "react";
import { useRouter } from "next/navigation";

export interface ThemeView {
  logoUrl: string | null;
  accent: string | null;
  accentSoft: string | null;
  fontFamily: string | null;
  extractedFrom: string | null;
  extractedAt: string | null;
  confirmedAt: string | null;
  confirmedBy: string | null;
}

export function ThemeForm({
  clientId,
  legalName,
  dbaName,
  hasWebsite,
  theme,
}: {
  clientId: string;
  legalName: string;
  dbaName: string | null;
  hasWebsite: boolean;
  theme: ThemeView;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [legal, setLegal] = useState(legalName);
  const [dba, setDba] = useState(dbaName ?? "");
  const [logo, setLogo] = useState(theme.logoUrl ?? "");
  const [accent, setAccent] = useState(theme.accent ?? "");
  const [font, setFont] = useState(theme.fontFamily ?? "");

  async function post(body: Record<string, unknown>, key: string) {
    setBusy(key);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch(`/api/clients/${clientId}/theme`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = (await res.json()) as { ok: boolean; error?: string; theme?: ThemeView };
      if (!json.ok) {
        setError(json.error ?? "That did not work.");
        return;
      }
      if (json.theme) {
        setLogo(json.theme.logoUrl ?? "");
        setAccent(json.theme.accent ?? "");
        setFont(json.theme.fontFamily ?? "");
      }
      setNotice(key === "extract" ? "Read their homepage. Check it, then confirm." : null);
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  const confirmed = Boolean(theme.confirmedAt);
  // ‼️ IT READS THE SAVED THEME, NOT THE INPUT STATE, AND THAT IS DELIBERATE.
  // The obvious "improvement" is to read `logo` / `accent` / `font` so the label updates as you
  // type. It must not: this describes what is STORED, and a Confirm pressed against a value that
  // was never saved would record a decision about a colour nobody wrote down.
  //
  // accentSoft is counted because activeTheme() counts it and the route's `set` action accepts
  // it. Leaving it out made the panel and the renderer disagree about what an override is.
  //
  // ‼️ THIS NO LONGER GATES THE CONFIRM BUTTON. It used to, and that was the deadlock: the panel
  // said an empty theme was "a fine place to start" directly above a disabled Confirm, so
  // "I am keeping the defaults" was an unconfirmable choice and hub_preview could never complete.
  // Confirmed and has-overrides are two different facts. See themeConfirmed() in hub-setup.ts.
  const hasOverrides = Boolean(
    theme.logoUrl || theme.accent || theme.accentSoft || theme.fontFamily
  );

  return (
    <div className="space-y-5">
      {error && <p className="text-sm text-[#F5636A]">{error}</p>}
      {notice && <p className="text-sm text-[#F5A623]">{notice}</p>}

      {/* ── The name, which is the schema ────────────────────────────────── */}
      <div className="space-y-2">
        <p className="text-xs text-[rgba(255,255,255,0.4)]">
          The trading name wins when it exists. This is the hub&apos;s heading, its title tag
          and the <code>name</code> in its LocalBusiness schema, so a typo here is a typo an
          engine reads.
        </p>
        <div className="flex flex-wrap gap-2">
          <label className="flex-1 min-w-[12rem] text-xs text-[rgba(255,255,255,0.5)]">
            Legal name
            <input
              value={legal}
              onChange={(e) => setLegal(e.target.value)}
              className="mt-1 w-full rounded border border-white/15 bg-transparent p-2 text-sm text-white"
            />
          </label>
          <label className="flex-1 min-w-[12rem] text-xs text-[rgba(255,255,255,0.5)]">
            Trading name (DBA), if any
            <input
              value={dba}
              onChange={(e) => setDba(e.target.value)}
              placeholder="blank = use the legal name"
              className="mt-1 w-full rounded border border-white/15 bg-transparent p-2 text-sm text-white"
            />
          </label>
        </div>
        <button
          type="button"
          onClick={() => post({ action: "name", legalName: legal, dbaName: dba }, "name")}
          disabled={busy !== null || !legal.trim() || (legal === legalName && dba === (dbaName ?? ""))}
          className="rounded border border-white/15 px-2 py-1 text-xs hover:border-white/40 disabled:opacity-40"
        >
          {busy === "name" ? "…" : "Save the name"}
        </button>
      </div>

      <hr className="border-white/10" />

      {/* ── The theme ────────────────────────────────────────────────────── */}
      <div className="space-y-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <span className="text-xs text-[rgba(255,255,255,0.5)]">
            Logo, accent colour and font. Nothing else is themable.
          </span>
          <button
            type="button"
            onClick={() => post({ action: "extract" }, "extract")}
            disabled={busy !== null || !hasWebsite}
            title={hasWebsite ? undefined : "No website on this client yet."}
            className="rounded border border-white/15 px-2 py-1 text-xs hover:border-white/40 disabled:opacity-40"
          >
            {busy === "extract" ? "reading…" : "Read it from their site"}
          </button>
        </div>

        <div className="flex flex-wrap gap-2">
          <label className="flex-1 min-w-[16rem] text-xs text-[rgba(255,255,255,0.5)]">
            Logo URL
            <input
              value={logo}
              onChange={(e) => setLogo(e.target.value)}
              placeholder="https://theirsite.com/logo.svg"
              className="mt-1 w-full rounded border border-white/15 bg-transparent p-2 font-mono text-xs text-white"
            />
          </label>
          <label className="w-32 text-xs text-[rgba(255,255,255,0.5)]">
            Accent
            <input
              value={accent}
              onChange={(e) => setAccent(e.target.value)}
              placeholder="#00705f"
              className="mt-1 w-full rounded border border-white/15 bg-transparent p-2 font-mono text-xs text-white"
            />
          </label>
          <label className="flex-1 min-w-[12rem] text-xs text-[rgba(255,255,255,0.5)]">
            Font stack
            <input
              value={font}
              onChange={(e) => setFont(e.target.value)}
              placeholder='"Inter", ui-sans-serif, system-ui, sans-serif'
              className="mt-1 w-full rounded border border-white/15 bg-transparent p-2 font-mono text-xs text-white"
            />
          </label>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={() =>
              post(
                { action: "set", logoUrl: logo, accent, fontFamily: font },
                "set"
              )
            }
            disabled={busy !== null}
            className="rounded border border-white/15 px-2 py-1 text-xs hover:border-white/40 disabled:opacity-40"
          >
            {busy === "set" ? "…" : "Save"}
          </button>

          {accent && /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i.test(accent) && (
            <span className="flex items-center gap-2 text-xs text-[rgba(255,255,255,0.5)]">
              <span
                className="inline-block h-4 w-4 rounded border border-white/20"
                style={{ background: accent }}
              />
              {accent}
            </span>
          )}
          {accent && !/^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i.test(accent) && (
            <span className="text-xs text-[#F5A623]">
              Hex only (#00705f). Anything else is dropped on save.
            </span>
          )}
        </div>

        {theme.extractedAt && (
          <p className="text-xs text-[rgba(255,255,255,0.35)]">
            Read from {theme.extractedFrom} on{" "}
            {new Date(theme.extractedAt).toLocaleDateString()}.
          </p>
        )}
      </div>

      {/* ── The confirmation gate ─────────────────────────────────────────── */}
      <div className="rounded border border-white/10 p-3">
        {confirmed ? (
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <span className="text-xs text-[#4ADE80]">
              Confirmed by {theme.confirmedBy ?? "someone"} on{" "}
              {new Date(theme.confirmedAt as string).toLocaleDateString()}.{" "}
              {hasOverrides
                ? "It is live on the hub and the review tool."
                : "No overrides are set, so the hub and the review tool render SRT's defaults on their domain. That is a recorded decision, not an unfinished step."}
            </span>
            <button
              type="button"
              onClick={() => post({ action: "unconfirm" }, "unconfirm")}
              disabled={busy !== null}
              className="rounded border border-white/15 px-2 py-1 text-xs hover:border-white/40 disabled:opacity-40"
            >
              {busy === "unconfirm" ? "…" : "Un-confirm"}
            </button>
          </div>
        ) : (
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <span className="text-xs text-[rgba(255,255,255,0.5)]">
              {hasOverrides
                ? "Not confirmed, so the hub still renders the default. Look at the preview first."
                : "Nothing is overridden. Confirming now records a decision to keep SRT's defaults on their domain, which unblocks the hub and review tool steps. Set a colour first if you would rather not."}
            </span>
            <span className="flex gap-2">
              <a
                href={`/dashboard/clients/${clientId}/preview`}
                target="_blank"
                rel="noreferrer"
                className="rounded border border-white/15 px-2 py-1 text-xs hover:border-white/40"
              >
                Preview →
              </a>
              <button
                type="button"
                onClick={() => post({ action: "confirm" }, "confirm")}
                disabled={busy !== null}
                className="rounded border border-white/15 px-2 py-1 text-xs hover:border-white/40 disabled:opacity-40"
              >
                {busy === "confirm" ? "…" : "Confirm the theme"}
              </button>
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
