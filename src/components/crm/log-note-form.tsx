"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { FileText } from "lucide-react";

// The other half of the log card: something worth remembering that was not a call.
//
// No follow-up date. See the comment in the note route for why — the mandatory
// date belongs to calls, and attaching it here would make it meaningless in both
// places.

export function LogNoteForm({ contactId }: { contactId: string }) {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canSave = content.trim().length > 0 && !saving;

  async function submit() {
    if (!canSave) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/crm/leads/${contactId}/note`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: title.trim() || undefined,
          content: content.trim(),
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Failed to save note");
      setTitle("");
      setContent("");
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      <input
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="Note title (optional)"
        className="mb-2 w-full rounded-lg border border-[rgba(255,255,255,0.1)] bg-[rgba(0,0,0,0.3)] px-3 py-2 text-xs text-white placeholder:text-[rgba(255,255,255,0.25)]"
      />

      <textarea
        value={content}
        onChange={(e) => setContent(e.target.value)}
        placeholder="What should we remember about this lead…"
        rows={4}
        className="mb-3 w-full resize-none rounded-lg border border-[rgba(255,255,255,0.1)] bg-[rgba(0,0,0,0.3)] px-3 py-2 text-xs text-white placeholder:text-[rgba(255,255,255,0.25)]"
      />

      {error && <p className="mb-2 text-xs text-[#E74C3C]">{error}</p>}

      <div className="flex items-center justify-between">
        <p className="flex items-center gap-1.5 text-[11px] text-[rgba(255,255,255,0.35)]">
          <FileText className="h-3 w-3" />
          {content.trim() ? "" : "Type something to save."}
        </p>
        <button
          onClick={submit}
          disabled={!canSave}
          className="rounded-lg bg-[#1B65A7] px-4 py-1.5 text-xs font-medium text-white transition-opacity disabled:cursor-not-allowed disabled:opacity-40"
        >
          {saving ? "Saving…" : "Save note"}
        </button>
      </div>
    </div>
  );
}
