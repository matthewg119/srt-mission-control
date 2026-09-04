// The widget frame. One tenant's conversation, in an iframe, on somebody else's page.
//
// ‼️ A ROUTE HANDLER RATHER THAN A PAGE, AND THE REASON IS ONE HEADER. frame-ancestors is the only
// thing that stops one client embedding a competitor's widget and harvesting their leads, it is
// per-tenant so next.config cannot hold it, it is explicitly IGNORED inside a <meta> tag by the CSP
// spec, and middleware runs on the Edge with no database so it cannot look up allowed_origins. A
// page component cannot set a response header. A route handler can, so this is a route handler.
//
// ‼️ NO REACT, NO BUNDLE, NO HYDRATION. This document loads inside a third party's page on a
// stranger's phone. It is a few kB of hand-written markup that renders instantly, and it shares no
// JavaScript with the dashboard, so nothing in the app can accidentally end up on a client's site.
//
// ‼️ THE FRAME IS SANDBOXED FROM ITS PARENT BY THE BROWSER, and that is a feature rather than a
// limitation: a patient's answers, and later a patient's photo, never enter the client's own
// analytics or session recording surface. That was one of the two reasons this lane chose an iframe.

import { NextRequest, NextResponse } from "next/server";
import { frameAncestorsFor, loadConciergeConfig } from "@/lib/concierge/config";
import { conciergeAllowed, PREVIEW_TOKEN_PARAM } from "@/lib/concierge/preview-grant";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Anything interpolated into the document is escaped, including values that came from our own DB. */
function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function notFound(): NextResponse {
  return new NextResponse("Not found", {
    status: 404,
    headers: { "content-type": "text/plain", "x-robots-tag": "noindex, nofollow", "cache-control": "no-store" },
  });
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const config = await loadConciergeConfig(slug);
  // A signed preview token for THIS client is the one thing that opens a switched-off tenant.
  // Without it this route 404s, which is what made the demo link concierge_preview posts before
  // the call dead on arrival. See src/lib/concierge/preview-grant.ts.
  const previewToken = new URL(req.url).searchParams.get(PREVIEW_TOKEN_PARAM);
  if (!config || !conciergeAllowed(config, previewToken)) return notFound();

  const ancestors = await frameAncestorsFor(config);
  const q = new URL(req.url).searchParams;
  const category = (q.get("category") ?? "").slice(0, 40);
  const city = (q.get("city") ?? "").slice(0, 120);
  // The offer the PAGE named. Bounded and lowercased before it reaches a query, the same way the
  // config route bounds it: everything on this line arrived from a third party's markup.
  const magnet = (q.get("magnet") ?? "").slice(0, 60).toLowerCase();

  // ‼️ THE PROTECTION TOKEN, CARRIED INTO THIS DOCUMENT'S OWN FETCHES. Same reason embed.js
  // forwards it: on a protected preview, /api/concierge/start and /turn are behind SSO too, and
  // this frame is cross-site so no bypass cookie reaches them. Only Vercel's own params are
  // copied, and in production there are none, so `pass` is empty and nothing below changes.
  // ‼️ THE PREVIEW TOKEN RIDES THE SAME CHANNEL AS THE PROTECTION PARAMS, deliberately. This
  // document's own fetches to /start and /turn are the ones that need it, and `pass` is already
  // the mechanism that carries a query param into every one of them. A second mechanism for the
  // same job would be a second place to forget.
  const pass = [...q.entries()]
    .filter(([k]) => k.startsWith("x-vercel-") || k === PREVIEW_TOKEN_PARAM)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join("&");
  const path = (q.get("path") ?? "").slice(0, 500);
  const host = (q.get("host") ?? "").slice(0, 200);

  const owner = config.audience === "owner";
  const title = owner ? "AI visibility" : `${config.clientName}`;

  const html = `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow">
<title>${esc(title)}</title>
<style>
/* onboarding2's chat bubble, in the palette Matthew picked for it: a near black ground and
   #00C9A7 as the single accent. ONE LOOK, NO prefers-color-scheme BRANCH, and that is a choice
   rather than an omission. This document renders inside somebody else's page, so a widget that
   flips to white because the visitor's OS is in light mode would sit on a dark client site as a
   glaring rectangle. The panel around it in embed.js is painted #0b1416 to match, and the two are
   the same object: change one and change the other. */
:root{--bg:#0b1416;--fg:#eaf4f3;--mut:#8fa9a8;--line:#1d2c2e;--card:#152325;--me:#00C9A7;--meFg:#04252b;--acc:#00C9A7;--accFg:#04252b}
*{box-sizing:border-box}
html,body{margin:0;height:100%}
body{background:var(--bg);color:var(--fg);font:15px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;display:flex;flex-direction:column}
header{padding:14px 16px;border-bottom:1px solid var(--line);font-weight:700;font-size:13px;letter-spacing:.06em;text-transform:uppercase;color:var(--acc)}
#log{flex:1;overflow-y:auto;padding:16px;display:flex;flex-direction:column;gap:10px}
.b{max-width:86%;padding:10px 13px;border-radius:14px;white-space:pre-wrap;word-wrap:break-word}
.a{background:var(--card);align-self:flex-start;border-bottom-left-radius:5px}
.u{background:var(--me);color:var(--meFg);align-self:flex-end;border-bottom-right-radius:5px;font-weight:500}
.cite{font-size:12px;color:var(--mut);align-self:flex-start;max-width:86%;padding-left:2px}
a.att{display:inline-block;margin-top:8px;padding:9px 14px;background:var(--acc);color:var(--accFg);border-radius:999px;text-decoration:none;font-weight:700;font-size:14px}
.slots{display:flex;flex-wrap:wrap;gap:8px;margin-top:10px}
a.slot{flex:1 1 44%;text-align:center;padding:11px 10px;border:1px solid var(--acc);border-radius:999px;text-decoration:none;color:var(--acc);font-weight:600;font-size:14px;white-space:nowrap}
form{display:flex;gap:8px;padding:12px;border-top:1px solid var(--line)}
input{flex:1;min-width:0;padding:11px 14px;border:1px solid var(--line);border-radius:999px;background:var(--card);color:var(--fg);font-size:16px}
input::placeholder{color:var(--mut)}
button{padding:11px 18px;border:0;border-radius:999px;background:var(--acc);color:var(--accFg);font-weight:700;font-size:15px;cursor:pointer}
button:disabled{opacity:.45;cursor:default}
.dots{color:var(--mut);font-size:13px;padding-left:4px}
</style></head><body>
<header>${esc(title)}</header>
<div id="log" role="log" aria-live="polite"></div>
<form id="f" autocomplete="off"><input id="i" placeholder="Type here" aria-label="Your message" maxlength="1200" disabled><button id="s" disabled>Send</button></form>
<script>
(function(){
 var CFG={slug:${JSON.stringify(slug)},category:${JSON.stringify(category)},magnet:${JSON.stringify(magnet)},city:${JSON.stringify(city)},path:${JSON.stringify(path)},host:${JSON.stringify(host)}};
 var PASS=${JSON.stringify(pass)};
 function api(p){return PASS?p+(p.indexOf("?")<0?"?":"&")+PASS:p}
 var log=document.getElementById('log'),form=document.getElementById('f'),input=document.getElementById('i'),send=document.getElementById('s');
 var token=null,busy=false;
 // ‼️ THE VISITOR'S ZONE, READ IN THE VISITOR'S BROWSER. The calendar has to offer THEIR today.
 // Resolving it here is the only place it is knowable; a server-side guess is wrong for anybody
 // outside one time zone, and wrong in a way that shows tomorrow's slots under a "today" label.
 var tz="";
 try{tz=Intl.DateTimeFormat().resolvedOptions().timeZone||""}catch(e){}

 function el(cls,text){var d=document.createElement('div');d.className=cls;d.textContent=text;log.appendChild(d);log.scrollTop=log.scrollHeight;return d}
 function bubble(who,text){return el('b '+who,text)}
 function height(){try{parent.postMessage({srtConcierge:'height',value:document.body.scrollHeight},'*')}catch(e){}}

 function attach(host,list){
  var items=(list||[]).filter(function(a){return a.url});
  if(!items.length)return;
  var slots=items.filter(function(a){return a.kind==='slot'});
  var rest=items.filter(function(a){return a.kind!=='slot'});

  if(slots.length){
   var row=document.createElement('div');row.className='slots';
   slots.forEach(function(a){
    var b=document.createElement('a');
    b.className='slot';b.href=a.url;b.target='_blank';b.rel='noopener noreferrer';
    b.textContent=a.title;
    row.appendChild(b);
   });
   host.appendChild(row);
  }

  rest.forEach(function(a){
   var link=document.createElement('a');
   link.className='att';link.href=a.url;link.target='_blank';link.rel='noopener noreferrer';
   link.textContent=a.title;
   host.appendChild(document.createElement('br'));host.appendChild(link);
  });
 }

 function lock(on){busy=on;input.disabled=on;send.disabled=on;if(!on){input.focus()}}

 fetch(api('/api/concierge/start'),{method:'POST',headers:{'content-type':'application/json'},
  body:JSON.stringify({slug:CFG.slug,category:CFG.category,magnet:CFG.magnet,city:CFG.city,path:CFG.path,host:CFG.host})})
 .then(function(r){return r.ok?r.json():Promise.reject(r.status)})
 .then(function(d){token=d.token;bubble('a',d.opening);lock(false);height()})
 .catch(function(){bubble('a','This is not available right now.')});

 form.addEventListener('submit',function(e){
  e.preventDefault();
  var text=input.value.trim();
  if(!text||busy||!token)return;
  input.value='';bubble('u',text);lock(true);
  var wait=el('dots','...');
  fetch(api('/api/concierge/turn'),{method:'POST',headers:{'content-type':'application/json'},
   body:JSON.stringify({token:token,message:text,tz:tz})})
  .then(function(r){return r.json()})
  .then(function(d){
   wait.remove();
   var b=bubble('a',d.reply||'');
   (d.evidence||[]).forEach(function(line){el('cite',line)});
   attach(b,d.attachments);
   lock(false);height();
  })
  .catch(function(){wait.remove();bubble('a','That did not go through. Try once more.');lock(false)});
 });
})();
</script></body></html>`;

  return new NextResponse(html, {
    headers: {
      "content-type": "text/html; charset=utf-8",
      // The whole reason this file is a route handler.
      "content-security-policy": `frame-ancestors ${ancestors}`,
      "x-robots-tag": "noindex, nofollow",
      "cache-control": "no-store",
    },
  });
}
