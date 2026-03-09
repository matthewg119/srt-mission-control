"use client";

import { useState } from "react";
import { X, Eye, Code, Send } from "lucide-react";
import { TEMPLATE_VARIABLES, previewTemplate, extractVariables } from "@/lib/template-renderer";

interface Template {
  id?: string;
  name: string;
  slug: string;
  type: "SMS" | "Email";
  category: string;
  subject: string | null;
  body: string;
  variables: string[];
  is_active: boolean;
}

interface TemplateEditorProps {
  template: Template | null;
  onSave: (template: Omit<Template, "id" | "is_active"> & { id?: string }) => void;
  onClose: () => void;
}

const CATEGORIES = [
  "Open - Not Contacted", "Working - Contacted", "Working - Application Out",
  "Closed - Not Converted", "Converted",
  "Contract In", "Pending Stips", "Funding Call", "In Funding",
  "Funded", "Deal Lost",
  "Re-engagement", "General",
];

export function TemplateEditor({ template, onSave, onClose }: TemplateEditorProps) {
  const [name, setName] = useState(template?.name || "");
  const [slug, setSlug] = useState(template?.slug || "");
  const [type, setType] = useState<"SMS" | "Email">(template?.type || "SMS");
  const [category, setCategory] = useState(template?.category || "Open - Not Contacted");
  const [subject, setSubject] = useState(template?.subject || "");
  const [body, setBody] = useState(template?.body || "");
  const [showPreview, setShowPreview] = useState(false);

  const autoSlug = (n: string) =>
    n.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");

  const handleNameChange = (v: string) => {
    setName(v);
    if (!template?.id) setSlug(autoSlug(v));
  };

  const insertVariable = (key: string) => {
    setBody((prev) => prev + `{{${key}}}`);
  };

  const handleSave = () => {
    if (!name || !body) return;
    const vars = extractVariables(body + (subject || ""));
    onSave({
      id: template?.id,
      name,
      slug: slug || autoSlug(name),
      type,
      category,
      subject: type === "Email" ? subject : null,
      body,
      variables: vars,
    });
  };

  const charCount = body.length;
  const smsSegments = Math.ceil(charCount / 160);

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
      <div className="bg-[#0F1A2E] border border-[rgba(255,255,255,0.08)] rounded-xl w-full max-w-3xl max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-[rgba(255,255,255,0.06)]">
          <h2 className="text-lg font-semibold text-white">
            {template?.id ? "Edit Template" : "New Template"}
          </h2>
          <button onClick={onClose} className="text-[rgba(255,255,255,0.4)] hover:text-white">
            <X size={20} />
          </button>
        </div>

        <div className="p-5 space-y-4">
          {/* Row 1: Name + Type */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-xs text-[rgba(255,255,255,0.5)] block mb-1">Template Name</label>
              <input
                type="text"
                value={name}
                onChange={(e) => handleNameChange(e.target.value)}
                className="w-full bg-[rgba(255,255,255,0.05)] border border-[rgba(255,255,255,0.1)] rounded-md px-3 py-2 text-sm text-white focus:outline-none focus:border-[#00C9A7]"
                placeholder="e.g., New Lead Welcome SMS"
              />
            </div>
            <div>
              <label className="text-xs text-[rgba(255,255,255,0.5)] block mb-1">Type</label>
              <div className="flex gap-2">
                <button
                  onClick={() => setType("SMS")}
                  className={`flex-1 py-2 rounded-md text-sm font-medium transition-colors ${
                    type === "SMS"
                      ? "bg-[#00C9A7] text-[#0B1426]"
                      : "bg-[rgba(255,255,255,0.05)] text-[rgba(255,255,255,0.5)] hover:text-white"
                  }`}
                >
                  SMS
                </button>
                <button
                  onClick={() => setType("Email")}
                  className={`flex-1 py-2 rounded-md text-sm font-medium transition-colors ${
                    type === "Email"
                      ? "bg-[#1B65A7] text-white"
                      : "bg-[rgba(255,255,255,0.05)] text-[rgba(255,255,255,0.5)] hover:text-white"
                  }`}
                >
                  Email
                </button>
              </div>
            </div>
          </div>

          {/* Row 2: Category + Slug */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-xs text-[rgba(255,255,255,0.5)] block mb-1">Category (Stage)</label>
              <select
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                className="w-full bg-[rgba(255,255,255,0.05)] border border-[rgba(255,255,255,0.1)] rounded-md px-3 py-2 text-sm text-white focus:outline-none focus:border-[#00C9A7]"
              >
                {CATEGORIES.map((c) => (
                  <option key={c} value={c} className="bg-[#0F1A2E]">{c}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-xs text-[rgba(255,255,255,0.5)] block mb-1">Slug</label>
              <input
                type="text"
                value={slug}
                onChange={(e) => setSlug(e.target.value)}
                className="w-full bg-[rgba(255,255,255,0.05)] border border-[rgba(255,255,255,0.1)] rounded-md px-3 py-2 text-sm text-white focus:outline-none focus:border-[#00C9A7] font-mono"
                placeholder="auto-generated"
              />
            </div>
          </div>

          {/* Subject (Email only) */}
          {type === "Email" && (
            <div>
              <label className="text-xs text-[rgba(255,255,255,0.5)] block mb-1">Subject Line</label>
              <input
                type="text"
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                className="w-full bg-[rgba(255,255,255,0.05)] border border-[rgba(255,255,255,0.1)] rounded-md px-3 py-2 text-sm text-white focus:outline-none focus:border-[#00C9A7]"
                placeholder="e.g., Welcome to SRT Agency — {{business_name}}"
              />
            </div>
          )}

          {/* Variable Picker */}
          <div>
            <label className="text-xs text-[rgba(255,255,255,0.5)] block mb-2">Insert Variable</label>
            <div className="flex flex-wrap gap-1.5">
              {TEMPLATE_VARIABLES.map((v) => (
                <button
                  key={v.key}
                  onClick={() => insertVariable(v.key)}
                  className="text-[10px] px-2 py-1 bg-[rgba(255,255,255,0.05)] border border-[rgba(255,255,255,0.08)] rounded text-[rgba(255,255,255,0.6)] hover:text-white hover:border-[#00C9A7] transition-colors font-mono"
                  title={v.example}
                >
                  {`{{${v.key}}}`}
                </button>
              ))}
            </div>
          </div>

          {/* Body */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="text-xs text-[rgba(255,255,255,0.5)]">
                {showPreview ? "Preview" : "Message Body"}
              </label>
              <div className="flex items-center gap-2">
                {type === "SMS" && (
                  <span className="text-[10px] text-[rgba(255,255,255,0.3)] font-mono">
                    {charCount} chars · {smsSegments} segment{smsSegments !== 1 ? "s" : ""}
                  </span>
                )}
                <button
                  onClick={() => setShowPreview(!showPreview)}
                  className="text-xs text-[rgba(255,255,255,0.4)] hover:text-white flex items-center gap-1"
                >
                  {showPreview ? <Code size={12} /> : <Eye size={12} />}
                  {showPreview ? "Edit" : "Preview"}
                </button>
              </div>
            </div>
            {showPreview ? (
              <div className="w-full bg-[rgba(255,255,255,0.03)] border border-[rgba(255,255,255,0.1)] rounded-md px-3 py-3 text-sm text-white whitespace-pre-wrap min-h-[200px]">
                {previewTemplate(body)}
              </div>
            ) : (
              <textarea
                value={body}
                onChange={(e) => setBody(e.target.value)}
                rows={type === "Email" ? 12 : 5}
                className="w-full bg-[rgba(255,255,255,0.05)] border border-[rgba(255,255,255,0.1)] rounded-md px-3 py-2 text-sm text-white focus:outline-none focus:border-[#00C9A7] resize-none font-mono"
                placeholder={type === "SMS" ? "Type your SMS message..." : "Type your email body..."}
              />
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between p-5 border-t border-[rgba(255,255,255,0.06)]">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm text-[rgba(255,255,255,0.5)] hover:text-white transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={!name || !body}
            className="flex items-center gap-2 px-4 py-2 bg-[#00C9A7] text-[#0B1426] rounded-md text-sm font-semibold hover:opacity-90 disabled:opacity-50 transition-opacity"
          >
            <Send size={14} />
            {template?.id ? "Update Template" : "Create Template"}
          </button>
        </div>
      </div>
    </div>
  );
}
