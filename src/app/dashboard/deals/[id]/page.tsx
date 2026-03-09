"use client";

import { useEffect, useState, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import {
  ArrowLeft, Phone, Mail, Building2, User, FileText, Clock,
  CheckCircle2, ChevronDown, ChevronRight, Plus, Loader2,
  Edit, DollarSign, Landmark, Shield, Activity, Send,
} from "lucide-react";
import { NEW_DEALS_PIPELINE, ACTIVE_DEALS_PIPELINE, PIPELINES } from "@/config/pipeline";
import { formatCurrency, formatRelativeTime } from "@/lib/utils";

// ─── Types ──────────────────────────────────────────────────────────────────

interface Contact {
  id: string;
  first_name: string; last_name: string;
  email: string | null; phone: string | null; mobile_phone: string | null;
  additional_phone: string | null; fax: string | null;
  business_name: string | null; legal_name: string | null; dba: string | null;
  industry: string | null; ein: string | null; incorporation_date: string | null;
  address_street: string | null; address_city: string | null;
  address_state: string | null; address_zip: string | null;
  dob: string | null; credit_score_range: string | null;
  ownership_pct: string | null; ssn_last4: string | null; home_address: string | null;
  funding_amount_requested: string | null; use_of_funds: string | null;
  monthly_deposits: string | null; existing_loans: string | null;
  title: string | null; iso: string | null; website: string | null;
  program_type: string | null; lead_owner: string | null;
  tags: string[]; source: string | null;
}

interface Deal {
  id: string; contact_id: string;
  pipeline: string; stage: string;
  amount: number | null; product_type: string | null;
  assigned_to: string | null; source: string | null;
  selected_lender: string | null;
  agreement_amount: number | null; repayment_amount: number | null;
  num_payments: number | null; payment_frequency: string | null;
  payment_method: string | null; buy_rate: number | null; sell_rate: number | null;
  underwriting_fee: number | null; bank_wire_fee: number | null;
  lender_origination_fee: number | null; ucc_filing_fee: number | null;
  bank_name: string | null; bank_account: string | null; routing_number: string | null;
  created_at: string; updated_at: string;
  contacts: Contact;
}

interface DealEvent { id: string; event_type: string; description: string; created_at: string; }
interface DealNote { id: string; content: string; created_at: string; }

// ─── Shared helpers ──────────────────────────────────────────────────────────

function Field({ label, value }: { label: string; value?: string | number | null }) {
  if (!value && value !== 0) return null;
  return (
    <div>
      <p className="text-[10px] text-[rgba(255,255,255,0.3)] uppercase tracking-wider mb-0.5">{label}</p>
      <p className="text-sm text-[rgba(255,255,255,0.8)]">{value}</p>
    </div>
  );
}

function FieldGrid({ children }: { children: React.ReactNode }) {
  return <div className="grid grid-cols-2 gap-x-6 gap-y-3">{children}</div>;
}

function Section({
  title, icon, children, defaultOpen = true,
}: { title: string; icon: React.ReactNode; children: React.ReactNode; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="bg-[rgba(255,255,255,0.03)] border border-[rgba(255,255,255,0.06)] rounded-xl overflow-hidden">
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-[rgba(255,255,255,0.03)] transition-colors"
      >
        <span className="flex items-center gap-2 text-sm font-semibold text-white">
          {icon}{title}
        </span>
        {open ? <ChevronDown size={14} className="text-[rgba(255,255,255,0.3)]" /> : <ChevronRight size={14} className="text-[rgba(255,255,255,0.3)]" />}
      </button>
      {open && <div className="px-4 pb-4">{children}</div>}
    </div>
  );
}

function StageBar({
  deal, onMove, moving,
}: { deal: Deal; onMove: (stage: string, pipeline?: string) => void; moving: string | null }) {
  const pipeline = deal.pipeline === "Active Deals" ? ACTIVE_DEALS_PIPELINE : NEW_DEALS_PIPELINE;
  const currentIndex = pipeline.stages.findIndex((s) => s.name === deal.stage);

  const advanceStage = () => {
    if (currentIndex < pipeline.stages.length - 1) {
      onMove(pipeline.stages[currentIndex + 1].name);
    }
  };

  return (
    <div className="bg-[rgba(255,255,255,0.03)] border border-[rgba(255,255,255,0.06)] rounded-xl px-4 py-3 mb-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-1 overflow-x-auto flex-1 pb-1">
          {pipeline.stages.map((stage, i) => {
            const isPast = i < currentIndex;
            const isCurrent = i === currentIndex;
            return (
              <button
                key={stage.name}
                onClick={() => onMove(stage.name)}
                disabled={moving !== null}
                title={stage.name}
                className={`flex items-center gap-1 px-2.5 py-1 rounded text-[11px] font-medium whitespace-nowrap transition-all flex-shrink-0 ${
                  isCurrent ? "text-[#0B1426] font-semibold" : isPast ? "text-[rgba(255,255,255,0.5)] hover:text-white" : "text-[rgba(255,255,255,0.3)] hover:text-white"
                }`}
                style={{
                  backgroundColor: isCurrent ? stage.color : isPast ? `${stage.color}30` : "rgba(255,255,255,0.04)",
                }}
              >
                {moving === stage.name ? <Loader2 size={9} className="animate-spin" /> : isPast ? <CheckCircle2 size={9} /> : null}
                {stage.name}
              </button>
            );
          })}
        </div>
        {currentIndex < pipeline.stages.length - 1 && (
          <button
            onClick={advanceStage}
            disabled={moving !== null}
            className="flex-shrink-0 px-3 py-1.5 bg-[#00C9A7] text-[#0B1426] rounded text-xs font-semibold hover:bg-[#00a88a] transition-colors flex items-center gap-1.5 disabled:opacity-50"
          >
            {moving ? <Loader2 size={11} className="animate-spin" /> : <CheckCircle2 size={11} />}
            Mark as Complete
          </button>
        )}
      </div>
      {/* Move to any stage / convert */}
      <div className="flex items-center gap-2 mt-2 flex-wrap">
        {deal.pipeline === "New Deals" && deal.stage === "Converted" && (
          <button
            onClick={() => onMove("Underwriting", "Active Deals")}
            disabled={moving !== null}
            className="text-[11px] px-3 py-1 bg-[rgba(0,201,167,0.12)] text-[#00C9A7] border border-[rgba(0,201,167,0.2)] rounded hover:bg-[rgba(0,201,167,0.2)] transition-colors"
          >
            → Move to Active Deals
          </button>
        )}
        <MoveToAnyStage deal={deal} onMove={onMove} moving={moving} />
      </div>
    </div>
  );
}

function MoveToAnyStage({ deal, onMove, moving }: { deal: Deal; onMove: (s: string, p?: string) => void; moving: string | null }) {
  const [open, setOpen] = useState(false);
  const allStages = PIPELINES.flatMap((p) => p.stages.map((s) => ({ ...s, pipeline: p.name })));
  return (
    <div className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="text-[11px] px-3 py-1 bg-[rgba(255,255,255,0.05)] text-[rgba(255,255,255,0.4)] rounded hover:text-white hover:bg-[rgba(255,255,255,0.08)] transition-colors"
      >
        Move to stage ▾
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute top-7 left-0 z-20 bg-[#0d1b2e] border border-[rgba(255,255,255,0.12)] rounded-lg shadow-xl py-1 min-w-[220px]">
            {allStages.map((s) => (
              <button
                key={`${s.pipeline}-${s.name}`}
                disabled={moving !== null}
                onClick={() => { onMove(s.name, s.pipeline); setOpen(false); }}
                className={`w-full text-left px-3 py-1.5 text-xs hover:bg-[rgba(255,255,255,0.06)] transition-colors flex items-center justify-between ${s.name === deal.stage ? "text-[#00C9A7]" : "text-[rgba(255,255,255,0.6)]"}`}
              >
                <span>{s.name}</span>
                <span className="text-[rgba(255,255,255,0.2)] text-[9px]">{s.pipeline}</span>
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function ActivityPanel({ events, notes, onAddNote }: {
  events: DealEvent[]; notes: DealNote[];
  onAddNote: (text: string) => Promise<void>;
}) {
  const [tab, setTab] = useState<"activity" | "notes">("activity");
  const [noteText, setNoteText] = useState("");
  const [saving, setSaving] = useState(false);

  const save = async () => {
    if (!noteText.trim()) return;
    setSaving(true);
    await onAddNote(noteText.trim());
    setNoteText("");
    setSaving(false);
  };

  const eventIcon = (type: string) => {
    if (type === "stage_change") return <ChevronRight size={11} className="text-[#00C9A7]" />;
    if (type === "created") return <CheckCircle2 size={11} className="text-[#1B65A7]" />;
    return <Clock size={11} className="text-[rgba(255,255,255,0.3)]" />;
  };

  return (
    <div className="bg-[rgba(255,255,255,0.03)] border border-[rgba(255,255,255,0.06)] rounded-xl overflow-hidden">
      <div className="flex border-b border-[rgba(255,255,255,0.06)]">
        {(["activity", "notes"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`flex-1 py-2.5 text-xs font-medium capitalize transition-colors ${tab === t ? "text-white border-b-2 border-[#00C9A7]" : "text-[rgba(255,255,255,0.4)] hover:text-white"}`}
          >
            {t === "activity" ? `Activity (${events.length})` : `Notes (${notes.length})`}
          </button>
        ))}
      </div>
      <div className="p-3">
        {tab === "notes" && (
          <div className="mb-3">
            <textarea
              value={noteText}
              onChange={(e) => setNoteText(e.target.value)}
              placeholder="Add a note..."
              rows={2}
              className="w-full bg-[rgba(255,255,255,0.04)] border border-[rgba(255,255,255,0.08)] rounded px-2.5 py-2 text-xs text-white placeholder:text-[rgba(255,255,255,0.2)] focus:outline-none focus:border-[rgba(0,201,167,0.4)] resize-none"
            />
            <button
              onClick={save}
              disabled={!noteText.trim() || saving}
              className="mt-1.5 w-full py-1.5 bg-[rgba(0,201,167,0.12)] text-[#00C9A7] border border-[rgba(0,201,167,0.2)] rounded text-xs font-semibold hover:bg-[rgba(0,201,167,0.2)] transition-colors disabled:opacity-40 flex items-center justify-center gap-1"
            >
              {saving ? <Loader2 size={10} className="animate-spin" /> : <Plus size={10} />} Save
            </button>
          </div>
        )}
        {tab === "activity" && (
          <div className="space-y-3 max-h-80 overflow-y-auto">
            {events.length === 0 ? (
              <p className="text-xs text-[rgba(255,255,255,0.2)] text-center py-4">No activity yet</p>
            ) : events.map((e) => (
              <div key={e.id} className="flex items-start gap-2">
                <div className="mt-0.5 w-4 h-4 rounded-full bg-[rgba(255,255,255,0.05)] flex items-center justify-center flex-shrink-0">{eventIcon(e.event_type)}</div>
                <div>
                  <p className="text-xs text-[rgba(255,255,255,0.6)] leading-snug">{e.description}</p>
                  <p className="text-[10px] text-[rgba(255,255,255,0.2)] mt-0.5">{formatRelativeTime(e.created_at)}</p>
                </div>
              </div>
            ))}
          </div>
        )}
        {tab === "notes" && (
          <div className="space-y-3 max-h-72 overflow-y-auto">
            {notes.length === 0 ? (
              <p className="text-xs text-[rgba(255,255,255,0.2)] text-center py-2">No notes yet</p>
            ) : notes.map((n) => (
              <div key={n.id} className="border-l-2 border-[rgba(255,255,255,0.1)] pl-2.5">
                <p className="text-xs text-[rgba(255,255,255,0.7)]">{n.content}</p>
                <p className="text-[10px] text-[rgba(255,255,255,0.2)] mt-0.5">{formatRelativeTime(n.created_at)}</p>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Edit Modal ──────────────────────────────────────────────────────────────

function EditModal({ deal, onClose, onSave }: { deal: Deal; onClose: () => void; onSave: () => void }) {
  const contact = deal.contacts;
  const isActive = deal.pipeline === "Active Deals";

  const [contactForm, setContactForm] = useState({
    first_name: contact?.first_name || "",
    last_name: contact?.last_name || "",
    email: contact?.email || "",
    phone: contact?.phone || "",
    mobile_phone: contact?.mobile_phone || "",
    additional_phone: contact?.additional_phone || "",
    business_name: contact?.business_name || "",
    legal_name: contact?.legal_name || "",
    dba: contact?.dba || "",
    industry: contact?.industry || "",
    ein: contact?.ein || "",
    incorporation_date: contact?.incorporation_date || "",
    address_street: contact?.address_street || "",
    address_city: contact?.address_city || "",
    address_state: contact?.address_state || "",
    address_zip: contact?.address_zip || "",
    dob: contact?.dob || "",
    credit_score_range: contact?.credit_score_range || "",
    ownership_pct: contact?.ownership_pct || "",
    ssn_last4: contact?.ssn_last4 || "",
    home_address: contact?.home_address || "",
    funding_amount_requested: contact?.funding_amount_requested || "",
    use_of_funds: contact?.use_of_funds || "",
    monthly_deposits: contact?.monthly_deposits || "",
    existing_loans: contact?.existing_loans || "",
    title: contact?.title || "",
    iso: contact?.iso || "",
    fax: contact?.fax || "",
    website: contact?.website || "",
    program_type: contact?.program_type || "",
    lead_owner: contact?.lead_owner || "",
  });

  const [dealForm, setDealForm] = useState({
    product_type: deal.product_type || "",
    amount: deal.amount?.toString() || "",
    assigned_to: deal.assigned_to || "",
    selected_lender: deal.selected_lender || "",
    agreement_amount: deal.agreement_amount?.toString() || "",
    repayment_amount: deal.repayment_amount?.toString() || "",
    num_payments: deal.num_payments?.toString() || "",
    payment_frequency: deal.payment_frequency || "",
    payment_method: deal.payment_method || "ACH",
    buy_rate: deal.buy_rate?.toString() || "",
    sell_rate: deal.sell_rate?.toString() || "",
    underwriting_fee: deal.underwriting_fee?.toString() || "",
    bank_wire_fee: deal.bank_wire_fee?.toString() || "",
    lender_origination_fee: deal.lender_origination_fee?.toString() || "",
    ucc_filing_fee: deal.ucc_filing_fee?.toString() || "",
    bank_name: deal.bank_name || "",
    bank_account: deal.bank_account || "",
    routing_number: deal.routing_number || "",
  });

  const [saving, setSaving] = useState(false);
  const [activeSection, setActiveSection] = useState<string>(isActive ? "terms" : "contact");

  const cf = (field: keyof typeof contactForm) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setContactForm((prev) => ({ ...prev, [field]: e.target.value }));
  const df = (field: keyof typeof dealForm) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setDealForm((prev) => ({ ...prev, [field]: e.target.value }));

  const handleSave = async () => {
    setSaving(true);
    try {
      const numericDealFields = ["amount", "agreement_amount", "repayment_amount", "num_payments", "buy_rate", "sell_rate", "underwriting_fee", "bank_wire_fee", "lender_origination_fee", "ucc_filing_fee"];
      const dealPayload: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(dealForm)) {
        if (v !== "") dealPayload[k] = numericDealFields.includes(k) ? parseFloat(v) || null : v;
      }
      const contactPayload: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(contactForm)) {
        if (v !== "") contactPayload[k] = v;
      }
      await Promise.all([
        fetch(`/api/deals/${deal.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(dealPayload) }),
        fetch(`/api/contacts/${contact.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(contactPayload) }),
      ]);
      onSave();
      onClose();
    } finally {
      setSaving(false);
    }
  };

  const INPUT = "w-full bg-[rgba(255,255,255,0.06)] border border-[rgba(255,255,255,0.1)] rounded px-2.5 py-1.5 text-sm text-white placeholder:text-[rgba(255,255,255,0.2)] focus:outline-none focus:border-[rgba(0,201,167,0.4)]";
  const LABEL = "block text-[10px] text-[rgba(255,255,255,0.4)] uppercase tracking-wider mb-1";

  const sections = isActive
    ? [
        { id: "terms", label: "Deal Terms" },
        { id: "bank", label: "Bank Account" },
        { id: "contact", label: "Business Info" },
        { id: "owner", label: "Owner Info" },
      ]
    : [
        { id: "contact", label: "Contact Info" },
        { id: "business", label: "Business Info" },
        { id: "address", label: "Address" },
        { id: "owner", label: "Owner Info" },
      ];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-[rgba(0,0,0,0.7)]" onClick={onClose}>
      <div className="bg-[#0d1b2e] border border-[rgba(255,255,255,0.1)] rounded-2xl w-full max-w-3xl max-h-[90vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
        {/* Modal header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-[rgba(255,255,255,0.06)]">
          <h2 className="text-base font-bold text-white">Edit Deal</h2>
          <button onClick={onClose} className="text-[rgba(255,255,255,0.4)] hover:text-white text-lg leading-none">×</button>
        </div>

        {/* Section tabs */}
        <div className="flex border-b border-[rgba(255,255,255,0.06)] px-5">
          {sections.map((s) => (
            <button
              key={s.id}
              onClick={() => setActiveSection(s.id)}
              className={`py-3 px-3 text-xs font-medium mr-1 transition-colors ${activeSection === s.id ? "text-white border-b-2 border-[#00C9A7]" : "text-[rgba(255,255,255,0.4)] hover:text-white"}`}
            >
              {s.label}
            </button>
          ))}
        </div>

        {/* Form body */}
        <div className="overflow-y-auto flex-1 px-5 py-4">
          {activeSection === "terms" && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div><label className={LABEL}>Product Type</label><input className={INPUT} value={dealForm.product_type} onChange={df("product_type")} placeholder="Merchant Cash Advance" /></div>
                <div><label className={LABEL}>Selected Lender</label><input className={INPUT} value={dealForm.selected_lender} onChange={df("selected_lender")} /></div>
                <div><label className={LABEL}>Agreement Amount</label><input className={INPUT} type="number" value={dealForm.agreement_amount} onChange={df("agreement_amount")} placeholder="0.00" /></div>
                <div><label className={LABEL}>Repayment Amount</label><input className={INPUT} type="number" value={dealForm.repayment_amount} onChange={df("repayment_amount")} placeholder="0.00" /></div>
                <div><label className={LABEL}># of Payments</label><input className={INPUT} type="number" value={dealForm.num_payments} onChange={df("num_payments")} /></div>
                <div><label className={LABEL}>Payment Frequency</label>
                  <select className={INPUT} value={dealForm.payment_frequency} onChange={df("payment_frequency")}>
                    <option value="">Select...</option>
                    <option>Daily</option><option>Weekly</option><option>Bi-Weekly</option><option>Monthly</option>
                  </select>
                </div>
                <div><label className={LABEL}>Payment Method</label>
                  <select className={INPUT} value={dealForm.payment_method} onChange={df("payment_method")}>
                    <option>ACH</option><option>Check</option><option>Wire</option>
                  </select>
                </div>
                <div><label className={LABEL}>Buy Rate</label><input className={INPUT} type="number" step="0.001" value={dealForm.buy_rate} onChange={df("buy_rate")} placeholder="1.20" /></div>
                <div><label className={LABEL}>Sell Rate</label><input className={INPUT} type="number" step="0.001" value={dealForm.sell_rate} onChange={df("sell_rate")} placeholder="1.30" /></div>
                <div><label className={LABEL}>Underwriting Fee</label><input className={INPUT} type="number" value={dealForm.underwriting_fee} onChange={df("underwriting_fee")} /></div>
                <div><label className={LABEL}>Lender Origination Fee</label><input className={INPUT} type="number" value={dealForm.lender_origination_fee} onChange={df("lender_origination_fee")} /></div>
                <div><label className={LABEL}>Bank Wire Fee</label><input className={INPUT} type="number" value={dealForm.bank_wire_fee} onChange={df("bank_wire_fee")} /></div>
                <div><label className={LABEL}>UCC Filing Fee</label><input className={INPUT} type="number" value={dealForm.ucc_filing_fee} onChange={df("ucc_filing_fee")} /></div>
                <div><label className={LABEL}>Assigned To</label><input className={INPUT} value={dealForm.assigned_to} onChange={df("assigned_to")} /></div>
              </div>
            </div>
          )}

          {activeSection === "bank" && (
            <div className="grid grid-cols-2 gap-4">
              <div><label className={LABEL}>Bank Name</label><input className={INPUT} value={dealForm.bank_name} onChange={df("bank_name")} /></div>
              <div><label className={LABEL}>Account Number</label><input className={INPUT} value={dealForm.bank_account} onChange={df("bank_account")} /></div>
              <div><label className={LABEL}>Routing Number</label><input className={INPUT} value={dealForm.routing_number} onChange={df("routing_number")} /></div>
            </div>
          )}

          {(activeSection === "contact" || activeSection === "business") && (
            <div className="grid grid-cols-2 gap-4">
              <div><label className={LABEL}>First Name</label><input className={INPUT} value={contactForm.first_name} onChange={cf("first_name")} /></div>
              <div><label className={LABEL}>Last Name</label><input className={INPUT} value={contactForm.last_name} onChange={cf("last_name")} /></div>
              <div><label className={LABEL}>Company (DBA)</label><input className={INPUT} value={contactForm.business_name} onChange={cf("business_name")} /></div>
              <div><label className={LABEL}>Legal Name</label><input className={INPUT} value={contactForm.legal_name} onChange={cf("legal_name")} /></div>
              <div><label className={LABEL}>DBA</label><input className={INPUT} value={contactForm.dba} onChange={cf("dba")} /></div>
              <div><label className={LABEL}>Industry</label><input className={INPUT} value={contactForm.industry} onChange={cf("industry")} /></div>
              <div><label className={LABEL}>EIN / Tax ID</label><input className={INPUT} value={contactForm.ein} onChange={cf("ein")} /></div>
              <div><label className={LABEL}>Date Est.</label><input className={INPUT} value={contactForm.incorporation_date} onChange={cf("incorporation_date")} /></div>
              <div><label className={LABEL}>Email</label><input className={INPUT} value={contactForm.email} onChange={cf("email")} /></div>
              <div><label className={LABEL}>Phone</label><input className={INPUT} value={contactForm.phone} onChange={cf("phone")} /></div>
              <div><label className={LABEL}>Additional Phone</label><input className={INPUT} value={contactForm.additional_phone} onChange={cf("additional_phone")} /></div>
              <div><label className={LABEL}>Website</label><input className={INPUT} value={contactForm.website} onChange={cf("website")} /></div>
              <div><label className={LABEL}>Fax</label><input className={INPUT} value={contactForm.fax} onChange={cf("fax")} /></div>
              <div><label className={LABEL}>ISO</label><input className={INPUT} value={contactForm.iso} onChange={cf("iso")} /></div>
              <div><label className={LABEL}>Lead Source</label><input className={INPUT} value={contactForm.lead_owner} onChange={cf("lead_owner")} placeholder="Matthew" /></div>
              <div><label className={LABEL}>Program Type</label><input className={INPUT} value={contactForm.program_type} onChange={cf("program_type")} /></div>
            </div>
          )}

          {activeSection === "address" && (
            <div className="grid grid-cols-2 gap-4">
              <div className="col-span-2"><label className={LABEL}>Street Address</label><input className={INPUT} value={contactForm.address_street} onChange={cf("address_street")} /></div>
              <div><label className={LABEL}>City</label><input className={INPUT} value={contactForm.address_city} onChange={cf("address_city")} /></div>
              <div><label className={LABEL}>State</label><input className={INPUT} value={contactForm.address_state} onChange={cf("address_state")} /></div>
              <div><label className={LABEL}>Zip Code</label><input className={INPUT} value={contactForm.address_zip} onChange={cf("address_zip")} /></div>
            </div>
          )}

          {activeSection === "owner" && (
            <div className="grid grid-cols-2 gap-4">
              <div><label className={LABEL}>Full Name</label><input className={`${INPUT} opacity-50`} value={`${contactForm.first_name} ${contactForm.last_name}`.trim()} readOnly /></div>
              <div><label className={LABEL}>Title</label><input className={INPUT} value={contactForm.title} onChange={cf("title")} placeholder="Owner" /></div>
              <div><label className={LABEL}>Mobile Phone</label><input className={INPUT} value={contactForm.mobile_phone} onChange={cf("mobile_phone")} /></div>
              <div><label className={LABEL}>Email</label><input className={INPUT} value={contactForm.email} onChange={cf("email")} /></div>
              <div><label className={LABEL}>Date of Birth</label><input className={INPUT} value={contactForm.dob} onChange={cf("dob")} /></div>
              <div><label className={LABEL}>SSN (last 4)</label><input className={INPUT} value={contactForm.ssn_last4} onChange={cf("ssn_last4")} maxLength={4} /></div>
              <div><label className={LABEL}>Ownership %</label><input className={INPUT} value={contactForm.ownership_pct} onChange={cf("ownership_pct")} /></div>
              <div><label className={LABEL}>Credit Score Range</label><input className={INPUT} value={contactForm.credit_score_range} onChange={cf("credit_score_range")} placeholder="700-749" /></div>
              <div className="col-span-2"><label className={LABEL}>Home Address</label><input className={INPUT} value={contactForm.home_address} onChange={cf("home_address")} /></div>
              <div><label className={LABEL}>Funding Requested</label><input className={INPUT} value={contactForm.funding_amount_requested} onChange={cf("funding_amount_requested")} /></div>
              <div><label className={LABEL}>Use of Funds</label><input className={INPUT} value={contactForm.use_of_funds} onChange={cf("use_of_funds")} /></div>
              <div><label className={LABEL}>Monthly Deposits</label><input className={INPUT} value={contactForm.monthly_deposits} onChange={cf("monthly_deposits")} /></div>
              <div><label className={LABEL}>Existing Loans</label>
                <select className={INPUT} value={contactForm.existing_loans} onChange={cf("existing_loans")}>
                  <option value="">Select...</option><option>Yes</option><option>No</option>
                </select>
              </div>
            </div>
          )}
        </div>

        {/* Modal footer */}
        <div className="flex items-center justify-end gap-3 px-5 py-4 border-t border-[rgba(255,255,255,0.06)]">
          <button onClick={onClose} className="px-4 py-2 text-sm text-[rgba(255,255,255,0.5)] hover:text-white transition-colors">Cancel</button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="px-5 py-2 bg-[#00C9A7] text-[#0B1426] rounded-lg text-sm font-semibold hover:bg-[#00a88a] transition-colors disabled:opacity-50 flex items-center gap-2"
          >
            {saving ? <Loader2 size={14} className="animate-spin" /> : null}
            Save Changes
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── New Deals (Lead) Layout ─────────────────────────────────────────────────

function NewDealsView({ deal, events, notes, onMove, moving, onAddNote, onEdit }: {
  deal: Deal; events: DealEvent[]; notes: DealNote[];
  onMove: (s: string, p?: string) => void; moving: string | null;
  onAddNote: (t: string) => Promise<void>; onEdit: () => void;
}) {
  const contact = deal.contacts;
  const displayName = [contact?.first_name, contact?.last_name].filter(Boolean).join(" ") || "Unknown";

  return (
    <div>
      {/* Header */}
      <div className="bg-[rgba(255,255,255,0.03)] border border-[rgba(255,255,255,0.06)] rounded-xl p-4 mb-4">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <span className="text-[10px] font-bold px-2 py-0.5 rounded uppercase tracking-wider bg-[rgba(27,101,167,0.15)] text-[#1B65A7] border border-[rgba(27,101,167,0.3)]">Lead</span>
              <span className="text-xs text-[rgba(255,255,255,0.3)]">{deal.stage}</span>
            </div>
            <h1 className="text-2xl font-bold text-white">{displayName}</h1>
            <div className="flex flex-wrap items-center gap-3 mt-1">
              <span className="text-sm text-[rgba(255,255,255,0.5)]">{contact?.business_name}</span>
              {contact?.phone && <a href={`tel:${contact.phone}`} className="flex items-center gap-1 text-sm text-[rgba(255,255,255,0.4)] hover:text-white"><Phone size={12} />{contact.phone}</a>}
              {contact?.email && <a href={`mailto:${contact.email}`} className="flex items-center gap-1 text-sm text-[rgba(255,255,255,0.4)] hover:text-white"><Mail size={12} />{contact.email}</a>}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button className="flex items-center gap-1.5 px-3 py-1.5 bg-[rgba(255,255,255,0.05)] text-[rgba(255,255,255,0.6)] border border-[rgba(255,255,255,0.1)] rounded text-xs hover:text-white transition-colors">
              <Send size={11} /> Send Application
            </button>
            <button onClick={onEdit} className="flex items-center gap-1.5 px-3 py-1.5 bg-[rgba(255,255,255,0.05)] text-[rgba(255,255,255,0.6)] border border-[rgba(255,255,255,0.1)] rounded text-xs hover:text-white transition-colors">
              <Edit size={11} /> Edit
            </button>
          </div>
        </div>
      </div>

      <StageBar deal={deal} onMove={onMove} moving={moving} />

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
        {/* Left column */}
        <div className="lg:col-span-3 space-y-3">
          {/* Quick info grid */}
          <div className="bg-[rgba(255,255,255,0.03)] border border-[rgba(255,255,255,0.06)] rounded-xl p-4">
            <div className="grid grid-cols-2 gap-x-8 gap-y-2.5">
              <Field label="Company" value={contact?.business_name} />
              <Field label="Lead Owner" value={contact?.lead_owner || "Matthew"} />
              <Field label="DBA" value={contact?.dba} />
              <Field label="Lead Status" value={deal.stage} />
              <Field label="Lead Source" value={contact?.source} />
              <Field label="Phone" value={contact?.phone} />
              <Field label="ISO" value={contact?.iso} />
              <Field label="Additional Phone" value={contact?.additional_phone} />
              <Field label="Website" value={contact?.website} />
              <Field label="Program Type" value={contact?.program_type} />
              <Field label="Fax" value={contact?.fax} />
            </div>
          </div>

          {/* Company Information */}
          <Section title="Company Information" icon={<Building2 size={13} className="text-[#1B65A7]" />}>
            <FieldGrid>
              <Field label="Company" value={contact?.business_name} />
              <Field label="Legal Name" value={contact?.legal_name} />
              <Field label="DBA" value={contact?.dba} />
              <Field label="Industry" value={contact?.industry} />
              <Field label="EIN / Tax ID" value={contact?.ein} />
              <Field label="Date Established" value={contact?.incorporation_date} />
              <Field label="Lead Source" value={contact?.source} />
              <Field label="ISO" value={contact?.iso} />
              <Field label="Website" value={contact?.website} />
              <Field label="Fax" value={contact?.fax} />
              <Field label="Program Type" value={contact?.program_type} />
            </FieldGrid>
          </Section>

          {/* Address Information */}
          <Section title="Address Information" icon={<Building2 size={13} className="text-[#9C27B0]" />}>
            <FieldGrid>
              <Field label="Street" value={contact?.address_street} />
              <Field label="City" value={contact?.address_city} />
              <Field label="State" value={contact?.address_state} />
              <Field label="Zip Code" value={contact?.address_zip} />
            </FieldGrid>
            {contact?.address_street && (
              <div className="mt-3 rounded-lg overflow-hidden bg-[rgba(255,255,255,0.04)] h-28 flex items-center justify-center">
                <span className="text-xs text-[rgba(255,255,255,0.2)]">{contact.address_street}, {contact.address_city} {contact.address_state}</span>
              </div>
            )}
          </Section>

          {/* Owner Information */}
          <Section title="Owner Information" icon={<User size={13} className="text-[#f59e0b]" />}>
            <FieldGrid>
              <Field label="Name" value={[contact?.first_name, contact?.last_name].filter(Boolean).join(" ") || null} />
              <Field label="Title" value={contact?.title || "Owner"} />
              <Field label="Mobile" value={contact?.mobile_phone} />
              <Field label="Email" value={contact?.email} />
              <Field label="Birthdate" value={contact?.dob} />
              <Field label="Ownership %" value={contact?.ownership_pct ? `${contact.ownership_pct}%` : null} />
              <Field label="Credit Score" value={contact?.credit_score_range} />
              <Field label="SSN (last 4)" value={contact?.ssn_last4 ? `•••-••-${contact.ssn_last4}` : null} />
              <div className="col-span-2"><Field label="Home Address" value={contact?.home_address} /></div>
            </FieldGrid>
          </Section>

          {/* Funding Details */}
          <Section title="Funding Details" icon={<DollarSign size={13} className="text-[#00C9A7]" />} defaultOpen={false}>
            <FieldGrid>
              <Field label="Amount Requested" value={contact?.funding_amount_requested} />
              <Field label="Use of Funds" value={contact?.use_of_funds} />
              <Field label="Monthly Deposits" value={contact?.monthly_deposits} />
              <Field label="Existing Loans" value={contact?.existing_loans} />
            </FieldGrid>
          </Section>
        </div>

        {/* Right column */}
        <div className="lg:col-span-2 space-y-3">
          <ActivityPanel events={events} notes={notes} onAddNote={onAddNote} />

          {/* Files placeholder */}
          <div className="bg-[rgba(255,255,255,0.03)] border border-[rgba(255,255,255,0.06)] rounded-xl p-4">
            <h3 className="text-sm font-semibold text-white mb-3 flex items-center gap-2"><FileText size={13} className="text-[rgba(255,255,255,0.3)]" />Files</h3>
            <div className="border-2 border-dashed border-[rgba(255,255,255,0.08)] rounded-lg py-6 text-center">
              <p className="text-xs text-[rgba(255,255,255,0.2)]">Upload Files</p>
              <p className="text-[10px] text-[rgba(255,255,255,0.1)] mt-1">Or drop files</p>
            </div>
          </div>

          {/* Deal meta */}
          <div className="bg-[rgba(255,255,255,0.03)] border border-[rgba(255,255,255,0.06)] rounded-xl p-4">
            <h3 className="text-xs font-semibold text-[rgba(255,255,255,0.4)] uppercase tracking-wider mb-3">Deal Info</h3>
            <div className="space-y-2">
              <Field label="Pipeline" value={deal.pipeline} />
              <Field label="Source" value={deal.source} />
              <Field label="Assigned To" value={deal.assigned_to} />
              <Field label="Created" value={formatRelativeTime(deal.created_at)} />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Active Deals (Opportunity) Layout ──────────────────────────────────────

function ActiveDealsView({ deal, events, notes, onMove, moving, onAddNote, onEdit }: {
  deal: Deal; events: DealEvent[]; notes: DealNote[];
  onMove: (s: string, p?: string) => void; moving: string | null;
  onAddNote: (t: string) => Promise<void>; onEdit: () => void;
}) {
  const contact = deal.contacts;
  const [tab, setTab] = useState<"details" | "terms" | "kyc" | "activity">("details");
  const dealTitle = [contact?.business_name, deal.product_type, new Date(deal.created_at).toISOString().split("T")[0]]
    .filter(Boolean).join(" — ");

  return (
    <div>
      {/* Header */}
      <div className="bg-[rgba(255,255,255,0.03)] border border-[rgba(255,255,255,0.06)] rounded-xl p-4 mb-4">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <span className="text-[10px] font-bold px-2 py-0.5 rounded uppercase tracking-wider bg-[rgba(0,201,167,0.1)] text-[#00C9A7] border border-[rgba(0,201,167,0.2)]">Active Deal</span>
              <span className="text-xs text-[rgba(255,255,255,0.3)]">{deal.stage}</span>
            </div>
            <h1 className="text-xl font-bold text-white">{dealTitle || contact?.business_name || "Unknown"}</h1>
            <div className="flex flex-wrap items-center gap-3 mt-1">
              {contact?.phone && <a href={`tel:${contact.phone}`} className="flex items-center gap-1 text-sm text-[rgba(255,255,255,0.4)] hover:text-white"><Phone size={12} />{contact.phone}</a>}
              {contact?.email && <a href={`mailto:${contact.email}`} className="flex items-center gap-1 text-sm text-[rgba(255,255,255,0.4)] hover:text-white"><Mail size={12} />{contact.email}</a>}
            </div>
          </div>
          <div className="flex items-center gap-2">
            {deal.agreement_amount && Number(deal.agreement_amount) > 0 && (
              <div className="text-right mr-2">
                <p className="text-[10px] text-[rgba(255,255,255,0.3)] uppercase">Agreement</p>
                <p className="text-xl font-bold text-[#00C9A7] font-mono">{formatCurrency(Number(deal.agreement_amount))}</p>
              </div>
            )}
            <button className="flex items-center gap-1.5 px-3 py-1.5 bg-[rgba(255,255,255,0.05)] text-[rgba(255,255,255,0.6)] border border-[rgba(255,255,255,0.1)] rounded text-xs hover:text-white transition-colors">
              <Send size={11} /> Email Approval
            </button>
            <button onClick={onEdit} className="flex items-center gap-1.5 px-3 py-1.5 bg-[rgba(255,255,255,0.05)] text-[rgba(255,255,255,0.6)] border border-[rgba(255,255,255,0.1)] rounded text-xs hover:text-white transition-colors">
              <Edit size={11} /> Edit
            </button>
          </div>
        </div>
      </div>

      <StageBar deal={deal} onMove={onMove} moving={moving} />

      {/* Tabs */}
      <div className="flex border-b border-[rgba(255,255,255,0.06)] mb-4">
        {([
          { id: "details", label: "Details" },
          { id: "terms", label: "Deal Terms" },
          { id: "kyc", label: "KYC" },
          { id: "activity", label: "Activity" },
        ] as const).map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`py-2.5 px-4 text-sm font-medium transition-colors ${tab === t.id ? "text-white border-b-2 border-[#00C9A7]" : "text-[rgba(255,255,255,0.4)] hover:text-white"}`}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
        {/* Left / main content */}
        <div className="lg:col-span-3 space-y-4">
          {tab === "details" && (
            <>
              {/* Contact Roles */}
              <Section title="Contact Roles" icon={<User size={13} className="text-[#9C27B0]" />}>
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="text-[rgba(255,255,255,0.3)] border-b border-[rgba(255,255,255,0.06)]">
                        <th className="text-left py-2 pr-4">Contact</th>
                        <th className="text-left py-2 pr-4">Title</th>
                        <th className="text-left py-2 pr-4">Phone</th>
                        <th className="text-left py-2 pr-4">Email</th>
                        <th className="text-left py-2 pr-4">Ownership %</th>
                        <th className="text-left py-2">Credit Score</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr className="border-b border-[rgba(255,255,255,0.04)]">
                        <td className="py-2 pr-4 text-white font-medium">{[contact?.first_name, contact?.last_name].filter(Boolean).join(" ")}</td>
                        <td className="py-2 pr-4 text-[rgba(255,255,255,0.5)]">{contact?.title || "Owner"}</td>
                        <td className="py-2 pr-4 text-[rgba(255,255,255,0.5)]">{contact?.phone || "—"}</td>
                        <td className="py-2 pr-4 text-[rgba(255,255,255,0.5)]">{contact?.email || "—"}</td>
                        <td className="py-2 pr-4 text-[rgba(255,255,255,0.5)]">{contact?.ownership_pct ? `${contact.ownership_pct}%` : "—"}</td>
                        <td className="py-2 text-[rgba(255,255,255,0.5)]">{contact?.credit_score_range || "—"}</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </Section>

              {/* Business Info */}
              <Section title="Account Summary" icon={<Building2 size={13} className="text-[#1B65A7]" />}>
                <FieldGrid>
                  <Field label="Company" value={contact?.business_name} />
                  <Field label="DBA" value={contact?.dba} />
                  <Field label="Phone" value={contact?.phone} />
                  <Field label="Website" value={contact?.website} />
                  <Field label="Federal Tax ID" value={contact?.ein} />
                  <Field label="Entity Type" value={contact?.industry} />
                  <Field label="State of Inc." value={contact?.address_state} />
                  <Field label="Business Start Date" value={contact?.incorporation_date} />
                  <Field label="Industry" value={contact?.industry} />
                  <Field label="ISO" value={contact?.iso} />
                </FieldGrid>
              </Section>
            </>
          )}

          {tab === "terms" && (
            <>
              <Section title={`Selected Terms — ${deal.product_type || "MCA"}`} icon={<DollarSign size={13} className="text-[#00C9A7]" />}>
                <div className="grid grid-cols-2 gap-x-8 gap-y-3">
                  <Field label="Agreement Amount" value={deal.agreement_amount ? formatCurrency(Number(deal.agreement_amount)) : null} />
                  <Field label="Repayment Amount" value={deal.repayment_amount ? formatCurrency(Number(deal.repayment_amount)) : null} />
                  <Field label="Number of Payments" value={deal.num_payments?.toString()} />
                  <Field label="Payment Frequency" value={deal.payment_frequency} />
                  <Field label="Payment Amount" value={
                    deal.repayment_amount && deal.num_payments
                      ? formatCurrency(Number(deal.repayment_amount) / Number(deal.num_payments))
                      : null
                  } />
                  <Field label="Payment Method" value={deal.payment_method} />
                  <Field label="Buy Rate" value={deal.buy_rate?.toString()} />
                  <Field label="Sell Rate" value={deal.sell_rate?.toString()} />
                  <Field label="Underwriting Fee" value={deal.underwriting_fee ? formatCurrency(Number(deal.underwriting_fee)) : null} />
                  <Field label="Bank Wire Fee" value={deal.bank_wire_fee ? formatCurrency(Number(deal.bank_wire_fee)) : null} />
                  <Field label="Lender Origination Fee" value={deal.lender_origination_fee ? formatCurrency(Number(deal.lender_origination_fee)) : null} />
                  <Field label="UCC Filing Fee" value={deal.ucc_filing_fee ? formatCurrency(Number(deal.ucc_filing_fee)) : null} />
                  <Field label="Selected Lender" value={deal.selected_lender} />
                  <Field label="Assigned To" value={deal.assigned_to} />
                </div>
              </Section>

              <Section title="Selected Bank Account" icon={<Landmark size={13} className="text-[#1B65A7]" />} defaultOpen={false}>
                <FieldGrid>
                  <Field label="Bank Name" value={deal.bank_name} />
                  <Field label="Account Number" value={deal.bank_account ? `••••${deal.bank_account.slice(-4)}` : null} />
                  <Field label="Routing Number" value={deal.routing_number} />
                </FieldGrid>
              </Section>
            </>
          )}

          {tab === "kyc" && (
            <Section title="KYC — Know Your Customer" icon={<Shield size={13} className="text-[#f59e0b]" />}>
              <FieldGrid>
                <Field label="Full Name" value={[contact?.first_name, contact?.last_name].filter(Boolean).join(" ") || null} />
                <Field label="Title" value={contact?.title || "Owner"} />
                <Field label="Date of Birth" value={contact?.dob} />
                <Field label="SSN (last 4)" value={contact?.ssn_last4 ? `•••-••-${contact.ssn_last4}` : null} />
                <Field label="Ownership %" value={contact?.ownership_pct ? `${contact.ownership_pct}%` : null} />
                <Field label="Credit Score" value={contact?.credit_score_range} />
                <div className="col-span-2"><Field label="Home Address" value={contact?.home_address} /></div>
                <Field label="Funding Requested" value={contact?.funding_amount_requested} />
                <Field label="Use of Funds" value={contact?.use_of_funds} />
                <Field label="Monthly Deposits" value={contact?.monthly_deposits} />
                <Field label="Existing Loans" value={contact?.existing_loans} />
              </FieldGrid>
            </Section>
          )}

          {tab === "activity" && (
            <ActivityPanel events={events} notes={notes} onAddNote={onAddNote} />
          )}
        </div>

        {/* Right sidebar */}
        <div className="lg:col-span-2 space-y-3">
          {/* Account Summary sidebar */}
          <div className="bg-[rgba(255,255,255,0.03)] border border-[rgba(255,255,255,0.06)] rounded-xl p-4">
            <h3 className="text-sm font-semibold text-white mb-3 flex items-center gap-2">
              <Activity size={13} className="text-[rgba(255,255,255,0.4)]" />Account Summary
            </h3>
            <div className="space-y-2.5">
              <Field label="Account Name" value={contact?.business_name} />
              <Field label="DBA" value={contact?.dba} />
              <Field label="Phone" value={contact?.phone} />
              <Field label="Website" value={contact?.website} />
              <Field label="Federal Tax ID" value={contact?.ein} />
              <Field label="State of Inc." value={contact?.address_state} />
              <Field label="Business Start" value={contact?.incorporation_date} />
              <Field label="Industry" value={contact?.industry} />
            </div>
          </div>

          {/* DocuSign placeholder */}
          <div className="bg-[rgba(255,255,255,0.03)] border border-[rgba(255,255,255,0.06)] rounded-xl p-4">
            <h3 className="text-sm font-semibold text-white mb-3">DocuSign Status</h3>
            <p className="text-xs text-[rgba(255,255,255,0.2)] text-center py-2">DocuSign integration coming soon</p>
          </div>

          {/* Activity (always visible on right for non-activity tab) */}
          {tab !== "activity" && (
            <ActivityPanel events={events} notes={notes} onAddNote={onAddNote} />
          )}

          {/* Files */}
          <div className="bg-[rgba(255,255,255,0.03)] border border-[rgba(255,255,255,0.06)] rounded-xl p-4">
            <h3 className="text-sm font-semibold text-white mb-3 flex items-center gap-2"><FileText size={13} className="text-[rgba(255,255,255,0.3)]" />Files</h3>
            <div className="border-2 border-dashed border-[rgba(255,255,255,0.08)] rounded-lg py-5 text-center">
              <p className="text-xs text-[rgba(255,255,255,0.2)]">Upload Files · Or drop files</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Main Page ───────────────────────────────────────────────────────────────

export default function DealRoomPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const [deal, setDeal] = useState<Deal | null>(null);
  const [events, setEvents] = useState<DealEvent[]>([]);
  const [notes, setNotes] = useState<DealNote[]>([]);
  const [loading, setLoading] = useState(true);
  const [moving, setMoving] = useState<string | null>(null);
  const [editOpen, setEditOpen] = useState(false);

  const fetchDeal = useCallback(async () => {
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
  }, [params.id, router]);

  useEffect(() => { fetchDeal(); }, [fetchDeal]);

  const handleMove = useCallback(async (newStage: string, newPipeline?: string) => {
    if (!deal) return;
    setMoving(newStage);
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
      setMoving(null);
    }
  }, [deal, params.id]);

  const handleAddNote = useCallback(async (text: string) => {
    if (!deal) return;
    await fetch("/api/deals/notes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ deal_id: deal.id, contact_id: deal.contacts?.id, content: text }),
    });
    setNotes((prev) => [{ id: Date.now().toString(), content: text, created_at: new Date().toISOString() }, ...prev]);
  }, [deal]);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <Loader2 className="animate-spin text-[#00C9A7]" size={32} />
      </div>
    );
  }

  if (!deal) return null;

  const sharedProps = { deal, events, notes, onMove: handleMove, moving, onAddNote: handleAddNote, onEdit: () => setEditOpen(true) };

  return (
    <div className="max-w-7xl mx-auto">
      <div className="mb-4">
        <Link href="/dashboard/pipeline" className="flex items-center gap-1.5 text-[rgba(255,255,255,0.4)] hover:text-white text-sm transition-colors">
          <ArrowLeft size={14} /> Pipeline
        </Link>
      </div>

      {deal.pipeline === "Active Deals"
        ? <ActiveDealsView {...sharedProps} />
        : <NewDealsView {...sharedProps} />
      }

      {editOpen && <EditModal deal={deal} onClose={() => setEditOpen(false)} onSave={fetchDeal} />}
    </div>
  );
}
