// Shot grammar - the variety engine for every generated image prompt.
//
// The problem this replaces: each lane prepended ONE fixed look string to every
// prompt (`vertical.style_token` in broll-suggestions, `style_dna ?? style_token`
// in hook-studio) and let the model pick a subject from a short hardcoded menu.
// Same grade, same lens, same twelve scenes, forever - three "different" images
// came back as one photo in three crops.
//
// The inversion: CODE deals a distinct combination of photographic axes per image
// and the model only writes the scene sentence inside that constraint. Subjects
// come from a 120-entry library, so a channel can run for weeks without repeating
// a setup. `dealShots` refuses anything used recently (LRU per axis, widest on
// subject) and never repeats a value inside one deal.
//
// Realism is the second job. Generated B-roll reads as AI because it is too clean:
// perfect symmetry, dust motes in a god ray, teal-and-orange, nobody in frame ever.
// REALISM_TAIL and AI_TELL_BAN ship on every prompt to fight exactly that, and the
// PRESENCE axis puts anonymous partial people back in the shot (never a face).

export type ShotLane = "owner" | "treatment";

export interface AxisEntry {
  key: string;
  /** The prompt fragment, written to drop straight into a sentence. */
  text: string;
  /** Relative odds when dealing. Default 1. */
  weight?: number;
}

export interface SubjectEntry extends AxisEntry {
  lane: ShotLane;
}

export interface ShotSpec {
  subject: SubjectEntry;
  capture: AxisEntry;
  light: AxisEntry;
  grade: AxisEntry;
  framing: AxisEntry;
  presence: AxisEntry;
}

/** Recently-used keys per axis, most-recent-first (read from `broll_drops`). */
export interface RecentShots {
  subject?: string[];
  capture?: string[];
  light?: string[];
  grade?: string[];
  framing?: string[];
  presence?: string[];
}

// ---- the axes ---------------------------------------------------------------------------

// HOW the frame was captured. This is the axis that does the most work against the
// "everything is a cinematic 35mm still" sameness.
export const CAPTURE: AxisEntry[] = [
  { key: "phone_handheld", text: "Shot handheld on a phone, slight tilt, nothing straightened" },
  { key: "phone_flash", text: "Shot on a phone with the on-camera flash, harsh foreground falloff" },
  { key: "security_cam", text: "A security-camera still, wide angle, mild barrel distortion, slightly soft" },
  { key: "dashcam", text: "A dashcam frame through a windshield, fixed and slightly low" },
  { key: "doc_photo", text: "A printed page photographed on a desk at a slight angle, one corner lifting" },
  { key: "screen_offshot", text: "A monitor photographed off the screen, faint moire and a reflection in the glass" },
  { key: "reflection", text: "Shot through glass so the reflection doubles over what is behind it" },
  { key: "long_lens", text: "Shot on a long lens from across the street, compressed and slightly grainy" },
  { key: "overhead_phone", text: "A phone held straight down over the surface, flat lay, hand shadow at the edge" },
  { key: "disposable", text: "A disposable-camera frame, heavy grain, blown highlights" },
  { key: "tripod_wide", text: "A locked-off wide on a tripod, level and patient" },
  { key: "through_doorway", text: "Shot from a hallway through an open doorway, the door frame cutting the edges" },
  { key: "over_shoulder", text: "An over-the-shoulder crop, the near shoulder out of focus and dark" },
  { key: "photo_of_photo", text: "A photograph of a printed photograph pinned to a board, edges curling" },
];

