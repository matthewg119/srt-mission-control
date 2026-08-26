"use client";

import { useState } from "react";
import { HuntLink } from "./hunt-nav";
import { Phone, Clock, MessageCircle, CalendarX, Sparkles } from "lucide-react";
import type { WorklistBucket, WorklistItem } from "@/lib/worklist";
import { LogCallForm } from "./log-call-form";

// The call board. Grouped by WHY a lead is here, because "who do I call today"
// is really four different questions and they deserve different urgency.

const BUCKET_META: Record<
  WorklistBucket,
  { title: string; blurb: string; tone: string; icon: typeof Phone }
> = {
  replied: {
    title: "They replied",
    blurb: "Answered us and hasn't heard back. Highest cost to ignore.",
    tone: "#00C9A7",
    icon: MessageCircle,
  },
  overdue: {
    title: "Overdue follow-ups",
    blurb: "You committed to a date and it has passed.",
    tone: "#E74C3C",
    icon: Clock,
  },
  due_today: {
    title: "Due today",
    blurb: "Scheduled for today.",
    tone: "#F5A623",
    icon: CalendarX,
  },
  unscheduled: {
    title: "No follow-up scheduled",
    blurb: "Live leads with nothing on the calendar. This is how leads go quiet.",
    tone: "#9C27B0",
    icon: Sparkles,
  },
  cadence: {
    title: "Going stale",
    blurb: "Past the touch cadence for their stage.",
    tone: "#0E8C77",
    icon: Clock,
  },
};

const BUCKET_ORDER: WorklistBucket[] = [
  "replied",
  "overdue",
  "due_today",
  "unscheduled",
  "cadence",
];

function money(n: number | null): string | null {
  if (n === null || n === undefined) return null;
  return n >= 1000 ? `$${Math.round(n / 1000)}K` : `$${n}`;
}

function LeadCard({ lead, queueIds }: { lead: WorklistItem; queueIds: string[] }) {
  const [logging, setLogging] = useState(false);
  const tone = BUCKET_META[lead.bucket].tone;

  return (
    <div className="rounded-xl border border-[rgba(255,255,255,0.07)] bg-[rgba(255,255,255,0.02)] p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          {/* Freezes the board's order for the next/prev arrows. It matters more here
              than on the leads list: logging a call usually makes a lead INELIGIBLE, so
              it drops off this board entirely and a live re-query would lose your place
              every single time. */}
          <HuntLink
            id={lead.contactId}
            ids={queueIds}
            label="Call list"
            className="text-sm font-medium text-white hover:underline"
          >
            {lead.name}
          </HuntLink>
          {lead.businessName && lead.businessName !== lead.name && (
            <p className="truncate text-xs text-[rgba(255,255,255,0.45)]">{lead.businessName}</p>
          )}

          <div className="mt-1.5 flex flex-wrap items-center gap-2 text-[11px]">
            {lead.status && (
              <span
                className="rounded-md px-1.5 py-0.5"
                style={{ background: `${tone}22`, color: tone }}
              >
                {lead.status}
              </span>
            )}
            {lead.website && (
              <span className="text-[rgba(255,255,255,0.45)]">{lead.website}</span>
            )}
            {lead.daysSinceActivity !== null && (
              <span className="text-[rgba(255,255,255,0.35)]">
                {lead.daysSinceActivity}d since last touch
              </span>
            )}
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          {lead.phone && (
            <a
              href={`tel:${lead.phone}`}
              className="flex items-center gap-1.5 rounded-lg border border-[rgba(255,255,255,0.12)] px-3 py-1.5 text-xs text-white hover:bg-[rgba(255,255,255,0.06)]"
            >
              <Phone className="h-3.5 w-3.5" />
              {lead.phone}
            </a>
          )}
          <button
            onClick={() => setLogging((v) => !v)}
            className="rounded-lg bg-[#0E8C77] px-3 py-1.5 text-xs font-medium text-white"
          >
            {logging ? "Cancel" : "Log call"}
          </button>
        </div>
      </div>

      {/* The reasons the scorer produced, verbatim. A lead should always be
          able to explain why it is on today's list. */}
      {lead.reasons.length > 0 && (
        <ul className="mt-2.5 space-y-0.5">
          {lead.reasons.map((r, i) => (
            <li key={i} className="text-[11px] text-[rgba(255,255,255,0.5)]">
              · {r}
            </li>
          ))}
        </ul>
      )}

      {lead.lastNote?.body && (
        <p className="mt-2 line-clamp-2 rounded-lg bg-[rgba(0,0,0,0.25)] px-2.5 py-1.5 text-[11px] text-[rgba(255,255,255,0.4)]">
          {lead.lastNote.body}
        </p>
      )}

      {logging && (
        <div className="mt-3">
          <LogCallForm
            contactId={lead.contactId}
            leadName={lead.name}
            onClose={() => setLogging(false)}
          />
        </div>
      )}
    </div>
  );
}

export function WorklistBoard({ leads }: { leads: WorklistItem[] }) {
  const grouped = new Map<WorklistBucket, WorklistItem[]>();
  for (const l of leads) {
    const list = grouped.get(l.bucket) ?? [];
    list.push(l);
    grouped.set(l.bucket, list);
  }

  // Queue order follows the RENDERED order, bucket by bucket, so arrowing forward walks
  // the board top to bottom exactly as it reads. Built from BUCKET_ORDER rather than the
  // flat `leads` array, which is sorted by score and would arrow you across buckets in a
  // sequence that does not match anything on screen.
  const queueIds = BUCKET_ORDER.flatMap((b) => (grouped.get(b) ?? []).map((l) => l.contactId));

  if (leads.length === 0) {
    return (
      <div className="rounded-xl border border-[rgba(255,255,255,0.07)] bg-[rgba(255,255,255,0.02)] p-8 text-center">
        <p className="text-sm text-white">Nothing needs a call right now.</p>
        <p className="mt-1 text-xs text-[rgba(255,255,255,0.4)]">
          Every working lead has a follow-up scheduled and nothing is overdue.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {BUCKET_ORDER.map((bucket) => {
        const items = grouped.get(bucket);
        if (!items || items.length === 0) return null;
        const meta = BUCKET_META[bucket];
        const Icon = meta.icon;

        return (
          <section key={bucket}>
            <div className="mb-3 flex items-center gap-2">
              <Icon className="h-4 w-4" style={{ color: meta.tone }} />
              <h2 className="text-sm font-medium text-white">{meta.title}</h2>
              <span
                className="rounded-md px-1.5 py-0.5 text-[11px]"
                style={{ background: `${meta.tone}22`, color: meta.tone }}
              >
                {items.length}
              </span>
            </div>
            <p className="mb-3 text-xs text-[rgba(255,255,255,0.35)]">{meta.blurb}</p>
            <div className="space-y-2">
              {items.map((l) => (
                <LeadCard key={l.contactId} lead={l} queueIds={queueIds} />
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}
