// The loader. One script tag on any page, ours or a client's, and the widget appears.
//
// ‼️ IT INJECTS AN IFRAME AND NOTHING ELSE. No framework, no fetch of anything but our own config,
// no cookies, no storage, and it never reads the host page's DOM beyond the element it created.
// Anything more would be code we ship into somebody else's site, and this is on a med spa's live
// website where a script that breaks their booking form is our problem forever.
//
// ‼️ THE CORNER IS A MASCOT WHEN THE CONFIG NAMES ONE (2026-09-16), the wizard cat by default, with speech
// bubbles drawn from /api/concierge/config every twenty seconds or so and an x that hides it for the page
// view. Without a mascot it is the pill it always was.
//
// ‼️ THE HEADER CTA TEXT COMES FROM THE MAGNET, VIA /api/concierge/config. Matthew's instruction is
// that the best lead magnet is the header and the widget is a popup under it. So the button says
// what the magnet promises, and editing that row changes every embedded page with no deploy and no
// re-paste of the snippet.
//
// ‼️ IT CARRIES ITS OWN x-vercel-* QUERY PARAMS ONTO EVERYTHING IT OPENS, AND ONLY THOSE.
// A preview deployment sits behind Vercel Deployment Protection, so a funnel on one project
// loading this script from another project's preview gets a 302 to SSO on the script, on the
// config fetch and on the frame. The bypass token has to travel with all three. Forwarding the
// loader's own query string is the only way to do that without a second attribute nobody would
// remember to remove. The prefix filter is the whole safety of it: nothing but Vercel's own
// protection params can ride along, so this cannot become a channel into our API. In production
// the script src carries no query at all and every line here is a no-op.
//
// ‼️ THE TEASER IS REMEMBERED IN MEMORY AND NOWHERE ELSE. Dismissing it lasts until the page is
// reloaded, and that is deliberate rather than unfinished: the line above says this script sets no
// cookies and touches no storage, and a sessionStorage key on a client's own domain would be the
// first exception to it. A teaser that comes back on the next page load is a smaller cost than a
// storage write we would then have to explain in their privacy policy.
//
// ‼️ IT FAILS SILENTLY AND COMPLETELY. Every branch that cannot proceed simply returns. A widget
// that does not appear is a bad day; a widget that throws in a client's console, or worse leaves a
// half-built button on their page, is a support call and a loss of trust.

import { NextResponse } from "next/server";

export const runtime = "nodejs";

