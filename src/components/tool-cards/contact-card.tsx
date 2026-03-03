"use client";

import { Phone, Mail, Building2, Tag, ExternalLink } from "lucide-react";

interface ContactData {
  id: string;
  name: string;
  email?: string;
  phone?: string;
  tags?: string[];
  businessName?: string;
}

interface DealData {
  stage: string;
  pipeline_name: string;
  amount?: number;
  updated_at?: string;
}

interface SequenceData {
  status: string;
  current_step: number;
  email_sequences?: { name: string; slug: string };
}

interface NoteData {
  body: string;
  author?: string;
  created_at: string;
}

interface ContactProfileResult {
  contact?: ContactData;
  deals?: DealData[];
  sequences?: SequenceData[];
  notes?: NoteData[];
  error?: string;
}

export function ContactCard({
  data,
  onAction,
}: {
  data: ContactProfileResult;
  onAction?: (prompt: string) => void;
}) {
  if (data.error || !data.contact) {
    return (
      <div className="my-2 rounded-xl border border-[rgba(255,255,255,0.06)] bg-[rgba(255,255,255,0.02)] px-4 py-3">
        <p className="text-sm text-[rgba(255,255,255,0.4)]">{data.error || "Contact not found"}</p>
      </div>
    );
  }

  const { contact, deals = [], sequences = [], notes = [] } = data;

  return (
    <div className="my-2 rounded-xl border border-[rgba(255,255,255,0.07)] bg-[rgba(255,255,255,0.03)] overflow-hidden">
      {/* Header */}
      <div className="px-4 py-3 border-b border-[rgba(255,255,255,0.06)] flex items-start justify-between gap-3">
        <div>
          <p className="text-base font-semibold text-white">{contact.name}</p>
          {contact.businessName && (
            <p className="text-xs text-[rgba(255,255,255,0.45)] flex items-center gap-1 mt-0.5">
              <Building2 className="h-3 w-3" />
              {contact.businessName}
            </p>
          )}
        </div>
        <a
          href={`https://app.gohighlevel.com/contacts/${contact.id}`}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-1 text-xs text-[rgba(255,255,255,0.3)] hover:text-[#00C9A7] transition-colors shrink-0"
        >
          GHL <ExternalLink className="h-3 w-3" />
        </a>
      </div>

      <div className="px-4 py-3 space-y-3">
        {/* Contact info */}
        <div className="flex flex-wrap gap-3">
          {contact.phone && (
            <a
              href={`tel:${contact.phone}`}
              className="flex items-center gap-1.5 text-xs text-[rgba(255,255,255,0.55)] hover:text-white transition-colors"
            >
              <Phone className="h-3 w-3" /> {contact.phone}
            </a>
          )}
          {contact.email && (
            <a
              href={`mailto:${contact.email}`}
              className="flex items-center gap-1.5 text-xs text-[rgba(255,255,255,0.55)] hover:text-white transition-colors"
            >
              <Mail className="h-3 w-3" /> {contact.email}
            </a>
          )}
        </div>

        {/* Tags */}
        {contact.tags && contact.tags.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {contact.tags.map((tag: string) => (
              <span
                key={tag}
                className="flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full bg-[rgba(27,101,167,0.15)] border border-[rgba(27,101,167,0.2)] text-[#1B65A7]"
              >
                <Tag className="h-2.5 w-2.5" /> {tag}
              </span>
            ))}
          </div>
        )}

        {/* Open deals */}
        {deals.length > 0 && (
          <div>
            <p className="text-[10px] font-semibold text-[rgba(255,255,255,0.3)] uppercase tracking-wider mb-1.5">
              Open Deals ({deals.length})
            </p>
            <div className="space-y-1">
              {deals.slice(0, 3).map((deal: DealData, i: number) => (
                <div key={i} className="flex items-center justify-between text-xs">
                  <span className="text-[rgba(255,255,255,0.5)]">{deal.stage}</span>
                  <div className="flex items-center gap-2">
                    <span className="text-[rgba(255,255,255,0.3)]">{deal.pipeline_name}</span>
                    {deal.amount ? (
                      <span className="text-white font-medium">${deal.amount.toLocaleString()}</span>
                    ) : null}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Active sequences */}
        {sequences.length > 0 && (
          <div>
            <p className="text-[10px] font-semibold text-[rgba(255,255,255,0.3)] uppercase tracking-wider mb-1.5">
              Active Sequences
            </p>
            {sequences.map((seq: SequenceData, i: number) => (
              <p key={i} className="text-xs text-[rgba(255,255,255,0.5)]">
                {seq.email_sequences?.name || "Unknown"} — step {seq.current_step}
              </p>
            ))}
          </div>
        )}

        {/* Recent notes */}
        {notes.length > 0 && (
          <div>
            <p className="text-[10px] font-semibold text-[rgba(255,255,255,0.3)] uppercase tracking-wider mb-1.5">
              Recent Notes
            </p>
            {notes.slice(0, 2).map((note: NoteData, i: number) => (
              <p key={i} className="text-xs text-[rgba(255,255,255,0.45)] line-clamp-2 mb-1">
                {note.body}
              </p>
            ))}
          </div>
        )}

        {/* Action buttons */}
        {onAction && (
          <div className="flex flex-wrap gap-2 pt-1 border-t border-[rgba(255,255,255,0.05)]">
            <button
              onClick={() => onAction(`Send SMS to ${contact.name}: `)}
              className="text-xs px-3 py-1 rounded-lg border border-[rgba(255,255,255,0.1)] text-[rgba(255,255,255,0.5)] hover:text-white hover:border-[rgba(255,255,255,0.2)] transition-colors"
            >
              Send SMS
            </button>
            <button
              onClick={() => onAction(`Send email to ${contact.name} — subject: `)}
              className="text-xs px-3 py-1 rounded-lg border border-[rgba(255,255,255,0.1)] text-[rgba(255,255,255,0.5)] hover:text-white hover:border-[rgba(255,255,255,0.2)] transition-colors"
            >
              Send Email
            </button>
            <button
              onClick={() => onAction(`Add note for ${contact.name}: `)}
              className="text-xs px-3 py-1 rounded-lg border border-[rgba(255,255,255,0.1)] text-[rgba(255,255,255,0.5)] hover:text-white hover:border-[rgba(255,255,255,0.2)] transition-colors"
            >
              Add Note
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
