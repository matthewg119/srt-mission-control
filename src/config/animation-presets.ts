// Named animation presets (Workflow Builder v2) — reusable Seedance motion prompts.
//
// Instead of writing a freeform motion sentence for every scene, the operator picks a preset
// key (`anim 2 slow_push_in`); a typed freeform sentence still wins when provided. v1 stores
// the preset on the scene and shows it on cards; the Seedance wiring reads the resolved prompt.

export interface AnimationPreset {
  key: string;
  label: string;
  prompt: string; // motion only, one sentence, no em dashes
}

export const ANIMATION_PRESETS: Record<string, AnimationPreset> = {
  static_hold: {
    key: "static_hold",
    label: "Static hold",
    prompt: "Camera holds perfectly still on the scene with only natural micro movement.",
  },
  slow_push_in: {
    key: "slow_push_in",
    label: "Slow push-in",
    prompt: "Camera pushes in slowly and steadily toward the subject.",
  },
  slow_pull_out: {
    key: "slow_pull_out",
    label: "Slow pull-out",
    prompt: "Camera pulls back slowly to reveal more of the scene around the subject.",
  },
  handheld_walk: {
    key: "handheld_walk",
    label: "Handheld walk",
    prompt: "Handheld first-person camera walks forward through the scene with natural sway.",
  },
  whip_pan: {
    key: "whip_pan",
    label: "Whip pan",
    prompt: "Camera whips quickly sideways to land on the subject with a fast settle.",
  },
  tilt_reveal: {
    key: "tilt_reveal",
    label: "Tilt reveal",
    prompt: "Camera tilts up slowly to reveal the subject from below.",
  },
};

/** The resolved motion prompt for a scene: typed freeform wins, else the preset, else "". */
export function resolveAnimationPrompt(preset?: string | null, freeform?: string | null): string {
  const typed = (freeform ?? "").trim();
  if (typed) return typed;
  if (preset && ANIMATION_PRESETS[preset]) return ANIMATION_PRESETS[preset].prompt;
  return "";
}

/** The one-line preset menu shown on gov2 scene cards. */
export function animationPresetMenu(): string {
  return Object.values(ANIMATION_PRESETS)
    .map((p) => p.key)
    .join(" | ");
}
