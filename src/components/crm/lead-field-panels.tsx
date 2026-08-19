"use client";

// The lead record, editable in place.
//
// Click a value, it becomes an input. Enter or blur saves that ONE field, Esc
// cancels. One field per PATCH is deliberate: /api/crm/leads/[id] writes a
// lead_field_history row per changed column, and a whole-panel save would make a
// failure ambiguous about which field did not land.
//
// Everything here rides on the write path that already existed and had no callers:
// PATCH -> updateLeadFields() -> contacts + lead_field_history + one summary touch.
// So an edit shows up in the timeline below without this component doing anything.

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { formatPhoneUS } from "@/lib/clients/normalize";
import { normalizeTarget, normalizeErrorMessage } from "@/lib/scan/normalize";
import { LEAD_FIELD_GROUPS, type LeadFieldDef } from "@/config/lead-fields";

/** Matches the page's old fmt(): empty reads as a dash, numbers get separators. */
function display(value: string | null, kind: LeadFieldDef["kind"]): string {
  if (value === null || value === "") return "";
  if (kind === "number") {
    const n = Number(value);
    return Number.isFinite(n) ? n.toLocaleString() : value;
  }
  if (kind === "phone") return formatPhoneUS(value) || value;
  if (kind === "date") return value.slice(0, 10);
  // The panel column is 300px. https:// and a trailing slash are the two parts
  // of a URL that carry no information and eat a third of the width.
  if (kind === "url") return value.replace(/^https?:\/\//i, "").replace(/\/$/, "");
  return value;
}

/** What goes INTO the input when editing starts. */
function toInputValue(value: string | null, kind: LeadFieldDef["kind"]): string {
  if (value === null) return "";
  if (kind === "date") return value.slice(0, 10);
  if (kind === "phone") return formatPhoneUS(value);
  return value;
}

type Parsed = { value: string | number | null } | { error: string };

/**
 * What gets sent to the API.
 *
 * Returns an error rather than a value when the input cannot be sent safely, so
 * a bad number never reaches PostgREST — a string in a numeric column fails the
 * WHOLE row, not just the offending field.
 */
function toPatchValue(raw: string, kind: LeadFieldDef["kind"]): Parsed {
  const trimmed = raw.trim();
  if (trimmed === "") return { value: null };

  if (kind === "number") {
    // "$12,500" is the shape people actually type. Strip the money furniture
    // rather than rejecting it, but refuse anything still non-numeric.
    const cleaned = trimmed.replace(/[$,\s]/g, "");
    const n = Number(cleaned);
    if (!Number.isFinite(n)) return { error: "Numbers only" };
    return { value: n };
  }

  if (kind === "email") {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(trimmed)) {
      return { error: "Not a valid email" };
    }
    return { value: trimmed.toLowerCase() };
  }

  if (kind === "phone") {
    const digits = trimmed.replace(/\D/g, "");
    if (digits.length < 10) return { error: "Needs 10 digits" };
    // Sent as typed. The route runs it through normalizeLeadPhone(), the same
    // door every inbound funnel uses, so there is one E.164 implementation.
    return { value: trimmed };
  }

  if (kind === "date") {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return { error: "Use YYYY-MM-DD" };
    return { value: trimmed };
  }

  if (kind === "url") {
    // The same normalizer /scan puts in front of a stranger's paste. Reused
    // rather than rewritten because it already answers the question this field
    // exists to answer: is this something researchWebsite() can be pointed at.
    // It is forgiving on the front (bare domain, deep link, mixed case) and
    // strict on the back (https, public host, real TLD), and it returns the
    // ORIGIN, which is where the audit's crawl has to start anyway.
    const norm = normalizeTarget(trimmed);
    if (!norm.ok) return { error: normalizeErrorMessage(norm.error) };
    return { value: norm.target.website };
  }

  return { value: trimmed };
}

