// The loader. One script tag on any page, ours or a client's, and the widget appears.
//
// ‼️ IT INJECTS AN IFRAME AND NOTHING ELSE. No framework, no fetch of anything but our own config,
// no cookies, no storage, and it never reads the host page's DOM beyond the element it created.
// Anything more would be code we ship into somebody else's site, and this is on a med spa's live
// website where a script that breaks their booking form is our problem forever.
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
 // ‼️ currentScript FIRST, THEN A SEARCH, BECAUSE THE TAG IS NOT ALWAYS WHERE IT WAS PASTED.
 // document.currentScript is null inside a module, inside a callback, and for a tag a CMS or a
 // tag manager injected after load, and every one of those is a normal way for this snippet to
 // end up on a client's site. It used to bail out on all of them, which is a widget that simply
 // never appears and leaves nothing in the console to explain why.
 var me=document.currentScript||document.querySelector("script[data-client]");
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

 // Vercel's protection params, and nothing else, copied off our own <script src>.
 var pass="";
 try{
  var mine=new URL(me.src,location.href).searchParams,keep=[];
  mine.forEach(function(v,k){
   if(k.indexOf("x-vercel-")===0)keep.push(encodeURIComponent(k)+"="+encodeURIComponent(v));
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

 // ── popup: a teaser line, a pill, and a panel under it ────────────────────
 //
 // The palette is onboarding2's chat bubble: a near black ground with #00C9A7 as the one accent.
 // Matthew asked for the same object in both places, so the two are deliberately not styled
 // independently. If one changes, change both.
 var REEF="#00C9A7", INK="#04252b";

 var wrap=document.createElement("div");
 wrap.style.cssText="position:fixed;right:20px;bottom:20px;z-index:2147483000;display:flex;flex-direction:column;align-items:flex-end;font:15px/1.4 -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";

 var panel=document.createElement("div");
 panel.style.cssText="display:none;width:min(380px,calc(100vw - 40px));height:min(560px,calc(100vh - 120px));background:#0b1416;border-radius:16px;overflow:hidden;box-shadow:0 12px 48px rgba(0,0,0,.35);margin-bottom:12px";

 // ── the teaser: what is on offer, before anybody has clicked anything ──────
 //
 // ‼️ IT CARRIES THE MAGNET AND THE PILL CARRIES THE ACTION. The pill has room for four words and
 // the promise needs a sentence, so putting both on the button meant the promise was never said.
 // It stays hidden until the config answers, because a teaser with no offer in it is just noise
 // on somebody's website.
 var teaser=document.createElement("div");
 teaser.style.cssText="display:none;position:relative;max-width:300px;margin-bottom:10px;padding:14px 34px 14px 16px;background:#0b1416;color:#fff;border-radius:14px;box-shadow:0 8px 28px rgba(0,0,0,.28);cursor:pointer;text-align:left";

 var teaserTitle=document.createElement("div");
 teaserTitle.style.cssText="font-weight:700;font-size:14px;line-height:1.35;color:"+REEF;

 var teaserPromise=document.createElement("div");
 teaserPromise.style.cssText="margin-top:5px;font-size:13px;line-height:1.45;color:#cfe3e2";

 var close=document.createElement("button");
 close.type="button";
 close.setAttribute("aria-label","Dismiss");
 close.textContent="×";
 close.style.cssText="position:absolute;top:6px;right:8px;border:0;background:none;color:#7fa3a2;font-size:19px;line-height:1;cursor:pointer;padding:2px 4px";

 teaser.appendChild(teaserTitle);teaser.appendChild(teaserPromise);teaser.appendChild(close);

 var btn=document.createElement("button");
 btn.type="button";
 btn.style.cssText="display:block;padding:13px 20px;border:0;border-radius:999px;background:"+REEF+";color:"+INK+";font-weight:700;font-size:15px;cursor:pointer;box-shadow:0 6px 20px rgba(0,0,0,.25)";
 btn.textContent="Chat";
 btn.setAttribute("aria-expanded","false");

 var opened=false;
 function toggle(show){
  panel.style.display=show?"block":"none";
  btn.setAttribute("aria-expanded",show?"true":"false");
  // ‼️ THE FRAME IS BUILT ON FIRST OPEN, NOT ON PAGE LOAD. Nothing is fetched, no session row is
  // written and no model is reachable until somebody actually clicks. On a page that gets crawled
  // or scraped, that is the difference between zero cost and one row per bot.
  if(show&&!opened){opened=true;panel.appendChild(makeFrame())}
  // Open means the offer is on screen inside the panel, so the teaser has said its piece.
  if(show)teaser.style.display="none";
  btn.textContent=show?"Close":(btn.getAttribute("data-label")||"Chat");
 }

 btn.addEventListener("click",function(){toggle(panel.style.display==="none")});
 teaser.addEventListener("click",function(){toggle(true)});
 close.addEventListener("click",function(e){
  e.stopPropagation();                  // dismissing the teaser is not opening the panel
  teaser.style.display="none";
  teaser.setAttribute("data-dismissed","1");
 });

 wrap.appendChild(panel);wrap.appendChild(teaser);wrap.appendChild(btn);

 function mount(){document.body&&document.body.appendChild(wrap)}
 if(document.readyState==="loading"){document.addEventListener("DOMContentLoaded",mount)}else{mount()}

 // The label and the teaser follow the resolved magnet. A failure here leaves the neutral "Chat"
 // and no teaser, and the widget still works, so this is deliberately not awaited before mounting.
 fetch(withPass(origin+"/api/concierge/config?"+q({c:slug,category:category,magnet:magnet})))
  .then(function(r){return r.json()})
  .then(function(d){
    if(!d||!d.enabled){wrap.remove();return}
    if(d.ctaLabel){btn.textContent=d.ctaLabel;btn.setAttribute("data-label",d.ctaLabel)}
    if(!d.headline)return;
    teaserTitle.textContent=d.headline;
    teaserPromise.textContent=d.promise||"";
    // A beat, so it reads as an offer arriving rather than as an overlay the page loaded with.
    setTimeout(function(){
      if(panel.style.display==="none"&&!teaser.getAttribute("data-dismissed")){
        teaser.style.display="block";
      }
    },1200);
  })
  .catch(function(){});

 window.addEventListener("message",function(e){
  if(e.origin!==origin)return;                       // the frame, and only the frame
  var d=e.data;
  if(!d||d.srtConcierge!=="height")return;
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
