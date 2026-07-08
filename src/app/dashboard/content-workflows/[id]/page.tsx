"use client";

// Full-page workflow editor — the "open the card" view of the Content Studio board.
// Everything the workflow IS lives here and is editable: profile (description + visual
// rules), image settings (provider/aspect/quality), per-shot prompts, the labeled copy
// structure with timings, galleries (references / approved variations / shots), and the
// structure map (mermaid.ink). The board observes; Slack runs; this page systemizes.

import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { ArrowLeft, Play, RefreshCw, Save, Copy, Plus, Trash2 } from "lucide-react";

interface Scene {
  role: string;
  image_prompt: string;
  animation_prompt: string;
  animation_preset?: string;
  animation_examples?: string[];
  duration_seconds?: number;
  image_url?: string | null;
  image_approved?: boolean;
}

const ANIMATION_PRESET_KEYS = [
  "static_hold",
  "slow_push_in",
  "slow_pull_out",
  "handheld_walk",
  "whip_pan",
  "tilt_reveal",
];

interface CopyRole {
  key: string;
  label: string;
  guidance: string;
  shot?: number;
  at_second?: number;
  out_second?: number;
  position?: string;
}

interface RenderSpec {
  mode: string;
  duration_seconds: number;
  shots: Array<{ i: number; start: number; end: number }>;
  texts: Array<{ n?: number; text: string; at_second: number; out_second?: number; position?: string; role?: string }>;
}

interface ApprovedVariation {
  label: string;
  structured_copy?: Array<{ key: string; text: string }>;
  song_ref?: string | null;
  image_urls?: string[];
  approved_at?: string;
}

interface WorkflowDetail {
  id: string;
  vertical_id: string;
  name: string;
  category: string;
  subcategory: string | null;
  status: string;
  configured: boolean;
  song: string;
  song_ref: string | null;
  description: string | null;
  visual_rules: string[];
  scenes: Scene[];
  render_options: { provider?: string; aspect?: string; quality?: string; max_shots?: number };
  copy_structure: CopyRole[];
  render_spec: RenderSpec | null;
  shot_screenshots: Array<{ role: string; url: string }>;
  reference_media: Array<{ kind: string; url: string; added_at?: string }>;
  approved_variations: ApprovedVariation[];
  production_status: string;
  style_dna: string | null;
  caption_template: string | null;
  beat_grid: { bpm: number | null; beats: number[]; duration: number | null } | null;
  scene_refs: Record<string, string[]>;
  detail_mermaid: string | null;
  video_description: string | null;
  render_prompt: string | null;
}

const inputCls =
  "w-full bg-[rgba(255,255,255,0.05)] border border-[rgba(255,255,255,0.1)] rounded-md px-3 py-2 text-sm text-white focus:outline-none focus:border-[#00C9A7]";
const labelCls = "text-xs text-[rgba(255,255,255,0.5)] uppercase tracking-wide block mb-1";
const sectionCls = "rounded-xl border border-[rgba(255,255,255,0.08)] bg-[#0F1A2E] p-5";

