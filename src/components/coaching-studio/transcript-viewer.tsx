"use client";

import type { TranscriptEntry } from "@/types/coaching";

interface TranscriptViewerProps {
  transcript: TranscriptEntry[];
  emptyLabel?: string;
}

function formatElapsed(ms: number): string {
  if (!ms || ms < 0) return "";
  const totalSec = Math.floor(ms / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export function TranscriptViewer({
  transcript,
  emptyLabel = "No transcript saved for this call.",
}: TranscriptViewerProps) {
  if (!transcript || transcript.length === 0) {
    return (
      <div className="text-center py-12 text-[rgba(255,255,255,0.4)]">
        <p className="text-sm">{emptyLabel}</p>
      </div>
    );
  }

  // Normalize timestamps to elapsed-from-start of call.
  const startTs = transcript[0]?.timestamp_ms || 0;

  return (
    <div className="space-y-3">
      {transcript.map((entry) => {
        const isRep = entry.speaker === "rep";
        const isMerchant = entry.speaker === "merchant";
        const align = isRep ? "justify-end" : "justify-start";
        const bubbleStyle = isRep
          ? "bg-[#00C9A7]/15 border-[#00C9A7]/30 text-white"
          : isMerchant
          ? "bg-[rgba(255,255,255,0.05)] border-[rgba(255,255,255,0.1)] text-[rgba(255,255,255,0.9)]"
          : "bg-[rgba(255,255,255,0.02)] border-[rgba(255,255,255,0.05)] text-[rgba(255,255,255,0.6)]";
        const label = isRep ? "REP" : isMerchant ? "MERCHANT" : "UNKNOWN";

        return (
          <div key={entry.id} className={`flex ${align}`}>
            <div className="max-w-[75%]">
              <div className="flex items-center gap-2 mb-1 text-[10px] text-[rgba(255,255,255,0.4)]">
                <span className="font-semibold">{label}</span>
                <span>{formatElapsed(entry.timestamp_ms - startTs)}</span>
              </div>
              <div
                className={`px-3 py-2 rounded-lg border text-sm leading-relaxed ${bubbleStyle}`}
              >
                {entry.text}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