function FieldRow({
  contactId,
  field,
  value,
}: {
  contactId: string;
  field: LeadFieldDef;
  value: string | null;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Held so the row shows the new value the instant it saves, rather than
  // flashing the old one until router.refresh() lands.
  const [local, setLocal] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  // setSaving is batched, so two rapid calls (Enter, then the blur that follows
  // the input unmounting) can both pass a check on `saving` and PATCH twice.
  const savingRef = useRef(false);

  // The refresh has landed when the server sends a different value down. Drop the
  // optimistic copy then — keeping it would pin the row to what was TYPED, and
  // the server legitimately rewrites some values (a phone is stored as E.164, so
  // "(989) 529-2078" comes back as "+19895292078" and would never be seen).
  const [seen, setSeen] = useState(value);
  if (value !== seen) {
    setSeen(value);
    setDirty(false);
  }

  const current = dirty ? local : value;
  const readOnly = field.kind === "readonly";

  function start() {
    if (readOnly || saving) return;
    setDraft(toInputValue(current, field.kind));
    setError(null);
    setEditing(true);
  }

  function cancel() {
    setEditing(false);
    setError(null);
  }

  async function save() {
    if (!editing || savingRef.current) return;
    const parsed = toPatchValue(draft, field.kind);
    if ("error" in parsed) {
      setError(parsed.error);
      return;
    }

    // Nothing changed — close quietly rather than writing a no-op history row.
    const next = parsed.value === null ? null : String(parsed.value);
    if (next === (current ?? null)) {
      setEditing(false);
      setError(null);
      return;
    }

    savingRef.current = true;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/crm/leads/${contactId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ [field.key]: parsed.value }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Save failed");
      setLocal(next);
      setDirty(true);
      setEditing(false);
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }

  const shown = display(current, field.kind);

  return (
    <div className="text-[11px]">
      <div className="flex items-start justify-between gap-3">
        <dt className="shrink-0 pt-0.5 text-[rgba(255,255,255,0.35)]">{field.label}</dt>
        <dd className="min-w-0 flex-1 text-right">
          {editing ? (
            <input
              autoFocus
              type={field.kind === "date" ? "date" : "text"}
              value={draft}
              disabled={saving}
              onChange={(e) =>
                setDraft(
                  field.kind === "phone" ? formatPhoneUS(e.target.value) : e.target.value
                )
              }
              onBlur={() => void save()}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  void save();
                } else if (e.key === "Escape") {
                  e.preventDefault();
                  cancel();
                }
              }}
              className="w-full rounded border border-[#00C9A7] bg-[rgba(0,0,0,0.4)] px-1.5 py-0.5 text-right text-[11px] text-white outline-none disabled:opacity-50"
            />
          ) : readOnly ? (
            <span className="block truncate text-[rgba(255,255,255,0.45)]">
              {shown || "—"}
            </span>
          ) : (
            // The click-to-edit button stays the whole row for every kind. A url
            // gets one extra affordance beside it rather than instead of it:
            // making the value itself a link would leave no way to correct a
            // typo except deleting the field.
            <div className="flex items-center justify-end gap-1">
              <button
                type="button"
                onClick={start}
                title="Click to edit"
                className={
                  "min-w-0 flex-1 truncate rounded px-1.5 py-0.5 text-right hover:bg-[rgba(255,255,255,0.06)] " +
                  (shown ? "text-[rgba(255,255,255,0.75)]" : "text-[rgba(255,255,255,0.28)]")
                }
              >
                {saving ? "Saving…" : shown || "+ add"}
              </button>
              {field.kind === "url" && current && (
                <a
                  href={current}
                  target="_blank"
                  rel="noreferrer noopener"
                  title="Open in a new tab"
                  className="shrink-0 rounded px-1 py-0.5 text-[rgba(255,255,255,0.35)] hover:bg-[rgba(255,255,255,0.06)] hover:text-[#00C9A7]"
                >
                  &#8599;
                </a>
              )}
            </div>
          )}
        </dd>
      </div>
      {error && <p className="mt-0.5 text-right text-[10px] text-[#E74C3C]">{error}</p>}
    </div>
  );
}

export function LeadFieldPanels({
  contactId,
  values,
}: {
  contactId: string;
  values: Record<string, string | null>;
}) {
  return (
    <>
      {LEAD_FIELD_GROUPS.map((g) => (
        <div
          key={g.title}
          className="rounded-xl border border-[rgba(255,255,255,0.07)] bg-[rgba(255,255,255,0.02)] p-3"
        >
          <p className="mb-2 text-[10px] uppercase tracking-widest text-[rgba(255,255,255,0.3)]">
            {g.title}
          </p>
          <dl className="space-y-1.5">
            {g.fields.map((f) => (
              <FieldRow
                key={f.key}
                contactId={contactId}
                field={f}
                value={values[f.key] ?? null}
              />
            ))}
          </dl>
        </div>
      ))}
    </>
  );
}