export const LIGHT: AxisEntry[] = [
  { key: "overcast", text: "Flat overcast daylight, no visible shadow direction" },
  { key: "hard_noon", text: "Hard midday sun, black-edged shadows, blown highlights" },
  { key: "sodium_lot", text: "Orange sodium parking-lot light after dark" },
  { key: "one_tube", text: "A single fluorescent tube overhead, everything else falling off" },
  { key: "screen_only", text: "Lit only by a screen, the rest of the room unlit" },
  { key: "headlights", text: "Headlights raking through glass, moving highlights" },
  { key: "blue_hour_blinds", text: "Blue-hour light through half-closed blinds" },
  { key: "mixed_wb", text: "A warm lamp fighting cool daylight, two color temperatures in one frame" },
  { key: "direct_flash", text: "Direct flash, flat and unflattering, hard shadow on the wall behind" },
  { key: "windshield_sun", text: "Low sun through a windshield, glare across the glass" },
  { key: "led_panel", text: "A clinical LED panel directly overhead, even and shadowless" },
  { key: "backlit_window", text: "Backlit by a window that blows out completely behind the subject" },
];

// Color treatment. The old locked look survives as ONE of ten, no longer the law.
export const GRADE: AxisEntry[] = [
  { key: "uncorrected", text: "Uncorrected phone color, not graded" },
  { key: "clinical_white", text: "Slightly overexposed clinical white, near-blown walls" },
  { key: "warm_domestic", text: "Warm domestic color, slightly yellow" },
  { key: "cold_office", text: "Cold blue-green office color" },
  { key: "flash_contrast", text: "High-contrast flash color, saturated and hard" },
  { key: "faded", text: "Faded and washed out, low saturation, lifted blacks" },
  { key: "sodium_orange", text: "Heavy sodium orange, almost monochrome" },
  { key: "muted_film", text: "Muted 35mm film color, fine grain" },
  { key: "green_fluoro", text: "A green fluorescent cast nobody corrected" },
  { key: "crushed_black", text: "Crushed blacks, most of the frame reading as shadow" },
];

export const FRAMING: AxisEntry[] = [
  { key: "macro", text: "Macro detail, filling the frame" },
  { key: "closeup", text: "Close-up" },
  { key: "mid", text: "Mid shot" },
  { key: "wide", text: "Wide shot with room around the subject" },
  { key: "corner_wide", text: "Ultra-wide from a room corner, walls converging" },
  { key: "compressed", text: "Long-lens compression, background stacked flat" },
  { key: "overhead", text: "Directly overhead" },
  { key: "low_waist", text: "Low angle from about waist height" },
];

// Anonymous partial presence. A photograph reads as taken, not generated, when a
// person is incidentally in it. Identifiable faces stay banned everywhere.
export const PRESENCE: AxisEntry[] = [
  { key: "nobody", text: "Nobody in frame", weight: 3 },
  { key: "hand_cropped", text: "One hand only, cropped at the wrist by the frame edge" },
  { key: "back_of_head", text: "The back of someone's head, out of focus in the foreground" },
  { key: "blur_cross", text: "A body crossing the frame, motion-blurred past recognition" },
  { key: "legs_edge", text: "Legs and shoes at the very edge of frame, the rest cut off" },
  { key: "frosted_silhouette", text: "A silhouette behind frosted glass, no features readable" },
  { key: "reflected_person", text: "An unidentifiable person reflected in glass or a screen" },
];

// ---- the subject library ----------------------------------------------------------------

type SubjectSeed = [string, string];

function lane(seeds: SubjectSeed[], laneId: ShotLane): SubjectEntry[] {
  return seeds.map(([key, text]) => ({ key, text, lane: laneId }));
}

