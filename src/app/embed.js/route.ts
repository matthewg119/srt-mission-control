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

 function q(o){return Object.keys(o).filter(function(k){return o[k]}).map(function(k){
   return encodeURIComponent(k)+"="+encodeURIComponent(o[k])}).join("&")}

 // Vercel's protection params and the preview grant, copied off our own <script src>.
 //
 // "pt" is a signed, client-scoped, 14-day token that Mission Control's own preview page puts on
 // this tag so a SWITCHED-OFF widget will answer there, and nowhere else. It is copied rather
 // than read from a data- attribute so it travels the same path the protection params already
 // take: into the frame URL and into /api/concierge/config, both of which need it. Nothing on a
 // client's real website ever carries one. See src/lib/concierge/preview-grant.ts.
 var pass="";
 try{
  var mine=new URL(me.src,location.href).searchParams,keep=[];
  mine.forEach(function(v,k){
   if(k.indexOf("x-vercel-")===0||k==="pt")keep.push(encodeURIComponent(k)+"="+encodeURIComponent(v));
  });
  pass=keep.join("&");
 }catch(e){}
 function withPass(u){return pass?u+(u.indexOf("?")<0?"?":"&")+pass:u}

 var frameSrc=withPass(origin+"/w/"+encodeURIComponent(slug)+"?"+q({
   category:category,city:city,magnet:magnet,path:location.pathname,host:location.host}));

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
 // The palette is onboarding2's chat bubble: a near black ground with #00C9A7 as the one accent. Matthew
 // asked for the same object in both places, so the two are deliberately not styled independently.
 var REEF="#00C9A7", INK="#04252b";
 var reduce=false;
 try{reduce=window.matchMedia("(prefers-reduced-motion: reduce)").matches}catch(e){}

 var wrap=document.createElement("div");
 wrap.style.cssText="position:fixed;right:16px;bottom:16px;z-index:2147483000;display:flex;flex-direction:column;align-items:flex-end;font:15px/1.4 -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";

 var panel=document.createElement("div");
 panel.style.cssText="display:none;width:min(380px,calc(100vw - 32px));height:min(580px,calc(100vh - 150px));background:#0b1416;border-radius:16px;overflow:hidden;box-shadow:0 12px 48px rgba(0,0,0,.35);margin-bottom:10px";

 // The speech bubble. It carries one line at a time and never the conversation.
 var bubble=document.createElement("div");
 bubble.setAttribute("role","status");
 bubble.style.cssText="display:none;position:relative;max-width:250px;margin:0 10px 8px 0;padding:11px 30px 11px 14px;background:#0b1416;color:#eaf4f3;border-radius:14px 14px 4px 14px;box-shadow:0 8px 28px rgba(0,0,0,.28);cursor:pointer;font-size:14px;line-height:1.4;opacity:0;transform:translateY(6px);transition:opacity .25s,transform .25s";
 var bubbleText=document.createElement("span");
 var bubbleClose=document.createElement("button");
 bubbleClose.type="button";bubbleClose.setAttribute("aria-label","Stop the messages");bubbleClose.textContent="\\u00d7";
 bubbleClose.style.cssText="position:absolute;top:4px;right:6px;border:0;background:none;color:#7fa3a2;font-size:18px;line-height:1;cursor:pointer;padding:2px 4px";
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
 hide.style.cssText="display:none;position:absolute;top:-4px;left:-4px;width:22px;height:22px;border:0;border-radius:50%;background:#0b1416;color:#cfe3e2;font-size:15px;line-height:22px;text-align:center;cursor:pointer;padding:0;box-shadow:0 2px 8px rgba(0,0,0,.3)";
 var launcher=document.createElement("div");
 launcher.style.cssText="position:relative";
 launcher.appendChild(btn);launcher.appendChild(hide);

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

 btn.addEventListener("click",function(){toggle(panel.style.display==="none")});
 bubble.addEventListener("click",function(){toggle(true)});
 bubbleClose.addEventListener("click",function(e){e.stopPropagation();dismissed=true;say(null)});
 // Hiding lasts for this page view, the same memory-only rule as everything else here.
 hide.addEventListener("click",function(e){e.stopPropagation();wrap.remove()});

 wrap.appendChild(panel);wrap.appendChild(bubble);wrap.appendChild(launcher);

 function say(line){
  if(!line){
   bubble.style.opacity="0";bubble.style.transform="translateY(6px)";
   setTimeout(function(){if(bubble.style.opacity==="0")bubble.style.display="none"},260);
   if(cat&&catAssets&&!reduce&&cat.getAttribute("data-live"))cat.src=origin+catAssets.idle;
   return;
  }
  bubbleText.textContent=line;
  bubble.style.display="block";
  requestAnimationFrame(function(){bubble.style.opacity="1";bubble.style.transform="translateY(0)"});
  if(cat&&catAssets&&!reduce&&talkLoaded)cat.src=origin+catAssets.talk;
 }

 function useMascot(assets){
  catAssets=assets;
  cat=document.createElement("img");
  cat.alt="";cat.height=96;cat.width=Math.round(assets.width*96/assets.height);
  cat.src=origin+assets.still;
  cat.style.cssText="display:block;height:96px;width:auto;filter:drop-shadow(0 6px 14px rgba(0,0,0,.28));transition:transform .2s";
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
    a.onload=function(){cat.setAttribute("data-live","1");if(bubble.style.display==="none")cat.src=a.src};
    a.src=origin+assets.idle;
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
   if(catAssets&&!talkLoaded&&!reduce){var t=new Image();t.onload=function(){talkLoaded=true};t.src=origin+catAssets.talk}
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
 fetch(withPass(origin+"/api/concierge/config?"+q({c:slug,category:category,magnet:magnet})))
  .then(function(r){return r.json()})
  .then(function(d){
    if(!d||!d.enabled){wrap.remove();return}
    if(d.mascot&&me.getAttribute("data-mascot")!=="none")useMascot(d.mascot);
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
