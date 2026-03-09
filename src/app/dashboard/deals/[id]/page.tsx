"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import {
  ArrowLeft, Phone, Mail, Building2,
  DollarSign, Tag, ChevronRight, Plus, CheckCircle2,
  Clock, AlertCircle, User, FileText, BarChart3, Loader2,
} from "lucide-react";
import { NEW_DEALS_PIPELINE, ACTIVE_DEALS_PIPELINE, PIPELINES } from "@/config/pipeline";
import { formatCurrency, formatRelativeTime } from "@/lib/utils";

interface Contact {
  id: string;
  first_name: string;
  last_name: string;
  email: string | null;
  phone: string | null;
  mobile_phone: string | null;
  business_name: string | null;
  legal_name: string | null;
  dba: string | null;
  industry: string | null;
  ein: string | null;
  incorporation_date: string | null;
  address_street: string | null;
  address_city: string | null;
  address_state: string | null;
  address_zip: string | null;
  dob: string | null;
  credit_score_range: string | null;
  ownership_pct: string | null;
  ssn_last4: string | null;
  home_address: string | null;
  funding_amount_requested: string | null;
  use_of_funds: string | null;
  monthly_deposits: string | null;
  existing_loans: string | null;
  tags: string[];
  source: string | null;
}

interface Deal {
  id: string;
  pipeline: string;
  stage: string;
  amount: number | null;
  product_type: string | null;
  assigned_to: string | null;
  source: string | null;
  created_at: string;
  updated_at: string;
  contacts: Contact;
}

interface DealEvent {
  id: string;
  event_type: string;
  description: string;
  created_at: string;
}

interface DealNote {
  id: string;
  content: string;
  created_at: string;
}

