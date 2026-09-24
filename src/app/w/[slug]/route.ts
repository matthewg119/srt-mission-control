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
// ‼️ IT OPENS ON A GREETING AND A SET OF DOORS, NOT ON A TEXT BOX (2026-09-16). Matthew: "It should
// start with 'how can we help you today?' and as buttons ... Get Free AI Visibility audit (3 min)
// ... the lead magnet ... and a third option where they can type for help, always ask for email in
// case we lose connection." Every button asks for a name and an email first, the buttons run
// through /api/concierge/action, and "Type for help" opens the same model conversation this frame
// always held.
//
// ‼️ AND NOW THERE ARE DOORS UNDER EVERY REPLY, NOT ONLY THE FIRST (2026-09-24). /api/concierge/turn
// returns `actions` built by lib/concierge/chips.ts, which is handed no reply text and picks off
// rows: the next allowed magnet, the client's own published pages, and the call once bookingGate
// permits it. A visitor should always be able to tap instead of type. Read that file before adding
// a kind here, because the rule it protects is that the model cannot write its own buttons.
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
  const title = owner ? "Virtual Agent" : `${config.clientName}`;

  const html = `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow">
<title>${esc(title)}</title>
<style>
/* The Virtual Agent, in the light palette Matthew picked off the Expedia virtual agent: a white
   panel, grey assistant bubbles, and the accent only on the things you press.

   ONE LOOK, NO prefers-color-scheme BRANCH, and that is a choice rather than an omission. This
   document renders inside somebody else's page, so a widget that flipped with the visitor's OS
   would be two different products depending on a setting nobody set for this site. The panel and
   launcher in embed.js are painted to match, and the two files are one object: change one and
   change the other.

   IT USED TO BE NEAR BLACK (#0b1416). It was changed on 2026-09-24 because the widget is now sold
   for a client's whole site rather than living on SRT's own dark pages, and a dark rectangle on a
   white clinic page reads as something bolted on.

   THE CLASS NAMES AND THE TOKEN NAMES BELOW ARE SHARED WITH src/app/hub/[host]/hub.css, where the
   review tool's Virtual Agent panel is written in the same vocabulary. The VALUES are not shared
   and must not be: this widget carries SRT's accent because it is SRT's product, and the review
   panel resolves --va-accent to the client's own. scripts/_probe-virtual-agent-grammar.ts checks
   the names match and deliberately does not check the values. */
:root{--va-bg:#ffffff;--va-ink:#14181f;--va-mut:#5b6672;--va-line:#e3e8ec;--va-card:#f2f5f7;--va-radius:14px;--va-accent:#00C9A7;--va-on-accent:#04252b}
*{box-sizing:border-box}
html,body{margin:0;height:100%}
body{background:var(--va-bg);color:var(--va-ink);font:15px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;display:flex;flex-direction:column}
.va-head{display:flex;align-items:center;gap:10px;padding:12px 14px;border-bottom:1px solid var(--va-line);flex:0 0 auto}
.va-avatar{display:flex;align-items:center;justify-content:center;width:30px;height:30px;border-radius:50%;background:var(--va-accent);color:var(--va-on-accent);flex:0 0 auto;font-weight:700;font-size:13px}
.va-title{font-weight:700;font-size:14px;flex:1}
.va-x{padding:2px 8px;border:0;background:none;color:var(--va-mut);font-size:22px;line-height:1;cursor:pointer}
.va-msgs{flex:1;overflow-y:auto;padding:16px;display:flex;flex-direction:column;gap:10px}
.va-msg{max-width:86%;padding:10px 13px;border-radius:var(--va-radius);white-space:pre-wrap;word-wrap:break-word}
.va-msg.is-them{background:var(--va-card);align-self:flex-start;border-bottom-left-radius:5px}
.va-msg.is-her{background:var(--va-accent);color:var(--va-on-accent);align-self:flex-end;border-bottom-right-radius:5px;font-weight:500}
.va-typing{display:flex;gap:4px;align-items:center;padding:14px 13px;background:var(--va-card);align-self:flex-start;border-radius:var(--va-radius);border-bottom-left-radius:5px}
.va-typing span{width:5px;height:5px;border-radius:50%;background:var(--va-mut);animation:vaDot 1.2s infinite ease-in-out}
.va-typing span:nth-child(2){animation-delay:.15s}
.va-typing span:nth-child(3){animation-delay:.3s}
@keyframes vaDot{0%,60%,100%{opacity:.25;transform:translateY(0)}30%{opacity:1;transform:translateY(-2px)}}
.va-cite{font-size:12px;color:var(--va-mut);align-self:flex-start;max-width:86%;padding-left:2px}
.va-att{display:inline-block;margin-top:8px;padding:9px 14px;background:var(--va-accent);color:var(--va-on-accent);border-radius:999px;text-decoration:none;font-weight:700;font-size:14px}
.va-slots{display:flex;flex-wrap:wrap;gap:8px;margin-top:10px}
.va-slot{flex:1 1 44%;text-align:center;padding:11px 10px;border:1px solid var(--va-accent);border-radius:999px;text-decoration:none;color:var(--va-accent);font-weight:600;font-size:14px;white-space:nowrap}
/* The doors. A column of them under the greeting, and a smaller set under any later reply. */
.va-chips{display:flex;flex-direction:column;gap:8px;align-self:stretch;margin-top:2px}
.va-chip{text-align:left;padding:12px 14px;border:1px solid var(--va-accent);border-radius:12px;background:transparent;color:var(--va-ink);font-weight:600;font-size:14px;cursor:pointer}
.va-chip:hover{background:var(--va-card)}
.va-chips.is-pair{flex-direction:row}
.va-chips.is-pair .va-chip{flex:1 1 auto;text-align:center;border-radius:999px;color:var(--va-accent)}
.va-composer{display:flex;padding:12px;border-top:1px solid var(--va-line);flex:0 0 auto}
.va-composer[hidden]{display:none}
.va-bar{display:flex;gap:8px;width:100%}
.va-bar input{flex:1;min-width:0;padding:11px 14px;border:1px solid var(--va-line);border-radius:999px;background:var(--va-bg);color:var(--va-ink);font-size:16px}
.va-bar input::placeholder{color:var(--va-mut)}
.va-send{padding:11px 18px;border:0;border-radius:999px;background:var(--va-accent);color:var(--va-on-accent);font-weight:700;font-size:15px;cursor:pointer}
.va-send:disabled{opacity:.45;cursor:default}
.va-dots{color:var(--va-mut);font-size:13px;padding-left:4px}
.va-form{align-self:stretch;background:var(--va-card);border-radius:var(--va-radius);padding:14px;display:flex;flex-direction:column;gap:8px}
.va-form p{margin:0 0 2px;font-size:13px;color:var(--va-mut)}
.va-form input{padding:11px 14px;border:1px solid var(--va-line);border-radius:10px;background:var(--va-bg);color:var(--va-ink);font-size:16px}
.va-form button{padding:11px 18px;border:0;border-radius:999px;background:var(--va-accent);color:var(--va-on-accent);font-weight:700;font-size:15px;cursor:pointer}
.va-err{color:#b91c1c;font-size:13px;min-height:1em}
.va-progress{height:6px;border-radius:99px;background:var(--va-line);overflow:hidden;margin-top:8px}
.va-progress i{display:block;height:100%;width:8%;background:var(--va-accent);transition:width .6s}
@media (prefers-reduced-motion: reduce){.va-typing span{animation:none;opacity:.5}}
</style></head><body class="va-panel">
<header class="va-head"><span class="va-avatar" aria-hidden="true">&#9679;</span><span class="va-title">${esc(title)}</span><button class="va-x" id="x" type="button" aria-label="Close">&times;</button></header>
<div id="log" class="va-msgs" role="log" aria-live="polite"></div>
<form id="f" class="va-composer" autocomplete="off" hidden><div class="va-bar"><input id="i" placeholder="Type here" aria-label="Your message" maxlength="1200" disabled><button id="s" class="va-send" disabled>Send</button></div></form>
<script>
(function(){
 var CFG={slug:${JSON.stringify(slug)},category:${JSON.stringify(category)},magnet:${JSON.stringify(magnet)},city:${JSON.stringify(city)},path:${JSON.stringify(path)},host:${JSON.stringify(host)}};
 var PASS=${JSON.stringify(pass)};
 function api(p){return PASS?p+(p.indexOf("?")<0?"?":"&")+PASS:p}
 var log=document.getElementById('log'),form=document.getElementById('f'),input=document.getElementById('i'),send=document.getElementById('s');
 var token=null,busy=false,opening='',contact=false,firstName='',pending=null,mode='',turnChips=null;
 // ‼️ THE VISITOR'S ZONE, READ IN THE VISITOR'S BROWSER. The calendar has to offer THEIR today.
 var tz="";
 try{tz=Intl.DateTimeFormat().resolvedOptions().timeZone||""}catch(e){}

 document.getElementById('x').addEventListener('click',function(){try{parent.postMessage({srtConcierge:'close'},'*')}catch(e){}});

 function el(cls,text){var d=document.createElement('div');d.className=cls;if(text)d.textContent=text;log.appendChild(d);log.scrollTop=log.scrollHeight;return d}
 function bubble(who,text){return el('va-msg '+(who==='u'?'is-her':'is-them'),text)}
 function height(){try{parent.postMessage({srtConcierge:'height',value:document.body.scrollHeight},'*')}catch(e){}}
 function post(path,body){return fetch(api(path),{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)}).then(function(r){return r.json().then(function(d){d.__status=r.status;return d})})}
 function link(host,url,label){var a=document.createElement('a');a.className='va-att';a.href=url;a.target='_blank';a.rel='noopener noreferrer';a.textContent=label;host.appendChild(document.createElement('br'));host.appendChild(a)}

 function attach(host,list){
  var items=(list||[]).filter(function(a){return a.url});
  if(!items.length)return;
  var slots=items.filter(function(a){return a.kind==='slot'});
  var rest=items.filter(function(a){return a.kind!=='slot'});
  if(slots.length){
   var row=document.createElement('div');row.className='va-slots';
   slots.forEach(function(a){var b=document.createElement('a');b.className='va-slot';b.href=a.url;b.target='_blank';b.rel='noopener noreferrer';b.textContent=a.title;row.appendChild(b)});
   host.appendChild(row);
  }
  rest.forEach(function(a){link(host,a.url,a.title)});
 }

 function lock(on){busy=on;input.disabled=on;send.disabled=on;if(!on){input.focus()}}

 // ── the doors at the start ───────────────────────────────────────────────
 function actions(list){
  var box=el('va-chips');
  list.forEach(function(a){
   var b=document.createElement('button');b.type='button';b.className='va-chip';b.textContent=a.label;
   b.addEventListener('click',function(){box.remove();bubble('u',a.label);choose(a.kind)});
   box.appendChild(b);
  });
  height();
 }

 // ── the doors under a reply ──────────────────────────────────────────────
 //
 // ‼️ THE PREVIOUS TURN'S CHIPS ARE REMOVED BEFORE THE NEW ONES ARE DRAWN. Without that the log
 // fills with stale buttons offering a magnet that has since been delivered, and a visitor
 // scrolling up finds four live ways to ask for the same thing.
 //
 // Every one of these came from /api/concierge/turn, which built them from rows without being
 // shown the reply. See src/lib/concierge/chips.ts.
 function chips(list){
  if(turnChips){turnChips.remove();turnChips=null}
  if(!list||!list.length)return;
  var box=el('va-chips');turnChips=box;
  list.forEach(function(a){
   var b=document.createElement('button');b.type='button';b.className='va-chip';b.textContent=a.label;
   b.addEventListener('click',function(){
    box.remove();turnChips=null;bubble('u',a.label);
    if(a.kind==='booking'){choose('booking');return}
    if(a.url){window.open(a.url,'_blank','noopener');height();return}
   });
   box.appendChild(b);
  });
  height();
 }

 function choose(kind){
  mode=kind;
  // ‼️ NAME AND EMAIL FIRST, ON EVERY DOOR. Matthew: "always ask for email in case we lose connection".
  if(!contact){pending=kind;askContact(kind);return}
  if(kind==='audit')askWebsite();
  else if(kind==='magnet')giveMagnet();
  else if(kind==='booking')askBooking();
  else startTyping();
 }

 function askContact(kind){
  bubble('a','Happy to help. Who am I talking to? That way I can send it to you if we get disconnected.');
  var c=el('va-form');
  var n=document.createElement('input');n.placeholder='Your name';n.autocomplete='given-name';n.maxLength=60;
  var m=document.createElement('input');m.placeholder='Email';m.type='email';m.autocomplete='email';m.maxLength=120;
  var err=document.createElement('div');err.className='va-err';
  var go=document.createElement('button');go.type='button';go.textContent='Continue';
  c.appendChild(n);c.appendChild(m);c.appendChild(err);c.appendChild(go);
  n.focus();
  function submit(){
   go.disabled=true;err.textContent='';
   post('/api/concierge/action',{token:token,action:'contact',name:n.value,email:m.value,picked:kind,host:CFG.host,path:CFG.path})
   .then(function(d){
    go.disabled=false;
    if(!d.ok){err.textContent=d.message||'Check those and try again.';return}
    contact=true;firstName=d.firstName||'';c.remove();
    bubble('u',n.value+' \\u00b7 '+m.value);
    var k=pending;pending=null;choose(k);
   }).catch(function(){go.disabled=false;err.textContent='That did not go through. Try once more.'});
  }
  go.addEventListener('click',submit);
  m.addEventListener('keydown',function(e){if(e.key==='Enter'){e.preventDefault();submit()}});
  height();
 }

 function askWebsite(){
  bubble('a',(firstName?'Thanks '+firstName+'. ':'')+'What is your website? I will check whether ChatGPT and the other AI assistants recommend you. It takes about three minutes.');
  var c=el('va-form');
  var w=document.createElement('input');w.placeholder='yourbusiness.com';w.inputMode='url';w.maxLength=300;
  var err=document.createElement('div');err.className='va-err';
  var go=document.createElement('button');go.type='button';go.textContent='Run my free audit';
  c.appendChild(w);c.appendChild(err);c.appendChild(go);w.focus();
  function submit(){
   go.disabled=true;err.textContent='';
   post('/api/concierge/action',{token:token,action:'audit_start',website:w.value})
   .then(function(d){
    go.disabled=false;
    if(!d.ok){err.textContent=d.message||'That site could not be scanned.';return}
    c.remove();bubble('u',d.domain);watchAudit(d.scanId,d.domain);
   }).catch(function(){go.disabled=false;err.textContent='That did not go through. Try once more.'});
  }
  go.addEventListener('click',submit);
  w.addEventListener('keydown',function(e){if(e.key==='Enter'){e.preventDefault();submit()}});
  height();
 }

 // ── the call ─────────────────────────────────────────────────────────────
 //
 // ‼️ THE SERVER DECIDES WHETHER THERE IS A CALL TO OFFER, NOT THIS FILE. The action route runs
 // the same resolveBooking() the model's offer_booking tool runs, so a tenant with a calendar
 // gets real times, one with only a link gets the link, and one with neither gets a sentence
 // rather than a button that goes nowhere.
 function askBooking(){
  var wait=el('va-dots','...');
  post('/api/concierge/action',{token:token,action:'booking',tz:tz}).then(function(d){
   wait.remove();
   var b=bubble('a',d.message||'Here are some times.');
   attach(b,d.attachments);
   startTyping(true);height();
  }).catch(function(){wait.remove();bubble('a','That did not go through. Type your question below.');startTyping()});
 }

 function watchAudit(scanId,domain){
  var b=bubble('a','Running the audit on '+domain+'. I am asking the AI assistants the questions your customers ask. You can keep browsing; the report will also land in your inbox.');
  var bar=document.createElement('div');bar.className='va-progress';var fill=document.createElement('i');bar.appendChild(fill);b.appendChild(bar);
  var started=Date.now(),done=false;
  function tick(){
   if(done)return;
   post('/api/concierge/action',{token:token,action:'audit_status',scanId:scanId}).then(function(d){
    var pct=d.engine&&d.engine.total?Math.round(100*d.engine.done/d.engine.total):Math.min(90,Math.round((Date.now()-started)/2000));
    fill.style.width=Math.max(8,Math.min(100,pct))+'%';
    if(d.reportUrl){done=true;fill.style.width='100%';var r=bubble('a','Your AI visibility report is ready.');link(r,d.reportUrl,'Open my report');afterAudit();height();return}
    if(d.status==='failed'){done=true;bubble('a',(d.error||'That audit could not finish.')+' Type below and I will help directly.');startTyping();return}
    setTimeout(tick,6000);
   }).catch(function(){setTimeout(tick,9000)});
  }
  setTimeout(tick,4000);
  startTyping(true);
 }

 function afterAudit(){bubble('a','Want me to walk you through what it found? Ask me anything below.')}

 function giveMagnet(){
  var wait=el('va-dots','...');
  post('/api/concierge/action',{token:token,action:'magnet'}).then(function(d){
   wait.remove();
   if(d.magnet){var b=bubble('a',d.magnet.title+'. '+(d.magnet.promise||''));link(b,d.magnet.url,d.magnet.cta||'Open it')}
   else bubble('a',d.message||'Ask me anything below.');
   startTyping(true);height();
  }).catch(function(){wait.remove();bubble('a','That did not go through. Type your question below.');startTyping()});
 }

 function startTyping(quiet){
  if(form.hidden){form.hidden=false;lock(false)}
  if(!quiet&&opening)bubble('a',opening);
  height();
 }

 fetch(api('/api/concierge/start'),{method:'POST',headers:{'content-type':'application/json'},
  body:JSON.stringify({slug:CFG.slug,category:CFG.category,magnet:CFG.magnet,city:CFG.city,path:CFG.path,host:CFG.host})})
 .then(function(r){return r.ok?r.json():Promise.reject(r.status)})
 .then(function(d){
  token=d.token;opening=d.opening||'';
  if(d.greeting&&d.actions&&d.actions.length){bubble('a',d.greeting);actions(d.actions)}
  else{bubble('a',opening);startTyping(true)}
  height();
 })
 .catch(function(){bubble('a','This is not available right now.')});

 form.addEventListener('submit',function(e){
  e.preventDefault();
  var text=input.value.trim();
  if(!text||busy||!token)return;
  input.value='';bubble('u',text);lock(true);
  var wait=el('va-dots','...');
  fetch(api('/api/concierge/turn'),{method:'POST',headers:{'content-type':'application/json'},
   body:JSON.stringify({token:token,message:text,tz:tz})})
  .then(function(r){return r.json()})
  .then(function(d){
   wait.remove();
   var b=bubble('a',d.reply||'');
   (d.evidence||[]).forEach(function(line){el('va-cite',line)});
   attach(b,d.attachments);
   chips(d.actions);
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