// `owner` - the B2B avatar's own world. The metaphors that carry "you are not in the
// answer" without a single empty-waiting-room cliche.
const OWNER_SUBJECTS: SubjectEntry[] = lane(
  [
    ["laptop_kitchen", "a laptop open on a kitchen island late at night, dishes still in the sink"],
    ["invoices", "a stack of unopened agency invoices on a counter, the top one half torn"],
    ["calendar_wiped", "a dry-erase appointment calendar wiped blank, ghost marker streaks left behind"],
    ["pos_quiet", "a card terminal on a reception counter, its screen asleep"],
    ["banner_faded", "a sun-faded grand opening banner zip-tied to a fence"],
    ["suite_sign", "a strip-mall suite sign listing six tenants"],
    ["rival_billboard", "a competitor billboard seen through a moving car window"],
    ["loan_statement", "a printed loan statement on a desk, the numbers too small to read"],
    ["product_lockbox", "a small lockbox holding unopened product cartons"],
    ["phone_facedown", "a phone face down beside a cold half-finished coffee"],
    ["stool_alone", "a rolling stool alone in the middle of a lit room"],
    ["price_list", "a laminated price list taped to a wall, curling at one corner"],
    ["storefront_night", "a storefront at night, sign still lit, the interior dark"],
    ["lot_early", "an empty business parking lot at seven in the morning with one car in it"],
    ["lockscreen_review", "a phone lock screen face up on a table showing a review notification"],
    ["ai_answer_rivals", "a laptop screen showing an AI answer that lists three other clinics"],
    ["keys_counter", "a ring of keys dropped on a front counter"],
    ["open_sign", "an OPEN sign flipped to CLOSED, shot through the glass from outside"],
    ["mail_pile", "a pile of mail wedged under a glass front door"],
    ["whiteboard_goals", "a whiteboard of monthly goals half erased"],
    ["folding_chairs", "stacked folding chairs against a back-room wall"],
    ["breakroom", "a break room table with one chair pulled out"],
    ["supply_closet", "a supply closet shelf with boxes stacked unevenly"],
    ["receipt_tape", "a curl of receipt tape left on a counter"],
    ["clipboard_blank", "a clipboard of blank intake forms on a reception desk"],
    ["water_cooler", "a water cooler and a sleeve of paper cups in a lobby"],
    ["magazines", "magazines fanned on a lobby table, one cover curled"],
    ["door_hours", "vinyl business-hours lettering on a glass door, shot from the sidewalk"],
    ["wifi_router", "a router and tangled cables on a shelf"],
    ["pen_cup", "a cup of pens on a counter, one missing its cap"],
    ["monitor_dashboard", "a monitor showing a marketing dashboard, every number out of focus"],
    ["headset", "a headset resting across a keyboard"],
    ["lobby_chairs", "two lobby chairs and a small table seen from the doorway"],
    ["plant_dry", "a potted plant going dry in a lobby corner"],
    ["diploma_wall", "framed certificates on a wall, the glass reflecting a window"],
    ["badge_lanyard", "a clinic badge on a lanyard hanging from a coat hook"],
    ["scrubs_hook", "folded scrubs on a hook behind a door"],
    ["car_dash", "a car dashboard at a stoplight with a phone in the mount"],
    ["gas_station", "a gas pump at night, the card reader lit"],
    ["school_pickup", "a school pickup line seen through a windshield"],
    ["gym_parking", "a gym parking lot at dawn"],
    ["bank_envelope", "a bank envelope and a pen on a kitchen table"],
    ["calculator", "a calculator sitting on a printed spreadsheet, digits out of focus"],
    ["notebook_list", "a spiral notebook with a handwritten list, the writing illegible"],
    ["sticky_notes", "a monitor bezel crowded with sticky notes"],
    ["filing_drawer", "an open filing drawer with the folders leaning"],
    ["printer_tray", "a printer mid-job, paper stacked in the tray"],
    ["shredder", "a shredder bin full of paper strips"],
    ["thermostat", "a wall thermostat early in the morning"],
    ["light_switches", "a bank of light switches with only the first one flipped up"],
    ["alarm_panel", "a security keypad beside a back door"],
    ["trash_bags", "trash bags set by a back door at closing"],
    ["sidewalk_sign", "an A-frame sidewalk sign on wet pavement"],
    ["window_decal", "a window decal peeling at one corner"],
    ["neighbor_line", "a line of customers outside the business next door"],
    ["rival_storefront", "a competitor storefront across the street with a full parking lot"],
    ["mall_directory", "a shopping-center directory board"],
    ["review_printout", "a printed page of reviews with one circled in pen"],
    ["checkin_tablet", "a check-in tablet on a stand, screen asleep"],
    ["clock_wall", "a wall clock in an empty room in late afternoon light"],
  ],
  "owner"
);

