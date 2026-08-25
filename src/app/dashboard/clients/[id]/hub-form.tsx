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

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { hasBannedDash } from "@/lib/copy-guard";

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

// `id` is what turns the writer into an editor. savePage has always accepted one and the
// route has always forwarded it; there was simply no control on this panel that could set it,
// so every saved page was write-once and unreachable.
const BLANK = {
  id: "",
  title: "",
  question: "",
  answerMd: "",
  metaDescription: "",
  sourceReportId: "",
};

/**
 * The markdown toolbar.
 *
 * Plain textarea surgery: selectionStart/selectionEnd and setRangeText, no editor library.
 * There is none in this repo and one button row does not justify adding one, on a surface
 * whose output has to stay markdown a person can read in a diff.
 *
 * ‼️ THERE IS NO FONT OR SIZE CONTROL HERE AND THERE MUST NOT BE. See the note rendered
 * under the box: react-markdown runs WITHOUT rehype-raw, deliberately, and per-page styling
 * means turning that off on the one surface a client's customers visit.
 */
type Tool =
  | { kind: "wrap"; label: string; title: string; before: string; after: string; placeholder: string }
  | { kind: "line"; label: string; title: string; prefix: string; placeholder: string }
  | { kind: "ordered"; label: string; title: string; placeholder: string };

const TOOLS: Tool[] = [
  { kind: "wrap", label: "B", title: "Bold", before: "**", after: "**", placeholder: "bold text" },
  { kind: "wrap", label: "I", title: "Italic", before: "_", after: "_", placeholder: "italic text" },
  { kind: "line", label: "H2", title: "Heading", prefix: "## ", placeholder: "Heading" },
  { kind: "line", label: "• List", title: "Bulleted list", prefix: "- ", placeholder: "item" },
  { kind: "ordered", label: "1. List", title: "Numbered list", placeholder: "item" },
  { kind: "line", label: "Quote", title: "Quote", prefix: "> ", placeholder: "quote" },
  { kind: "wrap", label: "Link", title: "Link", before: "[", after: "](https://)", placeholder: "link text" },
];

function applyTool(el: HTMLTextAreaElement, tool: Tool): string {
  const value = el.value;
  const start = el.selectionStart;
  const end = el.selectionEnd;
  const selected = value.slice(start, end);

  if (tool.kind === "wrap") {
    const body = selected || tool.placeholder;
    const next = value.slice(0, start) + tool.before + body + tool.after + value.slice(end);
    const caret = start + tool.before.length;
    queueMicrotask(() => el.setSelectionRange(caret, caret + body.length));
    return next;
  }

  // Line tools apply to every line of the selection, or to the line the caret sits on. Taking
  // only the first line would silently leave everything below it unmarked on a multi-line
  // selection, which is the shape a pasted paragraph always arrives in.
  const lineStart = value.lastIndexOf("\n", start - 1) + 1;
  const nextBreak = value.indexOf("\n", start);
  const lineEnd = end === start ? (nextBreak === -1 ? value.length : nextBreak) : end;
  const block = value.slice(lineStart, lineEnd) || tool.placeholder;
  const marked = block
    .split("\n")
    .map((line, i) => (tool.kind === "ordered" ? `${i + 1}. ${line}` : `${tool.prefix}${line}`))
    .join("\n");
  const next = value.slice(0, lineStart) + marked + value.slice(lineEnd);
  queueMicrotask(() => el.setSelectionRange(lineStart, lineStart + marked.length));
  return next;
}

