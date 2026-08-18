"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, MailWarning } from "lucide-react";

// Fills the timeline with emails and texts a beat after the page paints.
//
// It runs here rather than in the server page because the Outlook search takes
// about a second, and the record and the call form should not wait on a mailbox
// to render. Refreshes ONLY when something new was mirrored, so the steady state
// (open a lead you have already opened) is one cheap request and no re-render.

export function CommsSync({ contactId }: { contactId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(true);
  const [graphError, setGraphError] = useState<string | null>(null);
  // React 18 StrictMode mounts effects twice in dev; without this the sync runs
  // twice on every dev page load.
  const ran = useRef(false);

  useEffect(() => {
    if (ran.current) return;
    ran.current = true;

    let alive = true;
    (async () => {
      try {
        const res = await fetch(`/api/crm/leads/${contactId}/sync-comms`, {
          method: "POST",
        });
        const json = await res.json();
        if (!alive) return;
        if (json?.graphError) setGraphError(String(json.graphError));
        if (res.ok && json?.inserted > 0) router.refresh();
      } catch {
        // A failed sync is not worth an error banner: the timeline still shows
        // everything already stored.
      } finally {
        if (alive) setBusy(false);
      }
    })();

    return () => {
      alive = false;
    };
  }, [contactId, router]);

  if (busy) {
    return (
      <p className="mb-2 flex items-center gap-1.5 text-[10px] text-[rgba(255,255,255,0.3)]">
        <Loader2 className="h-3 w-3 animate-spin" />
        Checking email and texts…
      </p>
    );
  }

  if (graphError) {
    return (
      <p className="mb-2 flex items-center gap-1.5 text-[10px] text-[#F5A623]">
        <MailWarning className="h-3 w-3" />
        Could not reach Outlook — email history may be incomplete.
      </p>
    );
  }

  return null;
}
