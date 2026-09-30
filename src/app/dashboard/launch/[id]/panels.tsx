"use client";

// The four things a person actually DOES on this lane: upload the documents, confirm the words,
// buy the domain, paste the site.
//
// ‼️ EVERY PANEL REPORTS WHAT HAPPENED, INCLUDING THE PARTS NOBODY ASKED ABOUT.
// The sanitiser's removals, the price a domain was bought at, which of the four documents is
// still missing. A panel that only says "saved" is how a stripped analytics tag, or a form still
// posting to a mock-up endpoint, becomes something discovered months later.

import { useState } from "react";
import { useRouter } from "next/navigation";

interface DocStatus {
  kind: string;
  label: string;
  present: boolean;
  evidenceMissing: boolean;
  chars: number | null;
}

interface AudienceView {
  label: string;
  confirmedAt: string | null;
  laneName: string | null;
  launcherLabel: string | null;
  buyer: string | null;
  offer: string | null;
  visit: string | null;
  business: string | null;
  source: string | null;
}

interface Proposal {
  slug: string;
  label: string;
  buyerSingular: string;
  buyerPlural: string;
  offerSingular: string;
  offerPlural: string;
  businessNoun: string;
  visitNoun: string;
  laneName: string;
  launcherLabel: string;
  hardLines: string[];
  rationale: string;
}

interface Candidate {
  domain: string;
  available: boolean;
  priceCents: number | null;
  renewalCents: number | null;
}

const card = "rounded-xl border border-[rgba(255,255,255,0.1)] bg-[rgba(255,255,255,0.02)] p-4";
const heading = "text-xs font-medium uppercase tracking-wider text-[rgba(255,255,255,0.4)]";
const btn =
  "rounded-lg border border-[rgba(0,201,167,0.4)] px-3 py-1.5 text-xs text-[#00C9A7] disabled:opacity-40";
const input =
  "w-full rounded-lg border border-[rgba(255,255,255,0.12)] bg-[rgba(255,255,255,0.03)] px-2.5 py-1.5 text-xs text-white outline-none focus:border-[rgba(0,201,167,0.5)]";

function money(cents: number | null): string {
  return cents === null ? "price unknown" : `$${(cents / 100).toFixed(2)}`;
}

export interface OfferView {
  treatment: string | null;
  outcomePromise: string | null;
  lockedAt: string | null;
}

