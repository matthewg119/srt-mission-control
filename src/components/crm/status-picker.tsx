"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ALL_STAGES, normalizeStage } from "@/config/stage-display";

// Status changes go through /api/crm/leads/[id]/status → crm.setLeadStatus,
// never a direct contacts UPDATE. That path is what writes lead_status_history
// and pushes to Zoho, and it is what makes the inbound webhook able to tell
// our own echo from a real change made in the Zoho UI.

export function LeadStatusPicker({
  contactId,
  current,
}: {
  contactId: string;
  current: string | null;
}) {
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function change(status: string) {
    if (status === current || saving) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/crm/leads/${contactId}/status`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Failed to update status");
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      <select
        // Normalized so a lead still carrying a pre-migration value renders as
        // its mapped stage instead of falling through to a blank select.
        value={current ? normalizeStage(current) : ""}
        disabled={saving}
        onChange={(e) => change(e.target.value)}
        className="w-full rounded-lg border border-[rgba(255,255,255,0.1)] bg-[rgba(0,0,0,0.3)] px-2.5 py-1.5 text-xs text-white disabled:opacity-50"
      >
        <option value="" disabled>
          Select a status…
        </option>
        {ALL_STAGES.map((s) => (
          <option key={s.name} value={s.name}>
            {s.name}
          </option>
        ))}
      </select>
      {error && <p className="mt-1.5 text-[11px] text-[#E74C3C]">{error}</p>}
    </div>
  );
}
