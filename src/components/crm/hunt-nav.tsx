"use client";

// Next / previous through a list of leads, for working them one at a time.
//
// WHY A SNAPSHOT AND NOT A QUERY. The obvious implementation, "ask the database for the
// next lead after this one", is wrong here for two independent reasons:
//
//   1. The leads list orders by last_activity_at desc with NO tiebreaker, and roughly
//      7,400 of 8,300 contacts have that column NULL. Postgres returns ties in arbitrary
//      order, and it can differ between two identical requests. There is no stable
//      "next".
//   2. Logging a call SETS last_activity_at, which teleports that lead to position 1. So
//      the one action you take on each lead is precisely the action that reshuffles the
//      queue you are working through.
//
// So the queue is frozen the moment you enter it. The list page writes its ordered ids to
// sessionStorage, and these arrows walk that array. Nothing re-queries, so nothing moves
// under you, and the counter ("3 of 47") is honest.
//
// sessionStorage rather than a URL param because the array is up to 200 ids, and rather
// than localStorage because a queue should not outlive the tab you opened it in.

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronLeft, ChevronRight } from "lucide-react";

const KEY = "srt-hunt-queue-v1";

export interface HuntQueue {
  label: string;
  ids: string[];
}

/** Called by the list pages just before navigating into a lead. */
export function saveHuntQueue(queue: HuntQueue): void {
  try {
    sessionStorage.setItem(KEY, JSON.stringify(queue));
  } catch {
    // Private mode, quota, or storage disabled. The arrows simply will not appear.
  }
}

function readHuntQueue(): HuntQueue | null {
  try {
    const raw = sessionStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as HuntQueue;
    return Array.isArray(parsed?.ids) && parsed.ids.length > 0 ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * A lead link that freezes the list it was clicked from.
 *
 * The list pages are server components, so the click handler has to live in a client
 * component. This is that, and nothing more: it stores the queue, then navigates
 * normally. Rendered as a real anchor so middle-click, cmd-click and "copy link" all
 * still behave.
 */
export function HuntLink({
  id,
  ids,
  label,
  className,
  children,
}: {
  id: string;
  ids: string[];
  label: string;
  className?: string;
  children: React.ReactNode;
}) {
  const router = useRouter();
  const href = `/dashboard/leads/${id}`;

  return (
    <a
      href={href}
      className={className}
      onClick={(e) => {
        // Let the browser handle anything that is not a plain left click.
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
        e.preventDefault();
        saveHuntQueue({ label, ids });
        router.push(href);
      }}
    >
      {children}
    </a>
  );
}

export function HuntNav({ currentId }: { currentId: string }) {
  const router = useRouter();
  const [queue, setQueue] = useState<HuntQueue | null>(null);

  // sessionStorage is not available during SSR, so the queue is read after mount. That
  // makes this render nothing on the server and appear on hydrate, which is correct:
  // there is no server-side notion of "the list you came from".
  useEffect(() => setQueue(readHuntQueue()), []);

  if (!queue) return null;

  const index = queue.ids.indexOf(currentId);
  // Deep-linked into a lead that is not part of the queue. Showing arrows that jumped
  // somewhere unrelated would be worse than showing none.
  if (index === -1) return null;

  const prevId = index > 0 ? queue.ids[index - 1] : null;
  const nextId = index < queue.ids.length - 1 ? queue.ids[index + 1] : null;

  const btn =
    "flex h-8 w-8 items-center justify-center rounded-lg border border-[rgba(255,255,255,0.12)] text-[rgba(255,255,255,0.6)] hover:text-white disabled:opacity-25 disabled:hover:text-[rgba(255,255,255,0.6)]";

  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        aria-label="Previous lead"
        disabled={!prevId}
        onClick={() => prevId && router.push(`/dashboard/leads/${prevId}`)}
        className={btn}
      >
        <ChevronLeft className="h-4 w-4" />
      </button>

      <span className="min-w-[70px] text-center text-[11px] text-[rgba(255,255,255,0.4)]">
        {index + 1} of {queue.ids.length}
      </span>

      <button
        type="button"
        aria-label="Next lead"
        disabled={!nextId}
        onClick={() => nextId && router.push(`/dashboard/leads/${nextId}`)}
        className={btn}
      >
        <ChevronRight className="h-4 w-4" />
      </button>
    </div>
  );
}
