import type { BlockStat } from "@/lib/audit-engine/report-view";

const BLOCK_LABELS: Record<string, string> = {
  MARCA: "Brand",
  SERVICIO: "Service",
  INFO: "Info",
  COMPARATIVO: "Comparison",
};

export function BlockBreakdown({ blockStats }: { blockStats: BlockStat[] }) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      {blockStats.map((b) => (
        <div key={b.block} className="rounded-lg border border-surface-border bg-surface p-3 text-center">
          <p className="text-xs font-semibold uppercase tracking-wide text-text-secondary">
            {BLOCK_LABELS[b.block] ?? b.block}
          </p>
          <p className="mt-1 text-lg font-semibold text-text-primary">
            {b.mentioned}/{b.total}
          </p>
        </div>
      ))}
    </div>
  );
}
