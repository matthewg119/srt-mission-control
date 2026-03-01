"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import {
  GripVertical,
  CheckCircle2,
  Circle,
  Pencil,
  Check,
  X,
  ExternalLink,
  Rocket,
  ChevronDown,
  ChevronRight,
} from "lucide-react";
import { DEFAULT_ONBOARDING_STEPS } from "@/config/onboarding";
import type { OnboardingStep } from "@/config/onboarding";

const STORAGE_KEY = "srt-onboarding-v1";

interface StepState {
  id: string;
  title: string;
  description: string;
  link?: string;
  linkLabel?: string;
  completed: boolean;
  order: number;
}

function loadState(): StepState[] {
  if (typeof window === "undefined") return [];
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) return JSON.parse(stored);
  } catch {
    // Fall through to defaults
  }
  return DEFAULT_ONBOARDING_STEPS.map((s, i) => ({
    ...s,
    completed: false,
    order: i,
  }));
}

function saveState(steps: StepState[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(steps));
  } catch {
    // localStorage unavailable
  }
}

export default function OnboardingPage() {
  const [steps, setSteps] = useState<StepState[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const [dragOverIdx, setDragOverIdx] = useState<number | null>(null);
  const editInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setSteps(loadState());
  }, []);

  const sorted = [...steps].sort((a, b) => a.order - b.order);
  const completedCount = steps.filter((s) => s.completed).length;
  const percentage = steps.length > 0 ? Math.round((completedCount / steps.length) * 100) : 0;

  const updateSteps = useCallback((next: StepState[]) => {
    setSteps(next);
    saveState(next);
  }, []);

  const toggleComplete = useCallback(
    (id: string) => {
      updateSteps(
        steps.map((s) => (s.id === id ? { ...s, completed: !s.completed } : s))
      );
    },
    [steps, updateSteps]
  );

  const startEdit = useCallback(
    (step: StepState) => {
      setEditingId(step.id);
      setEditTitle(step.title);
      setEditDescription(step.description);
      setTimeout(() => editInputRef.current?.focus(), 50);
    },
    []
  );

  const saveEdit = useCallback(() => {
    if (!editingId || !editTitle.trim()) return;
    updateSteps(
      steps.map((s) =>
        s.id === editingId
          ? { ...s, title: editTitle.trim(), description: editDescription.trim() }
          : s
      )
    );
    setEditingId(null);
  }, [editingId, editTitle, editDescription, steps, updateSteps]);

  const cancelEdit = useCallback(() => {
    setEditingId(null);
  }, []);

  // Drag and drop handlers
  const handleDragStart = useCallback((idx: number) => {
    setDragIdx(idx);
  }, []);

  const handleDragOver = useCallback(
    (e: React.DragEvent, idx: number) => {
      e.preventDefault();
      if (dragIdx === null || dragIdx === idx) return;
      setDragOverIdx(idx);
    },
    [dragIdx]
  );

  const handleDrop = useCallback(
    (idx: number) => {
      if (dragIdx === null || dragIdx === idx) {
        setDragIdx(null);
        setDragOverIdx(null);
        return;
      }

      const reordered = [...sorted];
      const [moved] = reordered.splice(dragIdx, 1);
      reordered.splice(idx, 0, moved);

      // Reassign order
      const updated = reordered.map((s, i) => ({ ...s, order: i }));
      updateSteps(updated);
      setDragIdx(null);
      setDragOverIdx(null);
    },
    [dragIdx, sorted, updateSteps]
  );

  const handleDragEnd = useCallback(() => {
    setDragIdx(null);
    setDragOverIdx(null);
  }, []);

  return (
    <div className="max-w-3xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-[rgba(0,201,167,0.1)]">
            <Rocket className="h-5 w-5 text-[#00C9A7]" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-white">Onboarding</h1>
            <p className="text-sm text-[rgba(255,255,255,0.4)]">
              Get set up step by step
            </p>
          </div>
        </div>
      </div>

      {/* Progress */}
      <div className="bg-[rgba(255,255,255,0.03)] border border-[rgba(255,255,255,0.08)] rounded-xl p-5 mb-6">
        <div className="flex items-center justify-between mb-3">
          <span className="text-sm font-medium text-white">
            {completedCount} / {steps.length} steps completed
          </span>
          <span
            className={`text-lg font-bold ${
              percentage === 100
                ? "text-[#00C9A7]"
                : percentage >= 50
                ? "text-yellow-400"
                : "text-[rgba(255,255,255,0.5)]"
            }`}
          >
            {percentage}%
          </span>
        </div>
        <div className="w-full h-3 bg-[rgba(255,255,255,0.06)] rounded-full overflow-hidden">
          <div
            className="h-full rounded-full transition-all duration-500 ease-out"
            style={{
              width: `${percentage}%`,
              background:
                percentage === 100
                  ? "#00C9A7"
                  : "linear-gradient(90deg, #1B65A7, #00C9A7)",
            }}
          />
        </div>
      </div>

      {/* Steps List */}
      <div className="space-y-2">
        {sorted.map((step, idx) => {
          const isEditing = editingId === step.id;
          const isExpanded = expandedId === step.id;
          const isDragging = dragIdx === idx;
          const isDragOver = dragOverIdx === idx;

          return (
            <div
              key={step.id}
              draggable={!isEditing}
              onDragStart={() => handleDragStart(idx)}
              onDragOver={(e) => handleDragOver(e, idx)}
              onDrop={() => handleDrop(idx)}
              onDragEnd={handleDragEnd}
              className={`bg-[rgba(255,255,255,0.03)] border rounded-xl transition-all ${
                isDragging
                  ? "opacity-50 border-[rgba(0,201,167,0.3)]"
                  : isDragOver
                  ? "border-[#00C9A7] bg-[rgba(0,201,167,0.05)]"
                  : "border-[rgba(255,255,255,0.08)]"
              }`}
            >
              <div className="flex items-center gap-3 p-4">
                {/* Drag handle */}
                <div className="cursor-grab active:cursor-grabbing text-[rgba(255,255,255,0.2)] hover:text-[rgba(255,255,255,0.4)]">
                  <GripVertical className="h-4 w-4" />
                </div>

                {/* Step number */}
                <span className="text-xs font-bold text-[rgba(255,255,255,0.2)] w-6 text-center">
                  {idx + 1}
                </span>

                {/* Check toggle */}
                <button
                  onClick={() => toggleComplete(step.id)}
                  className="shrink-0"
                >
                  {step.completed ? (
                    <CheckCircle2 className="h-5 w-5 text-[#00C9A7]" />
                  ) : (
                    <Circle className="h-5 w-5 text-[rgba(255,255,255,0.2)] hover:text-[rgba(255,255,255,0.4)]" />
                  )}
                </button>

                {/* Title / Edit */}
                {isEditing ? (
                  <div className="flex-1 flex items-center gap-2">
                    <input
                      ref={editInputRef}
                      value={editTitle}
                      onChange={(e) => setEditTitle(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") saveEdit();
                        if (e.key === "Escape") cancelEdit();
                      }}
                      className="flex-1 bg-[rgba(255,255,255,0.05)] border border-[rgba(255,255,255,0.15)] rounded-md px-2 py-1 text-sm text-white focus:outline-none focus:border-[#00C9A7]"
                    />
                    <button onClick={saveEdit} className="text-[#00C9A7] hover:text-white">
                      <Check className="h-4 w-4" />
                    </button>
                    <button onClick={cancelEdit} className="text-[rgba(255,255,255,0.4)] hover:text-white">
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={() => setExpandedId(isExpanded ? null : step.id)}
                    className={`flex-1 text-left text-sm font-medium transition-colors ${
                      step.completed
                        ? "text-[rgba(255,255,255,0.3)] line-through"
                        : "text-white"
                    }`}
                  >
                    {step.title}
                  </button>
                )}

                {/* Expand/collapse */}
                {!isEditing && (
                  <button
                    onClick={() => setExpandedId(isExpanded ? null : step.id)}
                    className="text-[rgba(255,255,255,0.3)] hover:text-white"
                  >
                    {isExpanded ? (
                      <ChevronDown className="h-4 w-4" />
                    ) : (
                      <ChevronRight className="h-4 w-4" />
                    )}
                  </button>
                )}

                {/* Edit button */}
                {!isEditing && (
                  <button
                    onClick={() => startEdit(step)}
                    className="text-[rgba(255,255,255,0.2)] hover:text-[rgba(255,255,255,0.5)]"
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>

              {/* Expanded content */}
              {isExpanded && !isEditing && (
                <div className="px-4 pb-4 ml-[4.5rem]">
                  {editingId === step.id ? null : (
                    <>
                      <p className="text-sm text-[rgba(255,255,255,0.4)] mb-3">
                        {step.description}
                      </p>
                      {step.link && (
                        <a
                          href={step.link}
                          target={step.link.startsWith("http") ? "_blank" : undefined}
                          rel={step.link.startsWith("http") ? "noopener noreferrer" : undefined}
                          className="inline-flex items-center gap-1.5 text-xs font-medium text-[#00C9A7] hover:text-white transition-colors"
                        >
                          <ExternalLink className="h-3 w-3" />
                          {step.linkLabel || "Open Link"}
                        </a>
                      )}
                    </>
                  )}
                </div>
              )}

              {/* Edit description (when editing) */}
              {isEditing && (
                <div className="px-4 pb-4 ml-[4.5rem]">
                  <textarea
                    value={editDescription}
                    onChange={(e) => setEditDescription(e.target.value)}
                    rows={2}
                    className="w-full bg-[rgba(255,255,255,0.05)] border border-[rgba(255,255,255,0.15)] rounded-md px-2 py-1 text-sm text-[rgba(255,255,255,0.6)] focus:outline-none focus:border-[#00C9A7] resize-none"
                    placeholder="Step description..."
                  />
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Bottom */}
      <div className="mt-6 mb-8 text-center text-sm text-[rgba(255,255,255,0.3)]">
        {percentage === 100
          ? "All set! You're ready to go."
          : "Drag steps to reorder. Click the pencil to rename."}
      </div>
    </div>
  );
}
