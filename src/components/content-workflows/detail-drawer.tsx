"use client";

import { useEffect, useState } from "react";
import { X, Play, Copy, Check } from "lucide-react";

interface CopyRole {
  key: string;
  label: string;
  guidance?: string;
  text?: string;
}
interface RenderShot {
  i: number;
  start: number;
  end: number;
}
interface RenderText {
  text: string;
  at_second: number;
  out_second?: number;
  position?: string;
  role?: string;
}
interface WorkflowDetail {
  id: string;
  name: string;
  category: string;
  subcategory: string | null;
  status: string;
  configured: boolean;
  song: string;
  copy_structure: CopyRole[];
  render_spec: { mode: string; duration_seconds: number; shots: RenderShot[]; texts: RenderText[] } | null;
  shot_screenshots: Array<{ role: string; url: string }>;
  video_description: string | null;
  render_prompt: string | null;
}

export function DetailDrawer({ id, onClose }: { id: string; onClose: () => void }) {
  const [detail, setDetail] = useState<WorkflowDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [launching, setLaunching] = useState(false);
  const [launched, setLaunched] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    fetch(`/api/content-workflows/${id}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => alive && setDetail(d))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [id]);

  async function runInSlack() {
    setLaunching(true);
    try {
      const res = await fetch(`/api/content-workflows/${id}/launch`, { method: "POST" });
      if (res.ok) setLaunched(true);
    } finally {
      setLaunching(false);
    }
  }

  function copyPrompt() {
    if (!detail?.render_prompt) return;
    navigator.clipboard.writeText(detail.render_prompt).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }

  const spec = detail?.render_spec;
  const total = spec?.duration_seconds || 1;

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="relative w-full max-w-md h-full overflow-y-auto bg-[#0d1220] border-l border-white/10 p-5">
        <button onClick={onClose} className="absolute top-4 right-4 text-white/50 hover:text-white">
          <X size={18} />
        </button>

        {loading && <p className="text-white/40 text-sm">Loading…</p>}

        {detail && (
          <>
            <p className="text-[11px] uppercase tracking-widest text-white/40">
              {detail.category}
              {detail.subcategory ? ` · ${detail.subcategory}` : ""}
            </p>
            <h2 className="text-lg font-semibold text-white mt-1">{detail.name}</h2>
            <div className="flex items-center gap-2 mt-2">
              <span
                className="text-[10px] font-bold px-2 py-0.5 rounded-full"
                style={{
                  background: detail.status === "active" ? "#00C9A722" : "#f59e0b22",
                  color: detail.status === "active" ? "#00C9A7" : "#f59e0b",
                }}
              >
                {detail.status}
              </span>
              <span className="text-[11px] text-white/40">♪ {detail.song}</span>
            </div>

            {/* Labeled copy boxes */}
            {detail.copy_structure.length > 0 && (
              <section className="mt-5">
                <h3 className="text-xs font-semibold text-white/60 uppercase tracking-wider mb-2">Copy structure</h3>
                <div className="space-y-1.5">
                  {detail.copy_structure.map((r, i) => (
                    <div key={r.key} className="rounded-lg bg-white/5 px-3 py-2">
                      <p className="text-[10px] uppercase tracking-wide text-white/40">
                        {i + 1}. {r.label}
                      </p>
                      <p className="text-sm text-white/90">{r.text || <span className="text-white/30 italic">{r.guidance}</span>}</p>
                    </div>
                  ))}
                </div>
              </section>
            )}

            {/* Render timeline */}
            {spec && spec.shots.length > 0 && (
              <section className="mt-5">
                <h3 className="text-xs font-semibold text-white/60 uppercase tracking-wider mb-2">
                  Timeline · {spec.mode === "animated" ? "video" : "static images"} · {spec.duration_seconds}s
                </h3>
                <div className="space-y-2">
                  {spec.shots
                    .slice()
                    .sort((a, b) => a.i - b.i)
                    .map((shot) => {
                      const texts = spec.texts.filter((t) => t.at_second >= shot.start - 0.05 && t.at_second < shot.end);
                      return (
                        <div key={shot.i} className="rounded-lg bg-white/5 p-2">
                          <div className="flex items-center gap-2">
                            <div className="h-2 rounded-full bg-sky-500/60" style={{ width: `${((shot.end - shot.start) / total) * 100}%`, minWidth: 24 }} />
                            <span className="text-[10px] text-white/40">
                              Shot {shot.i} · {shot.start}s–{shot.end}s
                            </span>
                          </div>
                          {texts.map((t, i) => (
                            <p key={i} className="text-[11px] text-white/70 mt-1 pl-1">
                              {t.at_second}s–{t.out_second ?? shot.end}s “{t.text || t.role}”
                              {t.position ? <span className="text-white/30"> ({t.position})</span> : null}
                            </p>
                          ))}
                        </div>
                      );
                    })}
                </div>
              </section>
            )}

            {/* Generated stills */}
            {detail.shot_screenshots.length > 0 && (
              <section className="mt-5">
                <h3 className="text-xs font-semibold text-white/60 uppercase tracking-wider mb-2">Shots</h3>
                <div className="grid grid-cols-3 gap-2">
                  {detail.shot_screenshots.map((s, i) => (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img key={i} src={s.url} alt={s.role} className="rounded-lg border border-white/10 aspect-[9/16] object-cover" />
                  ))}
                </div>
              </section>
            )}

            {/* Actions */}
            <section className="mt-6 space-y-2">
              {detail.configured ? (
                <button
                  onClick={runInSlack}
                  disabled={launching || launched}
                  className="w-full flex items-center justify-center gap-2 rounded-xl bg-emerald-500/90 hover:bg-emerald-500 text-white text-sm font-semibold py-2.5 disabled:opacity-60"
                >
                  <Play size={15} />
                  {launched ? "Launched in #content-full" : launching ? "Launching…" : "Run in Slack"}
                </button>
              ) : (
                <div className="rounded-xl bg-amber-500/10 border border-amber-500/30 p-3 text-[12px] text-amber-200/90">
                  Not configured yet. Give Claude Code its copy structure, song, and render spec to finish it.
                </div>
              )}

              {detail.render_prompt && (
                <button
                  onClick={copyPrompt}
                  className="w-full flex items-center justify-center gap-2 rounded-xl bg-white/5 hover:bg-white/10 text-white/80 text-sm py-2.5"
                >
                  {copied ? <Check size={15} /> : <Copy size={15} />}
                  {copied ? "Copied" : "Copy render prompt"}
                </button>
              )}
            </section>

            {/* Video description */}
            {detail.video_description && (
              <section className="mt-5">
                <h3 className="text-xs font-semibold text-white/60 uppercase tracking-wider mb-2">Video description</h3>
                <pre className="text-[11px] text-white/60 whitespace-pre-wrap bg-black/30 rounded-lg p-3 border border-white/5">
                  {detail.video_description}
                </pre>
              </section>
            )}
          </>
        )}
      </div>
    </div>
  );
}
