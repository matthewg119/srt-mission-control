"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import {
  Palette,
  Shuffle,
  ChevronLeft,
  ChevronRight,
  Download,
  Plus,
  Trash2,
  Loader2,
  Copy,
  Check,
} from "lucide-react";
import {
  ALL_SCRIPTS,
  LAYOUTS,
  PATTERNS,
  GLOWS,
  BARS,
  DECORS,
  CAPTION_TEMPLATES,
  BRAND,
  type LayoutType,
  type PatternType,
  type GlowType,
  type BarType,
  type DecorType,
} from "@/config/carousel-scripts";
import { drawCanvas, downloadSlide } from "@/components/carousel-canvas";

interface SlideData {
  hook: string;
  body: string;
  layout: LayoutType;
}

type Stage = "pick" | "edit" | "preview";

export default function CarouselPage() {
  const [stage, setStage] = useState<Stage>("pick");
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [slides, setSlides] = useState<SlideData[]>([]);
  const [activeSlide, setActiveSlide] = useState(0);
  const [pattern, setPattern] = useState<PatternType>("dots");
  const [glow, setGlow] = useState<GlowType>("center");
  const [bar, setBar] = useState<BarType>("top");
  const [decor, setDecor] = useState<DecorType>("corner-brackets");
  const [copiedCaption, setCopiedCaption] = useState<string | null>(null);
  const [aiLoading, setAiLoading] = useState(false);
  const canvasRefs = useRef<(HTMLCanvasElement | null)[]>([]);

  // Render all canvases whenever slides or visual options change
  useEffect(() => {
    if (stage !== "preview") return;
    slides.forEach((slide, i) => {
      const canvas = canvasRefs.current[i];
      if (canvas) {
        drawCanvas(canvas, {
          hook: slide.hook,
          body: slide.body,
          slideIndex: i,
          totalSlides: slides.length,
          layout: slide.layout,
          pattern,
          glow,
          bar,
          decor,
        });
      }
    });
  }, [stage, slides, pattern, glow, bar, decor]);

  const selectScript = useCallback(
    (catKey: string, scriptIndex: number) => {
      const cat = ALL_SCRIPTS[catKey];
      if (!cat) return;
      const script = cat.scripts[scriptIndex];
      if (!script) return;
      setSlides(
        script.slides.map((s) => ({
          hook: s.hook,
          body: s.body,
          layout: LAYOUTS[Math.floor(Math.random() * LAYOUTS.length)],
        }))
      );
      setActiveSlide(0);
      setStage("edit");
    },
    []
  );

  const randomize = useCallback(async () => {
    setAiLoading(true);
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: [
            {
              role: "system",
              content:
                "Generate a 5-slide Instagram carousel script for SRT Agency (business funding company). Each slide needs a 'hook' (short attention-grabbing line, max 8 words) and a 'body' (supporting text, 1-2 sentences). Return ONLY a JSON array of 5 objects with 'hook' and 'body' fields. No markdown, no explanation.",
            },
            {
              role: "user",
              content:
                "Create a compelling carousel about why business owners need working capital. Make it relatable and use real talk, not corporate language.",
            },
          ],
        }),
      });

      if (res.ok) {
        const data = await res.json();
        const text = data.response || data.message || "";
        // Try to parse JSON from response
        const match = text.match(/\[[\s\S]*\]/);
        if (match) {
          const parsed = JSON.parse(match[0]) as { hook: string; body: string }[];
          if (Array.isArray(parsed) && parsed.length > 0) {
            setSlides(
              parsed.map((s: { hook: string; body: string }) => ({
                hook: s.hook,
                body: s.body,
                layout: LAYOUTS[Math.floor(Math.random() * LAYOUTS.length)],
              }))
            );
            setActiveSlide(0);
            setStage("edit");
            return;
          }
        }
      }
      // Fallback: pick random script
      const catKeys = Object.keys(ALL_SCRIPTS);
      const rCat = catKeys[Math.floor(Math.random() * catKeys.length)];
      const rScript = Math.floor(
        Math.random() * ALL_SCRIPTS[rCat].scripts.length
      );
      selectScript(rCat, rScript);
    } catch {
      // Fallback
      const catKeys = Object.keys(ALL_SCRIPTS);
      const rCat = catKeys[Math.floor(Math.random() * catKeys.length)];
      const rScript = Math.floor(
        Math.random() * ALL_SCRIPTS[rCat].scripts.length
      );
      selectScript(rCat, rScript);
    }
    setAiLoading(false);
  }, [selectScript]);

  const updateSlide = useCallback(
    (index: number, field: keyof SlideData, value: string) => {
      setSlides((prev) => {
        const next = [...prev];
        next[index] = { ...next[index], [field]: value };
        return next;
      });
    },
    []
  );

  const addSlide = useCallback(() => {
    setSlides((prev) => [
      ...prev,
      { hook: "New slide", body: "Add your content here", layout: "centered" },
    ]);
    setActiveSlide(slides.length);
  }, [slides.length]);

  const removeSlide = useCallback(
    (index: number) => {
      if (slides.length <= 1) return;
      setSlides((prev) => prev.filter((_, i) => i !== index));
      if (activeSlide >= index && activeSlide > 0) {
        setActiveSlide(activeSlide - 1);
      }
    },
    [slides.length, activeSlide]
  );

  const downloadAll = useCallback(() => {
    canvasRefs.current.forEach((canvas, i) => {
      if (canvas) {
        downloadSlide(canvas, `srt-carousel-slide-${i + 1}.jpg`);
      }
    });
  }, []);

  const copyCaption = useCallback((id: string, text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedCaption(id);
    setTimeout(() => setCopiedCaption(null), 2000);
  }, []);

  // ─── STAGE 1: Pick Script ───
  if (stage === "pick") {
    return (
      <div className="space-y-6">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-[rgba(245,166,35,0.12)] flex items-center justify-center">
            <Palette className="h-4.5 w-4.5 text-[#F5A623]" />
          </div>
          <div>
            <h1 className="text-lg font-bold text-white">Carousel Studio</h1>
            <p className="text-xs text-[rgba(255,255,255,0.35)]">
              Select a script or randomize with AI
            </p>
          </div>
          <button
            onClick={randomize}
            disabled={aiLoading}
            className="ml-auto flex items-center gap-2 px-4 py-2 bg-[#F5A623] text-[#0B1426] text-sm font-semibold rounded-lg hover:opacity-90 disabled:opacity-50"
          >
            {aiLoading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Shuffle className="h-4 w-4" />
            )}
            Randomize with AI
          </button>
        </div>

        {/* Category tabs */}
        <div className="flex gap-2">
          {Object.entries(ALL_SCRIPTS).map(([key, cat]) => (
            <button
              key={key}
              onClick={() =>
                setSelectedCategory(selectedCategory === key ? null : key)
              }
              className={`px-3 py-1.5 text-xs rounded-lg border transition-colors ${
                selectedCategory === key
                  ? "border-[#F5A623] bg-[rgba(245,166,35,0.1)] text-[#F5A623]"
                  : "border-[rgba(255,255,255,0.08)] text-[rgba(255,255,255,0.4)] hover:border-[rgba(255,255,255,0.15)]"
              }`}
            >
              {cat.icon} {cat.name}
            </button>
          ))}
        </div>

        {/* Scripts grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {Object.entries(ALL_SCRIPTS)
            .filter(([key]) => !selectedCategory || key === selectedCategory)
            .flatMap(([catKey, cat]) =>
              cat.scripts.map((script, idx) => (
                <button
                  key={script.id}
                  onClick={() => selectScript(catKey, idx)}
                  className="text-left bg-[rgba(255,255,255,0.02)] border border-[rgba(255,255,255,0.06)] rounded-xl p-4 hover:border-[rgba(255,255,255,0.12)] transition-colors"
                >
                  <div className="text-[10px] text-[rgba(255,255,255,0.25)] mb-1">
                    {cat.icon} {cat.name}
                  </div>
                  <h3 className="text-sm font-semibold text-white mb-2 line-clamp-2">
                    {script.title}
                  </h3>
                  <p className="text-[11px] text-[rgba(255,255,255,0.35)] line-clamp-2">
                    {script.slides[0].hook} {script.slides[0].body}
                  </p>
                  <div className="text-[10px] text-[rgba(255,255,255,0.2)] mt-2">
                    {script.slides.length} slides
                  </div>
                </button>
              ))
            )}
        </div>
      </div>
    );
  }

  // ─── STAGE 2: Edit Slides ───
  if (stage === "edit") {
    const slide = slides[activeSlide];
    return (
      <div className="space-y-6">
        <div className="flex items-center gap-3">
          <button
            onClick={() => setStage("pick")}
            className="text-[rgba(255,255,255,0.4)] hover:text-white transition-colors"
          >
            <ChevronLeft className="h-5 w-5" />
          </button>
          <h1 className="text-lg font-bold text-white">Edit Slides</h1>
          <span className="text-xs text-[rgba(255,255,255,0.25)]">
            {slides.length} slides
          </span>
          <button
            onClick={() => setStage("preview")}
            className="ml-auto px-4 py-2 bg-[#F5A623] text-[#0B1426] text-sm font-semibold rounded-lg hover:opacity-90"
          >
            Preview & Download
          </button>
        </div>

        <div className="flex flex-col lg:flex-row gap-6">
          {/* Slide list */}
          <div className="w-full lg:w-[200px] shrink-0 space-y-2">
            {slides.map((s, i) => (
              <button
                key={i}
                onClick={() => setActiveSlide(i)}
                className={`w-full text-left px-3 py-2 rounded-lg border text-xs transition-colors ${
                  i === activeSlide
                    ? "border-[#F5A623] bg-[rgba(245,166,35,0.08)] text-white"
                    : "border-[rgba(255,255,255,0.06)] text-[rgba(255,255,255,0.4)] hover:border-[rgba(255,255,255,0.12)]"
                }`}
              >
                <div className="font-medium truncate">
                  Slide {i + 1}
                </div>
                <div className="text-[10px] text-[rgba(255,255,255,0.25)] truncate mt-0.5">
                  {s.hook}
                </div>
              </button>
            ))}
            <div className="flex gap-2">
              <button
                onClick={addSlide}
                className="flex-1 flex items-center justify-center gap-1 px-3 py-2 rounded-lg border border-dashed border-[rgba(255,255,255,0.1)] text-[rgba(255,255,255,0.3)] text-xs hover:border-[rgba(255,255,255,0.2)]"
              >
                <Plus className="h-3 w-3" /> Add
              </button>
              {slides.length > 1 && (
                <button
                  onClick={() => removeSlide(activeSlide)}
                  className="px-3 py-2 rounded-lg border border-[rgba(255,255,255,0.06)] text-red-400 text-xs hover:border-red-400/30"
                >
                  <Trash2 className="h-3 w-3" />
                </button>
              )}
            </div>
          </div>

          {/* Edit form */}
          {slide && (
            <div className="flex-1 bg-[rgba(255,255,255,0.02)] border border-[rgba(255,255,255,0.06)] rounded-xl p-5 space-y-4">
              <div>
                <label className="block text-xs font-medium text-[rgba(255,255,255,0.5)] mb-1.5">
                  Hook
                </label>
                <input
                  type="text"
                  value={slide.hook}
                  onChange={(e) =>
                    updateSlide(activeSlide, "hook", e.target.value)
                  }
                  className="w-full bg-[rgba(255,255,255,0.05)] border border-[rgba(255,255,255,0.1)] rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-[#F5A623]"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-[rgba(255,255,255,0.5)] mb-1.5">
                  Body
                </label>
                <textarea
                  value={slide.body}
                  onChange={(e) =>
                    updateSlide(activeSlide, "body", e.target.value)
                  }
                  rows={3}
                  className="w-full bg-[rgba(255,255,255,0.05)] border border-[rgba(255,255,255,0.1)] rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-[#F5A623] resize-none"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-[rgba(255,255,255,0.5)] mb-1.5">
                  Layout
                </label>
                <div className="flex gap-2">
                  {LAYOUTS.map((l) => (
                    <button
                      key={l}
                      onClick={() =>
                        updateSlide(activeSlide, "layout", l)
                      }
                      className={`px-3 py-1.5 text-xs rounded-lg border transition-colors ${
                        slide.layout === l
                          ? "border-[#F5A623] text-[#F5A623] bg-[rgba(245,166,35,0.08)]"
                          : "border-[rgba(255,255,255,0.08)] text-[rgba(255,255,255,0.4)]"
                      }`}
                    >
                      {l}
                    </button>
                  ))}
                </div>
              </div>

              {/* DOM Preview */}
              <div
                className="relative w-full aspect-square max-w-[400px] rounded-lg overflow-hidden"
                style={{ backgroundColor: BRAND.bg }}
              >
                <div className="absolute inset-0 flex flex-col justify-center p-10">
                  <div
                    className="text-white font-bold text-lg mb-3"
                    style={{ textAlign: slide.layout === "centered" || slide.layout === "stacked" ? "center" : "left" }}
                  >
                    {slide.hook}
                  </div>
                  <div
                    className="text-sm"
                    style={{
                      color: BRAND.muted,
                      textAlign: slide.layout === "centered" || slide.layout === "stacked" ? "center" : "left",
                    }}
                  >
                    {slide.body}
                  </div>
                </div>
                <div className="absolute bottom-3 left-4 text-[10px] font-bold" style={{ color: BRAND.accent }}>
                  SRT AGENCY
                </div>
                <div className="absolute bottom-3 right-4 text-[10px]" style={{ color: `${BRAND.text}40` }}>
                  {activeSlide + 1}/{slides.length}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    );
  }

  // ─── STAGE 3: Preview & Download ───
  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <button
          onClick={() => setStage("edit")}
          className="text-[rgba(255,255,255,0.4)] hover:text-white transition-colors"
        >
          <ChevronLeft className="h-5 w-5" />
        </button>
        <h1 className="text-lg font-bold text-white">Preview & Download</h1>
        <button
          onClick={downloadAll}
          className="ml-auto flex items-center gap-2 px-4 py-2 bg-[#F5A623] text-[#0B1426] text-sm font-semibold rounded-lg hover:opacity-90"
        >
          <Download className="h-4 w-4" /> Download All JPGs
        </button>
      </div>

      {/* Visual options */}
      <div className="flex flex-wrap gap-4 text-xs text-[rgba(255,255,255,0.4)]">
        <label className="flex items-center gap-1.5">
          Pattern:
          <select
            value={pattern}
            onChange={(e) => setPattern(e.target.value as PatternType)}
            className="bg-[rgba(255,255,255,0.05)] border border-[rgba(255,255,255,0.1)] rounded px-2 py-1 text-white"
          >
            {PATTERNS.map((p) => (
              <option key={p} value={p} className="bg-[#0B1426]">
                {p}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-1.5">
          Glow:
          <select
            value={glow}
            onChange={(e) => setGlow(e.target.value as GlowType)}
            className="bg-[rgba(255,255,255,0.05)] border border-[rgba(255,255,255,0.1)] rounded px-2 py-1 text-white"
          >
            {GLOWS.map((g) => (
              <option key={g} value={g} className="bg-[#0B1426]">
                {g}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-1.5">
          Bar:
          <select
            value={bar}
            onChange={(e) => setBar(e.target.value as BarType)}
            className="bg-[rgba(255,255,255,0.05)] border border-[rgba(255,255,255,0.1)] rounded px-2 py-1 text-white"
          >
            {BARS.map((b) => (
              <option key={b} value={b} className="bg-[#0B1426]">
                {b}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-1.5">
          Decor:
          <select
            value={decor}
            onChange={(e) => setDecor(e.target.value as DecorType)}
            className="bg-[rgba(255,255,255,0.05)] border border-[rgba(255,255,255,0.1)] rounded px-2 py-1 text-white"
          >
            {DECORS.map((d) => (
              <option key={d} value={d} className="bg-[#0B1426]">
                {d}
              </option>
            ))}
          </select>
        </label>
      </div>

      {/* Canvas slides */}
      <div className="relative">
        <div className="flex gap-4 overflow-x-auto pb-4">
          {slides.map((_, i) => (
            <div key={i} className="shrink-0">
              <canvas
                ref={(el) => { canvasRefs.current[i] = el; }}
                width={1000}
                height={1000}
                className="w-[280px] h-[280px] rounded-lg"
              />
              <button
                onClick={() => {
                  const c = canvasRefs.current[i];
                  if (c) downloadSlide(c, `srt-carousel-slide-${i + 1}.jpg`);
                }}
                className="mt-2 flex items-center gap-1 text-[10px] text-[rgba(255,255,255,0.3)] hover:text-white"
              >
                <Download className="h-3 w-3" /> Slide {i + 1}
              </button>
            </div>
          ))}
        </div>
        {slides.length > 3 && (
          <div className="flex gap-2 mt-2">
            <ChevronLeft className="h-4 w-4 text-[rgba(255,255,255,0.2)]" />
            <span className="text-[10px] text-[rgba(255,255,255,0.2)]">Scroll for more</span>
            <ChevronRight className="h-4 w-4 text-[rgba(255,255,255,0.2)]" />
          </div>
        )}
      </div>

      {/* Captions */}
      <div>
        <h3 className="text-sm font-semibold text-white mb-3">Caption Options</h3>
        <div className="space-y-3">
          {CAPTION_TEMPLATES.map((tmpl) => {
            const caption = tmpl.template
              .replace("{hook}", slides[0]?.hook || "")
              .replace(
                "{summary}",
                slides.map((s) => `\u2022 ${s.hook}`).join("\n")
              );
            return (
              <div
                key={tmpl.id}
                className="bg-[rgba(255,255,255,0.02)] border border-[rgba(255,255,255,0.06)] rounded-xl p-4"
              >
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-medium text-[rgba(255,255,255,0.5)]">
                    {tmpl.name}
                  </span>
                  <button
                    onClick={() => copyCaption(tmpl.id, caption)}
                    className="flex items-center gap-1 text-[10px] text-[rgba(255,255,255,0.3)] hover:text-white"
                  >
                    {copiedCaption === tmpl.id ? (
                      <>
                        <Check className="h-3 w-3" /> Copied
                      </>
                    ) : (
                      <>
                        <Copy className="h-3 w-3" /> Copy
                      </>
                    )}
                  </button>
                </div>
                <pre className="text-xs text-[rgba(255,255,255,0.4)] whitespace-pre-wrap font-sans">
                  {caption}
                </pre>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
