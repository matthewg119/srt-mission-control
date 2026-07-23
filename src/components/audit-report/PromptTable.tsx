import type { EngineCellView, PromptRowView } from "@/lib/audit-engine/report-view";

// Three states, not two: a failed engine call renders as a distinct gray "no
// data" chip, never a red x that would imply "checked and confirmed absent".
// This is where the no-fabrication rule surfaces in the UI.
function EngineChip({ label, cell }: { label: string; cell: EngineCellView }) {
  if (cell.status === "no_data") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-white/5 px-2 py-0.5 text-xs text-text-secondary">
        {label}: no data
      </span>
    );
  }
  return cell.mentioned ? (
    <span className="inline-flex items-center gap-1 rounded-full bg-reef/15 px-2 py-0.5 text-xs text-reef">
      ✅ {label}
    </span>
  ) : (
    <span className="inline-flex items-center gap-1 rounded-full bg-white/5 px-2 py-0.5 text-xs text-text-secondary">
      ❌ {label}
    </span>
  );
}

function PromptRow({ row }: { row: PromptRowView }) {
  const hasSnippet = row.engines.openai.snippet || row.engines.perplexity.snippet;

  return (
    <details className="group rounded-lg border border-surface-border bg-surface open:bg-surface-hover">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 p-3">
        <span className="min-w-0 flex-1 truncate text-sm text-text-primary">{row.prompt}</span>
        <span className="flex shrink-0 gap-1.5">
          <EngineChip label="ChatGPT" cell={row.engines.openai} />
          <EngineChip label="Perplexity" cell={row.engines.perplexity} />
        </span>
      </summary>
      {hasSnippet && (
        <div className="space-y-2 border-t border-surface-border p-3 text-xs text-text-secondary">
          {row.engines.openai.snippet && (
            <p>
              <span className="font-semibold text-text-primary">ChatGPT: </span>
              {row.engines.openai.snippet}…
            </p>
          )}
          {row.engines.perplexity.snippet && (
            <p>
              <span className="font-semibold text-text-primary">Perplexity: </span>
              {row.engines.perplexity.snippet}…
            </p>
          )}
        </div>
      )}
    </details>
  );
}

export function PromptTable({ prompts }: { prompts: PromptRowView[] }) {
  return (
    <div className="space-y-2">
      {prompts.map((row, i) => (
        <PromptRow key={`${row.block}-${i}`} row={row} />
      ))}
    </div>
  );
}