export function HubForm({
  clientId,
  domain,
  wanted,
  hosts,
  pages,
  prompts,
  day0ArchivedAt,
  day0Source,
  vercelConfigured,
  dnsVerified,
  dnsTotal,
  themeConfirmedAt,
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
  /**
   * Is HUB_VERCEL_TOKEN / PROJECT_ID / TEAM_ID actually configured on this deployment?
   *
   * %s A DISTINCT STATE FROM "not attached", and conflating them cost a whole pilot.
   * With no token, registerClientHosts() returns a warning and attaches nothing, so every
   * hostname renders "not attached to Vercel" %s which reads as "nobody has pressed the button
   * yet" when it actually means "the button cannot work". Two identical-looking rows, two
   * completely different things to do about it.
   */
  vercelConfigured: boolean;
  /** How many of the three DNS records the resolver has actually seen. */
  dnsVerified: number;
  dnsTotal: number;
  /** Set once a person pressed Confirm on the Theme panel. */
  themeConfirmedAt: string | null;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [draft, setDraft] = useState({ ...BLANK });
  const [open, setOpen] = useState(false);
  const [drafting, setDrafting] = useState(false);
  const [draftError, setDraftError] = useState<string | null>(null);
  const [showPreview, setShowPreview] = useState(true);
  const bodyRef = useRef<HTMLTextAreaElement | null>(null);

  const runTool = (tool: Tool) => {
    const el = bodyRef.current;
    if (!el) return;
    const next = applyTool(el, tool);
    setDraft((d) => ({ ...d, answerMd: next }));
    el.focus();
  };

  /**
   * Open a saved page in the writer.
   *
   * ‼️ THE BODY IS FETCHED, NOT SHIPPED WITH THE PAGE. The board's own query selects only
   * id/slug/title/question/status/published_at, and widening it would put every page body of
   * every client into the initial HTML of a page that mostly is not being used to edit one.
   * GET /api/clients/[id]/hub already returns listAllForBoard, which carries answerMd, so the
   * cost is one request at the moment somebody actually presses Edit.
   */
  const editPage = async (pageId: string) => {
    setBusy(pageId);
    setError(null);
    setDraftError(null);
    try {
      const res = await fetch(`/api/clients/${clientId}/hub`);
      const json = (await res.json()) as {
        ok?: boolean;
        pages?: Array<{
          id: string;
          title: string;
          question: string;
          answerMd?: string;
          metaDescription?: string | null;
        }>;
      };
      const found = json.pages?.find((x) => x.id === pageId);
      if (!found) {
        setError("That page could not be loaded.");
        return;
      }
      setDraft({
        id: found.id,
        title: found.title,
        question: found.question,
        answerMd: found.answerMd ?? "",
        metaDescription: found.metaDescription ?? "",
        sourceReportId: "",
      });
      setOpen(true);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

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

  /**
   * Fill the form from a first draft.
   *
   * ‼️ DELIBERATELY NOT post(). That helper sets the shared notice, refreshes the router and
   * returns a boolean, all of which are about a write that happened. Nothing is written here:
   * the draft lands in local state and the person still presses Save.
   */
  async function draftIt() {
    if (!draft.question.trim()) return;
    setDrafting(true);
    setDraftError(null);
    try {
      const res = await fetch(`/api/clients/${clientId}/hub`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "page_draft", question: draft.question }),
      });
      const json = (await res.json()) as {
        ok: boolean;
        error?: string;
        draft?: { title: string; answerMd: string; metaDescription: string };
      };
      if (!json.ok || !json.draft) {
        setDraftError(json.error ?? "That did not draft.");
      } else {
        setDraft((d) => ({
          ...d,
          title: json.draft!.title,
          answerMd: json.draft!.answerMd,
          metaDescription: json.draft!.metaDescription,
        }));
      }
    } catch (e) {
      setDraftError((e as Error).message);
    } finally {
      setDrafting(false);
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

  // ‼️ FIVE THINGS HAVE TO BE TRUE AND THEY FAIL IN A FIXED ORDER, so the panel names the
  // FIRST unmet one rather than showing five independent ticks. On the pilot the hub was
  // "built" with none of these true, and the only signal was review_tool_preview refusing two
  // steps later for a reason that sounded like it belonged to the review tool.
  const attachedCount = hosts.filter((h) => h.attached).length;
  const steps: Array<{ label: string; ok: boolean; fix: string }> = [
    {
      label: "Domain on file",
      ok: Boolean(domain),
      fix: "Intake step 1 sets it. Without a domain there is no hostname to build.",
    },
    {
      label: "Vercel configured",
      ok: vercelConfigured,
      fix: "HUB_VERCEL_TOKEN, HUB_VERCEL_PROJECT_ID or HUB_VERCEL_TEAM_ID is missing on this deployment. Nothing can attach until it is set. Set it with the REST API, not `vercel env add`.",
    },
    {
      label: "Hostnames attached",
      ok: attachedCount > 0 && attachedCount >= (wanted.length || 2),
      fix: "Press Attach below. It also writes the real CNAME target into the DNS panel, replacing the generic default.",
    },
    {
      label: `DNS resolving (${dnsVerified}/${dnsTotal})`,
      ok: dnsTotal > 0 && dnsVerified >= dnsTotal,
      fix: "The client adds the three records in their registrar. Read them off the DNS panel above. Propagation runs up to an hour, so re-check rather than assuming it is wrong.",
    },
    {
      label: "Theme confirmed",
      ok: Boolean(themeConfirmedAt),
      fix: "Identity and theme panel, extract or set the colours, then Confirm. Until then the hub and the review tool render in SRT's colours on the client's own domain.",
    },
  ];
  const blocking = steps.find((x) => !x.ok) ?? null;

  return (
    <div className="space-y-5">
      {/* — Where this client actually is, in one strip — */}
      <div className="rounded-lg border border-white/10 bg-white/[0.02] p-3">
        <div className="flex flex-wrap gap-x-4 gap-y-1.5">
          {steps.map((x) => (
            <span
              key={x.label}
              className={
                "inline-flex items-center gap-1.5 text-xs " +
                (x.ok ? "text-[#00C9A7]" : x === blocking ? "text-[#F5A623]" : "text-[rgba(255,255,255,0.3)]")
              }
            >
              <span aria-hidden>{x.ok ? "●" : x === blocking ? "◉" : "○"}</span>
              {x.label}
            </span>
          ))}
        </div>
        <p className="mt-2 text-xs leading-relaxed text-[rgba(255,255,255,0.5)]">
          {blocking ? (
            <>
              <span className="text-[#F5A623]">Next: {blocking.label}.</span> {blocking.fix}
            </>
          ) : (
            <span className="text-[#00C9A7]">
              Everything this hub needs is in place. Pages published here are live on the
              client&apos;s own domain.
            </span>
          )}
        </p>
      </div>
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
                    <span className="text-[rgba(255,255,255,0.35)]">
                      {vercelConfigured ? "not attached to Vercel" : "cannot attach: Vercel not configured"}
                    </span>
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
            disabled={busy !== null || !vercelConfigured}
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
            <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => editPage(page.id)}
              disabled={busy !== null}
              className="rounded border border-white/15 px-2 py-1 text-xs hover:border-white/40 disabled:opacity-40"
            >
              Edit
            </button>
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
          onClick={() => {
            // Clearing the draft on close is load-bearing: leaving an id behind would make the
            // next "Write a page" quietly overwrite the page that was last edited.
            if (open) setDraft({ ...BLANK });
            setOpen((v) => !v);
          }}
          className="rounded border border-white/15 px-3 py-1.5 text-sm hover:border-white/40"
        >
          {open ? "Close" : "Write a page"}
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
            <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
              <label className="text-xs text-[rgba(255,255,255,0.5)]">
                The answer, in Markdown
              </label>
              <button
                type="button"
                onClick={() => setShowPreview((v) => !v)}
                className="rounded border border-white/15 px-2 py-0.5 text-xs text-white/60 hover:border-white/40 hover:text-white"
              >
                {showPreview ? "Hide preview" : "Show preview"}
              </button>
            </div>

            <div className="mb-1 flex flex-wrap gap-1">
              {TOOLS.map((tool) => (
                <button
                  key={tool.label}
                  type="button"
                  title={tool.title}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => runTool(tool)}
                  className="rounded border border-white/10 px-2 py-1 text-xs text-white/70 hover:border-white/40 hover:text-white"
                >
                  {tool.label}
                </button>
              ))}
            </div>

            <div className={showPreview ? "grid gap-2 md:grid-cols-2" : ""}>
              <textarea
                ref={bodyRef}
                rows={showPreview ? 18 : 12}
                value={draft.answerMd}
                onChange={(e) => setDraft((d) => ({ ...d, answerMd: e.target.value }))}
                className="w-full rounded border border-white/15 bg-transparent px-2 py-1.5 font-mono text-xs"
              />
              {showPreview && (
                <div className="min-h-[8rem] overflow-auto rounded border border-white/10 bg-black/20 px-3 py-2 text-sm text-white/85 [&_a]:underline [&_blockquote]:border-l-2 [&_blockquote]:border-white/20 [&_blockquote]:pl-3 [&_blockquote]:text-white/60 [&_h2]:mb-1 [&_h2]:mt-3 [&_h2]:text-base [&_h2]:font-semibold [&_h3]:mb-1 [&_h3]:mt-3 [&_h3]:text-sm [&_h3]:font-semibold [&_li]:mb-1 [&_ol]:mb-2 [&_ol]:list-decimal [&_ol]:pl-5 [&_p]:mb-2 [&_ul]:mb-2 [&_ul]:list-disc [&_ul]:pl-5">
                  {/*
                    ‼️ NO rehype-raw, HERE OR IN src/components/hub/hub-bodies.tsx. That file is
                    the authority on how a body renders and this is a second renderer beside it,
                    which is a drift risk taken deliberately: hub-bodies.tsx is a server
                    component and cannot be imported into a "use client" file. The ONE thing
                    that must never drift is this flag. A body is typed into this box and then
                    served on the client's own domain under their name, so a paste carrying a
                    <script> would be an XSS on their site, not ours. If this preview ever
                    renders something the live page does not, fix the preview.
                  */}
                  {draft.answerMd.trim() ? (
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>{draft.answerMd}</ReactMarkdown>
                  ) : (
                    <p className="text-xs text-[rgba(255,255,255,0.35)]">
                      The preview shows what a reader sees.
                    </p>
                  )}
                </div>
              )}
            </div>

            {/*
              ‼️ FONT STYLE AND SIZE ARE A THEME DECISION, NOT A PER-PAGE ONE, AND THE PANEL HAS
              TO SAY SO RATHER THAN JUST NOT OFFERING THEM. Asked for "at least the font style,
              size and other stuff", the obvious build is inline styling per page, and the
              obvious way to ship that is to turn rehype-raw on. That is the one change this
              surface cannot take: these bodies go out on a client's own domain, in front of
              their customers. theme.fontFamily already exists, is validated by safeFontFamily,
              applies to the whole hub, and is the correct control.
            */}
            <p className="mt-2 text-xs text-[rgba(255,255,255,0.4)]">
              Font and size are set once for the whole hub in{" "}
              <span className="text-white/70">Identity and theme</span> above, not per page. This
              box is Markdown on purpose: raw HTML is not rendered, because a page served on{" "}
              {domain ? <span className="font-mono">{domain}</span> : "the client's own domain"}{" "}
              under their name must not be able to carry a pasted script.
            </p>

            {hasBannedDash(draft.answerMd) && (
              <p className="mt-1 text-xs text-[#F5A623]">
                There is an em dash, en dash or double hyphen in the body. SRT copy uses commas,
                periods and single hyphens. Nothing blocks the save; this is the same rule
                guard() enforces at build time on copy written in code.
              </p>
            )}
            {/*
              ‼️ THE NOTE HERE USED TO SAY "Nothing here drafts it for you", AND ITS REASON WAS
              RIGHT ABOUT THE WRONG CONTROL. A page goes out on the client's own domain under
              their name, so an unreviewed paragraph must never reach the public. That is
              enforced by Publish being a separate deliberate press behind the Day-0 wall —
              not by refusing to produce a first draft. Writing every page from an empty box is
              not a delivery pipeline, and publishing answers to the questions a client is
              absent from is the entire product.

              What this button does NOT do: save, publish, or write anything to the database.
              It fills this textarea and stops.
            */}
            <div className="mt-1 flex flex-wrap items-center gap-2">
              <button
                type="button"
                disabled={drafting || !draft.question.trim()}
                onClick={draftIt}
                className="rounded border border-white/15 px-2 py-1 text-xs text-white/70 hover:border-white/40 hover:text-white disabled:opacity-40"
              >
                {drafting ? "Drafting…" : "Draft it"}
              </button>
              <span className="text-xs text-[rgba(255,255,255,0.4)]">
                {draft.question.trim()
                  ? "Grounded in their own site. Read every line before you save it."
                  : "Pick a question first."}
              </span>
            </div>
            {draftError && <p className="mt-1 text-xs text-[#FF6B6B]">{draftError}</p>}
          </div>

          <button
            type="button"
            onClick={async () => {
              const ok = await post(
                {
                  action: "page_save",
                  // Present only when editing. savePage branches on it: with an id it UPDATES
                  // that row, without one it inserts. Sending "" would be an insert with a
                  // slug that already exists, i.e. a 23505 on every save of an edited page.
                  id: draft.id || undefined,
                  // ‼️ THE SLUG COMES FROM THE TITLE, WHICH MEANS RETITLING AN EDITED PAGE
                  // MOVES ITS URL. That is right while it is a draft and wrong once it is
                  // published and indexed. Publish is the deliberate press that ends the
                  // first case, and an already-published page is edited knowingly.
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
            {busy === "save" ? "Saving…" : draft.id ? "Save changes" : "Save as draft"}
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
