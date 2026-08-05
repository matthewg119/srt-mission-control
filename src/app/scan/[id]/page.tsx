// The run view. Server component resolves the session so a dead link 404s
// before any JS loads; everything live is in <ScanRun>, which polls.

import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getSession, buildStatusPayload } from "@/lib/scan/session";
import { ScanRun } from "./scan-run";

export const dynamic = "force-dynamic";
// See the note in api/scan/[id]/status/route.ts: supabase-js goes through Next's patched fetch,
// and force-dynamic governs the ROUTE cache, not the DATA cache. Without this, a refresh
// mid-run repaints from a stale snapshot of the session.
export const fetchCache = "force-no-store";

// Explicit, not inherited. The landing page lifts the layout's noindex so the free tool can be
// found; these run pages must NOT follow it. Each one is a stranger's audit of their own
// business, and it is not ours to put in an index.
export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

export default async function ScanRunPage({ params }: { params: { id: string } }) {
  if (!/^[0-9a-f-]{36}$/i.test(params.id)) notFound();

  const session = await getSession(params.id);
  if (!session) notFound();

  // Seed the client with the current state so a refresh mid-run paints the
  // finished steps immediately instead of replaying from step 1.
  const initial = await buildStatusPayload(session);

  return <ScanRun initial={initial} />;
}
