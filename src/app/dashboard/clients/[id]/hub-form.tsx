"use client";

// The Hub panel. Two hostnames, and the pages they serve.
//
// It sits directly under DNS because it is the other half of the same conversation: DNS
// says whether the record resolves, this says whether anything is there to answer when it
// does. Attaching is what makes the CNAME target in the DNS panel above TRUE rather than a
// default — Vercel issues per-domain targets, so until a hostname is attached the value the
// client is told to type is a guess.
//
// NO SECOND STATUS VOCABULARY. Vercel's `misconfigured` before propagation is the same fact
// the DNS panel already reports as "they added it, not confirmed", so it is rendered as
// grey context and never as a status of its own.

import { useState } from "react";
import { useRouter } from "next/navigation";

export interface HubHostView {
  host: string;
  kind: "hub" | "reviews";
  attached: boolean;
  verified: boolean | null;
  misconfigured: boolean | null;
  checkedAt: string | null;
  error: string | null;
}

export interface HubPageView {
  id: string;
  slug: string;
  title: string;
  question: string;
  status: string;
  publishedAt: string | null;
}

export interface AuditPromptView {
  text: string;
  block: string | null;
  reportId: string | null;
}

const BLANK = { title: "", question: "", answerMd: "", metaDescription: "", sourceReportId: "" };