export function LaunchPanels({
  clientId,
  documents,
  host,
  audience,
  offer,
}: {
  clientId: string;
  documents: DocStatus[];
  host: string | null;
  audience: AudienceView | null;
  offer: OfferView | null;
}) {
  return (
    <div className="space-y-4">
      <DocumentsPanel clientId={clientId} documents={documents} />
      <VocabularyPanel clientId={clientId} audience={audience} />
      <OfferPanel clientId={clientId} offer={offer} />
      <DomainPanel clientId={clientId} host={host} />
      <SitePanel clientId={clientId} />
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

function DocumentsPanel({ clientId, documents }: { clientId: string; documents: DocStatus[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ kind: string; text: string; bad: boolean } | null>(null);

  async function upload(kind: string, file: File) {
    setBusy(kind);
    setMsg(null);
    const form = new FormData();
    form.set("kind", kind);
    form.set("file", file);
    try {
      const res = await fetch(`/api/launch/${clientId}/documents`, { method: "POST", body: form });
      const json = (await res.json()) as { ok: boolean; error?: string; chars?: number };
      setMsg(
        json.ok
          ? { kind, text: `Stored, ${json.chars?.toLocaleString() ?? "?"} characters, and filed as evidence.`, bad: false }
          : { kind, text: json.error ?? "That did not work.", bad: true }
      );
      if (json.ok) router.refresh();
    } catch {
      setMsg({ kind, text: "That did not work. Check your connection.", bad: true });
    }
    setBusy(null);
  }

  return (
    <div className={card}>
      <p className={heading}>The four documents</p>
      <p className="mt-1 text-[11px] text-[rgba(255,255,255,0.35)]">
        Each one is stored twice: as the framework document, and in the evidence library every page
        cites. That second copy is what replaces a website crawl.
      </p>
      <ul className="mt-3 space-y-2">
        {documents.map((d) => (
          <li key={d.kind}>
            <label className="flex cursor-pointer items-center gap-2">
              <span className={d.present ? "text-[#00C9A7]" : "text-[rgba(255,255,255,0.2)]"}>
                {d.present ? "✓" : "○"}
              </span>
              <span className="min-w-0 flex-1 truncate text-xs text-[rgba(255,255,255,0.7)]" title={d.label}>
                {d.kind.replace(/_/g, " ")}
              </span>
              <input
                type="file"
                accept=".pdf,.docx,.md,.txt"
                className="hidden"
                disabled={busy !== null}
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void upload(d.kind, f);
                  e.target.value = "";
                }}
              />
              <span className="shrink-0 text-[11px] text-[#00C9A7]">
                {busy === d.kind ? "reading..." : d.present ? "replace" : "upload"}
              </span>
            </label>
            {d.evidenceMissing && (
              <p className="ml-6 mt-0.5 text-[11px] text-[#F5A623]">
                stored, but not filed as evidence. Upload it again.
              </p>
            )}
            {msg?.kind === d.kind && (
              <p className={`ml-6 mt-0.5 text-[11px] ${msg.bad ? "text-[#FF6B6B]" : "text-[rgba(255,255,255,0.45)]"}`}>
                {msg.text}
              </p>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

function VocabularyPanel({ clientId, audience }: { clientId: string; audience: AudienceView | null }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [proposal, setProposal] = useState<Proposal | null>(null);
  const [from, setFrom] = useState<"preset" | "documents">("documents");

  async function propose() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/launch/${clientId}/vocabulary`);
      const json = (await res.json()) as { ok: boolean; error?: string; proposal?: Proposal; from?: "preset" | "documents" };
      if (!json.ok || !json.proposal) setError(json.error ?? "That did not work.");
      else {
        setProposal(json.proposal);
        setFrom(json.from ?? "documents");
      }
    } catch {
      setError("That did not work. Check your connection.");
    }
    setBusy(false);
  }

  async function confirm() {
    if (!proposal) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/launch/${clientId}/vocabulary`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ proposal, from }),
      });
      const json = (await res.json()) as { ok: boolean; error?: string };
      if (!json.ok) setError(json.error ?? "That did not work.");
      else {
        setProposal(null);
        router.refresh();
      }
    } catch {
      setError("That did not work. Check your connection.");
    }
    setBusy(false);
  }

  const set = (k: keyof Proposal, v: string) =>
    setProposal((p) => (p ? { ...p, [k]: v } : p));

  return (
    <div className={card}>
      <p className={heading}>The words</p>

      {audience?.confirmedAt ? (
        <div className="mt-2 space-y-1 text-[11px] text-[rgba(255,255,255,0.5)]">
          <p className="text-xs text-white">{audience.laneName ?? "AI Booking Bot"}</p>
          <p>
            a {audience.buyer} buying a {audience.offer}, from a {audience.business}, booking a{" "}
            {audience.visit}
          </p>
          <p className="text-[rgba(255,255,255,0.3)]">confirmed, source {audience.source ?? "unrecorded"}</p>
        </div>
      ) : (
        <p className="mt-1 text-[11px] text-[rgba(255,255,255,0.35)]">
          Not confirmed. Nothing speaks to a visitor until it is: the widget refuses to serve rather
          than guessing what to call this business&apos;s buyer.
        </p>
      )}

      {!proposal && (
        <button onClick={() => void propose()} disabled={busy} className={`${btn} mt-3`}>
          {busy ? "Reading the documents..." : audience?.confirmedAt ? "Propose again" : "Propose from the documents"}
        </button>
      )}

      {error && <p className="mt-2 text-[11px] text-[#FF6B6B]">{error}</p>}

      {proposal && (
        <div className="mt-3 space-y-2">
          <p className="text-[11px] text-[rgba(255,255,255,0.4)]">{proposal.rationale}</p>
          {(
            [
              ["they are a", "buyerSingular"],
              ["they buy a", "offerSingular"],
              ["from a", "businessNoun"],
              ["booking a", "visitNoun"],
              ["the bot is called", "laneName"],
              ["the button says", "launcherLabel"],
            ] as [string, keyof Proposal][]
          ).map(([label, key]) => (
            <label key={key} className="block">
              <span className="text-[11px] text-[rgba(255,255,255,0.35)]">{label}</span>
              <input value={String(proposal[key])} onChange={(e) => set(key, e.target.value)} className={input} />
            </label>
          ))}
          {proposal.hardLines.length > 0 && (
            <div>
              <p className="text-[11px] text-[rgba(255,255,255,0.35)]">it may never:</p>
              <ul className="mt-1 list-disc space-y-0.5 pl-4 text-[11px] text-[rgba(255,255,255,0.5)]">
                {proposal.hardLines.map((l) => (
                  <li key={l}>{l}</li>
                ))}
              </ul>
            </div>
          )}
          <div className="flex gap-2 pt-1">
            <button onClick={() => void confirm()} disabled={busy} className={btn}>
              {busy ? "Saving..." : "Confirm these words"}
            </button>
            <button
              onClick={() => setProposal(null)}
              className="text-[11px] text-[rgba(255,255,255,0.4)] hover:text-white"
            >
              Discard
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

function DomainPanel({ clientId, host }: { clientId: string; host: string | null }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [names, setNames] = useState("");
  const [results, setResults] = useState<Candidate[] | null>(null);
  const [buyable, setBuyable] = useState(true);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function search() {
    setBusy(true);
    setError(null);
    setResults(null);
    try {
      const res = await fetch(`/api/launch/${clientId}/domain`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "search",
          domains: names.split(/[\s,]+/).map((n) => n.trim()).filter(Boolean),
        }),
      });
      const json = (await res.json()) as {
        ok: boolean;
        error?: string;
        results?: Candidate[];
        buyable?: boolean;
        buyableNote?: string | null;
      };
      if (!json.ok) setError(json.error ?? "That did not work.");
      else {
        setResults(json.results ?? []);
        setBuyable(json.buyable !== false);
        setNote(json.buyableNote ?? null);
      }
    } catch {
      setError("That did not work. Check your connection.");
    }
    setBusy(false);
  }

  async function buy(c: Candidate) {
    if (c.priceCents === null) return;
    // ‼️ A CONFIRM, IN THE UI, NAMING THE DOMAIN AND THE PRICE. This is the only button in this
    // application that charges a card, and it is not undoable.
    const ok = window.confirm(
      `Buy ${c.domain} for ${money(c.priceCents)}?\n\nThis charges the Vercel account immediately and cannot be undone.`
    );
    if (!ok) return;

    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/launch/${clientId}/domain`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "buy", domain: c.domain, expectedPriceCents: c.priceCents }),
      });
      const json = (await res.json()) as { ok: boolean; error?: string; attach?: { error?: string } };
      if (!json.ok) setError(json.error ?? "That did not work.");
      else {
        if (json.attach?.error) setError(json.attach.error);
        setResults(null);
        router.refresh();
      }
    } catch {
      setError("The request failed in flight. Check the Vercel dashboard before retrying: the purchase may have gone through.");
    }
    setBusy(false);
  }

  return (
    <div className={card}>
      <p className={heading}>Domain</p>
      {host ? (
        <p className="mt-2 text-xs text-white">
          {host}
          <span className="ml-2 text-[11px] text-[rgba(255,255,255,0.35)]">attached, www redirects to it</span>
        </p>
      ) : (
        <>
          <p className="mt-1 text-[11px] text-[rgba(255,255,255,0.35)]">
            SRT buys and holds it, so there is no client DNS step and nothing to wait for.
          </p>
          <textarea
            value={names}
            onChange={(e) => setNames(e.target.value)}
            rows={2}
            placeholder="acmeroofing.com acmeroofingtx.com"
            className={`${input} mt-2 resize-y`}
          />
          <button onClick={() => void search()} disabled={busy || !names.trim()} className={`${btn} mt-2`}>
            {busy ? "Checking..." : "Check availability"}
          </button>
        </>
      )}

      {note && <p className="mt-2 text-[11px] text-[#F5A623]">{note}</p>}
      {error && <p className="mt-2 text-[11px] text-[#FF6B6B]">{error}</p>}

      {results && (
        <ul className="mt-3 space-y-1.5">
          {results.map((c) => (
            <li key={c.domain} className="flex items-center justify-between gap-2">
              <span className={`truncate text-xs ${c.available ? "text-white" : "text-[rgba(255,255,255,0.3)]"}`}>
                {c.domain}
              </span>
              {c.available ? (
                <button
                  onClick={() => void buy(c)}
                  disabled={busy || !buyable || c.priceCents === null}
                  className="shrink-0 rounded border border-[rgba(0,201,167,0.4)] px-2 py-1 text-[11px] text-[#00C9A7] disabled:opacity-40"
                  title={buyable ? "" : "The registrant contact is not configured"}
                >
                  Buy {money(c.priceCents)}
                </button>
              ) : (
                <span className="shrink-0 text-[11px] text-[rgba(255,255,255,0.25)]">taken</span>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

function SitePanel({ clientId }: { clientId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [path, setPath] = useState("/");
  const [title, setTitle] = useState("");
  const [html, setHtml] = useState("");
  const [removed, setRemoved] = useState<string[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function paste() {
    setBusy(true);
    setError(null);
    setRemoved(null);
    try {
      const res = await fetch(`/api/launch/${clientId}/site-page`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ path, title, html, publish: true }),
      });
      const json = (await res.json()) as { ok: boolean; error?: string; removed?: string[] };
      if (!json.ok) setError(json.error ?? "That did not work.");
      else {
        setRemoved(json.removed ?? []);
        setHtml("");
        router.refresh();
      }
    } catch {
      setError("That did not work. Check your connection.");
    }
    setBusy(false);
  }

  return (
    <div className={card}>
      <p className={heading}>Paste a page</p>
      <p className="mt-1 text-[11px] text-[rgba(255,255,255,0.35)]">
        Marketing pages only. The answer pages keep their own renderer and publish to /answers.
      </p>
      <div className="mt-2 space-y-2">
        <input value={path} onChange={(e) => setPath(e.target.value)} placeholder="/" className={input} />
        <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Page title" className={input} />
        <textarea
          value={html}
          onChange={(e) => setHtml(e.target.value)}
          rows={5}
          placeholder="Paste the HTML"
          className={`${input} resize-y font-mono`}
        />
        <button onClick={() => void paste()} disabled={busy || !html.trim() || !title.trim()} className={btn}>
          {busy ? "Storing..." : "Paste and publish"}
        </button>
      </div>

      {error && <p className="mt-2 text-[11px] text-[#FF6B6B]">{error}</p>}

      {removed && (
        <div className="mt-2 text-[11px]">
          {removed.length === 0 ? (
            <p className="text-[rgba(255,255,255,0.45)]">Stored. Nothing had to be removed.</p>
          ) : (
            <>
              <p className="text-[#F5A623]">Stored. Removed on the way in:</p>
              <ul className="mt-1 list-disc space-y-0.5 pl-4 text-[rgba(255,255,255,0.5)]">
                {removed.map((r) => (
                  <li key={r}>{r}</li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

function OfferPanel({ clientId, offer }: { clientId: string; offer: OfferView | null }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<{ treatment: string; outcomePromise: string; rationale: string } | null>(
    null
  );

  async function propose() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/launch/${clientId}/offer`);
      const json = (await res.json()) as {
        ok: boolean;
        error?: string;
        proposal?: { treatment: string; outcomePromise: string; rationale: string };
      };
      if (!json.ok || !json.proposal) setError(json.error ?? "That did not work.");
      else setDraft(json.proposal);
    } catch {
      setError("That did not work. Check your connection.");
    }
    setBusy(false);
  }

  async function confirm() {
    if (!draft) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/launch/${clientId}/offer`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ treatment: draft.treatment, outcomePromise: draft.outcomePromise }),
      });
      const json = (await res.json()) as { ok: boolean; error?: string };
      if (!json.ok) setError(json.error ?? "That did not work.");
      else {
        setDraft(null);
        router.refresh();
      }
    } catch {
      setError("That did not work. Check your connection.");
    }
    setBusy(false);
  }

  return (
    <div className={card}>
      <p className={heading}>The offer</p>

      {offer?.lockedAt ? (
        <div className="mt-2 space-y-1 text-[11px] text-[rgba(255,255,255,0.5)]">
          <p className="text-xs text-white">{offer.treatment}</p>
          {offer.outcomePromise && <p>{offer.outcomePromise}</p>}
          <p className="text-[rgba(255,255,255,0.3)]">locked</p>
        </div>
      ) : (
        <p className="mt-1 text-[11px] text-[rgba(255,255,255,0.35)]">
          Not locked. Read out of the short offer document, not typed from memory: the keywords and
          every page are built around it.
        </p>
      )}

      {!draft && (
        <button onClick={() => void propose()} disabled={busy} className={`${btn} mt-3`}>
          {busy ? "Reading the document..." : offer?.lockedAt ? "Read it again" : "Read the short offer"}
        </button>
      )}

      {error && <p className="mt-2 text-[11px] text-[#FF6B6B]">{error}</p>}

      {draft && (
        <div className="mt-3 space-y-2">
          <p className="text-[11px] text-[rgba(255,255,255,0.4)]">{draft.rationale}</p>
          <label className="block">
            <span className="text-[11px] text-[rgba(255,255,255,0.35)]">what is sold</span>
            <input
              value={draft.treatment}
              onChange={(e) => setDraft({ ...draft, treatment: e.target.value })}
              className={input}
            />
          </label>
          <label className="block">
            <span className="text-[11px] text-[rgba(255,255,255,0.35)]">the promise</span>
            <input
              value={draft.outcomePromise}
              onChange={(e) => setDraft({ ...draft, outcomePromise: e.target.value })}
              className={input}
            />
          </label>
          <div className="flex gap-2 pt-1">
            <button onClick={() => void confirm()} disabled={busy || !draft.treatment.trim()} className={btn}>
              {busy ? "Locking..." : "Lock the offer"}
            </button>
            <button
              onClick={() => setDraft(null)}
              className="text-[11px] text-[rgba(255,255,255,0.4)] hover:text-white"
            >
              Discard
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
