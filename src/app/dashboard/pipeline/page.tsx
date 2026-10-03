import { supabaseAdmin } from "@/lib/db";
import { ALL_STAGES, normalizeStage } from "@/config/stage-display";
import { applyStageFilter } from "@/lib/stage-query";
import { PipelineBoard, type BoardCard, type BoardColumn } from "./board";

export const metadata = { title: "Pipeline | SRT Mission Control" };
export const dynamic = "force-dynamic";

// The board. The whole book, as columns.
//
// ‼️ IT IS NOT A VIEW MODE OF /dashboard/leads AND THE TWO ANSWER DIFFERENT QUESTIONS.
// The list answers "find me this one lead" and sorts, filters, searches and pages thousands of
// rows to do it. The board answers "what does the book look like", which a list cannot: the shape
// is the answer, and the shape is only visible when every stage is on screen at once.
//
// ‼️ A SLICE PER COLUMN, AND THE TOTAL READ SEPARATELY. Loading every contact to group them in
// memory is tens of thousands of rows for a screen that can show about fifty. So each column asks
// for its own first page ordered by most recently active, and a HEAD count gives the real number
// for the header. Nine small queries in parallel beats one enormous one.
const CARDS_PER_COLUMN = 40;

interface ContactRow {
  id: string;
  first_name: string | null;
  last_name: string | null;
  business_name: string | null;
  email: string | null;
  phone: string | null;
  application_stage: string | null;
  last_activity_at: string | null;
  open_task_count: number | null;
  do_not_contact: boolean | null;
}

const COLUMNS =
  "id, first_name, last_name, business_name, email, phone, application_stage, " +
  "last_activity_at, open_task_count, do_not_contact";

function displayName(r: ContactRow): string {
  const n = [r.first_name, r.last_name].filter(Boolean).join(" ").trim();
  return n || r.business_name || r.email || "Unnamed lead";
}

function toCard(r: ContactRow): BoardCard {
  return {
    id: r.id,
    name: displayName(r),
    business: r.business_name,
    email: r.email,
    phone: r.phone,
    stage: normalizeStage(r.application_stage),
    lastActivityAt: r.last_activity_at,
    openTasks: r.open_task_count ?? 0,
    doNotContact: r.do_not_contact === true,
  };
}

async function loadColumn(meta: (typeof ALL_STAGES)[number]): Promise<BoardColumn> {
  const build = (head: boolean) =>
    applyStageFilter(
      supabaseAdmin
        .from("contacts")
        .select(head ? "id" : COLUMNS, head ? { count: "exact", head: true } : undefined),
      meta.name
    );

  const [countRes, rowsRes] = await Promise.all([
    build(true),
    build(false)
      .order("last_activity_at", { ascending: false, nullsFirst: false })
      .limit(CARDS_PER_COLUMN),
  ]);

  if (countRes.error) console.error(`[pipeline] count for ${meta.name}:`, countRes.error.message);
  if (rowsRes.error) console.error(`[pipeline] rows for ${meta.name}:`, rowsRes.error.message);

  const rows = (rowsRes.data ?? []) as unknown as ContactRow[];
  return {
    stage: meta.name,
    color: meta.color,
    blurb: meta.blurb,
    total: countRes.count ?? rows.length,
    cards: rows.map(toCard),
  };
}

export default async function PipelinePage() {
  const columns = await Promise.all(ALL_STAGES.map(loadColumn));
  const book = columns.reduce((n, c) => n + c.total, 0);

  return (
    <div className="px-6 py-6">
      <div className="mb-5 flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-white">Pipeline</h1>
          <p className="mt-1 text-xs text-[rgba(255,255,255,0.45)]">
            {book.toLocaleString()} leads across {columns.length} stages. Drag a card to move one.
          </p>
        </div>
      </div>
      <PipelineBoard columns={columns} />
    </div>
  );
}
