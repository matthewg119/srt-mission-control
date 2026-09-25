"use client";

// The sentence a page uses to offer its lead magnet, and the only control that opens the assistant
// from inside the page.
//
// ‼️ IT IS NOT IN answer_md AND THAT IS THE WHOLE DESIGN. Three rails keep the body free of a pitch:
// draft-page.ts tells the drafter not to write a call to action, the same prompt forbids links, and
// page-gate.ts fails the publish gate on a markdown link in the body. The reason is that the body
// exists to be QUOTED by an assistant, and a pitch inside the answer is the part that stops it being
// quoted. Matthew's ask on 2026-09-25 was that a cited page still have somewhere to send the reader,
// which is this: after the answer, in the page's own words, crawlable, and outside the gate.
//
// Same precedent as the onward links in hub-bodies.tsx: the template draws what the body may not say.
//
// ‼️ THE BUTTON APPEARS ONLY ONCE THE WIDGET HAS ANNOUNCED ITSELF. embed.js publishes
// window.__srtConciergeOpen after /api/concierge/config confirms the tenant is live, and it is async,
// so this polls briefly rather than rendering a control that might do nothing. A dead button on a
// client's live page is worse than no button: the sentence still reads without one.
//
// ‼️ AND IT NAMES NO CORNER. concierge_configs.launcher_corner is one of four values and a visitor can
// drag the launcher anywhere, so "bottom right corner" is a sentence that is wrong for any tenant who
// moved it. The control is right here instead.

import { useEffect, useState } from "react";

declare global {
  interface Window {
    __srtConciergeOpen?: () => void;
  }
}

/** How long to wait for the loader before deciding there is no widget on this page. */
const WAIT_MS = 8000;
const EVERY_MS = 250;

export function HubCta({ line }: { line: string }) {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (typeof window.__srtConciergeOpen === "function") {
      setReady(true);
      return;
    }
    let waited = 0;
    const timer = window.setInterval(() => {
      waited += EVERY_MS;
      if (typeof window.__srtConciergeOpen === "function") {
        setReady(true);
        window.clearInterval(timer);
      } else if (waited >= WAIT_MS) {
        window.clearInterval(timer);
      }
    }, EVERY_MS);
    return () => window.clearInterval(timer);
  }, []);

  return (
    <aside className="hub-cta">
      <p className="hub-cta-line">{line}</p>
      {ready && (
        <button type="button" className="hub-cta-open" onClick={() => window.__srtConciergeOpen?.()}>
          Ask the assistant
        </button>
      )}
    </aside>
  );
}
