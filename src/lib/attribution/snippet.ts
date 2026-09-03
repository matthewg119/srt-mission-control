// The SRT first-party pixel, as a string. Served by src/app/px.js/route.ts.
//
// ‼️ ONE SNIPPET DOES BOTH JOBS. The agreement asks the client for site access once, for the AI
// Skin Concierge and for this, and a second tag on every page would be a second ask and a second
// thing to go missing. This file is the pixel; the Concierge frame is loaded by the same script
// when the client has one.
//
// ‼️ IT IS A TEMPLATE LITERAL AND NOT A .js FILE IN public/. public/ is served for EVERY
// hostname this deployment answers for, which is the trap public/robots.txt fell into and which
// is documented at length in CLAUDE.md. A route handler is host-aware and cacheable on our
// terms.
//
// ─────────────────────────────────────────────────────────────────────────────
// ‼️ THIS SCRIPT CANNOT REPORT A QUALIFIED APPOINTMENT AND THERE IS NO PARAMETER FOR ONE.
// srt('booking') posts a booking with no basis field at all, and the collector writes the
// literal 'pixel_only'. See the header of src/lib/attribution/ai-domains.ts for why, and
// docs/2026-09-03-attribution.sql for the two locks in the schema.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * ‼️ NO COOKIES, NO localStorage, AND sessionStorage IS THE DELIBERATE CHOICE. A session here
 * means one visit, which is exactly the unit first-touch attribution is about; a persistent id
 * would be cross-visit tracking on a clinic's patients, which is a different product with a
 * different consent conversation and is not what anybody signed.
 *
 * ‼️ EVERY STORAGE READ AND WRITE IS WRAPPED. Safari in private mode throws on setItem rather
 * than returning null, and an exception here would take down whatever else the clinic's page
 * runs after this tag.
 */
export function pixelSource(collectUrl: string): string {
  return `(function () {
  "use strict";
  var COLLECT = ${JSON.stringify(collectUrl)};
  var SID = "srt_sid";
  var TEST = "srt_test";

  var tag =
    document.currentScript ||
    (function () {
      var all = document.getElementsByTagName("script");
      for (var i = all.length - 1; i >= 0; i--) {
        if ((all[i].src || "").indexOf("/px.js") !== -1) return all[i];
      }
      return null;
    })();
  if (!tag) return;

  var key = tag.getAttribute("data-key") || "";
  if (!key) return;

  // Paths that mean "a booking just completed". Comma separated, matched as a PREFIX of the
  // pathname so /thank-you/123 counts. Absent means the page never auto-fires and the clinic's
  // booking software calls srt('booking') itself.
  var confirm = (tag.getAttribute("data-confirm") || "")
    .split(",")
    .map(function (s) { return s.trim(); })
    .filter(Boolean);

  function get(k) { try { return window.sessionStorage.getItem(k); } catch (e) { return null; } }
  function set(k, v) { try { window.sessionStorage.setItem(k, v); } catch (e) {} }

  function uuid() {
    try {
      if (window.crypto && window.crypto.randomUUID) return window.crypto.randomUUID();
    } catch (e) {}
    return "s-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 12);
  }

  var sid = get(SID);
  if (!sid) { sid = uuid(); set(SID, sid); }

  // TEST MODE, the Meta Test Events shape: put ?srt_test=CODE on any URL of the site and every
  // event for the rest of that visit is flagged and lands on the dashboard in real time. It
  // rides the SAME endpoint, the same validation and the same writer as production traffic,
  // which is the entire point: a test that took a different path would be proving a code path
  // nobody runs.
  var test = get(TEST);
  try {
    var q = new URLSearchParams(window.location.search);
    var fromUrl = q.get("srt_test");
    if (fromUrl) { test = fromUrl.slice(0, 64); set(TEST, test); }
  } catch (e) {}

  function send(kind, extra) {
    var body = {
      k: key,
      s: sid,
      e: kind,
      href: window.location.href,
      search: window.location.search || "",
      ref: document.referrer || "",
      t: test || ""
    };
    if (extra) body.x = extra;
    var payload = JSON.stringify(body);
    // text/plain keeps this a CORS-SIMPLE request, so there is no preflight and no OPTIONS
    // round trip on somebody else's website. sendBeacon also survives the page being unloaded,
    // which a booking confirmation that immediately redirects routinely is.
    try {
      if (navigator.sendBeacon) {
        var blob = new Blob([payload], { type: "text/plain;charset=UTF-8" });
        if (navigator.sendBeacon(COLLECT, blob)) return;
      }
    } catch (e) {}
    try {
      fetch(COLLECT, {
        method: "POST",
        body: payload,
        headers: { "Content-Type": "text/plain;charset=UTF-8" },
        keepalive: true,
        mode: "no-cors"
      });
    } catch (e) {}
  }

  send("view");

  var path = window.location.pathname || "/";
  for (var i = 0; i < confirm.length; i++) {
    if (path.indexOf(confirm[i]) === 0) { send("booking"); break; }
  }

  // The manual door, for a booking widget that confirms in place without a page load.
  // srt('booking') and srt('booking', {ref: 'abc'}). There is no third argument and no way to
  // say where the patient came from: that answer belongs to the form that asked them.
  window.srt = function (kind, extra) {
    if (kind === "booking" || kind === "view") send(kind, extra);
  };
})();
`;
}