// `treatment` - the room itself. Used when the belief needs identity resonance or a
// direct their-chair-is-full contrast. The old lane had one idea (gloved hand, syringe,
// a woman's face) and shot it three times; this is the fix.
const TREATMENT_SUBJECTS: SubjectEntry[] = lane(
  [
    ["syringe_tray", "a single capped syringe lying on a stainless tray"],
    ["client_chair_doorway", "a client reclined in the treatment chair seen from the doorway, head turned away"],
    ["massage_overhead", "a massage in progress from directly above, only hands and a shoulder in frame"],
    ["facial_mask", "a cooling mask being lifted at the edge of frame"],
    ["laser_cradle", "a laser handpiece resting in its cradle"],
    ["microneedling", "a microneedling pen mid-pass, extreme close, only skin texture"],
    ["hydrafacial_wand", "a hydrafacial wand and its coiled tubing"],
    ["vial_load", "a gloved hand drawing from a small vial"],
    ["mirror_check", "the aftercare mirror on a counter with the room reflected in it"],
    ["checkout", "a front-desk checkout, a card going into a reader"],
    ["robe_hook", "a robe on a hook in a changing corner"],
    ["injectable_box", "a foil-wrapped carton on a counter beside a skin marker"],
    ["sharps", "a sharps container mounted on a wall"],
    ["towel_warmer", "an open towel warmer with steam coming off the stack"],
    ["consult_clipboard", "a consult sheet on a clipboard, the handwriting illegible"],
    ["bed_repaper", "a treatment bed being re-papered, the roll pulled halfway"],
    ["gauze_tray", "gauze, alcohol pads and a marker laid out on a tray"],
    ["ice_roller", "an ice roller resting on a folded towel"],
    ["led_mask", "an LED face mask glowing on its stand"],
    ["cryo_tank", "a small cryo tank standing in a corner"],
    ["wax_pot", "a wax pot warming with a spatula resting across it"],
    ["lash_tray", "a lash tray and tweezers under a task lamp"],
    ["glove_box", "a glove box mounted by a door with one glove half pulled out"],
    ["sanitizer", "a sanitizer pump on a counter catching the light"],
    ["skin_marker_dots", "marking dots drawn on a cheek, extreme macro, no full face in frame"],
    ["numbing_cream", "a tube of numbing cream and a wooden depressor"],
    ["chair_controls", "the foot pedal and chair controls under a treatment bed"],
    ["armrest", "a forearm resting on a treatment armrest, cropped at the elbow"],
    ["hair_cap", "a disposable cap hanging on a hook"],
    ["magnifier_lamp", "a magnifier lamp swung out over an empty bed"],
    ["retail_shelf", "a retail shelf of serums with the labels out of focus"],
    ["sample_jars", "small sample jars lined up on glass"],
    ["tint_bowl", "a tint bowl and brush on a rolling cart"],
    ["steamer", "a facial steamer running toward an empty bed"],
    ["instrument_cart", "a rolling cart of instruments beside a treatment bed"],
    ["uv_cabinet", "a sterilizer cabinet with the door ajar"],
    ["towel_cart", "a cart of folded white towels"],
    ["laundry_bin", "a bin of used towels beside a back door"],
    ["timer", "a timer counting down on a counter"],
    ["speaker_phone", "a small speaker and a phone playing music on a shelf"],
    ["candle", "a candle burning on a treatment-room windowsill"],
    ["privacy_curtain", "a privacy curtain drawn halfway"],
    ["blanket_fold", "a folded blanket at the foot of a treatment bed"],
    ["slippers", "disposable slippers on the floor beside a bed"],
    ["water_glass", "a glass of water with a straw on a side table"],
    ["photo_backdrop", "a photo light and a plain backdrop set up in a corner"],
    ["ring_light", "a ring light on a stand facing an empty stool"],
    ["tablet_consent", "a tablet showing a consent form with a stylus resting on it"],
    ["appointment_card", "a printed appointment card left on a counter"],
    ["aftercare_sheet", "an aftercare sheet folded on a pillow"],
    ["headband", "a spa headband on a folded towel"],
    ["cotton_rounds", "cotton rounds and a toner bottle on a tray"],
    ["gua_sha", "a gua sha stone and an oil bottle on stone"],
    ["contour_paddles", "body-contouring paddles laid out on a bed"],
    ["compression_wrap", "a compression wrap coiled on a shelf"],
    ["scale_tape", "a floor scale and a tape measure against a wall"],
    ["iv_bag", "an IV bag hanging on a pole beside a lounge chair"],
    ["iv_arm", "a taped IV line on a forearm, cropped above the elbow"],
    ["drip_lounge", "a row of drip lounge chairs with one blanket left behind"],
    ["back_hallway", "a back hallway of treatment-room doors with one standing open"],
  ],
  "treatment"
);

