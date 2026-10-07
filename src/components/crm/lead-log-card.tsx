"use client";

import { useState } from "react";
import { PhoneCall, FileText, Phone } from "lucide-react";
import { formatPhoneUS, telHref } from "@/lib/clients/normalize";
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
  phone,
}: {
  contactId: string;
  leadName: string;
  defaultFollowUpDays?: number;
  /**
   * The lead's number, so the call can start from the card the outcome gets logged on.
   *
   * ‼️ THE PRIMARY PHONE, AND MOBILE IS DELIBERATELY NOT A SECOND BUTTON HERE. Two Call
   * buttons side by side is a choice to make before every call, on the one control that should
   * need no thought. The contact panel carries both and is where a mobile gets dialled.
   */
  phone?: string | null;
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
        <div className="flex min-w-0 items-center gap-2">
          {/*
            ‼️ THE CALL STARTS WHERE THE OUTCOME GETS LOGGED, which is the whole reason this
            is here as well as on the contact panel. Dialling from the panel on the left and then
            coming back here to record what happened is two places for one action, and the second
            half is the half that gets skipped.

            A `tel:` link, so the call goes to whatever this machine has registered as its
            dialler and the audio is wherever that dialler is. It is not a button that calls on
            its own: nothing here talks to a carrier. RingCentral RingOut is the other shape and
            needs a route of its own.
          */}
          {telHref(phone) && (
            <a
              href={telHref(phone) as string}
              title={`Call ${formatPhoneUS(phone ?? "") || phone}`}
              className="flex shrink-0 items-center gap-1.5 rounded-lg border border-[#00C9A7] bg-[rgba(0,201,167,0.12)] px-3 py-1.5 text-xs text-white transition-colors hover:bg-[rgba(0,201,167,0.2)]"
            >
              <Phone className="h-3.5 w-3.5" />
              Call
            </a>
          )}
          <span className="truncate text-xs text-[rgba(255,255,255,0.4)]">{leadName}</span>
        </div>
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
