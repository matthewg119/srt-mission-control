// SRT Daily Creative Drop — single editable place for the look + rotation tuning.
// Change the house style, scene list, belief weighting, or Higgsfield sizing here
// without touching any logic.

export type ReelSlot = "morning" | "midday" | "evening";

// Bump this when you change the look so the Slack footer traces which version
// produced a given drop.
export const STYLE_VERSION = "vargas-v1";

// The locked house style. Every image prompt is `${HOUSE_STYLE_PROMPT}\n\nScene: ${scene}`.
// The trained Vargas Soul (HIGGSFIELD_SOUL_ID) carries the face/identity; this
// carries wardrobe, brand, location, and lighting.
export const HOUSE_STYLE_PROMPT = [
  "Photorealistic vertical photo of the same Hispanic male pest-control business owner (early 40s, short dark hair, light stubble).",
  "He wears a navy blue 'Vargas Pest Solutions' polo with a small green shield logo on the left chest, and khaki work pants.",
  "Florida residential setting with palm trees and a clean white service pickup truck. Golden-hour natural light.",
  "Shallow depth of field, sharp focus on the subject, realistic skin texture, professional editorial photography.",
].join(" ");

// Scene variations so the 3 images in a drop are not identical. The drop rotates
// through these (the pairing guide in the caption library maps belief -> b-roll
// energy; these cover all six).
export const SCENE_VARIATIONS: string[] = [
  "alone at a desk late, paperwork and a laptop, tired but focused.",
  "standing confidently in front of his white service truck, arms relaxed.",
  "knocking on a suburban front door holding a clipboard, friendly expression.",
  "sitting in the driver seat of his truck, hand on the wheel, looking ahead.",
  "treating a green lawn with a handheld pest-control sprayer, mid-action.",
  "crouched inspecting the foundation of a home with a flashlight, focused.",
  "loading a backpack sprayer into the bed of his service truck, mid-lift.",
  "up on a residential roof checking the gutters, balanced and focused.",
  "shaking hands with a homeowner on the doorstep, friendly smile.",
  "reviewing his route on a tablet in the truck cab, mid-tap.",
  "spraying along an indoor baseboard with a precision sprayer, crouched.",
  "setting a rodent trap in a garage corner, hands working carefully.",
  "power-spraying the perimeter of a lawn, mist catching the light.",
  "writing on a clipboard beside the open truck door, pen in hand.",
  "showing a junior tech how to inspect, pointing something out.",
  "on the phone walking through a backyard, gesturing as he talks.",
  "inspecting an attic with a flashlight, beam cutting the dark.",
  "closing a deal with a firm handshake outside a home, confident.",
  "pulling equipment from the truck at sunrise, first job of the day.",
  "sealing a foundation gap with a caulk gun, kneeling and precise.",
  "reviewing an invoice on a tablet at a kitchen counter with a client.",
];

// Belief weighting per slot. Morning + midday push cold / top-of-funnel beliefs
// (1-3); evening pushes retargeting beliefs (4-6).
export const SLOT_BELIEF_WEIGHTS: Record<ReelSlot, number[]> = {
  morning: [1, 2, 3],
  midday: [1, 2, 3],
  evening: [4, 5, 6],
};

// Higgsfield Soul (text2image/soul) sizing. width_and_height + quality are passed
// straight through to the API; adjust here if the account exposes a different
// 9:16 token. Soul V2 renders 9:16 reels at 1152x2048 (confirmed via the trained
// Vargas Soul). Use "1536x2048" if you want the 3:4 IG-portrait crop instead.
export const HIGGSFIELD_HOST = "https://platform.higgsfield.ai";
export const SOUL_SIZE = "1152x2048";
export const SOUL_QUALITY = "1080p";
export const SOUL_REFERENCE_STRENGTH = 1;

// How many images per drop.
export const IMAGES_PER_DROP = 3;

export function buildImagePrompt(scene: string): string {
  return `${HOUSE_STYLE_PROMPT}\n\nScene: ${scene}`;
}

// Map a wall-clock ET hour to a slot, used when the cron is invoked without an
// explicit ?slot= (absorbs the EST/EDT 1-hour drift since cron schedules are UTC).
export function slotFromEtHour(hour: number): ReelSlot {
  if (hour < 11) return "morning";
  if (hour < 15) return "midday";
  return "evening";
}