export function HubForm({
  clientId,
  domain,
  wanted,
  hosts,
  pages,
  prompts,
  day0ArchivedAt,
  day0Source,
}: {
  clientId: string;
  domain: string | null;
  wanted: Array<{ host: string; kind: "hub" | "reviews" }>;
  hosts: HubHostView[];
  pages: HubPageView[];
  prompts: AuditPromptView[];
  /** NULL means the Day 0 wall is shut and Publish will be refused. */
  day0ArchivedAt: string | null;
  day0Source: string | null;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [draft, setDraft] = useState({ ...BLANK });
  const [open, setOpen] = useState(false);

  // The waive form only appears after a publish has actually been refused. Offering it
  // up front would make it a button beside Publish, which is the same as not having a
  // wall — the point is that you meet it, not that you can route around it.
  const [waiving, setWaiving] = useState(false);
  const [waiveReason, setWaiveReason] = useState("");

  const day0Open = Boolean(day0ArchivedAt);

  async function post(body: Record<string, unknown>, key: string) {
    setBusy(key);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch(`/api/clients/${clientId}/hub`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = (await res.json()) as {
        ok: boolean;
        error?: string;
        warnings?: string[];
        pageUrl?: string | null;
        blockedBy?: string;
        waivable?: boolean;
      };
      if (!json.ok) {
        setError(json.error ?? json.warnings?.join(" ") ?? "That did not work.");
        if (json.blockedBy === "day_zero_archive" && json.waivable) setWaiving(true);
      } else if (json.pageUrl) {
        setNotice(`Published: ${json.pageUrl}`);
      }
      router.refresh();
      return json.ok;
    } catch (e) {
      setError((e as Error).message);
      return false;
    } finally {
      setBusy(null);
    }
  }

  async function waive() {
    setBusy("waive");
    setError(null);
    try {
      const res = await fetch(`/api/clients/${clientId}/delivery-step`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "waive_day_zero", reason: waiveReason }),
      });
      const json = (await res.json()) as { ok: boolean; error?: string };
      if (!json.ok) {
        setError(json.error ?? "That did not work.");
        return;
      }
      setWaiving(false);
      setWaiveReason("");
      setNotice("Day 0 waived. It has been posted to #alerts-infra.");
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  const byKind = new Map(hosts.map((h) => [h.kind, h]));

  return (
    <div className="space-y-5">
      {!domain && (
        <p className="text-sm text-[rgba(255,255,255,0.5)]">
          No domain on this client yet. Intake step 1 sets it, and the hostnames come from it.
        </p>
      )}

      {/* ── The two hostnames ─────────────────────────────────────────────── */}
      {domain && (
        <div className="space-y-2">
          {wanted.map((w) => {
            const state = byKind.get(w.kind);
            return (
              <div
                key={w.host}
                className="flex flex-wrap items-baseline justify-between gap-2 border-b border-white/5 pb-2"
              >
                <div>
                  <div className="font-mono text-sm">{w.host}</div>
                  <div className="text-xs text-[rgba(255,255,255,0.4)]">
                    {w.kind === "hub" ? "the answer hub" : "the review tool"}
                  </div>
                </div>
                <div className="text-right text-xs">
                  {!state?.attached ? (
                    <span className="text-[rgba(255,255,255,0.35)]">not attached to Vercel</span>
                  ) : state.misconfigured ? (
                    // The SAME gap the DNS panel models between `added` and `verified`.
                    // Said in words rather than as a new status.
                    <span className="text-[#F5A623]">attached, waiting on the CNAME</span>
                  ) : (
                    <span className="text-[#00C9A7]">attached and serving</span>
                  )}
                  {state?.error && <div className="mt-1 text-red-300">{state.error}</div>}
                </div>
              </div>
            );
          })}

          <button
            type="button"
            onClick={() => post({ action: "register" }, "register")}
            disabled={busy !== null}
            className="rounded border border-white/15 px-3 py-1.5 text-sm hover:border-white/40 disabled:opacity-40"
          >
            {busy === "register" ? "Attaching…" : "Attach hostnames and read the real CNAME target"}
          </button>
          <p className="text-xs text-[rgba(255,255,255,0.4)]">
            Writes the target Vercel actually wants into the DNS panel above, replacing the
            default. Do this before the call, not during it.
          </p>
        </div>
      )}

      {/* ── Pages ─────────────────────────────────────────────────────────── */}
      <div className="space-y-2">
        <div className="text-xs uppercase tracking-wider text-[rgba(255,255,255,0.4)]">
          Pages · {pages.filter((p) => p.status === "published").length} published
        </div>

        {/* ── The preview, Runner v3 5f/5g ──────────────────────────────────
            Before the call, before DNS, drafts included. Not a second hub: it renders the
            same components the live host renders. Opens in a tab so it can be screen-shared
            without losing the board. */}
        <div className="flex flex-wrap gap-2">
          <a
            href={`/dashboard/clients/${clientId}/preview`}
            target="_blank"
            rel="noreferrer"
            className="rounded border border-white/15 px-2 py-1 text-xs hover:border-white/40"
          >
            Preview the hub →
          </a>
          <a
            href={`/dashboard/clients/${clientId}/preview?kind=reviews`}
            target="_blank"
            rel="noreferrer"
            className="rounded border border-white/15 px-2 py-1 text-xs hover:border-white/40"
          >
            Preview the review tool →
          </a>
        </div>

        {pages.length === 0 && (
          <p className="text-sm text-[rgba(255,255,255,0.5)]">
            Nothing written yet. The first page is what completes <code>first_page</code> and
            sends the client the link. The preview above works now regardless — an empty hub is
            what the client sees the day their CNAME resolves.
          </p>
        )}

        {pages.map((page) => (
          <div
            key={page.id}
            className="flex flex-wrap items-baseline justify-between gap-2 border-b border-white/5 pb-2"
          >
            <div className="min-w-0">
              <div className="text-sm">{page.title}</div>
              <div className="truncate font-mono text-xs text-[rgba(255,255,255,0.4)]">
                /{page.slug}
              </div>
            </div>
            <button
              type="button"
              onClick={() =>
                post(
                  {
                    action: page.status === "published" ? "page_unpublish" : "page_publish",
                    pageId: page.id,
                  },
                  page.id
                )
              }
              disabled={busy !== null || (page.status !== "published" && !day0Open)}
              title={
                page.status !== "published" && !day0Open
                  ? "Day 0 is not archived. Tick the Day-0 step on the delivery checklist first."
                  : undefined
              }
              className="rounded border border-white/15 px-2 py-1 text-xs hover:border-white/40 disabled:opacity-40"
            >
              {busy === page.id
                ? "…"
                : page.status === "published"
                  ? "Unpublish"
                  : "Publish"}
            </button>
          </div>
        ))}

        {/* ── The Day 0 wall, said before it is hit ───────────────────────── */}
        {pages.length > 0 && !day0Open && (
          <p className="text-xs text-[#F5A623]">
            Publishing is blocked until Day 0 is archived. Tick{" "}
            <em>Day-0 scan archived, before any change lands</em> on the Delivery checklist
            above. Drafts, hostnames and DNS are unaffected.
          </p>
        )}

        {day0Open && day0Source === "waived" && (
          <p className="text-xs text-[#F5A623]">
            Day 0 was <strong>waived</strong> for this client, not archived. Nothing measured
            after this has a baseline behind it, and every artifact has to say so.
          </p>
        )}

        {waiving && (
          <div className="space-y-2 rounded border border-[#F5A623]/40 p-3">
            <div className="text-xs text-[#F5A623]">
              Publish anyway. This is recorded against your name, posted to #alerts-infra, and
              shown on this panel from now on. Say why in a sentence.
            </div>
            <textarea
              value={waiveReason}
              onChange={(e) => setWaiveReason(e.target.value)}
              rows={2}
              placeholder="Why this client is publishing without an archived Day 0."
              className="w-full rounded border border-white/15 bg-transparent p-2 text-sm"
            />
            <div className="flex gap-2">
              <button
                type="button"
                onClick={waive}
                disabled={busy !== null || waiveReason.trim().length < 10}
                className="rounded border border-[#F5A623]/60 px-2 py-1 text-xs text-[#F5A623] hover:border-[#F5A623] disabled:opacity-40"
              >
                {busy === "waive" ? "…" : "Waive Day 0"}
              </button>
              <button
                type="button"
                onClick={() => {
                  setWaiving(false);
                  setWaiveReason("");
                }}
                className="rounded border border-white/15 px-2 py-1 text-xs hover:border-white/40"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="rounded border border-white/15 px-3 py-1.5 text-sm hover:border-white/40"
        >
          {open ? "Cancel" : "Write a page"}
        </button>
      </div>

      {/* ── The writer ────────────────────────────────────────────────────── */}
      {open && (
        <div className="space-y-3 rounded border border-white/10 p-3">
          {prompts.length > 0 && (
            <div>
              <label className="mb-1 block text-xs text-[rgba(255,255,255,0.5)]">
                Start from a question the audit actually ran
              </label>
              <select
                className="w-full rounded border border-white/15 bg-transparent px-2 py-1.5 text-sm"
                value=""
                onChange={(e) => {
                  const picked = prompts[Number(e.target.value)];
                  if (!picked) return;
                  setDraft((d) => ({
                    ...d,
                    question: picked.text,
                    title: d.title || picked.text,
                    sourceReportId: picked.reportId ?? "",
                  }));
                }}
              >
                <option value="">Pick one of the {prompts.length}…</option>
                {prompts.map((p, i) => (
                  <option key={i} value={i}>
                    {p.block ? `[${p.block}] ` : ""}
                    {p.text}
                  </option>
                ))}
              </select>
            </div>
          )}

          <Field
            label="Title"
            value={draft.title}
            onChange={(v) => setDraft((d) => ({ ...d, title: v }))}
          />
          <Field
            label="The question this page answers"
            value={draft.question}
            onChange={(v) => setDraft((d) => ({ ...d, question: v }))}
          />
          <Field
            label="Meta description (optional)"
            value={draft.metaDescription}
            onChange={(v) => setDraft((d) => ({ ...d, metaDescription: v }))}
          />

          <div>
            <label className="mb-1 block text-xs text-[rgba(255,255,255,0.5)]">
              The answer, in Markdown
            </label>
            <textarea
              rows={12}
              value={draft.answerMd}
              onChange={(e) => setDraft((d) => ({ ...d, answerMd: e.target.value }))}
              className="w-full rounded border border-white/15 bg-transparent px-2 py-1.5 font-mono text-xs"
            />
            {/*
              Said out loud on the surface where somebody would otherwise expect a button.
              Nothing generates this text: a page goes out on the client's own domain under
              their name, and an unreviewed paragraph about a business we do not run is not
              a thing to publish on their behalf.
            */}
            <p className="mt-1 text-xs text-[rgba(255,255,255,0.4)]">
              Written by a person. Nothing here drafts it for you.
            </p>
          </div>

          <button
            type="button"
            onClick={async () => {
              const ok = await post(
                {
                  action: "page_save",
                  slug: draft.title,
                  title: draft.title,
                  question: draft.question,
                  answerMd: draft.answerMd,
                  metaDescription: draft.metaDescription || null,
                  sourceReportId: draft.sourceReportId || null,
                },
                "save"
              );
              if (ok) {
                setDraft({ ...BLANK });
                setOpen(false);
              }
            }}
            disabled={busy !== null}
            className="rounded border border-white/15 px-3 py-1.5 text-sm hover:border-white/40 disabled:opacity-40"
          >
            {busy === "save" ? "Saving…" : "Save as draft"}
          </button>
        </div>
      )}

      {error && <p className="text-sm text-red-300">{error}</p>}
      {notice && <p className="text-sm text-[#00C9A7]">{notice}</p>}
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div>
      <label className="mb-1 block text-xs text-[rgba(255,255,255,0.5)]">{label}</label>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded border border-white/15 bg-transparent px-2 py-1.5 text-sm"
      />
    </div>
  );
}
