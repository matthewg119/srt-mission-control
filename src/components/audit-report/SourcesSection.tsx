import type { OffsiteTarget, TargetKind } from "@/lib/clients/offsite-targets";

/**
 * "Where the engines get their answers."
 *
 * ‼️ THIS IS THE ANSWER TO "IS THIS IN THE AI VISIBILITY AUDIT". The data always was: every
 * engine call records the URLs it cited, on audit_runs.citations, since 2026-07. What was
 * missing was anybody being shown it. The report said which questions a business was absent
 * from; it never said where the engines had read instead.
 *
 * ‼️ AND IT IS NOT CompetitorSection'S citedDomains. That list is capped at eight, has no
 * classification, and sits inside a section about rivals, where it reads as "who else came
 * up". This one says what KIND of place each is, which is the difference between a list and
 * a plan: a review platform, a directory and a forum are three different jobs.
 */
export function SourcesSection({ targets }: { targets: OffsiteTarget[] }) {
  if (targets.length === 0) return null;

  return (
    <section className="space-y-4">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-text-secondary">
        Where the engines get their answers
      </h2>

      <p className="text-sm text-text-secondary">
        These are the places the engines actually read before answering the questions above.
        Being named on them is how a business gets into an answer it is currently missing from.
      </p>

      <ul className="space-y-2">
        {targets.map((t) => (
          <li key={t.domain} className="flex items-baseline justify-between gap-3 text-sm">
            <span className="flex items-baseline gap-2">
              <span className="font-medium">{t.domain}</span>
              <span className="text-xs text-text-secondary">{LABELS[t.kind]}</span>
            </span>
            <span className="shrink-0 text-xs text-text-secondary">
              cited {t.timesCited}
              {t.timesCited === 1 ? " time" : " times"}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

/**
 * ‼️ `unknown` READS AS "another site", NOT AS "unknown". The reader is a business owner, and
 * a column of the word "unknown" describes our classifier rather than their market. It is an
 * honest label either way: we know it was cited and we have not said what kind of place it is.
 */
const LABELS: Record<TargetKind, string> = {
  directory: "directory",
  listicle: "a ranked list",
  forum: "forum",
  review_platform: "reviews",
  news: "press",
  competitor: "a competitor",
  client_own: "your own site",
  listed_subject: "named on your page",
  unknown: "another site",
};
