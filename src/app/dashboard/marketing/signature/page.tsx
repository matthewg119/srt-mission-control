"use client";

import { useState, useRef, useCallback } from "react";
import { Mail, Copy, Check, Info } from "lucide-react";
import { generateSignatureHtml } from "@/config/email-signature";

const TITLE_OPTIONS = [
  "Capital Specialist",
  "Senior Capital Specialist",
  "Account Executive",
  "Funding Advisor",
  "Managing Partner",
];

export default function SignaturePage() {
  const [name, setName] = useState("");
  const [title, setTitle] = useState(TITLE_OPTIONS[0]);
  const [phone, setPhone] = useState("");
  const [fax, setFax] = useState("");
  const [copied, setCopied] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const previewRef = useRef<HTMLDivElement>(null);

  const isValid = name.trim() && phone.trim();

  const signatureHtml = isValid
    ? generateSignatureHtml({ name: name.trim(), title, phone: phone.trim(), fax: fax.trim() || undefined })
    : "";

  const copySignature = useCallback(() => {
    if (!previewRef.current || !isValid) return;
    const range = document.createRange();
    range.selectNodeContents(previewRef.current);
    const sel = window.getSelection();
    if (sel) {
      sel.removeAllRanges();
      sel.addRange(range);
    }
    document.execCommand("copy");
    sel?.removeAllRanges();
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [isValid]);

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <div className="w-9 h-9 rounded-lg bg-[rgba(0,201,167,0.12)] flex items-center justify-center">
          <Mail className="h-4.5 w-4.5 text-[#00C9A7]" />
        </div>
        <div>
          <h1 className="text-lg font-bold text-white">Email Signature Generator</h1>
          <p className="text-xs text-[rgba(255,255,255,0.35)]">
            Create your professional SRT Agency signature
          </p>
        </div>
      </div>

      <div className="flex flex-col lg:flex-row gap-6">
        {/* ─── LEFT: Form ─── */}
        <div className="w-full lg:w-[380px] shrink-0 space-y-4">
          <div className="bg-[rgba(255,255,255,0.02)] border border-[rgba(255,255,255,0.06)] rounded-xl p-5 space-y-4">
            <div>
              <label className="block text-xs font-medium text-[rgba(255,255,255,0.5)] mb-1.5">
                Full Name <span className="text-red-400">*</span>
              </label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Matthew Gabriel"
                className="w-full bg-[rgba(255,255,255,0.05)] border border-[rgba(255,255,255,0.1)] rounded-lg px-3 py-2 text-sm text-white placeholder-[rgba(255,255,255,0.25)] focus:outline-none focus:border-[#00C9A7]"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-[rgba(255,255,255,0.5)] mb-1.5">
                Title
              </label>
              <select
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className="w-full bg-[rgba(255,255,255,0.05)] border border-[rgba(255,255,255,0.1)] rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-[#00C9A7]"
              >
                {TITLE_OPTIONS.map((t) => (
                  <option key={t} value={t} className="bg-[#0B1426]">
                    {t}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-medium text-[rgba(255,255,255,0.5)] mb-1.5">
                Phone <span className="text-red-400">*</span>
              </label>
              <input
                type="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="(786) 282-2937"
                className="w-full bg-[rgba(255,255,255,0.05)] border border-[rgba(255,255,255,0.1)] rounded-lg px-3 py-2 text-sm text-white placeholder-[rgba(255,255,255,0.25)] focus:outline-none focus:border-[#00C9A7]"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-[rgba(255,255,255,0.5)] mb-1.5">
                Fax <span className="text-[rgba(255,255,255,0.25)] text-[10px]">(optional)</span>
              </label>
              <input
                type="tel"
                value={fax}
                onChange={(e) => setFax(e.target.value)}
                placeholder="(252) 556-1444"
                className="w-full bg-[rgba(255,255,255,0.05)] border border-[rgba(255,255,255,0.1)] rounded-lg px-3 py-2 text-sm text-white placeholder-[rgba(255,255,255,0.25)] focus:outline-none focus:border-[#00C9A7]"
              />
            </div>

            <button
              onClick={copySignature}
              disabled={!isValid}
              className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-[#00C9A7] text-[#0B1426] font-semibold text-sm rounded-lg hover:opacity-90 disabled:opacity-40 transition-opacity"
            >
              {copied ? (
                <>
                  <Check className="h-4 w-4" /> Copied!
                </>
              ) : (
                <>
                  <Copy className="h-4 w-4" /> Copy Signature
                </>
              )}
            </button>
          </div>

          {/* Help section */}
          <button
            onClick={() => setShowHelp(!showHelp)}
            className="flex items-center gap-2 text-xs text-[rgba(255,255,255,0.35)] hover:text-[rgba(255,255,255,0.6)] transition-colors"
          >
            <Info className="h-3.5 w-3.5" />
            How to install in Outlook
          </button>

          {showHelp && (
            <div className="bg-[rgba(255,255,255,0.02)] border border-[rgba(255,255,255,0.06)] rounded-xl p-4 space-y-2 text-xs text-[rgba(255,255,255,0.45)]">
              <p className="font-medium text-[rgba(255,255,255,0.6)]">Steps:</p>
              <ol className="list-decimal list-inside space-y-1.5">
                <li>Click &quot;Copy Signature&quot; above</li>
                <li>Open Outlook &rarr; File &rarr; Options &rarr; Mail &rarr; Signatures</li>
                <li>Click &quot;New&quot; and name it (e.g. &quot;SRT Agency&quot;)</li>
                <li>In the editor box, press Ctrl+A then Ctrl+V to paste</li>
                <li>Set it as default for new messages &amp; replies, then click OK</li>
              </ol>
              <p className="text-[10px] text-[rgba(255,255,255,0.25)] mt-2">
                Works with Outlook desktop, Outlook web, and most email clients that support HTML signatures.
              </p>
            </div>
          )}
        </div>

        {/* ─── RIGHT: Live Preview ─── */}
        <div className="flex-1">
          <div className="bg-white rounded-xl p-6 min-h-[300px]">
            {isValid ? (
              <div ref={previewRef} dangerouslySetInnerHTML={{ __html: signatureHtml }} />
            ) : (
              <div className="flex items-center justify-center h-[250px] text-gray-400 text-sm">
                Fill in your name and phone to see the preview
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