export const SUBJECTS: SubjectEntry[] = [...OWNER_SUBJECTS, ...TREATMENT_SUBJECTS];

export function subjectsFor(laneId: ShotLane): SubjectEntry[] {
  return SUBJECTS.filter((s) => s.lane === laneId);
}

// ---- the guards -------------------------------------------------------------------------

// What makes a frame read as photographed rather than rendered.
export const REALISM_TAIL =
  "Imperfect framing: the subject slightly off-center and something cut off by the frame edge. " +
  "Real clutter, wear, fingerprints and scuffs. Visible sensor noise in the shadows. " +
  "Mixed white balance. No perfect symmetry.";

// The tells in our own back catalogue. Named explicitly because a model will produce
// every one of them by default when asked for "cinematic".
export const AI_TELL_BAN =
  "Do not produce: dust motes floating in a light beam, god rays, teal-and-orange grading, " +
  "glowing UI panels floating in dark space, lens flares, glossy stock-photo polish, " +
  "cinematic haze, or a flawlessly tidy symmetrical room.";

export const FACE_BAN =
  "No identifiable faces. No posed or smiling subjects. No stock-photo models.";

/** The closing guards every image prompt ends with. */
export function shotGuards(extraNegative?: string): string {
  const extra = extraNegative ? `${extraNegative.replace(/[.\s]+$/, "")}. ` : "";
  return `${REALISM_TAIL} ${AI_TELL_BAN} ${FACE_BAN} ${extra}No on-screen text, logos, or watermarks in the image. 9:16 vertical.`;
}

// ---- rendering --------------------------------------------------------------------------

/**
 * The look sentence for one dealt shot, WITHOUT the subject. Replaces the single fixed
 * `style_token` / `style_dna` string at call sites that already carry their own action.
 */
export function renderLookLine(spec: ShotSpec): string {
  return [
    `${spec.capture.text}.`,
    `${spec.framing.text}.`,
    `${spec.light.text}.`,
    `${spec.grade.text}.`,
    `${spec.presence.text}.`,
  ].join(" ");
}

/** The full brief including the dealt subject, handed to the generator as a constraint. */
export function renderShotBrief(spec: ShotSpec): string {
  return `Subject: ${spec.subject.text}. ${renderLookLine(spec)}`;
}

/** A short human label for the Slack card, so the operator can see the spread at a glance. */
export function shotLabel(spec: ShotSpec): string {
  return [spec.subject.key, spec.capture.key, spec.light.key, spec.grade.key, spec.framing.key, spec.presence.key].join(" / ");
}

