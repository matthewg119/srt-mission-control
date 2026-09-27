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
import { REFERRAL_NO_TIMES, REFERRAL_SCRIPT, REFERRAL_TIMES_COPY } from "@/lib/concierge/referral-script";
import { REPORT_PIVOT } from "@/lib/concierge/report-pivot";
import { AUDIT_WAIT_CARDS, WAIT_CARD_MS, WAIT_FIRST_MS } from "@/lib/concierge/audit-wait";

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
  // Forwarded by embed.js, which read it off the page's own URL. Verified by /api/concierge/start and
  // never here: this route only hands it on, so a forged one buys a normal start rather than a session.
  const srtc = (q.get("srtc") ?? "").slice(0, 400);

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
/* The teaching card shown while the audit runs. ONE bubble whose text is swapped, never a third and a
   fourth appended: on a 375px panel three more bubbles would push the progress bar off the top, and the
   bar is the thing somebody is actually watching. See src/lib/concierge/audit-wait.ts. */
.va-teach{opacity:1;transition:opacity .35s}
.va-teach.is-fading{opacity:0}
.va-teach b{display:block;font-size:12px;letter-spacing:.06em;text-transform:uppercase;color:var(--va-mut);margin-bottom:3px}
@media (prefers-reduced-motion: reduce){.va-typing span{animation:none;opacity:.5}.va-teach{transition:none}}
</style></head><body class="va-panel">
<header class="va-head"><span class="va-avatar" aria-hidden="true">&#9679;</span><span class="va-title">${esc(title)}</span><button class="va-x" id="x" type="button" aria-label="Close">&times;</button></header>
<div id="log" class="va-msgs" role="log" aria-live="polite"></div>
<form id="f" class="va-composer" autocomplete="off" hidden><div class="va-bar"><input id="i" placeholder="Type here" aria-label="Your message" maxlength="1200" disabled><button id="s" class="va-send" disabled>Send</button></div></form>
<script>
(function(){
 var CFG={slug:${JSON.stringify(slug)},category:${JSON.stringify(category)},magnet:${JSON.stringify(magnet)},city:${JSON.stringify(city)},path:${JSON.stringify(path)},host:${JSON.stringify(host)},srtc:${JSON.stringify(srtc)}};
 var PASS=${JSON.stringify(pass)};
 // ‼️ THE WHOLE WALK, INLINED AS DATA, WITH NO MODEL AND NO FETCH FOR ANY OF ITS WORDS. Every
 // string here was written in src/lib/concierge/referral-script.ts and passed through copy-guard at
 // build time. The two appointment times are the only text that is not fixed, and they come from
 // resolveBooking() through /api/concierge/action, which is the only thing that knows what is open.
 var REF=${JSON.stringify(REFERRAL_SCRIPT)};
 var REF_NONE=${JSON.stringify(REFERRAL_NO_TIMES)};
 var REF_TIMES=${JSON.stringify(REFERRAL_TIMES_COPY)};
 var PIVOT=${JSON.stringify(REPORT_PIVOT)};
 // ‼️ THE THREE PILLARS, WRITTEN IN ONE PLACE AND NOT GENERATED. src/lib/concierge/audit-wait.ts
 // holds the copy and the timings, every string through copy-guard at build time. The scan is the part of
 // this conversation where a model knows least, so it is the last place to let one write.
 var WAIT=${JSON.stringify(AUDIT_WAIT_CARDS)};
 var WAIT_MS=${WAIT_CARD_MS}, WAIT_FIRST=${WAIT_FIRST_MS};
 // Read once, like embed.js does. Governs whether the card crossfades or simply changes.
 var animate=true;
 try{animate=!window.matchMedia("(prefers-reduced-motion: reduce)").matches}catch(e){}
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
  //
  // ‼️ EXCEPT THE REFERRAL WALK, WHICH ASKS FOR THEM ITSELF, TWO QUESTIONS IN. Matthew wrote that
  // script as an exact sequence and the form is step four of it, after the review count and the
  // website. Routing it through askContact would ask for a name, then ask for it again inside the
  // walk's own form. The window this opens is two short answers wide, and the walk's form collects
  // more than askContact does (a surname and a phone), so the intent behind the rule survives: nobody
  // reaches anything we hand over without leaving a way to be reached.
  if(!contact&&kind!=='referral'){pending=kind;askContact(kind);return}
  if(kind==='audit')askWebsite();
  else if(kind==='referral')walkRef(0);
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

 // ── the AI Referral Engine, as a scripted walk ───────────────────────────
 //
 // ‼️ NO MODEL IS IN THIS PATH AT ALL. REF is a step array inlined above; this walks it. The two round
 // trips it makes are the contact capture and the appointment times, and neither returns prose: one
 // returns ok, the other returns real slots. Every sentence read here was written by a person and
 // checked by copy-guard at build time.
 //
 // ‼️ AND IT NEVER SKIPS FORWARD ON ITS OWN. Each step advances only when its own answer lands, so a
 // failed post leaves the visitor on the step they were on with the error under it, rather than
 // halfway down a script that believes it collected something.
 var refAnswers={};

 function walkRef(i){
  var step=REF[i];
  if(!step)return;

  if(step.kind==='say'){
   bubble('a',step.text);height();
   setTimeout(function(){walkRef(i+1)},600);
   return;
  }

  if(step.kind==='end'){
   bubble('a',step.text);startTyping(true);height();
   return;
  }

  if(step.kind==='ask'){
   bubble('a',step.prompt);
   var c=el('va-form');
   var f=document.createElement('input');f.placeholder=step.placeholder;f.maxLength=200;
   var err=document.createElement('div');err.className='va-err';
   var go=document.createElement('button');go.type='button';go.textContent='Next';
   c.appendChild(f);c.appendChild(err);c.appendChild(go);f.focus();
   var submit=function(){
    var v=(f.value||'').trim();
    if(!v){err.textContent='Type an answer and I will carry on.';return}
    refAnswers[step.key]=v;
    c.remove();bubble('u',v);
    walkRef(i+1);
   };
   go.addEventListener('click',submit);
   f.addEventListener('keydown',function(e){if(e.key==='Enter'){e.preventDefault();submit()}});
   height();
   return;
  }

  if(step.kind==='form'){
   bubble('a',step.prompt);
   var fc=el('va-form');
   var fn=document.createElement('input');fn.placeholder='First name';fn.autocomplete='given-name';fn.maxLength=60;
   var ln=document.createElement('input');ln.placeholder='Last name';ln.autocomplete='family-name';ln.maxLength=60;
   var em=document.createElement('input');em.placeholder='Email';em.type='email';em.autocomplete='email';em.maxLength=120;
   var ph=document.createElement('input');ph.placeholder='Phone';ph.type='tel';ph.autocomplete='tel';ph.maxLength=20;
   // ‼️ FORMATTED AS IT IS TYPED, STORED AS E.164. The standing rule: live format, absorb a leading +1,
   // and reach the database as +1XXXXXXXXXX. The server normalises and REFUSES rather than trusting any
   // of this, because the route is public and a bad number stored is a call to a stranger. This exists
   // only so the person typing can see what they typed.
   ph.addEventListener('input',function(){
    var d=(ph.value||'').replace(/[^0-9]/g,'');
    if(d.length===11&&d.charAt(0)==='1')d=d.slice(1);
    d=d.slice(0,10);
    ph.value=d.length>6?'('+d.slice(0,3)+') '+d.slice(3,6)+'-'+d.slice(6):d.length>3?'('+d.slice(0,3)+') '+d.slice(3):d;
   });
   var ferr=document.createElement('div');ferr.className='va-err';
   var fgo=document.createElement('button');fgo.type='button';fgo.textContent=step.cta;
   fc.appendChild(fn);fc.appendChild(ln);fc.appendChild(em);fc.appendChild(ph);fc.appendChild(ferr);fc.appendChild(fgo);
   fn.focus();
   var fsubmit=function(){
    fgo.disabled=true;ferr.textContent='';
    post('/api/concierge/action',{token:token,action:'contact',name:fn.value,lastName:ln.value,email:em.value,phone:ph.value,picked:'referral',reviews:refAnswers.reviews||'',website:refAnswers.website||'',host:CFG.host,path:CFG.path})
    .then(function(d){
     fgo.disabled=false;
     if(!d.ok){ferr.textContent=d.message||'Check those and try again.';return}
     contact=true;firstName=d.firstName||'';
     fc.remove();
     bubble('u',fn.value+' '+ln.value+' · '+em.value);
     walkRef(i+1);
    }).catch(function(){fgo.disabled=false;ferr.textContent='That did not go through. Try once more.'});
   };
   fgo.addEventListener('click',fsubmit);
   ph.addEventListener('keydown',function(e){if(e.key==='Enter'){e.preventDefault();fsubmit()}});
   height();
   return;
  }

  if(step.kind==='chips'){
   bubble('a',step.prompt);
   var box=el('va-chips is-pair');
   step.options.forEach(function(o){
    var b=document.createElement('button');b.type='button';b.className='va-chip';b.textContent=o.label;
    b.addEventListener('click',function(){
     box.remove();bubble('u',o.label);
     refAnswers[step.key]=o.value;
     refTimes(o.value,i+1);
    });
    box.appendChild(b);
   });
   height();
   return;
  }

  // A slots step is never walked into directly: refTimes draws it, then continues past it.
  if(step.kind==='slots'){walkRef(i+1);return}
 }

 function refFill(t,a,b){return t.replace('{a}',a).replace('{b}',b||a)}

 // Where a named step sits in the walk, so a resume starts at one by name rather than by number. A
 // number here would silently point at the wrong step the first time somebody inserts one.
 function indexOfStep(id){for(var i=0;i<REF.length;i++){if(REF[i].id===id)return i}return 0}

 // ‼️ THE TIMES ARE REAL OR THEY ARE NOT OFFERED, AND THERE IS NO THIRD BRANCH. The server runs the
 // same resolveBooking() the model's offer_booking tool runs, and it answers with what is open, a
 // link, a phone, or nothing. This draws whichever came back and then continues the walk.
 //
 // ‼️ THE WALK CONTINUES IN EVERY BRANCH, THE FAILURES INCLUDED. The download link does not depend on
 // the install call being booked, so a rotated Calendly token must not strand somebody halfway down a
 // script they completed their half of.
 function refTimes(daypart,next){
  var wait=el('va-dots','...');
  post('/api/concierge/action',{token:token,action:'referral_times',daypart:daypart,tz:tz})
  .then(function(d){
   wait.remove();
   if(!d.ok){bubble('a',REF_NONE.callback);height();walkRef(next);return}

   if(d.mode==='slots'&&d.slots&&d.slots.length){
    if(d.otherHalf)bubble('a',REF_TIMES.otherHalf);
    var text=d.slots.length>1?refFill(REF_TIMES.two,d.slots[0].label,d.slots[1].label):refFill(REF_TIMES.one,d.slots[0].label);
    var b=bubble('a',text);
    attach(b,d.slots.map(function(x){return {kind:'slot',title:x.label,url:x.url}}));
    height();walkRef(next);return;
   }

   if(d.mode==='link'){var lb=bubble('a',REF_NONE.link);attach(lb,d.attachments);height();walkRef(next);return}
   if(d.mode==='phone'){bubble('a',REF_NONE.phone+' '+d.phone);height();walkRef(next);return}

   bubble('a',REF_NONE.callback);height();walkRef(next);
  })
  .catch(function(){wait.remove();bubble('a',REF_NONE.callback);height();walkRef(next)});
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

 // ‼️ THE WAIT TEACHES THE THREE THINGS THE REPORT IS ABOUT TO SCORE. Three minutes of a progress
 // bar and one sentence was three minutes of nothing; somebody who waits it out should come out of it
 // understanding what they are about to read. It teaches and does not sell, because the sell needs a
 // finding and there is not one yet.
 //
 // ‼️ ONE BUBBLE, TEXT SWAPPED, NEVER APPENDED. Three more bubbles on a 375px panel push the
 // progress bar off the top, and the bar is the thing being watched. Swapping keeps the height fixed.
 //
 // ‼️ AND IT STOPS THE INSTANT THE REPORT LANDS, MID ROTATION. The timer is cleared in the same
 // branch that draws the report link, so a card can never appear under "your report is ready".
 function teachWhileWaiting(){
  var card=el('va-msg is-them va-teach');
  var name=document.createElement('b');
  var body=document.createElement('span');
  card.appendChild(name);card.appendChild(body);
  var timer=null, fade=null;

  function show(i){
   name.textContent=WAIT[i].title;
   body.textContent=WAIT[i].body;
   height();
   // The last card stays up for the rest of the scan rather than looping. Somebody who has read all
   // three does not need them again, and a rotation that came back round reads as a carousel.
   if(i+1<WAIT.length)timer=setTimeout(function(){swap(i+1)},WAIT_MS);
  }

  function swap(i){
   if(!animate){show(i);return}
   card.className='va-msg is-them va-teach is-fading';
   fade=setTimeout(function(){card.className='va-msg is-them va-teach';show(i)},350);
  }

  timer=setTimeout(function(){show(0)},WAIT_FIRST);
  return {stop:function(){
   if(timer)clearTimeout(timer);
   if(fade)clearTimeout(fade);
   timer=null;fade=null;
   // ‼️ THE CARD IS REMOVED, NOT LEFT IN THE LOG. It is furniture for the wait, and a visitor
   // scrolling back through the conversation afterwards should find what they said and what was found,
   // not a lesson they have already had. It is only ever removed once the wait is over.
   if(card.parentNode)card.parentNode.removeChild(card);
  }};
 }

 function watchAudit(scanId,domain){
  var b=bubble('a','Running the audit on '+domain+'. I am asking the AI assistants the questions your customers ask. You can keep browsing; the report will also land in your inbox.');
  var bar=document.createElement('div');bar.className='va-progress';var fill=document.createElement('i');bar.appendChild(fill);b.appendChild(bar);
  var started=Date.now(),done=false;
  var teach=teachWhileWaiting();
  function tick(){
   if(done)return;
   post('/api/concierge/action',{token:token,action:'audit_status',scanId:scanId}).then(function(d){
    var pct=d.engine&&d.engine.total?Math.round(100*d.engine.done/d.engine.total):Math.min(90,Math.round((Date.now()-started)/2000));
    fill.style.width=Math.max(8,Math.min(100,pct))+'%';
    if(d.reportUrl){done=true;teach.stop();fill.style.width='100%';var r=bubble('a',PIVOT.ready);link(r,d.reportUrl,'Open my report');afterAudit(d.weakest);height();return}
    if(d.status==='failed'){done=true;teach.stop();bubble('a',(d.error||'That audit could not finish.')+' Type below and I will help directly.');startTyping();return}
    setTimeout(tick,6000);
   }).catch(function(){setTimeout(tick,9000)});
  }
  setTimeout(tick,4000);
  startTyping(true);
 }

 // ‼️ THE REPORT IS A HOOK, NOT A HANDOVER. This said "Want me to walk you through what it found?
 // Ask me anything below.", which hands control back to somebody who has just spent three minutes and
 // sells nothing. Now it names what was found, says why reviews are the lever, offers the free tool and
 // asks for the yes, in that order.
 //
 // ‼️ THE weakest SENTENCE COMES FINISHED FROM THE SERVER AND THIS FILE MAY NOT ALTER IT. It is built
 // in the audit_status branch from the report's own block counts, with the denominator in it. When the
 // server could not produce one honestly it is absent, and the pivot simply runs without a finding: read
 // without it the sequence still works, which is the test a conditional line has to pass. Nothing here
 // invents a score, a pillar or a competitor.
 //
 // ‼️ AND THE CHIP CALLS THE SAME WALK THE SECOND DOOR OPENS. Not a second copy of it: one script,
 // one contact capture, one booking source. See src/lib/concierge/referral-script.ts.
 function afterAudit(weakest){
  if(weakest)bubble('a',weakest);
  bubble('a',PIVOT.lever);
  bubble('a',PIVOT.tool);
  bubble('a',PIVOT.ask);
  var box=el('va-chips is-pair');
  var yes=document.createElement('button');yes.type='button';yes.className='va-chip';yes.textContent=PIVOT.chip;
  yes.addEventListener('click',function(){box.remove();bubble('u',PIVOT.chip);choose('referral')});
  var no=document.createElement('button');no.type='button';no.className='va-chip';no.textContent=PIVOT.decline;
  // The way out is a real way out: it opens the composer rather than asking again.
  no.addEventListener('click',function(){box.remove();bubble('u',PIVOT.decline);startTyping()});
  box.appendChild(yes);box.appendChild(no);
  height();
 }

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
  body:JSON.stringify({slug:CFG.slug,category:CFG.category,magnet:CFG.magnet,city:CFG.city,path:CFG.path,host:CFG.host,srtc:CFG.srtc})})
 .then(function(r){return r.ok?r.json():Promise.reject(r.status)})
 .then(function(d){
  token=d.token;opening=d.opening||'';

  // ‼️ COMING BACK FROM THE WELCOME EMAIL. The server reopened the session it already had rather
  // than minting a new one, so the contact it holds is the contact we captured. What it cannot restore is
  // the step index, which lived in this frame and went with the tab.
  //
  // ‼️ SO IT PICKS UP AT THE TIMES, WHICH IS THE ONE PLACE WORTH PICKING UP. Somebody who filled in
  // the form and then closed the tab without choosing a slot is exactly who that email is for, and the one
  // thing they must not be asked for twice is their name and number. With no contact on file there is
  // nothing to resume into, so they get the doors like anybody else.
  if(d.resumed){
   contact=Boolean(d.hasContact);firstName=d.firstName||'';
   bubble('a',d.greeting||'Welcome back.');
   if(contact)walkRef(indexOfStep('q_daypart'));
   else actions([{kind:'type',label:'Type for help'}]);
   height();
   return;
  }

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
