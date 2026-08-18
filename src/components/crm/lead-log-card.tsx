"use client";

import { useState } from "react";
import { PhoneCall, FileText } from "lucide-react";
import { LogCallForm } from "./log-call-form";
import { LogNoteForm } from "./log-note-form";

// One card, two ways to record what happened.
//
// Both write to lead_activities and both land in the timeline below, so they
// belong in the same place rather than in two cards competing for the top of the
// column. The tab strip replaces LogCallForm's own header, which is why it is
// rendered with chrome={false}.

type Tab = "call" | "note";

export function LeadLogCard({
  contactId,
  leadName,
  defaultFollowUpDays,
}: {
  contactId: string;
  leadName: string;
  defaultFollowUpDays?: number;
}) {
  const [tab, setTab] = useState<Tab>("call");

  const TABS: Array<{ key: Tab; label: string; Icon: typeof PhoneCall }> = [
    { key: "call", label: "Log call", Icon: PhoneCall },
    { key: "note", label: "Add note", Icon: FileText },
  ];

  return (
    <div className="rounded-xl border border-[rgba(255,255,255,0.1)] bg-[rgba(255,255,255,0.03)] p-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="flex gap-1.5">
          {TABS.map(({ key, label, Icon }) => (
            <button
              key={key}
              type="button"
              onClick={() => setTab(key)}
              className={
                "flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs transition-colors " +
                (tab === key
                  ? "border-[#00C9A7] bg-[rgba(0,201,167,0.12)] text-white"
                  : "border-[rgba(255,255,255,0.1)] text-[rgba(255,255,255,0.5)] hover:text-white")
              }
            >
              <Icon className="h-3.5 w-3.5" />
              {label}
            </button>
          ))}
        </div>
        <span className="truncate text-xs text-[rgba(255,255,255,0.4)]">{leadName}</span>
      </div>

      {tab === "call" ? (
        <LogCallForm
          chrome={false}
          contactId={contactId}
          leadName={leadName}
          defaultFollowUpDays={defaultFollowUpDays}
        />
      ) : (
        <LogNoteForm contactId={contactId} />
      )}
    </div>
  );
}
