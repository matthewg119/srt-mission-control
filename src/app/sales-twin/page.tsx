"use client";
/* eslint-disable @typescript-eslint/no-explicit-any, react-hooks/exhaustive-deps */
// Sales Twin — Red Panther kiosk (Module 1 + 2).
// The markup below is the Red Panther layout converted 1:1 to JSX. All original
// imperative logic is ported verbatim into the mount effect and exposed on
// `window` so the innerHTML-generated queue/approval cards keep working. Real
// data + momentum come from /api/sales-twin/* and Supabase Realtime.

import { useEffect, useState } from "react";
import { supabase } from "@/lib/db";
import "./sales-twin.css";

export default function SalesTwinPage() {
  const [banner, setBanner] = useState("Zoho: connecting…");

  useEffect(() => {
    const w = window as any;
    const TENANT_TODAY = new Date();
    void TENANT_TODAY;

    // ── DATA (replaced on mount by /api/sales-twin/leads) ──
    let redLeads: any[] = [];
    let greenLeads: any[] = [];

    // ── STATE ──
    let running = false,
      isGreen = false;
    let currentIdx = -1,
      connects = 0,
      totalDials = 0,
      totalNA = 0,
      totalTalkSec = 0;
    let dialInt: any = null,
      callInt: any = null,
      barInt: any = null;
    const connectTimes: Date[] = [];
    const connectNames: any[] = [];
    let activeLead: any = null;
    let allLeads: any[] = redLeads;
    let pendingCards = 0;

    // ── DIALER (Phase 2 — in-browser RingCentral WebPhone) ──
    let webphone: any = null; // SalesTwinWebPhone instance (lazy, client-only import)
    let wpConnecting: Promise<void> | null = null; // in-flight connect() (provision once)
    let pollInt: any = null; // legacy timer handle (kept harmless for shared cleanup)
    let leadRingStart = 0; // ms when the lead leg started ringing (starts 22s clock)
    let callTimerInt: any = null; // ticks #timerBig while on a connected call
    let noAnswerTO: any = null; // 22s lead-no-answer auto-advance timer
    let awaitingDisposition = false; // true once a call connects, until disposed
    let callStart = 0; // ms timestamp the call connected
    let answeredThisDial = false; // this dial reached the connected state
    let dialSettled = false; // this dial already advanced (no-answer or disposition)
    let talkCounted = false; // guard so talk time is added to totals exactly once
    let lastCallSec = 0; // talk seconds of the most recent connected call

    const suggestions = [
      { tag: "rate objection", text: '"Our rate is 1.26 — and our payback is daily or weekly, your choice. Want me to show you a side-by-side?"' },
      { tag: "urgency", text: '"Rates are moving this week — this offer window closes Friday. Worth locking in now?"' },
      { tag: "closing", text: '"You\'re already approved. We just need a start date. What works for you?"' },
      { tag: "competitor", text: '"What rate are they offering? And are they flexible on payback frequency? That\'s where we usually win."' },
      { tag: "stall", text: '"Totally get it — what\'s the one thing that needs to happen before you feel ready to move forward?"' },
    ];
    let sugIdx = 0;

    const $ = (id: string) => document.getElementById(id);

    // ── CLOCK ──
    const clockInt = setInterval(function () {
      const n = new Date();
      const el = $("clkEl");
      if (el) el.textContent = n.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
    }, 1000);

    // ── QUEUE BUILD ──
    function buildQueue() {
      const list = $("queueList");
      if (!list) return;
      list.innerHTML = "";
      const qc = $("qCount");
      if (qc) qc.textContent = allLeads.length + " leads";

      if (isGreen) {
        ($("qTitle") as HTMLElement).textContent = "follow-up queue";
        const lbl = document.createElement("div");
        lbl.className = "q-section-lbl green-sec";
        lbl.innerHTML = '<i class="ti ti-flame" style="font-size:9px;margin-right:3px;" aria-hidden="true"></i>warm — meta ads / funnel';
        list.appendChild(lbl);
        allLeads.forEach((l) => addQItem(l, list));
      } else {
        ($("qTitle") as HTMLElement).textContent = "no-contact queue";
        allLeads.forEach((l) => addQItem(l, list));
      }
    }

    function addQItem(l: any, list: HTMLElement) {
      const div = document.createElement("div");
      div.className = "q-item";
      div.id = "qi-" + l.id;
      let badge = "";
      if (l.taskDue === "today") badge = '<span class="qi-badge badge-due">today</span>';
      else if (l.taskDue && l.taskDue.indexOf("overdue") > -1) badge = '<span class="qi-badge badge-tasks">' + l.taskDue + "</span>";
      if (l.attempts >= 5) badge += '<span class="qi-badge badge-kick" style="margin-left:2px;">7-day</span>';
      div.innerHTML =
        '<div class="qi-name">' + l.name +
        '&nbsp;<span class="qi-badge badge-na" id="qbadge-' + l.id + '" style="display:none;"></span>' + badge + "</div>" +
        '<div class="qi-meta">' + l.fund + " · " + (l.taskDue || l.stage) + "</div>";
      list.appendChild(div);
    }

    // ── HELPERS ──
    function fmt(s: number) {
      return Math.floor(s / 60) + ":" + (s % 60 < 10 ? "0" : "") + (s % 60);
    }
    function log(m: string) {
      const el = $("logStrip");
      if (el) el.textContent = m;
    }
    function setStatus(m: string) {
      const el = $("ssText");
      if (el) el.textContent = m;
    }
    function dispBtns(on: boolean) {
      ["dConnected", "dNA", "dCB", "dNI", "dBN", "dVM"].forEach(function (id) {
        const el = $(id) as HTMLButtonElement | null;
        if (el) el.disabled = !on;
      });
    }

    function applyState() {
      const c = isGreen ? "#00C87A" : "#FF3B30";
      const g = isGreen ? "#007A4A" : "#7A1515";
      const sb = isGreen ? "#003D25" : "#3D0A0A";
      document.documentElement.style.setProperty("--state-color", c);
      document.documentElement.style.setProperty("--state-glow", g);
      document.documentElement.style.setProperty("--state-bg", sb);

      const bigDot = $("bigDot");
      if (bigDot) {
        if (isGreen) {
          bigDot.style.background = "radial-gradient(circle at 35% 35%, #00A562, #00C87A)";
          bigDot.style.borderColor = "#007A4A";
          bigDot.style.boxShadow = "0 0 20px rgba(0,200,122,0.4), inset 0 1px 0 rgba(255,255,255,0.1)";
        } else {
          bigDot.style.background = "radial-gradient(circle at 35% 35%, #CC2222, #FF3B30)";
          bigDot.style.borderColor = "#7A1515";
          bigDot.style.boxShadow = "0 0 20px rgba(255,59,48,0.4), inset 0 1px 0 rgba(255,255,255,0.1)";
        }
      }

      ($("modeLbl") as HTMLElement).textContent = isGreen ? "GREEN MODE" : "RED MODE";
      ($("modeSub") as HTMLElement).textContent = isGreen ? "working deals · task-due first" : "no contact · auto-hang 22s";
      ($("pillLabel") as HTMLElement).textContent = isGreen ? "GREEN · FOLLOW-UP" : "RED · AUTO-DIAL";
      ($("autoBtn") as HTMLElement).style.boxShadow = isGreen ? "0 0 20px rgba(0,200,122,0.35)" : "0 0 20px rgba(255,59,48,0.35)";
    }

    function updateGoals() {
      const dp = Math.min(Math.round((totalDials / 30) * 100), 100);
      const cp = Math.min(Math.round((connects / 3) * 100), 100);
      const tp = Math.min(Math.round((totalTalkSec / 7200) * 100), 100);
      ($("gDials") as HTMLElement).textContent = totalDials + "/30";
      ($("gDialF") as HTMLElement).style.width = dp + "%";
      ($("gConns") as HTMLElement).textContent = String(connects);
      ($("gConnF") as HTMLElement).style.width = cp + "%";
      ($("gTalk") as HTMLElement).textContent = Math.floor(totalTalkSec / 60) + "m";
      ($("gTalkF") as HTMLElement).style.width = tp + "%";
      ($("tDials") as HTMLElement).textContent = String(totalDials);
      ($("tConnects") as HTMLElement).textContent = String(connects);
      ($("tNA") as HTMLElement).textContent = String(totalNA);
      ($("tTalk") as HTMLElement).textContent = Math.floor(totalTalkSec / 60) + "m";
      ($("connProg") as HTMLElement).textContent = connects + " / 3";
      ($("connFill") as HTMLElement).style.width = Math.min(Math.round((connects / 3) * 100), 100) + "%";
    }

    function showLead(l: any) {
      activeLead = l;
      ($("callerAvatar") as HTMLElement).textContent = l.initials;
      ($("callerName") as HTMLElement).textContent = l.name;
      ($("callerSub") as HTMLElement).textContent = l.co;
      ($("aiSumText") as HTMLElement).innerHTML = l.sum;
      ($("noteCount") as HTMLElement).textContent = l.notes.length + " notes";
      ($("fFund") as HTMLElement).textContent = l.fund;
      ($("fRev") as HTMLElement).textContent = l.rev;
      ($("fStage") as HTMLElement).textContent = l.stage;
      ($("fBiz") as HTMLElement).textContent = l.biz;
      ($("fScore") as HTMLElement).textContent = l.score;
      ($("fTouch") as HTMLElement).textContent = l.touch;
      ($("crmLeadRef") as HTMLElement).textContent = l.name + " · Zoho ID #" + (l.external_id || 1000 + l.id);
      ($("crmTa") as HTMLTextAreaElement).value = "";
      ($("sideTa") as HTMLTextAreaElement).value = "";
      ($("transcriptLines") as HTMLElement).innerHTML = '<div class="tc-empty">Live transcription appears here once a call connects.</div>';
      document.querySelectorAll(".pq-item input").forEach(function (cb: any) {
        cb.checked = false;
        cb.closest(".pq-item").classList.remove("done");
      });
      hideSug();
      resetSaveBtn();
      ($("callerAvatar") as HTMLElement).classList.remove("live");
    }

    function clearLead() {
      activeLead = null;
      ($("callerAvatar") as HTMLElement).textContent = "—";
      ($("callerAvatar") as HTMLElement).classList.remove("live");
      ($("callerName") as HTMLElement).textContent = "Ready to dial";
      ($("callerSub") as HTMLElement).textContent = "";
      ($("aiSumText") as HTMLElement).textContent = "No active lead.";
      ($("noteCount") as HTMLElement).textContent = "0 notes";
      ["fFund", "fRev", "fStage", "fBiz", "fScore", "fTouch"].forEach(function (id) {
        ($(id) as HTMLElement).textContent = "—";
      });
      ($("transcriptLines") as HTMLElement).innerHTML = '<div class="tc-empty">Waiting for call...</div>';
      ($("crmLeadRef") as HTMLElement).textContent = "no lead selected";
      hideSug();
    }

    // ── DIALER ──
    function toggleDialer() {
      if (running) stopDialer();
      else startDialer();
    }

    function startDialer() {
      if (running) return;
      if (!allLeads.length) {
        log("No leads in queue yet.");
        return;
      }
      running = true;
      currentIdx = 0;
      ($("autoBtnLbl") as HTMLElement).textContent = "Stop Dialing";
      ($("autoBtnIcon") as HTMLElement).className = "ti ti-player-stop";
      log("Auto-dialer started. " + allLeads.length + " leads in queue.");
      setStatus("Auto-dialing — calls ring in this browser tab.");
      dialNext();
    }

    function stopDialer() {
      running = false;
      dialSettled = true; // block any in-flight call handlers from advancing
      awaitingDisposition = false;
      clearInterval(dialInt);
      clearInterval(callInt);
      clearInterval(barInt);
      clearInterval(callTimerInt);
      clearInterval(pollInt);
      clearTimeout(noAnswerTO);
      hangupCall();
      ($("autoBtnLbl") as HTMLElement).textContent = "Start Auto-Dial";
      ($("autoBtnIcon") as HTMLElement).className = "ti ti-player-play";
      ($("dialBar") as HTMLElement).style.width = "0%";
      ($("dialDot") as HTMLElement).className = "ph-dot off";
      ($("dialLbl") as HTMLElement).textContent = "idle";
      ($("listenDot") as HTMLElement).className = "ph-dot off";
      ($("listenLbl") as HTMLElement).textContent = "idle";
      ($("timerBig") as HTMLElement).textContent = "0:00";
      dispBtns(false);
      setStatus("Dialer stopped.");
      clearLead();
      log("Dialer stopped.");
    }

    // ── DIALER (Phase 2: in-browser RingCentral WebPhone) ──
    // Each lead: the browser places a WebRTC call straight to the lead (caller ID =
    // business number) — no desktop app, no "press 1", you talk through this tab's
    // mic/speakers. We map the SDK's ringing/answered/ended events onto the existing
    // dial state machine. Lead no-answer in 22s → hang up + mark + auto-advance.
    // Connected → stay on the call (timer + dispositions), advance only once the rep
    // logs a disposition. Momentum engine (connect → GREEN) unchanged.

    // Lazily import (client-only / ESM) + provision-register the softphone once.
    async function ensureWebPhone() {
      const mod = await import("@/lib/sales-twin/webphone");
      if (!webphone) webphone = new mod.SalesTwinWebPhone();
      if (!webphone.isConnected) {
        if (!wpConnecting) wpConnecting = webphone.connect();
        try {
          await wpConnecting;
        } finally {
          wpConnecting = null;
        }
      }
      return webphone;
    }

    function hangupCall() {
      if (webphone) webphone.hangup().catch(() => {});
    }

    function startCallTimer() {
      callStart = Date.now();
      ($("timerBig") as HTMLElement).textContent = "0:00";
      ($("dialBar") as HTMLElement).style.width = "0%";
      clearInterval(callTimerInt);
      callTimerInt = setInterval(function () {
        const sec = Math.floor((Date.now() - callStart) / 1000);
        ($("timerBig") as HTMLElement).textContent = fmt(sec);
        ($("dialBar") as HTMLElement).style.width = Math.min((sec / 60) * 100, 100) + "%";
      }, 1000);
    }

    function dialNext() {
      if (!running) return;
      if (currentIdx >= allLeads.length) {
        setStatus("Queue complete — all leads worked.");
        log("Queue complete. " + totalDials + " worked, " + connects + " connects.");
        stopDialer();
        return;
      }
      const l = allLeads[currentIdx];

      allLeads.forEach(function (x) {
        const qi = $("qi-" + x.id);
        if (qi) qi.className = "q-item" + (x.id === l.id ? " active" : qi.classList.contains("done") ? " done" : "");
      });

      // Reset per-dial state.
      answeredThisDial = false;
      dialSettled = false;
      talkCounted = false;
      awaitingDisposition = false;
      lastCallSec = 0;
      leadRingStart = 0;
      clearInterval(pollInt);
      clearTimeout(noAnswerTO);

      showLead(l);
      dispBtns(false); // disabled until the call connects
      ($("dialDot") as HTMLElement).className = "ph-dot amber";
      ($("dialLbl") as HTMLElement).textContent = "calling";
      ($("listenDot") as HTMLElement).className = "ph-dot off";
      ($("listenLbl") as HTMLElement).textContent = "idle";
      ($("timerBig") as HTMLElement).textContent = "0:00";
      ($("dialBar") as HTMLElement).style.width = "0%";

      if (!l.phone) {
        settleNoAnswer(l, "no number");
        return;
      }

      setStatus("Calling " + l.name + "…");
      log("[Dialing] " + l.name + " (" + l.co + ")");

      // Place the browser WebPhone call and map its events onto the dial machine.
      (async function () {
        let wp: any;
        try {
          wp = await ensureWebPhone();
        } catch (e: any) {
          if (dialSettled) return;
          if (e && e.name === "VoipNotEnabledError") {
            log("[Dial error] RingCentral 'VoIP Calling' not enabled on the WebPhone app.");
            setStatus("RingCentral 'VoIP Calling' isn't enabled — can't place browser calls. Dialing stopped.");
            stopDialer();
            return;
          }
          log("[Dial error] " + (e?.message || "WebPhone connect failed"));
          settleNoAnswer(l, "dial failed");
          return;
        }
        if (dialSettled) return;

        // Handlers are read at event time by the SDK wrapper; set before calling.
        wp.callbacks = {
          onRinging: function () {
            if (dialSettled || answeredThisDial) return;
            ($("dialDot") as HTMLElement).className = "ph-dot amber";
            ($("dialLbl") as HTMLElement).textContent = "ringing lead";
            setStatus("Ringing " + l.name + "…");
            if (!leadRingStart) {
              leadRingStart = Date.now();
              clearTimeout(noAnswerTO);
              noAnswerTO = setTimeout(function () {
                if (dialSettled || answeredThisDial) return;
                hangupCall();
                settleNoAnswer(l, "no answer");
              }, 22000);
            }
          },
          onAnswered: function () {
            if (!answeredThisDial) onAnswered(l);
          },
          onEnded: function () {
            if (dialSettled) return;
            onCallEnded(l);
          },
        };

        try {
          await wp.call(l.phone);
        } catch (e: any) {
          if (dialSettled) return;
          log("[Dial error] " + (e?.message || "call failed"));
          settleNoAnswer(l, "dial failed");
        }
      })();
    }

    function onAnswered(l: any) {
      if (dialSettled) return;
      answeredThisDial = true;
      clearTimeout(noAnswerTO);
      ($("dialDot") as HTMLElement).className = "ph-dot green-dot";
      ($("dialLbl") as HTMLElement).textContent = "connected";
      ($("listenDot") as HTMLElement).className = "ph-dot green-dot";
      ($("listenLbl") as HTMLElement).textContent = "live";
      ($("callerAvatar") as HTMLElement).classList.add("live");
      startCallTimer();
      dispBtns(true);
      awaitingDisposition = true;
      setStatus(l.name + " answered — log a disposition when the call wraps.");
      log("[Connected] " + l.name + " — on the call.");
    }

    function onCallEnded(l: any) {
      if (dialSettled) return; // already advanced (e.g. disposition logged)
      clearInterval(callTimerInt);
      clearInterval(pollInt);
      ($("dialDot") as HTMLElement).className = "ph-dot off";
      ($("dialLbl") as HTMLElement).textContent = "idle";
      ($("listenDot") as HTMLElement).className = "ph-dot off";
      ($("listenLbl") as HTMLElement).textContent = "idle";
      ($("callerAvatar") as HTMLElement).classList.remove("live");

      if (answeredThisDial) {
        if (!talkCounted) {
          lastCallSec = Math.floor((Date.now() - callStart) / 1000);
          totalTalkSec += lastCallSec;
          talkCounted = true;
          updateGoals();
        }
        // Hold — wait for the rep to log a disposition before advancing.
        awaitingDisposition = true;
        dispBtns(true);
        setStatus("Call ended — log a disposition to continue.");
        log("[Call ended] " + l.name + " — awaiting disposition.");
      } else {
        // Ended before answer (busy / failed) → treat as no-answer + advance.
        settleNoAnswer(l, "no answer");
      }
    }

    // No-answer / could-not-connect: mark, count, auto-advance (no disposition click).
    function settleNoAnswer(l: any, reason: string) {
      if (dialSettled) return;
      dialSettled = true;
      clearTimeout(noAnswerTO);
      clearInterval(callTimerInt);
      clearInterval(pollInt);
      totalDials++;
      totalNA++;
      ($("dialDot") as HTMLElement).className = "ph-dot off";
      ($("dialLbl") as HTMLElement).textContent = "idle";
      ($("listenDot") as HTMLElement).className = "ph-dot off";
      ($("listenLbl") as HTMLElement).textContent = "idle";
      ($("callerAvatar") as HTMLElement).classList.remove("live");
      dispBtns(false);

      const qi = $("qi-" + l.id);
      if (qi) qi.className = "q-item done";
      const b = $("qbadge-" + l.id);
      if (b) { b.style.display = "inline-block"; b.textContent = "N/A"; b.className = "qi-badge badge-na"; }

      updateGoals();
      setStatus(l.name + " — " + reason + ". Next lead…");
      log("[" + reason + "] " + l.name + ".");

      currentIdx++;
      setTimeout(function () { if (running) dialNext(); }, 1200);
    }

    function logDisp(d: string) {
      const l = activeLead || allLeads[currentIdx];
      if (!l) return;
      if (dialSettled) return; // this dial already advanced (no-answer auto-advance)
      dialSettled = true;

      // End any live WebPhone call (its handlers are guarded by dialSettled above).
      hangupCall();
      clearTimeout(noAnswerTO);
      clearInterval(callTimerInt);
      clearInterval(pollInt);

      // Count talk time exactly once.
      if (answeredThisDial && !talkCounted) {
        lastCallSec = Math.floor((Date.now() - callStart) / 1000);
        totalTalkSec += lastCallSec;
        talkCounted = true;
      }

      ($("callerAvatar") as HTMLElement).classList.remove("live");
      ($("dialDot") as HTMLElement).className = "ph-dot off";
      ($("dialLbl") as HTMLElement).textContent = "idle";
      ($("listenDot") as HTMLElement).className = "ph-dot off";
      ($("listenLbl") as HTMLElement).textContent = "idle";
      awaitingDisposition = false;
      dispBtns(false);
      totalDials++;
      if (d === "no-answer") totalNA++;

      if (d === "connected") {
        connects++;
        connectTimes.push(new Date());
        connectNames.push({ name: l.name, talk: lastCallSec });
        // Module 2 — persist the connect to the momentum engine (Realtime fires).
        fetch("/api/sales-twin/momentum/event", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ eventType: "connect", leadId: l.external_id }),
        }).catch(() => {});
      }
      if (d === "connected" || d === "callback") addApprovalCard(l);

      const qi = $("qi-" + l.id);
      if (qi) qi.className = d === "connected" ? "q-item connected-item" : "q-item done";
      const b = $("qbadge-" + l.id);
      if (b) {
        b.style.display = "inline-block";
        if (d === "connected") { b.textContent = "CONN"; b.className = "qi-badge badge-conn"; }
        else if (d === "voicemail") { b.textContent = "VM"; b.className = "qi-badge badge-vm"; }
        else if (d === "no-answer") { b.textContent = "N/A"; b.className = "qi-badge badge-na"; }
      }

      log("[Disposition] " + l.name + ": " + d + ".");
      setStatus("Logged: " + d + ". Next lead…");
      updateGoals();

      if (connects >= 3 && !isGreen) {
        setTimeout(function () { triggerGreenModal(); }, 1500);
      }

      currentIdx++;
      setTimeout(function () { if (running) dialNext(); }, 800);
    }

    // ── SUGGESTIONS ──
    function showSug() {
      const s = suggestions[sugIdx % suggestions.length];
      ($("sugCard") as HTMLElement).style.display = "block";
      ($("sugText") as HTMLElement).textContent = s.text;
      ($("sugTag") as HTMLElement).textContent = s.tag;
    }
    function hideSug() {
      const el = $("sugCard");
      if (el) el.style.display = "none";
    }
    function nextSug() {
      sugIdx++;
      showSug();
    }
    function markUsed(btn: HTMLButtonElement) {
      btn.textContent = "used ✓";
      btn.disabled = true;
      setTimeout(nextSug, 700);
    }
    function tPQ(cb: HTMLInputElement) {
      const item = cb.closest(".pq-item")!;
      if (cb.checked) item.classList.add("done");
      else item.classList.remove("done");
    }

    // ── APPROVAL QUEUE CARDS ──
    function addApprovalCard(l: any) {
      const cont = $("slackCards");
      if (!cont) return;
      const id = "sc-" + l.id + "-" + Date.now();
      const card = document.createElement("div");
      card.className = "ap-card";
      card.id = id;
      card.dataset.draftIdx = "0";
      card.dataset.drafts = JSON.stringify(l.drafts);

      card.innerHTML =
        '<div class="ap-top">' +
        '<span class="ch-badge' + (isGreen ? " green" : "") + '">' + (isGreen ? "WARM" : "SMS") + "</span>" +
        '<span style="font-size:9px;color:var(--text3);font-family:var(--mono);">' + l.name + "</span>" +
        '<span class="ap-sub">post-call draft</span>' +
        "</div>" +
        '<div class="ap-body" id="body-' + id + '" contenteditable="false">' + l.drafts[0] + "</div>" +
        '<div class="ap-btns">' +
        "<button class=\"ap-btn send\" onclick=\"sendDraft('" + id + "','" + l.slack + "')\"><i class=\"ti ti-send\" style=\"font-size:10px;\" aria-hidden=\"true\"></i> Approve & send</button>" +
        "<button class=\"ap-btn remix\" onclick=\"remixDraft('" + id + "')\"><i class=\"ti ti-refresh\" style=\"font-size:10px;\" aria-hidden=\"true\"></i> Remix</button>" +
        "<button class=\"ap-btn\" onclick=\"editCard('body-" + id + "',this)\" style=\"flex:0 0 48px;\">edit</button>" +
        "<button class=\"ap-btn\" onclick=\"dismissCard('" + id + "')\" style=\"flex:0 0 44px;color:var(--text4);\">skip</button>" +
        "</div>";

      cont.insertBefore(card, cont.firstChild);
      pendingCards++;
      updateQueueBadge();
    }

    function remixDraft(cardId: string) {
      const card = $(cardId);
      if (!card) return;
      const drafts = JSON.parse(card.dataset.drafts!);
      const idx = (parseInt(card.dataset.draftIdx!) + 1) % drafts.length;
      card.dataset.draftIdx = String(idx);
      const body = card.querySelector(".ap-body") as HTMLElement;
      body.style.opacity = "0";
      body.style.transition = "opacity 0.2s";
      setTimeout(function () {
        body.textContent = drafts[idx];
        body.style.opacity = "1";
      }, 200);
    }

    function sendDraft(cardId: string, channel: string) {
      const card = $(cardId);
      if (!card) return;
      card.style.borderColor = "var(--green)";
      const btn = card.querySelector(".ap-btn.send") as HTMLButtonElement;
      btn.innerHTML = '<i class="ti ti-check" style="font-size:10px;" aria-hidden="true"></i> Sent to ' + channel;
      btn.disabled = true;
      log("[Twin] Draft sent to " + channel);
      setTimeout(function () {
        dismissCard(cardId);
      }, 1400);
    }

    function dismissCard(cardId: string) {
      const card = $(cardId);
      if (!card) return;
      card.style.opacity = "0";
      card.style.transition = "opacity 0.3s";
      setTimeout(function () {
        if (card.parentNode) card.parentNode.removeChild(card);
        pendingCards = Math.max(0, pendingCards - 1);
        updateQueueBadge();
      }, 300);
    }

    function editCard(bodyId: string, btn: HTMLButtonElement) {
      const el = $(bodyId);
      if (!el) return;
      if (el.contentEditable === "true") {
        el.contentEditable = "false";
        btn.textContent = "edit";
      } else {
        el.contentEditable = "true";
        el.focus();
        btn.textContent = "done";
        const r = document.createRange();
        r.selectNodeContents(el);
        const s = window.getSelection()!;
        s.removeAllRanges();
        s.addRange(r);
      }
    }

    function updateQueueBadge() {
      const badge = $("queueCountBadge");
      if (!badge) return;
      if (pendingCards > 0) {
        badge.style.display = "inline-block";
        badge.textContent = pendingCards + " pending";
      } else {
        badge.style.display = "none";
      }
    }

    // ── CRM NOTE ──
    function saveCRMNote() {
      const note = ($("crmTa") as HTMLTextAreaElement).value.trim();
      if (!note) {
        log("[CRM] No note to save.");
        return;
      }
      if (!activeLead) {
        log("[CRM] No active lead selected.");
        return;
      }
      ($("crmSaveSubtitle") as HTMLElement).textContent = "Saving to Zoho CRM — " + activeLead.name;
      ($("crmSavePreview") as HTMLElement).innerHTML =
        "<strong>[Sales Twin] Call note · Jordan Malik</strong><br><br>" + note +
        '<br><br><span style="font-size:9px;color:var(--text3);">Will appear under ' + activeLead.name + "'s activity in Zoho — Notes tab</span>";
      ($("crmSaveModal") as HTMLElement).classList.add("show");
    }

    function closeCRMSave() {
      ($("crmSaveModal") as HTMLElement).classList.remove("show");
    }

    function confirmCRMSave() {
      const note = ($("crmTa") as HTMLTextAreaElement).value.trim();
      const l = activeLead;
      ($("crmSaveModal") as HTMLElement).classList.remove("show");
      if (l) {
        const ts = "Just now · Call note (Jordan)";
        l.notes.unshift(ts + "·" + note);
        ($("noteCount") as HTMLElement).textContent = l.notes.length + " notes";
        // Write the note to Zoho (real API call, budget-guarded server-side).
        if (l.external_id) {
          fetch("/api/sales-twin/zoho/note", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ leadExternalId: l.external_id, noteBody: note, repName: "Jordan Malik", disposition: "logged" }),
          })
            .then((r) => r.json())
            .then((res) => log(res.ok ? "[Zoho CRM] Note synced for " + l.name : "[Zoho CRM] Save failed: " + (res.error || "unknown")))
            .catch(() => log("[Zoho CRM] Save failed (network)"));
        }
      }
      const btn = $("crmSaveBtn") as HTMLElement;
      btn.className = "crm-save-btn saved";
      btn.innerHTML = '<i class="ti ti-check" style="font-size:11px;" aria-hidden="true"></i> Saved to Zoho';
      log("[Zoho CRM] Note saved for " + (l ? l.name : "lead") + " — syncing...");
      setStatus("Note saved to Zoho CRM for " + (l ? l.name : "lead"));
    }

    function resetSaveBtn() {
      const btn = $("crmSaveBtn") as HTMLElement;
      if (!btn) return;
      btn.className = "crm-save-btn";
      btn.innerHTML = '<i class="ti ti-cloud-upload" style="font-size:11px;" aria-hidden="true"></i> Save to Zoho';
    }

    // ── CRM NOTES POPUP ──
    function openCRMNotes() {
      if (!activeLead) return;
      const l = activeLead;
      ($("cnmTitle") as HTMLElement).textContent = "CRM Notes — " + l.name;
      let html = "";
      l.notes.forEach(function (n: string) {
        const parts = n.split("·");
        html += '<div class="cnm-entry"><div class="cnm-ts">' + parts[0] + '</div><div class="cnm-text">' + parts.slice(1).join("·") + "</div></div>";
      });
      ($("cnmBody") as HTMLElement).innerHTML = html;
      ($("crmNotesModal") as HTMLElement).classList.add("show");
    }
    function closeCRMNotes() {
      ($("crmNotesModal") as HTMLElement).classList.remove("show");
    }

    // ── GREEN MODAL ──
    function triggerGreenModal() {
      if (isGreen) return;
      let html = "";
      connectNames.slice(-3).forEach(function (c) {
        html += '<div class="gm-conn"><div class="gm-conn-name">' + c.name.split(" ")[0] + '</div><div class="gm-conn-talk">' + fmt(c.talk) + " talk</div></div>";
      });
      ($("gmConnects") as HTMLElement).innerHTML = html;
      ($("greenModal") as HTMLElement).classList.add("show");
    }

    async function goGreen() {
      ($("greenModal") as HTMLElement).classList.remove("show");
      log("[GREEN] Loading warm leads (Meta Ads / BusinessFunding) from Zoho…");
      setStatus("GREEN MODE — loading warm leads…");
      try {
        const res = await fetch("/api/sales-twin/leads?queue=green");
        const data = await res.json();
        greenLeads = (data.leads || []).map(rowToLead);
      } catch {
        /* keep whatever we have */
      }
      isGreen = true;
      applyState();
      allLeads = greenLeads;
      currentIdx = 0;
      connects = 0;
      buildQueue();
      updateGoals();
      clearLead();
      setStatus("GREEN MODE — " + greenLeads.length + " warm leads loaded.");
      log("[GREEN] " + greenLeads.length + " warm leads loaded from Zoho.");
    }

    function stayRed() {
      ($("greenModal") as HTMLElement).classList.remove("show");
      log("[RED] Staying on cold dial queue.");
      setStatus("Staying red — continuing no-contact dials.");
    }

    // Expose handlers for inline onclick (innerHTML cards) + JSX onClick.
    Object.assign(w, {
      toggleDialer, logDisp, markUsed, nextSug, hideSug, tPQ,
      saveCRMNote, closeCRMSave, confirmCRMSave, openCRMNotes, closeCRMNotes,
      goGreen, stayRed, sendDraft, remixDraft, dismissCard, editCard,
    });

    // ── DATA REHYDRATION ──
    function rowToLead(row: any, idx: number) {
      const m = row.metadata || {};
      return {
        id: idx,
        external_id: row.external_id,
        phone: row.phone || m.phone || null,
        initials: m.initials || "??",
        name: row.name || m.name || "Unknown",
        co: m.co || [row.company, row.phone].filter(Boolean).join(" · "),
        fund: m.fund || "—",
        rev: m.rev || "—",
        biz: m.biz || "—",
        score: m.score || "—",
        touch: m.touch || "—",
        stage: row.stage || m.stage || "No Contact",
        sum: m.sum || "<strong>" + (row.stage || "Lead") + ".</strong> No summary yet.",
        notes: m.notes || [],
        slack: m.slack || "#lead",
        drafts: m.drafts || ["Following up — do you have a few minutes?"],
        outcome: m.outcome || "connect",
        talkSec: m.talkSec || 120,
        taskDue: m.taskDue,
        attempts: m.attempts,
      };
    }

    // ── INIT (fetch leads + momentum, subscribe to Realtime) ──
    let channel: any = null;
    (async function init() {
      applyState();
      updateGoals();
      buildQueue();

      // 1) Red (no-contact DB 1.0) leads
      try {
        const res = await fetch("/api/sales-twin/leads?queue=red");
        const data = await res.json();
        const rows = data.leads || [];
        redLeads = rows.map(rowToLead);
        allLeads = isGreen ? greenLeads : redLeads;
        buildQueue();
        const meta = data.meta || {};
        setBanner(
          `Zoho: ${rows.length} no-contact · ${meta.apiCallsToday ?? 0}/${meta.dailyBudget ?? 80} API calls today · ${meta.fromCache ? "cached" : "live"}`
        );
      } catch {
        setBanner("Zoho: offline — using cached leads");
      }

      // 2) Momentum state
      try {
        const res = await fetch("/api/sales-twin/momentum/state");
        const data = await res.json();
        if (data.state?.current_state === "GREEN" && !isGreen) {
          isGreen = true;
          allLeads = greenLeads;
          applyState();
          buildQueue();
        }
      } catch {
        /* ignore */
      }

      // 3) Realtime — flip to green live when the momentum engine transitions.
      channel = supabase
        .channel("st_momentum_state_kiosk")
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: "st_momentum_state" },
          (payload: any) => {
            const next = (payload.new || {}).current_state;
            if (next === "GREEN" && !isGreen) {
              triggerGreenModal();
            } else if (next === "RED" && isGreen) {
              isGreen = false;
              allLeads = redLeads;
              applyState();
              buildQueue();
              log("[RED] Momentum window expired — back to cold dialing.");
            }
          }
        )
        .subscribe();
    })();

    return () => {
      clearInterval(clockInt);
      clearInterval(dialInt);
      clearInterval(callInt);
      clearInterval(barInt);
      clearInterval(callTimerInt);
      clearInterval(pollInt);
      clearTimeout(noAnswerTO);
      if (webphone) webphone.dispose().catch(() => {});
      if (channel) supabase.removeChannel(channel);
    };
  }, []);

  return (
    <div className="shell" id="shell">
      {/* TOPBAR */}
      <div className="topbar">
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <div>
            <span className="logo" id="logo">SALES TWIN</span>
            <span className="logo-sub">red panther · module 1</span>
          </div>
          <div className="state-pill" id="statePill">
            <div className="pulse-dot" id="pillDot"></div>
            <span id="pillLabel">RED · AUTO-DIAL</span>
          </div>
          <div className="rep-wrap">
            <div className="rep-avatar" id="repAvatar">JM</div>
            <span className="rep-name">Jordan Malik</span>
          </div>
        </div>
        <div className="topbar-stats">
          <span className="stat">Dials&nbsp;<span id="tDials">0</span></span>
          <span className="stat">Connects&nbsp;<span id="tConnects">0</span>/3</span>
          <span className="stat">Talk&nbsp;<span id="tTalk">0m</span></span>
          <span className="stat">No ans&nbsp;<span id="tNA">0</span></span>
          <span className="stat" id="zohoBanner">{banner}</span>
        </div>
        <span className="clock-el" id="clkEl">--:--</span>
      </div>

      <div className="main">
        {/* LEFT: COACH */}
        <div className="panel">
          <div className="ph">
            <div className="ph-dot off" id="listenDot"></div>
            <span id="listenLbl">listening</span>
          </div>
          <div className="coach-scroll">
            <div className="tc-card">
              <div className="tc-label">live transcript</div>
              <div id="transcriptLines"><div className="tc-empty">Waiting for call...</div></div>
            </div>

            <div className="sug-card" id="sugCard">
              <div className="sug-lbl">
                <i className="ti ti-sparkles" style={{ fontSize: 11 }} aria-hidden="true"></i>
                what to say
                <span className="sug-tag" id="sugTag">objection</span>
              </div>
              <div className="sug-text" id="sugText"></div>
              <div className="sug-btns">
                <button className="sug-btn" onClick={(e) => (window as any).markUsed(e.currentTarget)}><i className="ti ti-check" style={{ fontSize: 10 }} aria-hidden="true"></i> used</button>
                <button className="sug-btn" onClick={() => (window as any).nextSug()}>next <i className="ti ti-arrow-right" style={{ fontSize: 10 }} aria-hidden="true"></i></button>
                <button className="sug-btn" onClick={() => (window as any).hideSug()}>clear</button>
              </div>
            </div>

            <div className="preq-card">
              <div className="tc-label">prequalification</div>
              <div className="pq-grid" id="pqGrid">
                <label className="pq-item"><input type="checkbox" onChange={(e) => (window as any).tPQ(e.currentTarget)} /> Use of funds</label>
                <label className="pq-item"><input type="checkbox" onChange={(e) => (window as any).tPQ(e.currentTarget)} /> Amount</label>
                <label className="pq-item"><input type="checkbox" onChange={(e) => (window as any).tPQ(e.currentTarget)} /> Monthly rev</label>
                <label className="pq-item"><input type="checkbox" onChange={(e) => (window as any).tPQ(e.currentTarget)} /> Time in biz</label>
                <label className="pq-item"><input type="checkbox" onChange={(e) => (window as any).tPQ(e.currentTarget)} /> Credit</label>
                <label className="pq-item"><input type="checkbox" onChange={(e) => (window as any).tPQ(e.currentTarget)} /> Timeline</label>
              </div>
            </div>

            <div className="notes-side-card">
              <div className="nsc-hdr">
                <span className="nsc-lbl">merchant notes</span>
                <button className="nsc-clear" onClick={() => { const el = document.getElementById("sideTa") as HTMLTextAreaElement | null; if (el) el.value = ""; }}>clear</button>
              </div>
              <textarea className="nsc-ta" id="sideTa" rows={3} placeholder="Notes during call..."></textarea>
            </div>
          </div>
        </div>

        {/* CENTER */}
        <div className="center-panel">
          <div className="call-hero">
            <div className="ch-top">
              <div className="caller-wrap">
                <div className="avatar" id="callerAvatar">—</div>
                <div>
                  <div className="cn-name" id="callerName">Ready to dial</div>
                  <div className="cn-sub" id="callerSub">Press Start Auto-Dial</div>
                </div>
              </div>
              <div className="timer-big" id="timerBig">0:00</div>
            </div>
            <div className="dial-bar-wrap"><div className="dial-bar" id="dialBar"></div></div>
            <div className="disp-row" id="dispRow">
              <span className="disp-row-lbl">Disposition</span>
              <button className="dr-btn connected" id="dConnected" onClick={() => (window as any).logDisp("connected")} disabled>
                <i className="ti ti-phone-check" style={{ fontSize: 11 }} aria-hidden="true"></i> Connected
              </button>
              <button className="dr-btn noans" id="dNA" onClick={() => (window as any).logDisp("no-answer")} disabled>No answer</button>
              <button className="dr-btn" id="dCB" onClick={() => (window as any).logDisp("callback")} disabled>Callback</button>
              <button className="dr-btn" id="dNI" onClick={() => (window as any).logDisp("not-interested")} disabled>Not interested</button>
              <button className="dr-btn" id="dBN" onClick={() => (window as any).logDisp("bad-number")} disabled>Bad number</button>
              <button className="dr-btn vm" id="dVM" onClick={() => (window as any).logDisp("voicemail")} disabled>
                <i className="ti ti-voicemail" style={{ fontSize: 11 }} aria-hidden="true"></i> Voicemail — skip
              </button>
            </div>
          </div>

          <div className="status-strip">
            <div className="ss-dot" id="ssDot"></div>
            <span id="ssText">idle — press Start Auto-Dial</span>
          </div>

          <div className="ai-sum" onClick={() => (window as any).openCRMNotes()}>
            <div className="ai-sum-hdr">
              <span className="ai-sum-lbl">
                <i className="ti ti-sparkles" style={{ fontSize: 10 }} aria-hidden="true"></i>
                AI SUMMARY · CLICK FOR ALL CRM NOTES
              </span>
              <span id="noteCount" style={{ fontSize: 9, color: "var(--text4)", fontFamily: "var(--mono)" }}>0 notes</span>
            </div>
            <div className="ai-sum-text" id="aiSumText">No active lead.</div>
          </div>

          <div className="fields-row">
            <div className="fld"><div className="fld-l">Funding ask</div><div className="fld-v" id="fFund">—</div></div>
            <div className="fld"><div className="fld-l">Monthly rev</div><div className="fld-v" id="fRev">—</div></div>
            <div className="fld"><div className="fld-l">Stage</div><div className="fld-v" id="fStage">—</div></div>
            <div className="fld" style={{ borderTop: "1px solid var(--border)" }}><div className="fld-l">Time in biz</div><div className="fld-v" id="fBiz">—</div></div>
            <div className="fld" style={{ borderTop: "1px solid var(--border)" }}><div className="fld-l">Score</div><div className="fld-v" id="fScore">—</div></div>
            <div className="fld" style={{ borderTop: "1px solid var(--border)" }}><div className="fld-l">Last touch</div><div className="fld-v" id="fTouch">—</div></div>
          </div>

          <div className="center-body">
            <div className="slack-area">
              <div className="slack-hdr">
                <i className="ti ti-message-2" style={{ fontSize: 12, color: "var(--purple)" }} aria-hidden="true"></i>
                SLACK SMS DRAFTS · APPROVAL QUEUE
                <span id="queueCountBadge" style={{ marginLeft: "auto", background: "var(--red-darker)", color: "var(--red)", padding: "1px 6px", borderRadius: 2, fontSize: 7, display: "none" }}>0 pending</span>
              </div>
              <div id="slackCards"></div>
            </div>

            {/* CRM NOTE */}
            <div className="crm-note-section" id="crmNoteSection">
              <div className="crm-note-hdr">
                <span className="crm-note-lbl">
                  <i className="ti ti-notebook" style={{ fontSize: 11 }} aria-hidden="true"></i>
                  CALL NOTE
                  <span className="zoho-badge">→ ZOHO CRM</span>
                </span>
                <span style={{ fontSize: 9, color: "var(--text4)", fontFamily: "var(--mono)" }} id="crmLeadRef">no lead selected</span>
              </div>
              <div className="crm-note-wrap">
                <textarea className="crm-ta" id="crmTa" rows={3} placeholder="Type your call note here — this will be saved directly to Zoho CRM under this lead..."></textarea>
                <div className="crm-note-footer">
                  <span className="crm-note-meta" id="crmNoteMeta">Will save as: [Sales Twin] Call note · Jordan Malik</span>
                  <button className="crm-save-btn" id="crmSaveBtn" onClick={() => (window as any).saveCRMNote()}>
                    <i className="ti ti-cloud-upload" style={{ fontSize: 11 }} aria-hidden="true"></i> Save to Zoho
                  </button>
                </div>
              </div>
            </div>
          </div>

          <div className="log-strip" id="logStrip">System ready — Zoho connected.</div>
        </div>

        {/* RIGHT: DIALER */}
        <div className="panel panel-right">
          <div className="ph">
            <div className="ph-dot off" id="dialDot"></div>
            <span id="dialLbl">idle</span>
          </div>

          <div className="momentum-blk">
            <div className="big-dot-wrap">
              <div className="big-dot" id="bigDot"></div>
            </div>
            <div className="mode-lbl" id="modeLbl">RED MODE</div>
            <div className="mode-sub" id="modeSub">no contact · auto-hang 22s</div>
            <div className="connects-bar">
              <div className="cb-lbl">
                <span>connects to green</span>
                <span id="connProg">0 / 3</span>
              </div>
              <div className="cb-track"><div className="cb-fill" id="connFill" style={{ width: "0%" }}></div></div>
            </div>
          </div>

          <div className="goals-blk">
            <div className="g-row">
              <div className="g-meta"><span className="g-name">Dials</span><span className="g-val" id="gDials">0/30</span></div>
              <div className="g-bar"><div className="g-fill" id="gDialF" style={{ width: "0%" }}></div></div>
            </div>
            <div className="g-row">
              <div className="g-meta"><span className="g-name">Connects</span><span className="g-val" id="gConns">0</span></div>
              <div className="g-bar"><div className="g-fill" id="gConnF" style={{ width: "0%" }}></div></div>
            </div>
            <div className="g-row" style={{ marginBottom: 0 }}>
              <div className="g-meta"><span className="g-name">Talk time</span><span className="g-val" id="gTalk">0m</span></div>
              <div className="g-bar"><div className="g-fill" id="gTalkF" style={{ width: "0%" }}></div></div>
            </div>
          </div>

          <div className="auto-btn-wrap">
            <button className="auto-btn" id="autoBtn" onClick={() => (window as any).toggleDialer()}>
              <i className="ti ti-player-play" style={{ fontSize: 14 }} aria-hidden="true" id="autoBtnIcon"></i>
              <span id="autoBtnLbl">Start Auto-Dial</span>
            </button>
          </div>

          <div className="queue-blk">
            <div className="q-lbl">
              <span id="qTitle">queue</span>
              <span style={{ color: "var(--text4)", fontFamily: "var(--mono)", fontSize: 8 }} id="qCount">0 leads</span>
            </div>
            <div id="queueList"></div>
          </div>
        </div>
      </div>

      {/* GREEN MODAL */}
      <div className="modal-bg" id="greenModal">
        <div className="green-modal">
          <div className="gm-icon"><i className="ti ti-trending-up" aria-hidden="true"></i></div>
          <div className="gm-title">FLOOR IS HOT — 3 CONNECTS</div>
          <div className="gm-sub">3 connects in under 5 minutes. Momentum is real.<br />Zoho follow-up queue is ready.</div>
          <div className="gm-connects" id="gmConnects"></div>
          <div className="gm-question">Stop cold calling and switch to<br />follow-up on your working files?</div>
          <div className="gm-zoho-note">
            <i className="ti ti-database" style={{ fontSize: 10, marginRight: 4 }} aria-hidden="true"></i>
            Zoho will load your follow-up queue sorted by task due date — overdue first
          </div>
          <div className="gm-btns">
            <button className="gm-btn yes" onClick={() => (window as any).goGreen()}>
              <i className="ti ti-check" style={{ fontSize: 13, marginRight: 4 }} aria-hidden="true"></i>Yes — switch to follow-ups
            </button>
            <button className="gm-btn no" onClick={() => (window as any).stayRed()}>No — keep cold dialing</button>
          </div>
        </div>
      </div>

      {/* CRM SAVE MODAL */}
      <div className="modal-bg" id="crmSaveModal">
        <div className="crm-modal">
          <div className="crm-modal-title">
            <i className="ti ti-cloud-check" style={{ fontSize: 16 }} aria-hidden="true"></i> Save to Zoho CRM
          </div>
          <div className="crm-modal-sub" id="crmSaveSubtitle">Saving note for — lead name</div>
          <div className="crm-modal-note" id="crmSavePreview"></div>
          <div className="crm-modal-btns">
            <button className="crm-modal-btn" onClick={() => (window as any).closeCRMSave()}>Cancel</button>
            <button className="crm-modal-btn confirm" onClick={() => (window as any).confirmCRMSave()}>
              <i className="ti ti-check" style={{ fontSize: 11 }} aria-hidden="true"></i> Confirm save
            </button>
          </div>
        </div>
      </div>

      {/* CRM NOTES POPUP */}
      <div className="modal-bg" id="crmNotesModal">
        <div className="crm-notes-modal">
          <div className="cnm-hdr">
            <span className="cnm-title" id="cnmTitle">CRM Notes</span>
            <button className="cnm-close" onClick={() => (window as any).closeCRMNotes()}><i className="ti ti-x" aria-hidden="true"></i></button>
          </div>
          <div className="cnm-body" id="cnmBody"></div>
        </div>
      </div>
    </div>
  );
}