const SCRIPT = `(function(){
 "use strict";
 var me=document.currentScript;
 if(!me)return;
 var slug=me.getAttribute("data-client")||"";
 if(!slug)return;
 if(window.__srtConcierge)return;      // one per page, whatever the CMS pasted
 window.__srtConcierge=true;

 var origin=new URL(me.src,location.href).origin;
 var category=me.getAttribute("data-category")||"";
 var city=me.getAttribute("data-city")||"";
 var mode=me.getAttribute("data-mode")||"popup";   // popup | inline
 // The offer this page was written toward. Set by the page that renders the tag, never guessed
 // here. Empty means "let the ladder decide", which is every page written before it existed.
 var magnet=me.getAttribute("data-magnet")||"";
 // "none" is the per-page opt-out back to the plain pill. Any other value names a mascot to show
 // INSTEAD of the tenant's, which only /preview/[token] ever sets and which the config route only
 // honours alongside a valid preview token. See src/app/api/concierge/config/route.ts.
 var wantMascot=me.getAttribute("data-mascot")||"";
 // ‼️ THE RESUME TOKEN, READ OFF THE PAGE'S OWN URL. The welcome email links back to the page the
 // conversation started on with ?srtc=<signed token> on it, so somebody who closed the widget half way
 // through can carry on. Reading location.search is not a widening of this file's rules: it already reads
 // location.pathname and location.host to tell the frame which page it is on.
 //
 // ‼️ IT IS PASSED TO THE FRAME AND VERIFIED THERE, NEVER TRUSTED HERE. This script does nothing
 // with it but hand it on, so a forged one buys a frame that refuses it rather than an open panel.
 var resume="";
 try{resume=(new URLSearchParams(location.search).get("srtc")||"").slice(0,400)}catch(e){}

 function q(o){return Object.keys(o).filter(function(k){return o[k]}).map(function(k){
   return encodeURIComponent(k)+"="+encodeURIComponent(o[k])}).join("&")}

 // ‼️ A MASCOT URL MAY BE ABSOLUTE (2026-09-16). A built-in mascot is a static import, so the config
 // sends "/_next/static/..." and it has to be joined to the host the script came from. A mascot
 // generated for one client lives in a storage bucket and arrives as a full https URL. Prefixing that
 // with our origin produced a 404 and a corner with no cat in it, silently, because every failure
 // path in this file is silent by design.
 function abs(u){return /^https?:/i.test(u)?u:origin+u}

 // Vercel's protection params and the preview grant, copied off our own <script src>.
 //
 // "pt" is a signed, client-scoped, 14-day token that Mission Control's own preview page puts on
 // this tag so a SWITCHED-OFF widget will answer there, and nowhere else. It is copied rather
 // than read from a data- attribute so it travels the same path the protection params already
 // take: into the frame URL and into /api/concierge/config, both of which need it. Nothing on a
 // client's real website ever carries one. See src/lib/concierge/preview-grant.ts.
 var pass="",ptok="";
 try{
  var mine=new URL(me.src,location.href).searchParams,keep=[];
  mine.forEach(function(v,k){
   if(k.indexOf("x-vercel-")===0||k==="pt")keep.push(encodeURIComponent(k)+"="+encodeURIComponent(v));
   if(k==="pt")ptok=v;
  });
  pass=keep.join("&");
 }catch(e){}
 function withPass(u){return pass?u+(u.indexOf("?")<0?"?":"&")+pass:u}

 var frameSrc=withPass(origin+"/w/"+encodeURIComponent(slug)+"?"+q({
   category:category,city:city,magnet:magnet,path:location.pathname,host:location.host,srtc:resume}));

 function makeFrame(){
  var f=document.createElement("iframe");
  f.src=frameSrc;
  f.title="Assistant";
  f.loading="lazy";
  f.setAttribute("allow","clipboard-write");
  f.style.cssText="width:100%;height:100%;border:0;background:transparent";
  return f;
 }

 // ── inline: the caller placed a container and owns the layout ──────────────
 if(mode==="inline"){
  var host=document.getElementById(me.getAttribute("data-target")||"srt-concierge");
  if(!host)return;
  host.style.minHeight=host.style.minHeight||"520px";
  host.appendChild(makeFrame());
  return;
 }

 // ── popup: a mascot (or a pill), its speech bubbles, and a panel above it ──
 //
 // Matthew, 2026-09-15: "a little emoji in the bottom right side of the website with the ability to be
 // closed ... saying stuff like popup texts ... an extension for the website not a whole chatbot itself."
 // The palette is the Virtual Agent's: a white panel with #00C9A7 as the one accent, matching the
 // frame in src/app/w/[slug]/route.ts. The panel here and the document inside it are ONE OBJECT.
 // Change one and change the other, or the widget opens as a white card inside a black frame.
 //
 // It was near black (#0b1416) until 2026-09-24. The widget is now sold for a client's whole site
 // rather than living on SRT's own dark pages, and a dark rectangle on a white clinic page reads as
 // something bolted on. INK is the text that sits ON the accent and is unchanged.
 var REEF="#00C9A7", INK="#04252b", PANEL="#ffffff", PANEL_FG="#14181f", PANEL_MUT="#5b6672", PANEL_LINE="#e3e8ec";
 var reduce=false;
 try{reduce=window.matchMedia("(prefers-reduced-motion: reduce)").matches}catch(e){}

 var wrap=document.createElement("div");
 wrap.style.cssText="position:fixed;z-index:2147483000;display:flex;font:15px/1.4 -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";

 var panel=document.createElement("div");
 panel.style.cssText="display:none;width:min(380px,calc(100vw - 32px));height:min(580px,calc(100vh - 150px));background:"+PANEL+";border-radius:16px;overflow:hidden;box-shadow:0 18px 50px rgba(8,12,16,.3)";

 // The speech bubble. It carries one line at a time and never the conversation.
 var bubble=document.createElement("div");
 bubble.setAttribute("role","status");
 bubble.style.cssText="display:none;position:relative;max-width:250px;padding:11px 30px 11px 14px;background:"+PANEL+";color:"+PANEL_FG+";border:1px solid "+PANEL_LINE+";box-shadow:0 8px 28px rgba(8,12,16,.18);cursor:pointer;font-size:14px;line-height:1.4;opacity:0;transform:translateY(6px);transition:opacity .25s,transform .25s";
 var bubbleText=document.createElement("span");
 var bubbleClose=document.createElement("button");
 bubbleClose.type="button";bubbleClose.setAttribute("aria-label","Stop the messages");bubbleClose.textContent="\\u00d7";
 bubbleClose.style.cssText="position:absolute;top:4px;right:6px;border:0;background:none;color:"+PANEL_MUT+";font-size:18px;line-height:1;cursor:pointer;padding:2px 4px";
 bubble.appendChild(bubbleText);bubble.appendChild(bubbleClose);

 // The launcher: a pill until the config says there is a mascot.
 var btn=document.createElement("button");
 btn.type="button";
 btn.setAttribute("aria-expanded","false");
 btn.setAttribute("aria-label","Open the assistant");
 btn.style.cssText="display:block;padding:13px 20px;border:0;border-radius:999px;background:"+REEF+";color:"+INK+";font-weight:700;font-size:15px;cursor:pointer;box-shadow:0 6px 20px rgba(0,0,0,.25)";
 btn.textContent="Chat";

 var cat=null, catAssets=null, talkLoaded=false;
 var hide=document.createElement("button");
 hide.type="button";hide.setAttribute("aria-label","Hide the assistant");hide.textContent="\\u00d7";
 hide.style.cssText="display:none;position:absolute;top:-4px;left:-4px;width:22px;height:22px;border:0;border-radius:50%;background:"+PANEL+";color:"+PANEL_MUT+";border:1px solid "+PANEL_LINE+";font-size:15px;line-height:22px;text-align:center;cursor:pointer;padding:0;box-shadow:0 2px 8px rgba(8,12,16,.2)";
 var launcher=document.createElement("div");
 launcher.style.cssText="position:relative;touch-action:none";
 launcher.appendChild(btn);launcher.appendChild(hide);

 // ── where it sits ─────────────────────────────────────────────────────────
 //
 // Matthew, 2026-09-16: "Also allow me to move the concierge around."
 //
 // ‼️ FOUR CORNERS, NOT FREE PIXELS, AND THE STACK FLIPS WITH THE CORNER. The panel is 580px tall and
 // the bubble points at the launcher, so a widget parked at the top of the window with the old
 // bottom-anchored stack opens its panel off the top of the screen. Every corner therefore sets four
 // things together: which edges wrap is pinned to, which way the column runs (the panel is always on
 // the far side of the launcher from the nearest edge), which side the bubble's tail is on, and where
 // its margin goes. Splitting these apart is how you get a widget that looks right in one corner only.
 var corner="bottom-right";
 function place(c){
  corner=c;
  var top=c.indexOf("top")===0, left=c.indexOf("left")>0;
  wrap.style.left=left?"16px":"auto";
  wrap.style.right=left?"auto":"16px";
  wrap.style.top=top?"16px":"auto";
  wrap.style.bottom=top?"auto":"16px";
  wrap.style.flexDirection=top?"column-reverse":"column";
  wrap.style.alignItems=left?"flex-start":"flex-end";
  panel.style.margin=top?"10px 0 0 0":"0 0 10px 0";
  bubble.style.margin=top?(left?"8px 0 0 10px":"8px 10px 0 0"):(left?"0 0 8px 10px":"0 10px 8px 0");
  bubble.style.borderRadius=left?"14px 14px 14px 4px":"14px 14px 4px 14px";
 }
 place(corner);

 var opened=false, dismissed=false, shown=0;
 function toggle(show){
  panel.style.display=show?"block":"none";
  btn.setAttribute("aria-expanded",show?"true":"false");
  // ‼️ THE FRAME IS BUILT ON FIRST OPEN, NOT ON PAGE LOAD. Nothing is fetched, no session row is
  // written and no model is reachable until somebody actually clicks. On a page that gets crawled
  // or scraped, that is the difference between zero cost and one row per bot.
  if(show&&!opened){opened=true;panel.appendChild(makeFrame())}
  if(show)say(null);
  if(!cat)btn.textContent=show?"Close":(btn.getAttribute("data-label")||"Chat");
 }

 // ‼️ A DRAG MUST NOT OPEN THE PANEL. pointerup fires before click, so by the time this runs "moved"
 // already says whether the last gesture travelled. Swallowing it here rather than calling
 // preventDefault in pointerup keeps the keyboard path working: a focused launcher activated with
 // Enter emits a click with no pointer sequence at all, and "moved" is false for it.
 btn.addEventListener("click",function(){
  if(moved){moved=false;return}
  toggle(panel.style.display==="none");
 });
 bubble.addEventListener("click",function(){toggle(true)});
 bubbleClose.addEventListener("click",function(e){e.stopPropagation();dismissed=true;say(null)});
 // Hiding lasts for this page view, the same memory-only rule as everything else here.
 hide.addEventListener("click",function(e){e.stopPropagation();wrap.remove()});

 // ── dragging it somewhere else ────────────────────────────────────────────
 //
 // ‼️ THE POSITION IS MEMORY ONLY ON A LIVE PAGE, like the teaser and the hide. This script sets no
 // cookies and touches no storage on a client's domain, and a remembered corner is not worth being
 // the first exception to that. Where it RESTS comes from the config instead, so the decision is
 // ours and travels with the tenant rather than with one visitor's browser.
 //
 // ‼️ AND IT IS PERSISTED FROM THE PREVIEW ONLY. "pt" is minted by /preview/[token] for one client and
 // arrives nowhere else, so dragging on our own demo page is a decision Matthew is making about that
 // client, and dragging on a stranger's visit to a client's site is not. Nothing on a live page posts.
 var dragging=false, moved=false, sx=0, sy=0, ox=0, oy=0;
 launcher.addEventListener("pointerdown",function(e){
  if(e.button!==0||e.target===hide)return;
  dragging=true;moved=false;sx=e.clientX;sy=e.clientY;
  var r=wrap.getBoundingClientRect();ox=r.left;oy=r.top;
  try{launcher.setPointerCapture(e.pointerId)}catch(err){}
 });
 launcher.addEventListener("pointermove",function(e){
  if(!dragging)return;
  var dx=e.clientX-sx, dy=e.clientY-sy;
  // A few pixels of travel is a click with a shaky hand, not a drag.
  if(!moved&&Math.abs(dx)+Math.abs(dy)<6)return;
  moved=true;
  var x=Math.min(Math.max(0,ox+dx),Math.max(0,window.innerWidth-wrap.offsetWidth));
  var y=Math.min(Math.max(0,oy+dy),Math.max(0,window.innerHeight-wrap.offsetHeight));
  wrap.style.left=x+"px";wrap.style.top=y+"px";wrap.style.right="auto";wrap.style.bottom="auto";
 });
 function drop(e){
  if(!dragging)return;
  dragging=false;
  try{launcher.releasePointerCapture(e.pointerId)}catch(err){}
  if(!moved){place(corner);return}
  var r=wrap.getBoundingClientRect();
  var c=((r.top+r.height/2)<window.innerHeight/2?"top":"bottom")+"-"+((r.left+r.width/2)<window.innerWidth/2?"left":"right");
  place(c);
  if(!ptok)return;
  try{
   fetch(withPass(origin+"/api/concierge/corner"),{
    method:"POST",
    headers:{"content-type":"application/json"},
    body:JSON.stringify({c:slug,corner:c})
   }).catch(function(){});
  }catch(err){}
 }
 launcher.addEventListener("pointerup",drop);
 launcher.addEventListener("pointercancel",drop);

 wrap.appendChild(panel);wrap.appendChild(bubble);wrap.appendChild(launcher);

 function say(line){
  if(!line){
   bubble.style.opacity="0";bubble.style.transform="translateY(6px)";
   setTimeout(function(){if(bubble.style.opacity==="0")bubble.style.display="none"},260);
   // Not while a gesture is running: the gesture puts idle back itself when it ends, and cutting it
   // off here made the cat snap mid-throw every time a bubble timed out.
   if(cat&&catAssets&&!reduce&&!flourishing&&cat.getAttribute("data-live"))cat.src=abs(catAssets.idle);
   return;
  }
  bubbleText.textContent=line;
  bubble.style.display="block";
  requestAnimationFrame(function(){bubble.style.opacity="1";bubble.style.transform="translateY(0)"});
  // Talking outranks a gesture. The gesture's own timer finds the bubble up and leaves talk alone.
  if(cat&&catAssets&&!reduce&&talkLoaded){flourishing=false;cat.src=abs(catAssets.talk)}
 }

 // ── the gestures ──────────────────────────────────────────────────────────
 //
 // Matthew, 2026-09-16: "make it throw it and hold it with its tail, stand in his tail like tigger and
 // move the wand around even scan your face easter egg give it a very rare chance that one happens".
 //
 // ‼️ ONE GESTURE FILE IS LOADED AT A TIME, ON DEMAND, AND NEVER ON PAGE LOAD. Each is a few hundred
 // kB on somebody else's website and there are three of them. The idle loop already waits for
 // window.load plus a second and a half before it fetches anything; a gesture waits for its own turn
 // to come around, which is at least twenty five seconds later, and a tab that is never looked at
 // downloads none of them.
 var flourishing=false, eggPlayed=false, got={};
 function withClip(src,then){
  if(got[src])return then();
  var im=new Image();
  im.onload=function(){got[src]=1;then()};
  im.src=abs(src);
 }
 function quiet(){
  return !!cat&&!!catAssets&&!reduce&&!flourishing
   &&panel.style.display==="none"&&!document.hidden
   &&bubble.style.display==="none"
   &&!!cat.getAttribute("data-live")
   &&!!document.body&&document.body.contains(wrap);
 }
 function gesture(clip){
  if(!quiet())return;
  withClip(clip.src,function(){
   // Checked twice on purpose: the download takes as long as it takes, and a person may have opened
   // the panel or the teaser may have spoken while it was in flight.
   if(!quiet())return;
   flourishing=true;
   cat.src=abs(clip.src);
   setTimeout(function(){
    if(!flourishing)return;
    flourishing=false;
    if(cat&&catAssets&&bubble.style.display==="none")cat.src=abs(catAssets.idle);
   },clip.ms);
  });
 }
 function gestures(){
  var list=(catAssets&&catAssets.flourishes)||[];
  if(!list.length||reduce)return;
  setTimeout(function(){
   if(!document.body||!document.body.contains(wrap))return;
   var egg=catAssets&&catAssets.easterEgg;
   // The rare one. Once per page view at most, so a reader who stays all afternoon does not learn it.
   if(egg&&!eggPlayed&&Math.random()<1/60){eggPlayed=true;gesture(egg)}
   else gesture(list[Math.floor(Math.random()*list.length)]);
   gestures();
  },25000+Math.floor(Math.random()*20000));
 }

 function useMascot(assets){
  catAssets=assets;
  cat=document.createElement("img");
  cat.alt="";cat.height=96;cat.width=Math.round(assets.width*96/assets.height);
  cat.src=abs(assets.still);
  cat.style.cssText="display:block;height:96px;width:auto;filter:drop-shadow(0 6px 14px rgba(0,0,0,.28));transition:transform .2s;user-select:none;-webkit-user-drag:none";
  btn.textContent="";
  btn.style.cssText="display:block;padding:0;border:0;background:none;cursor:pointer";
  btn.appendChild(cat);
  btn.addEventListener("mouseenter",function(){cat.style.transform="translateY(-3px)"});
  btn.addEventListener("mouseleave",function(){cat.style.transform="none"});
  hide.style.display="block";
  if(reduce)return;
  // ‼️ THE ANIMATION LOADS AFTER THE PAGE HAS, NEVER WITH IT. It is a few hundred kB on somebody else's
  // website, so the still frame holds the corner until their own page has finished loading.
  function animate(){
   setTimeout(function(){
    var a=new Image();
    a.onload=function(){
     cat.setAttribute("data-live","1");
     if(bubble.style.display==="none")cat.src=a.src;
     // Only once the idle loop is actually running: a gesture that ends by swapping back to a still
     // frame would leave the corner frozen.
     gestures();
    };
    a.src=abs(assets.idle);
   },1500);
  }
  if(document.readyState==="complete")animate();else window.addEventListener("load",animate);
 }

 function schedule(lines){
  if(!lines||!lines.length)return;
  var pool=lines.slice(), MAX=8;
  function next(){
   if(dismissed||!document.body||!document.body.contains(wrap)||shown>=MAX)return;
   if(panel.style.display!=="none"||document.hidden){setTimeout(next,8000);return}
   if(!pool.length)pool=lines.slice();
   var line=pool.splice(Math.floor(Math.random()*pool.length),1)[0];
   shown++;
   if(catAssets&&!talkLoaded&&!reduce){var t=new Image();t.onload=function(){talkLoaded=true};t.src=abs(catAssets.talk)}
   say(line);
   setTimeout(function(){if(panel.style.display==="none")say(null)},7000);
   // "every 20 seconds ish": a random gap, so it reads as a character and not a timer.
   setTimeout(next,7000+15000+Math.floor(Math.random()*13000));
  }
  setTimeout(next,6000);
 }

 function mount(){document.body&&document.body.appendChild(wrap)}

 // The config decides mascot or pill, and the lines. A failure leaves the neutral "Chat" pill, which
 // still opens a working conversation, so the widget is mounted either way.
 fetch(withPass(origin+"/api/concierge/config?"+q({c:slug,category:category,magnet:magnet,
   mascot:wantMascot==="none"?"":wantMascot})))
  .then(function(r){return r.json()})
  .then(function(d){
    if(!d||!d.enabled){wrap.remove();return}
    // ‼️ A RESUME LINK OPENS THE PANEL BY ITSELF, AND THAT IS THE ONE TIME THIS SCRIPT DOES. The
    // rest of the time the corner waits to be pressed, because a panel that opens itself on a stranger's
    // first visit is a popup. Somebody arriving from an email we sent them, on a link they chose to tap,
    // is not a stranger and is not being interrupted: the conversation IS the point of the link. It runs
    // only after the config confirmed the tenant is live, so a switched-off widget still opens nothing.
    if(resume)toggle(true);
    if(d.corner)place(d.corner);
    if(d.mascot&&wantMascot!=="none")useMascot(d.mascot);
    else if(d.ctaLabel){btn.textContent=d.ctaLabel;btn.setAttribute("data-label",d.ctaLabel)}
    schedule(d.lines&&d.lines.length?d.lines:(d.headline?[d.headline]:[]));
  })
  .catch(function(){});

 if(document.readyState==="loading"){document.addEventListener("DOMContentLoaded",mount)}else{mount()}

 window.addEventListener("message",function(e){
  if(e.origin!==origin)return;                       // the frame, and only the frame
  var d=e.data;
  if(!d)return;
  // The panel's own x. The frame cannot reach this page, so it asks.
  if(d.srtConcierge==="close"&&typeof toggle==="function"){toggle(false);return}
 });
})();`;

export function GET() {
  return new NextResponse(SCRIPT, {
    headers: {
      "content-type": "application/javascript; charset=utf-8",
      // Served onto third-party pages, so it must be cacheable, and it must be reachable from any
      // origin. The script itself carries no secrets and takes no input but its own data attributes.
      "cache-control": "public, max-age=300, s-maxage=3600",
      "access-control-allow-origin": "*",
    },
  });
}
