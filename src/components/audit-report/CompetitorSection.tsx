import type { CitedDomain, MostRecommended } from "@/lib/audit-engine/report-view";
import type { LikelyCompetitor } from "@/lib/audit-engine/classify";

export function CompetitorSection({
  mostRecommended,
  citedDomains,
  likelyCompetitors,
}: {
  mostRecommended: MostRecommended[];
  citedDomains: CitedDomain[];
  likelyCompetitors: LikelyCompetitor[];
}) {
  const hasData = mostRecommended.length > 0 || citedDomains.length > 0 || likelyCompetitors.length > 0;
  if (!hasData) return null; // hide rather than show an empty/misleading section

  return (
    <section className="space-y-4">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-text-secondary">Who owns the answers</h2>

      {mostRecommended.length > 0 && (
        <div>
          <p className="mb-1.5 text-xs text-text-secondary">Most-recommended businesses across all 20 prompts:</p>
          <div className="flex flex-wrap gap-1.5">
            {mostRecommended.map((r) => (
              <span key={r.name} className="rounded-full border border-surface-border bg-surface px-2.5 py-1 text-xs text-text-primary">
                {r.name} <span className="text-text-secondary">×{r.count}</span>
              </span>
            ))}
          </div>
        </div>
      )}

      {citedDomains.length > 0 && (
        <div>
          <p className="mb-1.5 text-xs text-text-secondary">Most-cited sources across all engine runs:</p>
          <div className="flex flex-wrap gap-1.5">
            {citedDomains.map((d) => (
              <span key={d.domain} className="rounded-full border border-surface-border bg-surface px-2.5 py-1 text-xs text-text-primary">
                {d.domain} <span className="text-text-secondary">×{d.count}</span>
              </span>
            ))}
          </div>
        </div>
      )}

      {likelyCompetitors.length > 0 && (
        <div>
          <p className="mb-1.5 text-xs text-text-secondary">Hypothesized competitors (not yet confirmed by the runs above):</p>
          <div className="flex flex-wrap gap-1.5">
            {likelyCompetitors.map((c) => (
              <span key={c.name} className="rounded-full border border-surface-border bg-surface px-2.5 py-1 text-xs text-text-secondary">
                {c.name}
              </span>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
