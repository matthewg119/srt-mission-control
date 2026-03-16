"use client";

import { useState, useEffect, useCallback } from "react";
import {
  Mails,
  Play,
  RefreshCw,
  CheckCircle2,
  AlertCircle,
  Users,
  Mail,
  Tag,
  XCircle,
  Zap,
  Info,
} from "lucide-react";

interface Sequence {
  id: string;
  name: string;
  slug: string;
  trigger_tag: string | null;
  cancel_tag: string | null;
  is_active: boolean;
  created_at: string;
  step_count: number;
  active_enrollments: number;
  completed_enrollments: number;
}

interface SeedResult {
  message: string;
  sequences: Array<{ name: string; slug: string; steps: number }>;
}

export default function SequencesPage() {
  const [sequences, setSequences] = useState<Sequence[]>([]);
  const [loading, setLoading] = useState(true);
  const [seeding, setSeeding] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [seedResult, setSeedResult] = useState<SeedResult | null>(null);
  const [seedError, setSeedError] = useState<string | null>(null);
  const [processResult, setProcessResult] = useState<string | null>(null);
  const [isSeeded, setIsSeeded] = useState(false);

  const fetchSequences = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/sequences");
      const data = await res.json();
      const seqs: Sequence[] = data.sequences || [];
      setSequences(seqs);
      setIsSeeded(seqs.length > 0);
    } catch {
      setSequences([]);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchSequences();
  }, [fetchSequences]);

  const handleSeed = async () => {
    setSeeding(true);
    setSeedResult(null);
    setSeedError(null);
    try {
      const res = await fetch("/api/sequences/seed", { method: "POST" });
      const data = await res.json();
      if (!res.ok) {
        setSeedError(data.error || "Seed failed");
      } else {
        setSeedResult(data);
        await fetchSequences();
      }
    } catch (e) {
      setSeedError(e instanceof Error ? e.message : "Failed to seed");
    }
    setSeeding(false);
  };

  const handleProcess = async () => {
    setProcessing(true);
    setProcessResult(null);
    try {
      const res = await fetch("/api/cron/process-sequences", { method: "POST" });
      const data = await res.json();
      setProcessResult(
        `Processed: ${data.processed ?? 0} emails sent, ${data.skipped ?? 0} skipped, ${data.errors ?? 0} errors`
      );
      await fetchSequences();
    } catch (e) {
      setProcessResult(e instanceof Error ? e.message : "Failed to process");
    }
    setProcessing(false);
  };

  const SEQUENCE_META: Record<string, { description: string; color: string }> = {
    "website-lead-nurture": {
      description: "20-email nurture for contacts who fill the contact form. Runs over 55 days.",
      color: "#1B65A7",
    },
    "application-completed-nurture": {
      description: "20-email sequence for leads who complete the full application. Runs over 55 days.",
      color: "#00C9A7",
    },
    "application-abandoned": {
      description: "7-email recovery for leads who start but don't finish the application. Cancels when they complete.",
      color: "#F59E0B",
    },
    "website-lead-to-application": {
      description: "7-email push encouraging website leads to fill out the full application. Cancels when they apply.",
      color: "#8B5CF6",
    },
  };

  return (
    <div>
      {/* Header */}
      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-white">Email Sequences</h1>
          <p className="text-sm text-[rgba(255,255,255,0.5)] mt-1">
            Automated drip campaigns — 54 emails across 4 sequences
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={handleProcess}
            disabled={processing || !isSeeded}
            className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium border border-[rgba(255,255,255,0.1)] text-[rgba(255,255,255,0.6)] hover:text-white hover:border-[rgba(255,255,255,0.2)] transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <Zap className={`h-4 w-4 ${processing ? "animate-pulse" : ""}`} />
            {processing ? "Processing..." : "Process Now"}
          </button>
          <button
            onClick={handleSeed}
            disabled={seeding}
            className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold bg-[#00C9A7] text-[#0B1426] hover:bg-[#00b598] transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <Play className={`h-4 w-4 ${seeding ? "animate-spin" : ""}`} />
            {seeding ? "Seeding..." : isSeeded ? "Re-seed Sequences" : "Seed Sequences"}
          </button>
        </div>
      </div>

      {/* How it works callout */}
      <div className="mb-6 p-4 rounded-xl border border-[rgba(27,101,167,0.3)] bg-[rgba(27,101,167,0.08)] flex gap-3">
        <Info className="h-5 w-5 text-[#1B65A7] shrink-0 mt-0.5" />
        <div>
          <p className="text-sm text-[rgba(255,255,255,0.8)] font-medium mb-1">
            These are Mission Control email sequences
          </p>
          <p className="text-xs text-[rgba(255,255,255,0.45)] leading-relaxed">
            Emails are sent directly via Microsoft 365 and will appear in your Outlook Sent Items.
            Sequences run on a scheduled cron on Vercel.
          </p>
        </div>
      </div>

      {/* Step 1 callout — tables not yet set up */}
      {!isSeeded && !loading && (
        <div className="mb-6 p-4 rounded-xl border border-[rgba(245,158,11,0.3)] bg-[rgba(245,158,11,0.06)]">
          <p className="text-sm font-semibold text-[#F59E0B] mb-2">Setup Required</p>
          <ol className="text-xs text-[rgba(255,255,255,0.55)] space-y-1.5 list-decimal list-inside">
            <li>
              Go to{" "}
              <a
                href="https://supabase.com"
                target="_blank"
                rel="noopener noreferrer"
                className="text-[#00C9A7] underline"
              >
                Supabase Dashboard
              </a>{" "}
              → SQL Editor → paste the contents of{" "}
              <code className="text-white bg-[rgba(255,255,255,0.08)] px-1 rounded">
                docs/supabase-sequence-tables.sql
              </code>{" "}
              and run it.
            </li>
            <li>
              Come back here and click <strong className="text-[#00C9A7]">Seed Sequences</strong> — it will populate all 4 sequences with 54 emails.
            </li>
          </ol>
        </div>
      )}

      {/* Seed result */}
      {seedResult && (
        <div className="mb-6 p-4 rounded-xl border border-[rgba(0,201,167,0.3)] bg-[rgba(0,201,167,0.06)] flex gap-3">
          <CheckCircle2 className="h-5 w-5 text-[#00C9A7] shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-semibold text-[#00C9A7] mb-1">{seedResult.message}</p>
            <ul className="text-xs text-[rgba(255,255,255,0.5)] space-y-0.5">
              {seedResult.sequences?.map((s) => (
                <li key={s.slug}>
                  {s.name} — <span className="text-white">{s.steps} emails</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}

      {/* Seed error */}
      {seedError && (
        <div className="mb-6 p-4 rounded-xl border border-[rgba(239,68,68,0.3)] bg-[rgba(239,68,68,0.06)] flex gap-3">
          <AlertCircle className="h-5 w-5 text-red-400 shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-semibold text-red-400 mb-1">Seed failed</p>
            <p className="text-xs text-[rgba(255,255,255,0.5)]">{seedError}</p>
            {seedError.includes("does not exist") || seedError.includes("relation") ? (
              <p className="text-xs text-[rgba(255,255,255,0.4)] mt-2">
                The Supabase tables don&apos;t exist yet. Run the SQL from{" "}
                <code className="text-white bg-[rgba(255,255,255,0.08)] px-1 rounded">
                  docs/supabase-sequence-tables.sql
                </code>{" "}
                in your Supabase SQL Editor first.
              </p>
            ) : null}
          </div>
        </div>
      )}

      {/* Process result */}
      {processResult && (
        <div className="mb-6 p-4 rounded-xl border border-[rgba(255,255,255,0.1)] bg-[rgba(255,255,255,0.03)] flex gap-3">
          <RefreshCw className="h-4 w-4 text-[rgba(255,255,255,0.4)] shrink-0 mt-0.5" />
          <p className="text-sm text-[rgba(255,255,255,0.6)]">{processResult}</p>
        </div>
      )}

      {/* Sequences grid */}
      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="h-48 rounded-xl bg-[rgba(255,255,255,0.03)] border border-[rgba(255,255,255,0.06)] animate-pulse" />
          ))}
        </div>
      ) : sequences.length === 0 ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {(["website-lead-nurture", "application-completed-nurture", "application-abandoned", "website-lead-to-application"] as const).map((slug) => {
            const meta = SEQUENCE_META[slug];
            return (
              <div
                key={slug}
                className="rounded-xl border border-[rgba(255,255,255,0.06)] bg-[rgba(255,255,255,0.02)] p-5 opacity-50"
              >
                <div className="flex items-start gap-3 mb-3">
                  <div
                    className="h-2 w-2 rounded-full mt-2 shrink-0"
                    style={{ backgroundColor: meta.color }}
                  />
                  <div>
                    <h3 className="text-sm font-semibold text-white">{slug}</h3>
                    <p className="text-xs text-[rgba(255,255,255,0.4)] mt-1">{meta.description}</p>
                  </div>
                </div>
                <p className="text-xs text-[rgba(255,255,255,0.3)] italic">Not seeded yet</p>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {sequences.map((seq) => {
            const meta = SEQUENCE_META[seq.slug] ?? { description: "", color: "#64748b" };
            return (
              <div
                key={seq.id}
                className="rounded-xl border border-[rgba(255,255,255,0.07)] bg-[rgba(255,255,255,0.03)] p-5 hover:border-[rgba(255,255,255,0.12)] transition-colors"
              >
                {/* Header */}
                <div className="flex items-start gap-3 mb-4">
                  <div
                    className="h-2.5 w-2.5 rounded-full mt-1.5 shrink-0"
                    style={{ backgroundColor: meta.color }}
                  />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <h3 className="text-sm font-semibold text-white truncate">{seq.name}</h3>
                      {seq.is_active ? (
                        <span className="flex items-center gap-1 text-[10px] font-medium text-[#00C9A7] bg-[rgba(0,201,167,0.1)] px-1.5 py-0.5 rounded-full shrink-0">
                          <CheckCircle2 className="h-2.5 w-2.5" /> Active
                        </span>
                      ) : (
                        <span className="flex items-center gap-1 text-[10px] font-medium text-[rgba(255,255,255,0.4)] bg-[rgba(255,255,255,0.05)] px-1.5 py-0.5 rounded-full shrink-0">
                          <XCircle className="h-2.5 w-2.5" /> Inactive
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-[rgba(255,255,255,0.4)] mt-1 leading-relaxed">
                      {meta.description}
                    </p>
                  </div>
                </div>

                {/* Stats row */}
                <div className="grid grid-cols-3 gap-3 mb-4">
                  <div className="text-center p-2 rounded-lg bg-[rgba(255,255,255,0.03)] border border-[rgba(255,255,255,0.05)]">
                    <div className="flex items-center justify-center gap-1 mb-1">
                      <Mail className="h-3 w-3 text-[rgba(255,255,255,0.3)]" />
                    </div>
                    <p className="text-lg font-bold text-white">{seq.step_count}</p>
                    <p className="text-[10px] text-[rgba(255,255,255,0.3)]">Emails</p>
                  </div>
                  <div className="text-center p-2 rounded-lg bg-[rgba(255,255,255,0.03)] border border-[rgba(255,255,255,0.05)]">
                    <div className="flex items-center justify-center gap-1 mb-1">
                      <Users className="h-3 w-3 text-[rgba(255,255,255,0.3)]" />
                    </div>
                    <p className="text-lg font-bold text-white">{seq.active_enrollments}</p>
                    <p className="text-[10px] text-[rgba(255,255,255,0.3)]">Active</p>
                  </div>
                  <div className="text-center p-2 rounded-lg bg-[rgba(255,255,255,0.03)] border border-[rgba(255,255,255,0.05)]">
                    <div className="flex items-center justify-center gap-1 mb-1">
                      <CheckCircle2 className="h-3 w-3 text-[rgba(255,255,255,0.3)]" />
                    </div>
                    <p className="text-lg font-bold text-white">{seq.completed_enrollments}</p>
                    <p className="text-[10px] text-[rgba(255,255,255,0.3)]">Done</p>
                  </div>
                </div>

                {/* Tags */}
                <div className="flex flex-wrap gap-2">
                  {seq.trigger_tag && (
                    <span className="flex items-center gap-1 text-[10px] px-2 py-1 rounded-md bg-[rgba(27,101,167,0.15)] border border-[rgba(27,101,167,0.25)] text-[#1B65A7]">
                      <Tag className="h-2.5 w-2.5" />
                      Trigger: <strong>{seq.trigger_tag}</strong>
                    </span>
                  )}
                  {!seq.trigger_tag && (
                    <span className="flex items-center gap-1 text-[10px] px-2 py-1 rounded-md bg-[rgba(255,255,255,0.04)] border border-[rgba(255,255,255,0.07)] text-[rgba(255,255,255,0.35)]">
                      <Tag className="h-2.5 w-2.5" />
                      Manual enrollment
                    </span>
                  )}
                  {seq.cancel_tag && (
                    <span className="flex items-center gap-1 text-[10px] px-2 py-1 rounded-md bg-[rgba(239,68,68,0.08)] border border-[rgba(239,68,68,0.2)] text-red-400">
                      <XCircle className="h-2.5 w-2.5" />
                      Cancels on: <strong>{seq.cancel_tag}</strong>
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Where to see sent emails */}
      {isSeeded && (
        <div className="mt-6 p-4 rounded-xl border border-[rgba(255,255,255,0.06)] bg-[rgba(255,255,255,0.02)]">
          <p className="text-xs font-semibold text-[rgba(255,255,255,0.5)] uppercase tracking-wider mb-2">
            Where to see sent emails
          </p>
          <p className="text-sm text-[rgba(255,255,255,0.5)] leading-relaxed">
            Emails are sent via Microsoft 365. Check your <strong className="text-white">Outlook Sent Items</strong> folder
            to verify delivery. Contact tags (<code className="text-[#00C9A7]">website-lead</code>,{" "}
            <code className="text-[#00C9A7]">application-started</code>,{" "}
            <code className="text-[#00C9A7]">application-completed</code>) are used to trigger the right sequence.
          </p>
        </div>
      )}
    </div>
  );
}
