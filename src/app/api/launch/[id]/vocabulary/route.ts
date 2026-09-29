// Propose the words this niche uses, and confirm them.
//
// ‼️ TWO VERBS, AND THEY ARE SEPARATE ON PURPOSE. GET proposes and writes nothing; POST confirms
// what a person read and writes the row. Collapsing them into one "generate and save" call is
// exactly the read-time derivation that src/config/audience-presets.ts forbids at the top of the
// file: the words a client's widget speaks would become whatever the model said most recently,
// with nothing recording which words were live on any given day.

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { proposeVocabulary, confirmVocabulary, type VocabularyProposal } from "@/lib/launch/vocabulary";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

/** GET: propose. Reads the documents, writes nothing. */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth().catch(() => null);
  if (!session?.user) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const result = await proposeVocabulary(id);
  return NextResponse.json(result, { status: result.ok ? 200 : 400 });
}

function readProposal(v: unknown): VocabularyProposal | null {
  if (!v || typeof v !== "object") return null;
  const p = v as Record<string, unknown>;
  const keys = [
    "slug",
    "label",
    "buyerSingular",
    "buyerPlural",
    "offerSingular",
    "offerPlural",
    "businessNoun",
    "visitNoun",
    "laneName",
    "launcherLabel",
    "rationale",
  ] as const;

  for (const k of keys) if (typeof p[k] !== "string" || !(p[k] as string).trim()) return null;
  const hardLines = Array.isArray(p.hardLines) ? p.hardLines.filter((l) => typeof l === "string") : [];

  return {
    slug: (p.slug as string).trim(),
    label: (p.label as string).trim(),
    buyerSingular: (p.buyerSingular as string).trim(),
    buyerPlural: (p.buyerPlural as string).trim(),
    offerSingular: (p.offerSingular as string).trim(),
    offerPlural: (p.offerPlural as string).trim(),
    businessNoun: (p.businessNoun as string).trim(),
    visitNoun: (p.visitNoun as string).trim(),
    laneName: (p.laneName as string).trim(),
    launcherLabel: (p.launcherLabel as string).trim(),
    hardLines: hardLines as string[],
    rationale: (p.rationale as string).trim(),
  };
}

/**
 * POST: confirm.
 *
 * ‼️ THE BODY IS THE PROPOSAL A PERSON READ, NOT AN INSTRUCTION TO REGENERATE ONE.
 * It is sent back edited or unedited, which is what makes this a confirmation: the words written
 * to the row are the words that were on screen when somebody pressed the button. Re-proposing
 * here would store something nobody had seen.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth().catch(() => null);
  if (!session?.user) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });

  const { id } = await params;

  let body: { proposal?: unknown; from?: unknown; presetKey?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ ok: false, error: "Bad request." }, { status: 400 });
  }

  const proposal = readProposal(body.proposal);
  if (!proposal) {
    return NextResponse.json(
      { ok: false, error: "Every word is required. Send back the proposal with nothing blank." },
      { status: 400 }
    );
  }

  const from = body.from === "preset" ? "preset" : "documents";

  const result = await confirmVocabulary({
    clientId: id,
    proposal,
    from,
    presetKey: typeof body.presetKey === "string" ? body.presetKey : undefined,
    by: session.user.name ?? session.user.email ?? "the dashboard",
  });

  return NextResponse.json(result, { status: result.ok ? 200 : 400 });
}