function mermaidInkUrl(mermaid: string): string {
  // unicode-safe base64url for mermaid.ink (same encoding workflow-map.ts uses server-side)
  const b64 = btoa(unescape(encodeURIComponent(mermaid))).replace(/\+/g, "-").replace(/\//g, "_");
  return `https://mermaid.ink/img/${b64}?type=png&bgColor=1a1a2a`;
}

function gateBadge(w: WorkflowDetail) {
  if (w.production_status === "live")
    return <span className="text-xs font-bold px-2.5 py-1 rounded-full bg-[#00C9A7]/25 text-[#00C9A7]">★ LIVE</span>;
  if (w.production_status === "in_production")
    return (
      <span className="text-xs font-semibold px-2.5 py-1 rounded-full bg-blue-500/15 text-blue-300">
        onboarding {w.approved_variations.length}/4
      </span>
    );
  return (
    <span className="text-xs px-2.5 py-1 rounded-full bg-white/5 text-white/50">
      building · refs {w.reference_media.length}/3
    </span>
  );
}

export default function WorkflowEditorPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const id = decodeURIComponent(params.id);

  const [wf, setWf] = useState<WorkflowDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [launching, setLaunching] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [copied, setCopied] = useState(false);

  // editable form state
  const [name, setName] = useState("");
  const [status, setStatus] = useState("draft");
  const [description, setDescription] = useState("");
  const [visualRules, setVisualRules] = useState<string[]>([]);
  const [songRef, setSongRef] = useState("");
  const [provider, setProvider] = useState("");
  const [aspect, setAspect] = useState("");
  const [quality, setQuality] = useState("");
  const [scenes, setScenes] = useState<Scene[]>([]);
  const [copyStructure, setCopyStructure] = useState<CopyRole[]>([]);
  const [styleDna, setStyleDna] = useState("");
  const [captionTemplate, setCaptionTemplate] = useState("");
  const [rendering, setRendering] = useState(false);
  const [testVideoUrl, setTestVideoUrl] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/content-workflows/${encodeURIComponent(id)}`);
      if (!res.ok) throw new Error(`load failed (${res.status})`);
      const data = (await res.json()) as WorkflowDetail;
      setWf(data);
      setName(data.name);
      setStatus(data.status);
      setDescription(data.description ?? "");
      setVisualRules(data.visual_rules ?? []);
      setSongRef(data.song_ref ?? "");
      setProvider(data.render_options?.provider ?? "");
      setAspect(data.render_options?.aspect ?? "");
      setQuality(data.render_options?.quality ?? "");
      setScenes(data.scenes ?? []);
      setCopyStructure(data.copy_structure ?? []);
      setStyleDna(data.style_dna ?? "");
      setCaptionTemplate(data.caption_template ?? "");
    } catch {
      setNotice("Could not load this workflow.");
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  const buildPatch = useCallback(() => {
    if (!wf) return {};
    const patch: Record<string, unknown> = {};
    if (name !== wf.name) patch.name = name;
    if (status !== wf.status) patch.status = status;
    if (description !== (wf.description ?? "")) patch.description = description;
    if (JSON.stringify(visualRules) !== JSON.stringify(wf.visual_rules ?? [])) patch.visual_rules = visualRules;
    if (songRef !== (wf.song_ref ?? "")) patch.song_ref = songRef;
    const ro: Record<string, string> = {};
    if (provider !== (wf.render_options?.provider ?? "")) ro.provider = provider;
    if (aspect !== (wf.render_options?.aspect ?? "")) ro.aspect = aspect;
    if (quality !== (wf.render_options?.quality ?? "")) ro.quality = quality;
    if (Object.keys(ro).length) patch.render_options = ro;
    if (JSON.stringify(scenes) !== JSON.stringify(wf.scenes ?? [])) patch.scenes = scenes;
    if (JSON.stringify(copyStructure) !== JSON.stringify(wf.copy_structure ?? [])) patch.copy_structure = copyStructure;
    if (styleDna !== (wf.style_dna ?? "")) patch.style_dna = styleDna;
    if (captionTemplate !== (wf.caption_template ?? "")) patch.caption_template = captionTemplate;
    return patch;
  }, [wf, name, status, description, visualRules, songRef, provider, aspect, quality, scenes, copyStructure, styleDna, captionTemplate]);

  const dirty = useMemo(() => Object.keys(buildPatch()).length > 0, [buildPatch]);

  const save = useCallback(
    async (rebake: boolean) => {
      const patch = buildPatch();
      if (!Object.keys(patch).length && !rebake) return;
      setSaving(true);
      setNotice(null);
      setWarnings([]);
      try {
        const res = await fetch(`/api/content-workflows/${encodeURIComponent(id)}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(rebake ? { ...patch, rebake_spec: true } : patch),
        });
        const data = await res.json();
        if (!res.ok) {
          setNotice(data.error ?? "Save failed.");
          return;
        }
        setWarnings(data.warnings ?? []);
        setNotice(rebake ? "Saved + timeline rebaked." : "Saved.");
        await load();
      } catch {
        setNotice("Save failed.");
      } finally {
        setSaving(false);
        setTimeout(() => setNotice(null), 4000);
      }
    },
    [buildPatch, id, load]
  );

  const launch = useCallback(async () => {
    setLaunching(true);
    try {
      const res = await fetch(`/api/content-workflows/${encodeURIComponent(id)}/launch`, { method: "POST" });
      const data = await res.json();
      setNotice(res.ok ? "Launched in Slack (#content-full)." : (data.error ?? "Launch failed."));
    } catch {
      setNotice("Launch failed.");
    } finally {
      setLaunching(false);
      setTimeout(() => setNotice(null), 4000);
    }
  }, [id]);

  const testRender = useCallback(async () => {
    setRendering(true);
    setTestVideoUrl(null);
    setNotice(null);
    try {
      const res = await fetch(`/api/content-workflows/${encodeURIComponent(id)}/test-render`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) {
        setNotice(data.problems?.length ? `${data.error}: ${data.problems.join("; ")}` : (data.error ?? "Render failed."));
        return;
      }
      setTestVideoUrl(data.url as string);
      setNotice(`Test render done (${Number(data.duration).toFixed(1)}s).`);
    } catch {
      setNotice("Render failed.");
    } finally {
      setRendering(false);
      setTimeout(() => setNotice(null), 6000);
    }
  }, [id]);

  const copyPrompt = useCallback(async () => {
    if (!wf?.render_prompt) return;
    await navigator.clipboard.writeText(wf.render_prompt);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [wf]);

  if (loading) return <div className="p-6 text-white/40 text-sm">Loading workflow…</div>;
  if (!wf) return <div className="p-6 text-white/40 text-sm">Workflow not found.</div>;

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-5">
      {/* header */}
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-start gap-3 min-w-0">
          <button
            onClick={() => router.push("/dashboard/content-workflows")}
            className="mt-1 rounded-lg bg-white/5 hover:bg-white/10 text-white/70 p-2"
            title="Back to the board"
          >
            <ArrowLeft size={16} />
          </button>
          <div className="min-w-0">
            <p className="text-[11px] uppercase tracking-widest text-white/40">
              {wf.vertical_id.replace(/_/g, " ")} · {wf.category}
              {wf.subcategory ? ` · ${wf.subcategory}` : ""}
            </p>
            <input value={name} onChange={(e) => setName(e.target.value)} className={`${inputCls} mt-1 text-lg font-semibold`} />
            <div className="flex items-center gap-2 mt-2">
              {gateBadge(wf)}
              <select value={status} onChange={(e) => setStatus(e.target.value)} className={`${inputCls} !w-auto !py-1`}>
                <option value="draft">draft</option>
                <option value="active">active</option>
                <option value="archived">archived</option>
              </select>
              <span className="text-xs text-white/40">♪ {wf.song}</span>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={launch}
            disabled={launching || !wf.configured}
            className="flex items-center gap-2 rounded-lg bg-emerald-500/90 hover:bg-emerald-500 disabled:opacity-40 text-[#0B1426] text-sm font-semibold px-3 py-2"
          >
            <Play size={15} /> Run in Slack
          </button>
          <button
            onClick={() => save(false)}
            disabled={saving || !dirty}
            className="flex items-center gap-2 rounded-lg bg-[#00C9A7] hover:opacity-90 disabled:opacity-40 text-[#0B1426] text-sm font-semibold px-3 py-2"
          >
            <Save size={15} /> {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </div>

      {notice && <p className="text-sm text-[#00C9A7]">{notice}</p>}
      {warnings.length > 0 && (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-300 space-y-1">
          {warnings.map((w, i) => (
            <p key={i}>• {w}</p>
          ))}
        </div>
      )}

      {/* profile */}
      <div className={sectionCls}>
        <h2 className="text-sm font-semibold text-white mb-3">Consistency profile</h2>
        <label className={labelCls}>Description (what this workflow is, one line)</label>
        <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} className={`${inputCls} resize-none`} />
        <label className={`${labelCls} mt-4`}>
          Style DNA (prepended to EVERY scene prompt; scene prompts describe only the action)
        </label>
        <textarea
          value={styleDna}
          onChange={(e) => setStyleDna(e.target.value)}
          rows={3}
          placeholder="POV GoPro chest mount, pest control tech, daytime residential exterior, natural harsh sunlight, slight fisheye, gloved hands visible..."
          className={`${inputCls} resize-none`}
        />
        <label className={`${labelCls} mt-4`}>Caption template (optional; the caption stage fills it when set)</label>
        <textarea
          value={captionTemplate}
          onChange={(e) => setCaptionTemplate(e.target.value)}
          rows={2}
          placeholder="Leave empty for a fully generated caption."
          className={`${inputCls} resize-none`}
        />
        {wf.beat_grid && (
          <p className="text-xs text-white/40 mt-3">
            Beat grid on file: {wf.beat_grid.bpm ? `${Math.round(wf.beat_grid.bpm)} BPM` : "unknown BPM"} ·{" "}
            {wf.beat_grid.beats.length} beats · {wf.beat_grid.duration ? `${wf.beat_grid.duration.toFixed(1)}s` : "?"} (used by
            `sync auto` in Slack)
          </p>
        )}
        <label className={`${labelCls} mt-4`}>Visual rules (every image prompt must honor these)</label>
        <div className="space-y-2">
          {visualRules.map((r, i) => (
            <div key={i} className="flex gap-2">
              <input
                value={r}
                onChange={(e) => setVisualRules(visualRules.map((x, j) => (j === i ? e.target.value : x)))}
                className={inputCls}
              />
              <button
                onClick={() => setVisualRules(visualRules.filter((_, j) => j !== i))}
                className="text-white/40 hover:text-red-400 px-1"
                title="Remove rule"
              >
                <Trash2 size={14} />
              </button>
            </div>
          ))}
          <button
            onClick={() => setVisualRules([...visualRules, ""])}
            className="flex items-center gap-1.5 text-xs text-white/50 hover:text-white px-2 py-1 rounded bg-white/5"
          >
            <Plus size={12} /> Add rule
          </button>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-4">
          <div>
            <label className={labelCls}>Image model</label>
            <select value={provider} onChange={(e) => setProvider(e.target.value)} className={inputCls}>
              <option value="">default (gpt-image-2, OpenAI direct)</option>
              <option value="openai">openai (gpt-image-2 direct)</option>
              <option value="higgsfield-gpt">higgsfield-gpt (GPT image via Higgsfield)</option>
              <option value="higgsfield">higgsfield (Soul)</option>
            </select>
          </div>
          <div>
            <label className={labelCls}>Aspect</label>
            <select value={aspect} onChange={(e) => setAspect(e.target.value)} className={inputCls}>
              <option value="">default</option>
              <option value="3:4">3:4 (POV / Meta glasses)</option>
              <option value="9:16">9:16 (reel)</option>
            </select>
          </div>
          <div>
            <label className={labelCls}>Quality</label>
            <select value={quality} onChange={(e) => setQuality(e.target.value)} className={inputCls}>
              <option value="">default (high)</option>
              <option value="low">low</option>
              <option value="medium">medium</option>
              <option value="high">high</option>
            </select>
          </div>
          <div>
            <label className={labelCls}>Song (key or URL)</label>
            <input value={songRef} onChange={(e) => setSongRef(e.target.value)} placeholder="song_master" className={inputCls} />
          </div>
        </div>
      </div>

      {/* shots */}
      {scenes.length > 0 && (
        <div className={sectionCls}>
          <h2 className="text-sm font-semibold text-white mb-3">Shots ({scenes.length})</h2>
          <div className="space-y-4">
            {scenes.map((s, i) => (
              <div key={i} className="flex gap-4 rounded-lg border border-white/5 bg-white/[0.02] p-3">
                {s.image_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={s.image_url} alt={s.role} className="w-20 rounded-md object-cover aspect-[3/4] shrink-0" />
                ) : (
                  <div className="w-20 aspect-[3/4] rounded-md bg-white/5 shrink-0 flex items-center justify-center text-[10px] text-white/30">
                    no image
                  </div>
                )}
                <div className="flex-1 min-w-0 space-y-2">
                  <div className="flex items-center gap-2">
                    <span className="text-[11px] font-bold text-white/60">Shot {i + 1}</span>
                    <input
                      value={s.role}
                      onChange={(e) => setScenes(scenes.map((x, j) => (j === i ? { ...x, role: e.target.value } : x)))}
                      className={`${inputCls} !py-1 text-xs`}
                    />
                  </div>
                  <div>
                    <label className={labelCls}>Image prompt</label>
                    <textarea
                      value={s.image_prompt}
                      onChange={(e) => setScenes(scenes.map((x, j) => (j === i ? { ...x, image_prompt: e.target.value } : x)))}
                      rows={2}
                      className={`${inputCls} resize-none text-xs`}
                    />
                  </div>
                  <div className="grid grid-cols-3 gap-2">
                    <div className="col-span-2">
                      <label className={labelCls}>Animation prompt (motion only; overrides the preset)</label>
                      <textarea
                        value={s.animation_prompt}
                        onChange={(e) => setScenes(scenes.map((x, j) => (j === i ? { ...x, animation_prompt: e.target.value } : x)))}
                        rows={1}
                        className={`${inputCls} resize-none text-xs`}
                      />
                    </div>
                    <div>
                      <label className={labelCls}>Preset</label>
                      <select
                        value={s.animation_preset ?? ""}
                        onChange={(e) =>
                          setScenes(scenes.map((x, j) => (j === i ? { ...x, animation_preset: e.target.value || undefined } : x)))
                        }
                        className={`${inputCls} !py-1 text-xs`}
                      >
                        <option value="">none</option>
                        {ANIMATION_PRESET_KEYS.map((k) => (
                          <option key={k} value={k}>
                            {k}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                  {(wf.scene_refs?.[String(i + 1)] ?? []).length > 0 && (
                    <div>
                      <label className={labelCls}>Reference board ({(wf.scene_refs[String(i + 1)] ?? []).length}/9, scene-scoped)</label>
                      <div className="grid grid-cols-9 gap-1">
                        {(wf.scene_refs[String(i + 1)] ?? []).slice(0, 9).map((u, j) => (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img key={j} src={u} alt="" className="aspect-[3/4] rounded object-cover" />
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* copy structure */}
      {copyStructure.length > 0 && (
        <div className={sectionCls}>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold text-white">Copy structure ({copyStructure.length} boxes)</h2>
            <button
              onClick={() => save(true)}
              disabled={saving}
              className="flex items-center gap-1.5 text-xs text-white/60 hover:text-white px-2.5 py-1.5 rounded bg-white/5"
              title="Recompute the render timeline from these boxes"
            >
              <RefreshCw size={12} /> Rebake timeline
            </button>
          </div>
          <div className="space-y-2">
            {copyStructure.map((r, i) => (
              <div key={i} className="grid grid-cols-12 gap-2 items-start rounded-lg border border-white/5 bg-white/[0.02] p-2">
                <input
                  value={r.label}
                  onChange={(e) => setCopyStructure(copyStructure.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))}
                  className={`${inputCls} col-span-3 !py-1 text-xs`}
                  title={`key: ${r.key}`}
                />
                <input
                  value={r.guidance}
                  onChange={(e) => setCopyStructure(copyStructure.map((x, j) => (j === i ? { ...x, guidance: e.target.value } : x)))}
                  className={`${inputCls} col-span-4 !py-1 text-xs`}
                  placeholder="what this line must do"
                />
                <input
                  type="number"
                  value={r.shot ?? ""}
                  onChange={(e) =>
                    setCopyStructure(copyStructure.map((x, j) => (j === i ? { ...x, shot: e.target.value === "" ? undefined : Number(e.target.value) } : x)))
                  }
                  className={`${inputCls} col-span-1 !py-1 text-xs`}
                  placeholder="shot"
                  title="shot"
                />
                <input
                  type="number"
                  step="0.1"
                  value={r.at_second ?? ""}
                  onChange={(e) =>
                    setCopyStructure(copyStructure.map((x, j) => (j === i ? { ...x, at_second: e.target.value === "" ? undefined : Number(e.target.value) } : x)))
                  }
                  className={`${inputCls} col-span-1 !py-1 text-xs`}
                  placeholder="in"
                  title="in (s)"
                />
                <input
                  type="number"
                  step="0.1"
                  value={r.out_second ?? ""}
                  onChange={(e) =>
                    setCopyStructure(copyStructure.map((x, j) => (j === i ? { ...x, out_second: e.target.value === "" ? undefined : Number(e.target.value) } : x)))
                  }
                  className={`${inputCls} col-span-1 !py-1 text-xs`}
                  placeholder="out"
                  title="out (s)"
                />
                <select
                  value={r.position ?? ""}
                  onChange={(e) => setCopyStructure(copyStructure.map((x, j) => (j === i ? { ...x, position: e.target.value || undefined } : x)))}
                  className={`${inputCls} col-span-2 !py-1 text-xs`}
                >
                  <option value="">position</option>
                  <option value="upper_side">upper_side</option>
                  <option value="upper_middle">upper_middle</option>
                  <option value="center">center</option>
                  <option value="lower">lower</option>
                </select>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* structure map */}
      {wf.detail_mermaid && (
        <div className={sectionCls}>
          <h2 className="text-sm font-semibold text-white mb-3">Structure map</h2>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={mermaidInkUrl(wf.detail_mermaid)} alt="workflow structure" className="max-w-full rounded-lg border border-white/5" />
        </div>
      )}

      {/* galleries */}
      {(wf.reference_media.length > 0 || wf.approved_variations.length > 0 || wf.shot_screenshots.length > 0) && (
        <div className={sectionCls}>
          <h2 className="text-sm font-semibold text-white mb-3">Library</h2>
          {wf.reference_media.length > 0 && (
            <>
              <label className={labelCls}>Reference creatives ({wf.reference_media.length}/3 gate)</label>
              <div className="grid grid-cols-3 md:grid-cols-6 gap-2 mb-4">
                {wf.reference_media.map((m, i) =>
                  m.kind === "video" || m.kind === "audio" ? (
                    <a key={i} href={m.url} target="_blank" rel="noreferrer" className="aspect-[3/4] rounded-md bg-white/5 flex items-center justify-center text-[10px] text-white/50 hover:text-white">
                      {m.kind}
                    </a>
                  ) : (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img key={i} src={m.url} alt={m.kind} className="aspect-[3/4] rounded-md object-cover" />
                  )
                )}
              </div>
            </>
          )}
          {wf.approved_variations.length > 0 && (
            <>
              <label className={labelCls}>Approved variations ({wf.approved_variations.length}/4 to LIVE)</label>
              <div className="space-y-2 mb-4">
                {wf.approved_variations.map((v, i) => (
                  <div key={i} className="rounded-lg border border-white/5 bg-white/[0.02] p-2 flex gap-3 items-start">
                    <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-[#00C9A7]/15 text-[#00C9A7] shrink-0">{v.label}</span>
                    <p className="text-xs text-white/50 flex-1 min-w-0 truncate">
                      {(v.structured_copy ?? []).map((l) => l.text).filter(Boolean).join(" / ") || "copy on file"}
                    </p>
                    <div className="flex gap-1 shrink-0">
                      {(v.image_urls ?? []).slice(0, 3).map((u, j) => (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img key={j} src={u} alt="" className="w-8 aspect-[3/4] rounded object-cover" />
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
          {wf.shot_screenshots.length > 0 && (
            <>
              <label className={labelCls}>Shot screenshots</label>
              <div className="grid grid-cols-3 md:grid-cols-6 gap-2">
                {wf.shot_screenshots.map((s, i) => (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img key={i} src={s.url} alt={s.role} className="aspect-[3/4] rounded-md object-cover" title={s.role} />
                ))}
              </div>
            </>
          )}
        </div>
      )}

      {/* render prompt + description */}
      {(wf.video_description || wf.render_prompt) && (
        <div className={sectionCls}>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold text-white">Render</h2>
            <div className="flex items-center gap-2">
              <button
                onClick={testRender}
                disabled={rendering}
                className="flex items-center gap-1.5 text-xs font-semibold text-[#0B1426] bg-[#00C9A7] hover:opacity-90 disabled:opacity-40 px-2.5 py-1.5 rounded"
                title="Render the spec (own song + scene images + text timings) through render-spec"
              >
                <Play size={12} /> {rendering ? "Rendering..." : "Test render"}
              </button>
              {wf.render_prompt && (
                <button onClick={copyPrompt} className="flex items-center gap-1.5 text-xs text-white/60 hover:text-white px-2.5 py-1.5 rounded bg-white/5">
                  <Copy size={12} /> {copied ? "Copied" : "Copy render prompt"}
                </button>
              )}
            </div>
          </div>
          {testVideoUrl && (
            <video src={testVideoUrl} controls className="w-64 rounded-lg border border-white/10 mb-3" />
          )}
          {wf.video_description && (
            <pre className="text-[11px] text-white/50 font-mono whitespace-pre-wrap bg-black/20 rounded-lg p-3 max-h-64 overflow-auto">
              {wf.video_description}
            </pre>
          )}
        </div>
      )}
    </div>
  );
}
