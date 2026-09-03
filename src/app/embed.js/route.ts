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

 function q(o){return Object.keys(o).filter(function(k){return o[k]}).map(function(k){
   return encodeURIComponent(k)+"="+encodeURIComponent(o[k])}).join("&")}

 var frameSrc=origin+"/w/"+encodeURIComponent(slug)+"?"+q({
   category:category,city:city,path:location.pathname,host:location.host});

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

 // ── popup: a header line, a button, and a panel under it ───────────────────
 var wrap=document.createElement("div");
 wrap.style.cssText="position:fixed;right:20px;bottom:20px;z-index:2147483000;font:15px/1.4 -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";

 var panel=document.createElement("div");
 panel.style.cssText="display:none;width:min(380px,calc(100vw - 40px));height:min(560px,calc(100vh - 120px));background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 12px 48px rgba(0,0,0,.22);margin-bottom:12px";

 var btn=document.createElement("button");
 btn.type="button";
 btn.style.cssText="display:block;margin-left:auto;padding:13px 20px;border:0;border-radius:999px;background:#111;color:#fff;font-weight:600;font-size:15px;cursor:pointer;box-shadow:0 6px 20px rgba(0,0,0,.25)";
 btn.textContent="Chat";
 btn.setAttribute("aria-expanded","false");

 var opened=false;
 btn.addEventListener("click",function(){
  var show=panel.style.display==="none";
  panel.style.display=show?"block":"none";
  btn.setAttribute("aria-expanded",show?"true":"false");
  // ‼️ THE FRAME IS BUILT ON FIRST OPEN, NOT ON PAGE LOAD. Nothing is fetched, no session row is
  // written and no model is reachable until somebody actually clicks. On a page that gets crawled
  // or scraped, that is the difference between zero cost and one row per bot.
  if(show&&!opened){opened=true;panel.appendChild(makeFrame())}
  btn.textContent=show?"Close":(btn.getAttribute("data-label")||"Chat");
 });

 wrap.appendChild(panel);wrap.appendChild(btn);

 function mount(){document.body&&document.body.appendChild(wrap)}
 if(document.readyState==="loading"){document.addEventListener("DOMContentLoaded",mount)}else{mount()}

 // The label follows the resolved magnet. A failure here leaves the neutral "Chat" and the widget
 // still works, so this is deliberately not awaited before mounting.
 fetch(origin+"/api/concierge/config?"+q({c:slug,category:category}))
  .then(function(r){return r.json()})
  .then(function(d){
    if(!d||!d.enabled){wrap.remove();return}
    if(d.ctaLabel){btn.textContent=d.ctaLabel;btn.setAttribute("data-label",d.ctaLabel)}
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