/** The axis keys to log so the next deal can avoid them. */
export function shotKeys(spec: ShotSpec): Record<string, string> {
  return {
    subject_key: spec.subject.key,
    capture_key: spec.capture.key,
    light_key: spec.light.key,
    grade_key: spec.grade.key,
    framing_key: spec.framing.key,
    presence_key: spec.presence.key,
    lane: spec.subject.lane,
  };
}

// ---- the dealer -------------------------------------------------------------------------

// How far back each axis remembers. Subject is widest because a repeated subject is the
// repetition a human actually notices; framing/presence are narrow because there are only
// so many ways to point a camera.
const WINDOW: Record<keyof RecentShots, number> = {
  subject: 30,
  capture: 8,
  light: 8,
  grade: 8,
  framing: 5,
  presence: 4,
};

function weightedPick<T extends AxisEntry>(pool: T[]): T {
  const total = pool.reduce((sum, e) => sum + (e.weight ?? 1), 0);
  let r = Math.random() * total;
  for (const e of pool) {
    r -= e.weight ?? 1;
    if (r <= 0) return e;
  }
  return pool[pool.length - 1];
}

/**
 * Pick one entry that is neither in the recent window nor already used in this deal.
 * Falls back progressively (drop the window, then drop the deal guard) so a small axis
 * with a long history still returns something instead of throwing.
 */
function pickAxis<T extends AxisEntry>(
  entries: T[],
  recent: string[] | undefined,
  window: number,
  usedInDeal: Set<string>
): T {
  const blocked = new Set((recent ?? []).slice(0, window));
  const fresh = entries.filter((e) => !blocked.has(e.key) && !usedInDeal.has(e.key));
  if (fresh.length) return weightedPick(fresh);
  const unusedHere = entries.filter((e) => !usedInDeal.has(e.key));
  return weightedPick(unusedHere.length ? unusedHere : entries);
}

/**
 * Deal `count` distinct shot specs for a lane. Nothing repeats inside the deal, and
 * nothing repeats against the recent history the caller read out of `broll_drops`.
 */
export function dealShots(opts: {
  lane: ShotLane;
  count: number;
  recent?: RecentShots;
  /** Per-shot lane override, index-aligned with the deal. Falls back to `lane`. */
  lanes?: ShotLane[];
}): ShotSpec[] {
  const { lane: laneId, count, recent = {}, lanes } = opts;
  const used: Record<keyof RecentShots, Set<string>> = {
    subject: new Set(),
    capture: new Set(),
    light: new Set(),
    grade: new Set(),
    framing: new Set(),
    presence: new Set(),
  };

  const out: ShotSpec[] = [];
  for (let i = 0; i < count; i++) {
    const pool = subjectsFor(lanes?.[i] ?? laneId);
    const spec: ShotSpec = {
      subject: pickAxis(pool, recent.subject, WINDOW.subject, used.subject),
      capture: pickAxis(CAPTURE, recent.capture, WINDOW.capture, used.capture),
      light: pickAxis(LIGHT, recent.light, WINDOW.light, used.light),
      grade: pickAxis(GRADE, recent.grade, WINDOW.grade, used.grade),
      framing: pickAxis(FRAMING, recent.framing, WINDOW.framing, used.framing),
      presence: pickAxis(PRESENCE, recent.presence, WINDOW.presence, used.presence),
    };
    used.subject.add(spec.subject.key);
    used.capture.add(spec.capture.key);
    used.light.add(spec.light.key);
    used.grade.add(spec.grade.key);
    used.framing.add(spec.framing.key);
    used.presence.add(spec.presence.key);
    out.push(spec);
  }
  return out;
}

/** How many distinct combinations the grammar can express, for the Slack footer. */
export function grammarSize(laneId?: ShotLane): number {
  const subjects = laneId ? subjectsFor(laneId).length : SUBJECTS.length;
  return subjects * CAPTURE.length * LIGHT.length * GRADE.length * FRAMING.length * PRESENCE.length;
}