export default function DealRoomPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const [deal, setDeal] = useState<Deal | null>(null);
  const [events, setEvents] = useState<DealEvent[]>([]);
  const [notes, setNotes] = useState<DealNote[]>([]);
  const [loading, setLoading] = useState(true);
  const [movingStage, setMovingStage] = useState<string | null>(null);
  const [noteText, setNoteText] = useState("");
  const [addingNote, setAddingNote] = useState(false);
  const [showStageMenu, setShowStageMenu] = useState(false);

  useEffect(() => {
    fetchDeal();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.id]);

  async function fetchDeal() {
    setLoading(true);
    try {
      const res = await fetch(`/api/deals/${params.id}`);
      if (!res.ok) { router.push("/dashboard/pipeline"); return; }
      const data = await res.json();
      setDeal(data.deal);
      setEvents(data.events || []);
      setNotes(data.notes || []);
    } finally {
      setLoading(false);
    }
  }

  async function moveToStage(newStage: string, newPipeline?: string) {
    if (!deal) return;
    setMovingStage(newStage);
    setShowStageMenu(false);
    try {
      const res = await fetch(`/api/deals/${params.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stage: newStage, pipeline: newPipeline || deal.pipeline }),
      });
      if (res.ok) {
        const data = await res.json();
        setDeal((prev) => prev ? { ...prev, stage: data.deal.stage, pipeline: data.deal.pipeline } : prev);
        setEvents((prev) => [
          { id: Date.now().toString(), event_type: "stage_change", description: `Moved to "${newStage}"`, created_at: new Date().toISOString() },
          ...prev,
        ]);
      }
    } finally {
      setMovingStage(null);
    }
  }

  async function addNote() {
    if (!noteText.trim() || !deal) return;
    setAddingNote(true);
    try {
      await fetch("/api/deals/notes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ deal_id: deal.id, contact_id: deal.contacts?.id, content: noteText.trim() }),
      });
      setNotes((prev) => [
        { id: Date.now().toString(), content: noteText.trim(), created_at: new Date().toISOString() },
        ...prev,
      ]);
      setNoteText("");
    } finally {
      setAddingNote(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <Loader2 className="animate-spin text-[#00C9A7]" size={32} />
      </div>
    );
  }

  if (!deal) return null;

  const contact = deal.contacts;
  const currentPipelineConfig = deal.pipeline === "Active Deals" ? ACTIVE_DEALS_PIPELINE : NEW_DEALS_PIPELINE;
  const currentStageIndex = currentPipelineConfig.stages.findIndex((s) => s.name === deal.stage);
  const allStages = PIPELINES.flatMap((p) => p.stages.map((s) => ({ ...s, pipeline: p.name })));
  const displayName = [contact?.first_name, contact?.last_name].filter(Boolean).join(" ") || "Unknown";
  const businessName = contact?.business_name || deal.contacts?.legal_name || "Unknown Business";

  const eventIcon = (type: string) => {
    if (type === "stage_change") return <ChevronRight size={12} className="text-[#00C9A7]" />;
    if (type === "created") return <CheckCircle2 size={12} className="text-[#1B65A7]" />;
    return <Clock size={12} className="text-[rgba(255,255,255,0.3)]" />;
  };

  return (
    <div className="max-w-7xl mx-auto">
      {/* Back nav */}
      <div className="mb-4">
        <Link href="/dashboard/pipeline" className="flex items-center gap-1.5 text-[rgba(255,255,255,0.4)] hover:text-white text-sm transition-colors">
          <ArrowLeft size={14} />
          Pipeline
        </Link>
      </div>

      {/* Header card */}
      <div className="bg-[rgba(255,255,255,0.03)] border border-[rgba(255,255,255,0.06)] rounded-xl p-5 mb-5">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            {/* Pipeline badge */}
            <span className={`text-[10px] font-semibold px-2 py-0.5 rounded uppercase tracking-wider border mb-2 inline-block ${
              deal.pipeline === "Active Deals"
                ? "bg-[rgba(0,201,167,0.1)] text-[#00C9A7] border-[rgba(0,201,167,0.2)]"
                : "bg-[rgba(27,101,167,0.1)] text-[#1B65A7] border-[rgba(27,101,167,0.2)]"
            }`}>
              {deal.pipeline}
            </span>
            <h1 className="text-2xl font-bold text-white">{displayName}</h1>
            <p className="text-[rgba(255,255,255,0.5)] text-sm">{businessName}</p>
            <div className="flex flex-wrap gap-3 mt-2">
              {contact?.phone && (
                <a href={`tel:${contact.phone}`} className="flex items-center gap-1.5 text-sm text-[rgba(255,255,255,0.5)] hover:text-white transition-colors">
                  <Phone size={13} /> {contact.phone}
                </a>
              )}
              {contact?.email && (
                <a href={`mailto:${contact.email}`} className="flex items-center gap-1.5 text-sm text-[rgba(255,255,255,0.5)] hover:text-white transition-colors">
                  <Mail size={13} /> {contact.email}
                </a>
              )}
            </div>
          </div>
          {deal.amount && Number(deal.amount) > 0 && (
            <div className="text-right">
              <p className="text-xs text-[rgba(255,255,255,0.3)] uppercase tracking-wider">Deal Amount</p>
              <p className="text-2xl font-bold text-[#00C9A7] font-mono">{formatCurrency(Number(deal.amount))}</p>
              {deal.product_type && <p className="text-xs text-[rgba(255,255,255,0.4)] mt-0.5">{deal.product_type}</p>}
            </div>
          )}
        </div>

        {/* Stage progress bar */}
        <div className="mt-5 pt-5 border-t border-[rgba(255,255,255,0.06)]">
          <div className="flex items-center gap-1 overflow-x-auto pb-1">
            {currentPipelineConfig.stages.map((stage, i) => {
              const isPast = i < currentStageIndex;
              const isCurrent = i === currentStageIndex;
              return (
                <button
                  key={stage.name}
                  onClick={() => moveToStage(stage.name)}
                  disabled={movingStage !== null}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium whitespace-nowrap transition-all flex-shrink-0 ${
                    isCurrent
                      ? "text-[#0B1426] font-semibold"
                      : isPast
                      ? "text-[rgba(255,255,255,0.5)] hover:text-white"
                      : "text-[rgba(255,255,255,0.3)] hover:text-white"
                  }`}
                  style={{
                    backgroundColor: isCurrent ? stage.color : isPast ? `${stage.color}22` : "rgba(255,255,255,0.04)",
                    borderBottom: isCurrent ? `2px solid ${stage.color}` : "2px solid transparent",
                  }}
                >
                  {movingStage === stage.name ? (
                    <Loader2 size={10} className="animate-spin" />
                  ) : isPast ? (
                    <CheckCircle2 size={10} />
                  ) : null}
                  {stage.name}
                </button>
              );
            })}
          </div>

          {/* Convert / Move pipeline action */}
          <div className="flex items-center gap-2 mt-3 relative">
            {deal.pipeline === "New Deals" && deal.stage === "Converted" && (
              <button
                onClick={() => moveToStage("Contract In", "Active Deals")}
                disabled={movingStage !== null}
                className="px-4 py-1.5 bg-[#00C9A7] text-[#0B1426] rounded text-xs font-semibold hover:bg-[#00a88a] transition-colors flex items-center gap-1.5"
              >
                <BarChart3 size={12} />
                Move to Active Deals →
              </button>
            )}
            <button
              onClick={() => setShowStageMenu((v) => !v)}
              className="px-3 py-1.5 bg-[rgba(255,255,255,0.05)] text-[rgba(255,255,255,0.5)] rounded text-xs hover:text-white hover:bg-[rgba(255,255,255,0.08)] transition-colors"
            >
              Move to any stage ▾
            </button>
            {showStageMenu && (
              <div className="absolute top-8 left-0 z-20 bg-[#0d1b2e] border border-[rgba(255,255,255,0.12)] rounded-lg shadow-xl py-1 min-w-[220px]">
                {allStages.map((s) => (
                  <button
                    key={`${s.pipeline}-${s.name}`}
                    onClick={() => moveToStage(s.name, s.pipeline)}
                    className={`w-full text-left px-3 py-2 text-xs hover:bg-[rgba(255,255,255,0.06)] transition-colors flex items-center justify-between ${
                      s.name === deal.stage ? "text-[#00C9A7]" : "text-[rgba(255,255,255,0.6)]"
                    }`}
                  >
                    <span>{s.name}</span>
                    <span className="text-[rgba(255,255,255,0.2)] text-[10px]">{s.pipeline}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Body — two columns */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        {/* Left column — contact details */}
        <div className="lg:col-span-2 space-y-4">

          {/* Business Details */}
          <div className="bg-[rgba(255,255,255,0.03)] border border-[rgba(255,255,255,0.06)] rounded-xl p-4">
            <h3 className="text-sm font-semibold text-white mb-3 flex items-center gap-2">
              <Building2 size={14} className="text-[#1B65A7]" />
              Business Details
            </h3>
            <div className="grid grid-cols-2 gap-x-6 gap-y-2.5">
              <InfoRow label="Company" value={contact?.business_name} />
              <InfoRow label="Legal Name" value={contact?.legal_name} />
              <InfoRow label="DBA" value={contact?.dba} />
              <InfoRow label="Industry" value={contact?.industry} />
              <InfoRow label="EIN" value={contact?.ein} />
              <InfoRow label="Est. Date" value={contact?.incorporation_date} />
              {(contact?.address_street || contact?.address_city) && (
                <div className="col-span-2">
                  <p className="text-[10px] text-[rgba(255,255,255,0.3)] uppercase tracking-wider mb-0.5">Address</p>
                  <p className="text-sm text-[rgba(255,255,255,0.7)]">
                    {[contact.address_street, contact.address_city, contact.address_state, contact.address_zip]
                      .filter(Boolean).join(", ")}
                  </p>
                </div>
              )}
              <InfoRow label="Source" value={contact?.source} />
              <InfoRow label="Monthly Deposits" value={contact?.monthly_deposits} />
              <InfoRow label="Funding Requested" value={contact?.funding_amount_requested} />
              <InfoRow label="Use of Funds" value={contact?.use_of_funds} />
              <InfoRow label="Existing Loans" value={contact?.existing_loans} />
            </div>
          </div>

          {/* Owner Details */}
          <div className="bg-[rgba(255,255,255,0.03)] border border-[rgba(255,255,255,0.06)] rounded-xl p-4">
            <h3 className="text-sm font-semibold text-white mb-3 flex items-center gap-2">
              <User size={14} className="text-[#9C27B0]" />
              Owner Information
            </h3>
            <div className="grid grid-cols-2 gap-x-6 gap-y-2.5">
              <InfoRow label="Full Name" value={displayName !== "Unknown" ? displayName : null} />
              <InfoRow label="Date of Birth" value={contact?.dob} />
              <InfoRow label="Phone" value={contact?.phone} />
              <InfoRow label="Mobile" value={contact?.mobile_phone} />
              <InfoRow label="Email" value={contact?.email} />
              <InfoRow label="SSN (last 4)" value={contact?.ssn_last4 ? `••• - ••  - ${contact.ssn_last4}` : null} />
              <InfoRow label="Ownership %" value={contact?.ownership_pct ? `${contact.ownership_pct}%` : null} />
              <InfoRow label="Credit Score" value={contact?.credit_score_range} />
              <InfoRow label="Home Address" value={contact?.home_address} />
            </div>
          </div>

          {/* Tags */}
          {contact?.tags && contact.tags.length > 0 && (
            <div className="bg-[rgba(255,255,255,0.03)] border border-[rgba(255,255,255,0.06)] rounded-xl p-4">
              <h3 className="text-sm font-semibold text-white mb-3 flex items-center gap-2">
                <Tag size={14} className="text-[#f59e0b]" />
                Tags
              </h3>
              <div className="flex flex-wrap gap-2">
                {contact.tags.map((tag) => (
                  <span
                    key={tag}
                    className="text-xs px-2.5 py-1 rounded-full bg-[rgba(255,255,255,0.05)] border border-[rgba(255,255,255,0.08)] text-[rgba(255,255,255,0.5)]"
                  >
                    {tag}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Right column — activity + notes */}
        <div className="space-y-4">

          {/* Add Note */}
          <div className="bg-[rgba(255,255,255,0.03)] border border-[rgba(255,255,255,0.06)] rounded-xl p-4">
            <h3 className="text-sm font-semibold text-white mb-3 flex items-center gap-2">
              <FileText size={14} className="text-[#00C9A7]" />
              Add Note
            </h3>
            <textarea
              value={noteText}
              onChange={(e) => setNoteText(e.target.value)}
              placeholder="Add a note..."
              rows={3}
              className="w-full bg-[rgba(255,255,255,0.04)] border border-[rgba(255,255,255,0.08)] rounded-lg px-3 py-2 text-sm text-white placeholder:text-[rgba(255,255,255,0.2)] focus:outline-none focus:border-[rgba(0,201,167,0.4)] resize-none"
            />
            <button
              onClick={addNote}
              disabled={!noteText.trim() || addingNote}
              className="mt-2 w-full py-1.5 bg-[rgba(0,201,167,0.12)] text-[#00C9A7] border border-[rgba(0,201,167,0.2)] rounded-lg text-xs font-semibold hover:bg-[rgba(0,201,167,0.2)] transition-colors disabled:opacity-40 flex items-center justify-center gap-1.5"
            >
              {addingNote ? <Loader2 size={12} className="animate-spin" /> : <Plus size={12} />}
              Save Note
            </button>
          </div>

          {/* Notes list */}
          {notes.length > 0 && (
            <div className="bg-[rgba(255,255,255,0.03)] border border-[rgba(255,255,255,0.06)] rounded-xl p-4">
              <h3 className="text-sm font-semibold text-white mb-3 flex items-center gap-2">
                <FileText size={14} className="text-[rgba(255,255,255,0.4)]" />
                Notes ({notes.length})
              </h3>
              <div className="space-y-3">
                {notes.map((note) => (
                  <div key={note.id} className="border-l-2 border-[rgba(255,255,255,0.1)] pl-3">
                    <p className="text-sm text-[rgba(255,255,255,0.7)]">{note.content}</p>
                    <p className="text-[10px] text-[rgba(255,255,255,0.2)] mt-1">{formatRelativeTime(note.created_at)}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Activity Timeline */}
          <div className="bg-[rgba(255,255,255,0.03)] border border-[rgba(255,255,255,0.06)] rounded-xl p-4">
            <h3 className="text-sm font-semibold text-white mb-3 flex items-center gap-2">
              <Clock size={14} className="text-[rgba(255,255,255,0.4)]" />
              Activity
            </h3>
            {events.length === 0 ? (
              <p className="text-xs text-[rgba(255,255,255,0.2)] text-center py-4">No activity yet</p>
            ) : (
              <div className="space-y-3">
                {events.map((event) => (
                  <div key={event.id} className="flex items-start gap-2.5">
                    <div className="mt-0.5 w-5 h-5 rounded-full bg-[rgba(255,255,255,0.05)] flex items-center justify-center flex-shrink-0">
                      {eventIcon(event.event_type)}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs text-[rgba(255,255,255,0.6)] leading-snug">{event.description}</p>
                      <p className="text-[10px] text-[rgba(255,255,255,0.2)] mt-0.5">{formatRelativeTime(event.created_at)}</p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Files placeholder */}
          <div className="bg-[rgba(255,255,255,0.03)] border border-[rgba(255,255,255,0.06)] rounded-xl p-4">
            <h3 className="text-sm font-semibold text-white mb-3 flex items-center gap-2">
              <AlertCircle size={14} className="text-[rgba(255,255,255,0.2)]" />
              Files
            </h3>
            <p className="text-xs text-[rgba(255,255,255,0.2)] text-center py-3">
              File uploads coming soon
            </p>
          </div>

          {/* Deal meta */}
          <div className="bg-[rgba(255,255,255,0.03)] border border-[rgba(255,255,255,0.06)] rounded-xl p-4">
            <h3 className="text-sm font-semibold text-white mb-3 flex items-center gap-2">
              <DollarSign size={14} className="text-[rgba(255,255,255,0.4)]" />
              Deal Info
            </h3>
            <div className="space-y-2">
              <InfoRow label="Pipeline" value={deal.pipeline} />
              <InfoRow label="Stage" value={deal.stage} />
              <InfoRow label="Amount" value={deal.amount ? formatCurrency(Number(deal.amount)) : null} />
              <InfoRow label="Product" value={deal.product_type} />
              <InfoRow label="Assigned To" value={deal.assigned_to} />
              <InfoRow label="Source" value={deal.source} />
              <InfoRow label="Created" value={formatRelativeTime(deal.created_at)} />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: string | null | undefined }) {
  if (!value) return null;
  return (
    <div>
      <p className="text-[10px] text-[rgba(255,255,255,0.3)] uppercase tracking-wider mb-0.5">{label}</p>
      <p className="text-sm text-[rgba(255,255,255,0.75)]">{value}</p>
    </div>
  );
}
