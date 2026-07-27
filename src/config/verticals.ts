// Vertical + Avatar/Offer registry (Content Engine v2, Phase 0).
//
// A "vertical" is a content kit: an Avatar (voice-of-customer research distilled into a
// persona), the 6 necessary Beliefs (the buying-belief sequence), and an Offer sheet
// (UMP / UMS / Big Idea / belief-chains / objections / headline options). Today the
// pest-control persona, look, scenes, and copy live as hardcoded constants across
// pov-style.ts, reel-style.ts, and viral-video-decoder-prompt.ts. This registry turns
// them into selectable data so future generators read a kit instead of a constant.
//
// PHASE 0 IS DATA + CONFIG ONLY. Nothing imports this module yet, so runtime behavior is
// unchanged. The pest_control seed is built FROM the existing constants (POV_GLASSES_TOKEN,
// POV_GOLD_EXAMPLES, POV_SCENES, SCENE_VARIATIONS, HOUSE_STYLE_PROMPT, POV_STYLE_VERSION) so
// that, once a later phase wires this in, the active-vertical path reproduces today's output.
//
// loadVertical(id) reads the `verticals` table (docs/2026-06-30-verticals.sql) and merges
// the DB row OVER the seed below, so the seed is both the offline fallback and the source
// of the look fields the SQL seed intentionally leaves null. getActiveVertical() selects by
// env CONTENT_VERTICAL (default pest_control).

import { supabaseAdmin } from "@/lib/db";
import {
  POV_GLASSES_TOKEN,
  POV_GOLD_EXAMPLES,
  POV_SCENES,
  POV_STYLE_VERSION,
  type PovGoldExample,
} from "@/config/pov-style";
import { HOUSE_STYLE_PROMPT, SCENE_VARIATIONS } from "@/config/reel-style";

// One of the 6 ordered necessary beliefs. `phase` (pest_control) and `label`
// (pest_owner_ai) are optional tags carried verbatim from the source kits.
export interface Belief {
  n: number;
  phase?: string; // e.g. "DERRIBAR" | "DERRIBAR·BISAGRA" | "CONSTRUIR" | "CONSTRUIR·ACCIÓN"
  label?: string; // e.g. "La estrella polar (el reencuadre del problema)"
  text: string;
}

// One objection row from an offer sheet (objection + verbatim evidence + offer response).
export interface OfferObjection {
  objection: string;
  evidence?: string;
  response: string;
}

// One headline option from an offer sheet.
export interface OfferHeadline {
  title: string;
  subtitle?: string;
  angle?: string;
}

// The distilled offer sheet — the exact raw material per-vertical generators read instead
// of hardcoded constants.
export interface Offer {
  ump: string; // Unique Mechanism of the Problem
  ums: string; // Unique Mechanism of the Solution
  big_idea: string;
  belief_chains: string[];
  objections: OfferObjection[];
  headlines: OfferHeadline[];
}

// A full vertical kit. Mirrors the columns of the `verticals` table, plus a few TS-only
// convenience fields (scenes/scene_variations/style_version) that are not DB columns yet and
// are always seeded from the legacy constants.
export interface Vertical {
  id: string;
  name: string;
  audience: string; // 'homeowner' | 'pest_owner' | 'business_owner'
  language: string; // 'en' | 'es'
  status: string; // 'active'

  // Persona / kit:
  business_descriptor: string; // woven into system prompts, e.g. "pest control business"
  wearer_role: string; // first-person POV actor, e.g. "pest control technician"
  avatar_doc_url?: string | null; // source kit file in the `reels` bucket (set on upload)
  avatar_summary: string; // distilled persona (pains/desires/voice)
  beliefs: Belief[]; // the 6, ordered
  offer: Offer;

  // Look / generation:
  style_token: string; // replaces POV_GLASSES_TOKEN per vertical
  house_style_prompt: string; // replaces HOUSE_STYLE_PROMPT (Soul brand wardrobe)
  soul_id?: string; // Higgsfield Soul for character consistency
  cta_formats: string[];
  gold_examples: PovGoldExample[]; // few-shot anchor (replaces POV_GOLD_EXAMPLES)
  // Subject law for this avatar's images — the avatar-level twin of Workflow.visual_rules.
  // style_token says HOW a shot looks (grade, lens); these say WHAT may be in it. Injected
  // into every image-prompt system prompt AFTER the workflow's own rules, and they win on
  // conflict: the clinic borrows the pest workflow library, whose rules talk about gloved
  // hands and job sites.
  visual_rules?: string[];
  // Appended to the FINAL assembled prompt string. The rules above steer the model writing
  // the scene; this reaches the image model itself, so it is the last guard.
  image_negative?: string;

  // Drop-studio wiring (docs/2026-07-10-drop-channel-verticals.sql). These come from the
  // DB row ONLY — never from a seed — because seedFor(unknownId) returns the pest seed and
  // a new avatar must not silently inherit pest wiring or pest voice.
  slack_drop_channel_id?: string | null; // Slack channel whose drops run through drop-studio
  owner_vertical_id?: string | null; // the avatar the post-render sales letter speaks to
  workflow_vertical_id?: string | null; // whose workflow library the drop lane matches (null = pest_control's)
  sales_letter_examples?: string | null; // full-text reference letters (caption voice anchor)
  sales_letter_swipe?: string | null; // distilled format/voice rules override
  drop_mode?: string | null; // "reel_prompts" (default: LRU workflow -> 9 image prompts -> render)
  //                            | "broll_suggestions" (post 3 cinematic B-roll prompts, text only)

  // TS-only (not DB columns yet) — scene pools for rotation, always seeded from constants:
  scenes?: string[]; // POV_SCENES
  scene_variations?: string[]; // SCENE_VARIATIONS
  style_version?: string; // POV_STYLE_VERSION
}

export const DEFAULT_VERTICAL_ID = "pest_control";

// ---------------------------------------------------------------------------------------
// SEED DATA — the offline fallback and the look-field source. Transcribed faithfully from
// the authored kits; the pest_control look fields reuse the existing constants verbatim.
// ---------------------------------------------------------------------------------------

const PEST_CONTROL: Vertical = {
  id: "pest_control",
  name: "Pest Control (Homeowner / Triad)",
  audience: "homeowner",
  language: "en",
  status: "active",
  business_descriptor: "pest control business",
  wearer_role: "pest control technician",
  avatar_doc_url: null,
  avatar_summary: [
    "Voice-of-Customer avatar: \"Protect-My-Investment Pam / Dale\" - a 35-65 year-old Guilford or",
    "Forsyth County (Greensboro / Piedmont Triad, NC) homeowner in an older crawl-space home,",
    "household income roughly $63K-$70K, who sees the house as their biggest asset and is",
    "frightened of hidden structural rot, chemicals around kids/pets, and being scammed or upsold.",
    "Core belief (verbatim): \"There's something eating my house and I can't see it; I need it gone",
    "for good, but every exterminator either lowballs me to get in the door, scares me to sell more,",
    "or locks me in a contract I can't escape, so who can I actually trust?\"",
    "",
    "Awareness: overwhelmingly problem-aware to solution-aware. They already have an active issue",
    "(swarmers, mud tubes, roaches, mice, or a real-estate WDIR deadline) and are comparison-shopping",
    "providers while deeply distrustful of the industry. The deciding factor is trust / anti-scam",
    "credibility, NOT product novelty. Market sophistication is HIGH and skeptical: every chain claims",
    "\"guarantee,\" \"if pests come back so do we,\" \"eco-friendly,\" \"family-owned\" and the claims are",
    "saturated and disbelieved.",
    "",
    "Fears / pains (verbatim themes): structural rot (\"Entire beams holding the house up were eaten",
    "away. Live termites were everywhere.\"); recurrence (\"I still have termites swarming in my house",
    "each spring.\"); being scammed (\"I knew then that we were scammed.\"); being upsold/scared",
    "(\"upselling unnecessary work is a gross business model\"; the $3,000 crawlspace-dehumidifier",
    "upsell that was never requested); chemicals/safety (\"sprayed the inside and left a residue all",
    "over my stained wood floor and baseboard\"); failed closing (lender requires a clean WDIR).",
    "",
    "The hinge / north-star belief (#3): the entire market enters the decision convinced they will be",
    "scammed or over-sold (all exterminators upsell, scare to sell more, churn techs every year, and",
    "lock you into a contract you can't cancel). If the message does not resolve that first, nothing",
    "else matters. Proof point: Orkin's own internal audit (obtained by CBS News) showed a 45% failure",
    "rate for initial termite treatments company-wide and 54% in the Southeast termite belt.",
    "",
    "Authority / curiosity hooks (NC State Extension, NCDA&CS): eastern subterranean termites",
    "(Reticulitermes flavipes) live underground and can forage up to 1/3 acre and 200 feet from the",
    "nest, which is why spot DIY fails and a full perimeter barrier is needed; a 60,000-member colony",
    "can consume 1 foot of 2x4 in ~5 months and serious damage takes 3-8 years; Triad swarm season",
    "runs ~March-May, peaking April; a termite letter (one-time WDIR for closing) is NOT a termite",
    "bond (ongoing service contract). NC structural pest work is licensed by NCDA&CS. Greensboro is",
    "~10.5% Hispanic and High Point ~12.3%, so bilingual English/Spanish answering is a real",
    "differentiator. Caution (per brief): avoid \"the industry doesn't want you to know\" conspiracy",
    "framing; use the regulatory facts, the documented failure rate, and the biology as quiet authority.",
  ].join("\n"),
  beliefs: [
    {
      n: 1,
      phase: "DERRIBAR",
      text: "Creo que hay termitas (u otra plaga) atacando mi casa ahora mismo, escondidas donde no puedo verlas, y que el daño avanza en silencio mientras yo no hago nada.",
    },
    {
      n: 2,
      phase: "DERRIBAR",
      text: "Creo que lo que yo pueda hacer por mi cuenta, el spray de la tienda, los cebos sueltos, los remedios caseros, no elimina el problema, porque la colonia vive bajo tierra y sigue viva aunque mate lo que veo.",
    },
    {
      n: 3,
      phase: "DERRIBAR·BISAGRA",
      text: "Creo que no todos los exterminadores son iguales: la mayoría me va a asustar para venderme de más, cambiar de técnico cada año y amarrarme a un contrato que no puedo cancelar, pero existe uno que trabaja de la forma opuesta.",
    },
    {
      n: 4,
      phase: "CONSTRUIR",
      text: "Creo que este proveedor es ese exterminador honesto: baja al crawl space y me muestra la evidencia real, me da un precio fijo por escrito antes de tocar nada, manda al mismo técnico con licencia cada vez, y no me obliga a firmar nada que no pueda cancelar.",
    },
    {
      n: 5,
      phase: "CONSTRUIR",
      text: "Creo que su método, inspección honesta y barrera de perímetro completo, no un 'parche' de punto, sí elimina la colonia de raíz y la mantiene fuera, respaldado por una garantía que de verdad responde.",
    },
    {
      n: 6,
      phase: "CONSTRUIR·ACCIÓN",
      text: "Creo que si actúo ahora protejo mi mayor inversión y la seguridad de mi familia, y que esperar solo deja que el daño crezca y me cueste mucho más después.",
    },
  ],
  offer: {
    ump: "La Trampa de la Colonia Invisible: tu problema no es lo que ves, es lo que NO ves. La termita subterránea del Triad vive bajo tierra y puede forrajear hasta 60 metros desde el nido, así que el spray de tienda y los 'parches' de punto matan obreras visibles pero no la colonia, que vuelve a entrar por otra grieta.",
    ums: "Inspección Honesta + Barrera de Perímetro Completo + el Mismo Técnico Cada Año: bajamos al crawl space y mostramos con fotos qué tienes y qué NO tienes, precio fijo por escrito antes de empezar, barrera de perímetro completo que ataca la colonia (no parches), garantía real y transferible, el mismo técnico local con licencia NCDA&CS, y sin contrato que te atrape.",
    big_idea:
      "Casi todos los exterminadores te van a asustar para venderte de más. Nosotros entramos, te mostramos con evidencia lo que realmente tienes, te damos un precio fijo por escrito, y eliminamos la colonia para que no regrese. (Versión emocional: Hay algo comiéndose tu casa por dentro y no puedes verlo. Te lo sacamos de raíz, y por fin vuelves a dormir tranquilo, sabiendo que tu mayor inversión está protegida.)",
    belief_chains: [
      "Hay algo invisible comiéndose mi casa, y el spray de tienda no lo va a resolver porque la colonia vive bajo tierra.",
      "No todos los exterminadores son iguales: existe uno honesto que me muestra la evidencia en vez de inventarme plagas.",
      "Un precio fijo por escrito y el mismo técnico cada vez SÍ es posible, no tengo que aceptar sustos ni sobreventa.",
      "Puedo proteger mi casa sin quedar atrapado en un contrato de 12 páginas que no puedo cancelar.",
      "Si no actúo ahora, la colonia sigue comiendo en silencio y el daño estructural me costará mucho más después.",
    ],
    objections: [
      {
        objection: "¿Me van a inflar el precio o venderme de más?",
        evidence:
          "\"His quote was nearly three times other quotes\"; \"upselling unnecessary work is a gross business model.\"",
        response:
          "Precio fijo por escrito antes de empezar; te mostramos la matemática. Garantía de cero sobreventa: tratamos lo que llamaste.",
      },
      {
        objection: "¿La inspección gratis es una trampa de venta?",
        evidence:
          "\"DO NOT do their 'free' termite inspection, you will have to SIGN UP EVEN WITH NO ACTIVITY FOUND.\"",
        response:
          "Inspección honesta: si no tienes actividad, te lo decimos y te vas sin firmar nada. Reporte con fotos en mano.",
      },
      {
        objection: "¿Y si las termitas regresan?",
        evidence: "\"I still have termites swarming in my house each spring\" (tras pagar miles).",
        response:
          "Barrera de perímetro completo + garantía de re-tratamiento transferible. Re-inspección anual con fotos.",
      },
      {
        objection: "¿Es seguro para mis hijos y mascotas?",
        evidence: "\"sprayed the inside and left a residue all over my floor and baseboard.\"",
        response:
          "Productos seguros para niños y mascotas; te damos el ingrediente activo y el # EPA por escrito.",
      },
      {
        objection: "Los contratos no se pueden cancelar.",
        evidence: "\"They keep charging my credit card for the service that they are not providing.\"",
        response:
          "Sin contrato obligatorio ni auto-renovación sorpresa. Cancela por teléfono o correo, sin penalidad.",
      },
      {
        objection: "¿Me van a dejar plantado / cambian de técnico?",
        evidence:
          "\"People just never showed for appointments\"; el técnico de confianza \"was replaced.\"",
        response: "El mismo técnico local cada visita. Llegamos a tiempo o la visita es gratis.",
      },
      {
        objection: "¿Cómo sé que no es una estafa?",
        evidence: "\"I knew then that we were scammed.\"",
        response:
          "Licencia NCDA&CS visible, técnicos locales con verificación de antecedentes, reseñas reales del Triad.",
      },
    ],
    headlines: [
      {
        angle: "Anti-sobreventa (el ángulo más fuerte)",
        title: "La Mayoría de los Exterminadores Te Asustan para Venderte de Más. Nosotros No.",
        subtitle:
          "Inspección honesta, precio fijo por escrito y el mismo técnico cada vez. Eliminamos la colonia para que no regrese, sin sustos, sin contratos-trampa. Inspección gratis en todo el Triad. Hablamos español.",
      },
      {
        angle: "Miedo estructural + alivio",
        title: "Hay Algo Comiéndose Tu Casa por Dentro. Te Lo Sacamos de Raíz.",
        subtitle:
          "Termitas subterráneas, escondidas en el crawl space. Inspección honesta con fotos, barrera de perímetro completo y garantía real. Protege tu mayor inversión hoy.",
      },
      {
        angle: "Transparencia + sin contrato",
        title: "Precio Fijo por Escrito. El Mismo Técnico Cada Vez. Sin Contrato que No Puedas Cancelar.",
        subtitle:
          "Control de termitas y plagas en Greensboro y el Triad. Te mostramos la evidencia y el costo real antes de tocar nada. Inspección gratis.",
      },
      {
        angle: "Bienes raíces / cierre",
        title: "¿Necesitas el Termite Letter para Cerrar? Lo Tenemos Listo, Rápido y Sin Sorpresas.",
        subtitle:
          "WDIR para compra, venta o refinanciamiento en NC, con inspección honesta. Sin inventarte termitas que no tienes.",
      },
    ],
  },
  // Look / generation fields reuse today's constants verbatim so the active path reproduces
  // current output once a later phase wires this in.
  style_token: POV_GLASSES_TOKEN,
  house_style_prompt: HOUSE_STYLE_PROMPT,
  soul_id: process.env.HIGGSFIELD_SOUL_ID,
  cta_formats: ["Comment FUND", "Link in bio", "DM the word INSPECT"],
  gold_examples: POV_GOLD_EXAMPLES,
  scenes: POV_SCENES,
  scene_variations: SCENE_VARIATIONS,
  style_version: POV_STYLE_VERSION,
};

const MCA: Vertical = {
  id: "mca",
  name: "MCA / Revenue-Based Funding",
  audience: "business_owner",
  language: "en",
  status: "active",
  business_descriptor:
    "revenue-based funding brokerage (MCA, equipment financing, lines of credit, working capital)",
  wearer_role: "small-business owner / SRT Agency funding broker",
  avatar_doc_url: null,
  avatar_summary: [
    "SRT Agency (srtagency.com), an AI-first revenue-based funding brokerage run by Matthew Garcia.",
    "Products promoted: revenue-based funding (MCA), equipment financing, lines of credit, working",
    "capital. We do NOT do SBA loans, 7(a), 504, DSCR, or long-term bank loan programs and never",
    "mention them.",
    "",
    "Target: small/mid-size business owners, heavy focus on blue-collar service operators (pest",
    "control, HVAC, landscaping, trucking, auto repair, cleaning, construction) AND medical (dental,",
    "chiro, med spa, physical therapy). Secondary: restaurants, retail, e-commerce. Bilingual",
    "English/Spanish (Hispanic owners are a core audience).",
    "",
    "Core pain: sub-600 credit-score business owners who have been turned away by banks. \"Below 600,",
    "Still Funded\" is the flagship campaign. Free guide: \"The Business Owner's Guide to Funding",
    "Without a Bank\" at srtagency.com/bfunding. CTA formats: \"Comment FUND\", \"Comment CASH\",",
    "\"Link in bio\", \"DM the word FUND\".",
    "",
    "Realistic numbers for copy: revenue-based funding $25K-$500K, 4-12 month terms, factor rates",
    "1.15-1.49, same-day to 48-hour funding; equipment financing $1K-$2M, 12-84 month terms, 550+",
    "credit; lines of credit $1K-$275K, 500-650+ credit, 6-24 month terms.",
  ].join("\n"),
  beliefs: [
    {
      n: 1,
      text: "I believe my business has a real cash-flow or growth need right now, and waiting on a bank is costing me opportunities.",
    },
    {
      n: 2,
      text: "I believe the banks turned me down on my credit score, not on whether my business actually makes money.",
    },
    {
      n: 3,
      text: "I believe there is a way to get funded based on my revenue without a bank, even with credit below 600.",
    },
    {
      n: 4,
      text: "I believe SRT Agency is the broker that actually funds owners like me: fast, transparent, and built for blue-collar and service businesses.",
    },
    {
      n: 5,
      text: "I believe the funding can be in my account in same-day to 48 hours with terms I can understand, not a 12-page trap.",
    },
    {
      n: 6,
      text: "I believe acting now (comment FUND / grab the free guide) gets me capital while the opportunity is still in front of me.",
    },
  ],
  offer: {
    ump: "Banks reject sub-600 owners on a credit score, not on real revenue, so profitable businesses stay starved of capital they have already earned.",
    ums: "Revenue-based approval that looks at what the business actually makes, same-day to 48-hour funding, below 600 still funded, with terms read in plain English.",
    big_idea: "Below 600, Still Funded.",
    belief_chains: [
      "The bank said no because of my credit, not because my business doesn't make money.",
      "There is funding based on revenue that doesn't require a bank or a high credit score.",
      "SRT Agency funds owners below 600 and is built for service and blue-collar businesses like mine.",
      "The money can hit my account in same-day to 48 hours with terms I understand.",
      "If I act now I get the capital while the opportunity is still here.",
    ],
    objections: [
      {
        objection: "My credit is below 600, I won't qualify.",
        response: "Below 600, Still Funded. Approval is based on your revenue, not just your score.",
      },
      {
        objection: "This is going to take weeks like the bank.",
        response: "Same-day to 48-hour funding once you're approved.",
      },
      {
        objection: "I don't understand the terms / it's a trap.",
        response: "Plain-English terms: $25K-$500K, 4-12 month terms, no 12-page bank package.",
      },
      {
        objection: "Is this an SBA loan?",
        response:
          "No. Revenue-based funding, equipment financing, and lines of credit, not SBA or long-term bank programs.",
      },
    ],
    headlines: [
      {
        angle: "Flagship",
        title: "Below 600 Credit? Still Funded.",
        subtitle:
          "Revenue-based funding for service and blue-collar businesses the banks turned away. Same-day to 48-hour funding. Comment FUND.",
      },
      {
        angle: "Anti-bank",
        title: "The Bank Said No to Your Score, Not Your Revenue.",
        subtitle:
          "Get funded on what your business actually makes. Grab the free guide at srtagency.com/bfunding.",
      },
    ],
  },
  // No current runtime "look" for the MCA vertical (it is the decoder/storyboard flow, not
  // the POV reel), so look fields are minimal literals for now.
  style_token: "Photorealistic vertical 9:16, authentic and candid, not studio or cinematic.",
  house_style_prompt: "",
  soul_id: undefined,
  cta_formats: ["Comment FUND", "Comment CASH", "Link in bio", "DM the word FUND"],
  gold_examples: [],
};

const PEST_OWNER_AI: Vertical = {
  id: "pest_owner_ai",
  name: "Pest Owner AI Content (B2B)",
  audience: "pest_owner",
  language: "es",
  status: "active",
  business_descriptor:
    "done-for-you AI short-form content service for pest control business owners",
  wearer_role: "pest control shop owner (solo operator or 3+ truck fleet)",
  avatar_doc_url: null,
  avatar_summary: [
    "Pest control shop owner (B2B target for an AI content-automation service). Two sub-profiles:",
    "the solo owner-operator (does treatments, drives the truck, answers or misses the phone, maxed",
    "out on time, the ceiling of his own business) and the 3+ truck operator (has techs, wants to",
    "grow predictably, thinks in routes/KPIs/recurring revenue, has likely worked with two or three",
    "agencies and been disappointed). Typical economics: ~$400K annual revenue, ~45% gross margins,",
    "and razor-thin per-customer math (\"At a $418 annual customer you're left with about $66 a year",
    "in profit. One reservice and that's gone.\").",
    "",
    "Mindset: proud tradespeople who trust what they can see and measure and are deeply skeptical of",
    "marketing they can't track (\"Not theory. These are the exact moves that actually work in the",
    "field.\"). They feel outgunned by national chains (\"You can't out-content Orkin\") but believe",
    "local beats corporate on trust and speed.",
    "",
    "The villain (rawest, angriest language): the lead-seller and the agency that took the money and",
    "delivered garbage. Verbatim: \"Angi Leads is a scam, they charge for the same lead more than",
    "once, DONT USE ANGI!\"; \"the leads are complete trash\"; \"I feel robbed\"; \"YOU WILL GO BROKE.",
    "THEY WILL STEAL YOUR MONEY FROM YOU\"; \"it was nothing but a time suck\"; owners who \"spent",
    "$50,000 to $200,000 over a few years on marketing that mostly produced cold leads, no-shows, and",
    "one-off jobs.\"",
    "",
    "Objections / beliefs about AI content and short-form video: \"TikTok/short-form isn't for my",
    "kind of business\" (\"my customers aren't on TikTok\"); \"I don't have time to be on camera / to",
    "record\"; \"social media is a time-wasting obligation\" (\"happy Tuesday posts that do absolutely",
    "nothing\"); \"AI content looks fake/generic\"; \"I tried an agency before and got burned\"; \"just",
    "show me it makes the phone ring.\"",
    "",
    "Hopes / dreams (their language): a full schedule, predictable growth, recurring revenue, and",
    "freedom from the truck. \"Stuck in the truck, stuck under a million dollars.\" They want to",
    "\"dominate their zip code\" and have \"winter stop being something you dread\" (\"the phone stops",
    "ringing, the leads dry up\"). Many eventually want to sell.",
    "",
    "Proof / curiosity hooks: a 19-second reel of a yellow-jacket nest removal reportedly drove \"four",
    "bookings in the following 48 hours\"; \"summer lead volume can be 5 times higher than winter\";",
    "speed-to-lead (\"78% of customers buy from the first business to respond\"; leads contacted within",
    "5 minutes are 21x more likely to qualify); \"a good truck wrap outperforms almost any paid ad in",
    "your neighborhood.\" Position AI content as the missing layer that makes everything else (LSAs,",
    "reviews, referrals, truck wraps, the ads they already run) work better, an owned asset, not",
    "another rented lead.",
  ].join("\n"),
  beliefs: [
    {
      n: 1,
      label: "La estrella polar (el reencuadre del problema)",
      text: "Creo que la razón por la que mi teléfono no suena lo suficiente no es que me falten leads, sino que soy un desconocido invisible para el homeowner hasta el momento exacto en que decide a quién llamar.",
    },
    {
      n: 2,
      label: "El mecanismo de la compra del cliente",
      text: "Creo que cuando una familia descubre una plaga, llama a la empresa que ya le resulta familiar y de confianza, no necesariamente a la más barata ni a la primera en Google, así que la familiaridad construida de antemano es lo que gana la llamada.",
    },
    {
      n: 3,
      label: "El canal",
      text: "Creo que el video corto en Reels, TikTok y Facebook sí llega a los homeowners de mi zona, y que su poder no está en volverme viral, sino en mantenerme presente y familiar frente a la gente que algún día me va a necesitar.",
    },
    {
      n: 4,
      label: "Activo vs. lead rentado (el gran diferenciador)",
      text: "Creo que un activo de contenido que yo poseo y que trabaja para mí los 12 meses es una inversión más inteligente que rentar leads que me cobran aunque no gane el trabajo y que desaparecen el día que dejo de pagar.",
    },
    {
      n: 5,
      label: "Viabilidad sin fricción (mata el 'no tengo tiempo' y el 'se ve falso')",
      text: "Creo que puedo tener presencia constante y profesional sin grabar, editar ni publicar nada yo mismo, y que ese contenido puede verse local y auténtico, como yo, en lugar de genérico o robótico.",
    },
    {
      n: 6,
      label: "El multiplicador (cierre, sobre todo para el operador de flota)",
      text: "Creo que este contenido no compite con los anuncios que ya corro, sino que los potencia: el contenido calienta a mi audiencia y baja mi costo por lead, y los anuncios amplían el alcance que hace que mi contenido convierta.",
    },
  ],
  offer: {
    ump: "La razón oculta por la que el teléfono no suena no es que necesite más leads, es que el dueño es un desconocido invisible en el momento de la decisión. El homeowner busca control de plagas 1-2 veces al año, en pánico, y llama a quien le resulta familiar; como el dueño solo aparece cuando paga por un lead, nunca construye esa familiaridad y siempre compite por precio contra Orkin y contra 3-4 contratistas a los que vendieron el mismo lead.",
    ums: "Un motor de contenido hecho-por-ti que produce 30 piezas de video corto al mes (TikTok, Reels, Facebook) construidas alrededor de SUS plagas, SU zona y SUS servicios reales para que se vea local, no genérico. No graba, no edita, no publica. Crea presencia constante y familiaridad en su zip code los 12 meses, y si ya corre anuncios, el contenido y los anuncios se alimentan mutuamente. Un activo que posee, no un lead que renta.",
    big_idea:
      "Dejaste de comprar clientes. Ahora los clientes ya te conocen antes de llamar. En vez de rentar leads que te cobran aunque no ganes el trabajo, construyes un activo propio, 30 videos al mes, que mantiene tu cara frente a tu zip code todo el año.",
    belief_chains: [
      "Mi problema real no es falta de leads, es que soy invisible y desconocido hasta el momento en que el cliente decide.",
      "La gente llama a quien le resulta familiar y confiable, no necesariamente al más barato ni al primero en Google.",
      "El video corto en Reels/TikTok/Facebook SÍ llega a homeowners de 35-60 en mi zona, no se trata de volverme viral, sino de estar presente.",
      "Un activo de contenido que yo poseo es mejor inversión que leads rentados que me cobran aunque no gane el trabajo.",
      "Puedo tener esto sin gastar tiempo, ellos lo hacen todo, y se ve local, no genérico.",
      "Si ya corro anuncios, esto los hace rendir más; no es un gasto extra, es un multiplicador.",
    ],
    objections: [
      {
        objection: "Ya me quemé con una agencia, pagué $2,000/mes por puros cold leads.",
        response:
          "No estás rentando leads aquí, estás construyendo un activo que posees; nadie revende el mismo lead a otros 20.",
      },
      {
        objection: "Mis clientes no están en TikTok, son homeowners, no adolescentes.",
        response:
          "Reels y TikTok ya llegan a homeowners de 35-60, y los mismos clips corren en Instagram y Facebook donde tus compradores definitivamente están. El punto no es viralidad, es familiaridad.",
      },
      {
        objection: "No tengo tiempo de estar frente a la cámara, vivo metido en crawl spaces.",
        response: "No grabas, no editas, no publicas nada. Lo producimos con IA, 30 piezas al mes, hands-off.",
      },
      {
        objection: "El contenido con IA se ve falso/genérico, no quiero parecer un robot.",
        response:
          "Lo construimos alrededor de tus servicios, tus plagas y tu zona para que se vea local, no genérico, contenido que se ve como tú.",
      },
      {
        objection: "Ya corro Google Ads, ¿para qué necesito esto también?",
        response:
          "Es el mejor caso para usarlo: tus anuncios y tu contenido se alimentan; el contenido calienta a tu audiencia y baja tu costo por lead, y los anuncios amplían el alcance. Uno hace que el otro rinda más.",
      },
      {
        objection: "¿Cómo sé que esto va a hacer sonar el teléfono?",
        evidence: "Un reel de 19 segundos de remoción de un nido de avispas reportó 4 bookings en 48 horas.",
        response: "Todo se juzga por trabajos agendados; el contenido construye la familiaridad que gana la llamada.",
      },
      {
        objection: "¿Cuánto cuesta? (con márgenes de $66/cliente el precio asusta).",
        response:
          "Es un activo que trabaja los 12 meses y baja tu costo por lead, no un lead suelto que pagas una y otra vez aunque no ganes el trabajo.",
      },
    ],
    headlines: [
      {
        angle: "Familiaridad / confianza",
        title: "Be The Name They Already Trust, Before They Ever Pick Up The Phone.",
        subtitle:
          "30 videos a month that keep your pest control business in front of your whole zip code, without you ever touching a camera.",
      },
      {
        angle: "Anti-lead-rentado",
        title: "Stop Renting Leads That Get Sold To 20 Other Guys.",
        subtitle:
          "Build a content asset you actually own, and watch winter stop being the season you dread.",
      },
      {
        angle: "Anti-chain / local",
        title: "You Can't Out-Spend Orkin. But You Can Out-Show-Up In Your Own Backyard.",
        subtitle:
          "30 done-for-you short videos a month that make you the familiar local face homeowners call first.",
      },
    ],
  },
  // No current runtime "look" for this B2B vertical yet; minimal literals for now.
  style_token: "Photorealistic vertical 9:16, local and authentic, not generic stock.",
  house_style_prompt: "",
  soul_id: undefined,
  cta_formats: ["DM the word REELS", "Link in bio", "Book a call"],
  gold_examples: [],
};

// TRT / hormone / med-spa clinic owner — the B2B avatar SRT sells AI-search visibility to.
// Mirrors pest_owner_ai (sell owners on visibility). The daily lane runs in drop_mode
// "broll_suggestions": 3 cinematic B-roll prompts per drop instead of the 9-image render path.
// Kit transcribed from Avatar_Dueno_Clinica_TRT.md, TRT AEO Beliefs.docx (the 9-belief ladder),
// Plantilla_Oferta_Corta_SRT_AI_Visibility.md, and Banco_Citas_Operador_SRT.md.
const TRT_CLINIC_AI: Vertical = {
  id: "trt_clinic_ai",
  name: "TRT Clinic AI Visibility (B2B)",
  audience: "business_owner",
  language: "en",
  status: "active",
  business_descriptor:
    "done-for-you AI-search visibility service for local TRT / hormone-optimization / med-spa clinics",
  wearer_role: "TRT / hormone clinic owner (escaped clinician or non-medical MSO operator)",
  avatar_doc_url: null,
  avatar_summary: [
    "The owner of a local, cash-pay TRT / hormone-optimization clinic in the U.S. (Sun Belt / South /",
    "Midwest metros: Tampa, Austin, Scottsdale, Nashville, Charlotte). 35-55, ~75-85% male, often a TRT",
    "user himself (lifts, listens to Huberman/Attia/More Plates More Dates). Two archetypes:",
    "  A) THE ESCAPED CLINICIAN - MD/DO/NP/PA who quit insured/hospital medicine to run a cash-pay clinic.",
    "     The 'escape' story is central: \"becoming disgruntled with the impersonal and over-controlling",
    "     physician-as-employee system.\" Values autonomy above almost everything.",
    "  B) THE MSO OPERATOR - non-medical entrepreneur (ex-fitness, ex-sales, ex-agency) who owns the",
    "     management-services org and contracts a medical director. Thinks in assets, multiples, exit value.",
    "",
    "Economics: recurring revenue $2,200-$5,800/patient/yr, retained-patient LTV $3,500-$4,500, ~88% gross",
    "margins (subscription-like). Anchor service TRT + peptides, GLP-1, female HRT, ED, NAD+. Real case:",
    "$3.3M revenue / $527K EBITDA across 6 locations.",
    "",
    "REGISTER (critical for copy): cold anger, dry sarcasm, resignation, and specific dollar figures - NOT",
    "B2C melodrama, never shame framing, never guru tone. He BUYS CONTROL, NOT MARKETING. Promises of more",
    "patients/leads trip his snake-oil detector; promises of measurable, self-verifiable visibility on his",
    "own device disarm it. He respects data with methodology (BrightLocal n=1,002; SOCi 350,000 locations;",
    "OpenAI 230M health queries/week) and despises hype. Vocabulary of the operator: my practice, my ad",
    "account, retainer, no-shows, medical director, cash-pay, front desk, chair time.",
    "",
    "Pains: (1) patient acquisition is unpredictable and referral-dependent (\"the 35-year reputation keeps",
    "a steady flow from word of mouth\" - works, but no dial on it); (2) paid channels are closed/rigged -",
    "Meta & Google reject testosterone ads (\"they hired someone to run Facebook ads... then everything got",
    "flagged and the account went down\"), while VC-funded telehealth (Ro $876M, Hone $39M) dominate the",
    "auctions he's locked out of; (3) the $99/month telehealth threat and DIGITAL INVISIBILITY - when a man",
    "in his city asks ChatGPT \"best TRT clinic near me,\" the answer is ~10 national telehealth brands and",
    "his clinic is absent (only 1.2% of local businesses appear in ChatGPT, SOCi 2026) - and he often does",
    "not even know it, or falsely believes he shows up because he checked on HIS phone.",
    "",
    "Deepest fear: going invisible while believing he is visible - the 'take a look at my phone' false",
    "security (Marcus Sheridan, 21 Hats, Feb 2026), followed by the bucket of cold water: \"You're not one",
    "of the best - at least not in the eyes of ChatGPT when it's talking to me.\" Skeptic-because-burned, not",
    "ignorant: his first reaction to 'AEO' is \"I can't see how AEO/GEO meaningfully differs from traditional",
    "SEO.\" The copy must AGREE with him first (most AEO is snake oil), then differentiate on the one thing",
    "no honest vendor can fake: measurable, neutral-account, self-verifiable AI-answer visibility.",
  ].join("\n"),
  beliefs: [
    {
      n: 1,
      label: "The foundation - patients ask AI, not Google (install with data, not adjectives)",
      text: "Creo que una parte creciente y significativa de mis futuros pacientes ya no me busca en Google, le pregunta directamente a la IA, y la IA decide por ellos.",
    },
    {
      n: 2,
      label: "The personal wound - his city's answer omits him (install with the live demo)",
      text: "Creo que cuando un hombre de mi ciudad le pregunta a ChatGPT dónde tratarse, la respuesta recomienda a los telehealth nacionales de $99/mes, y mi clínica no existe en ella.",
    },
    {
      n: 3,
      label: "Kills false security - neutral account is the only true view",
      text: "Creo que verlo en mi propio teléfono no prueba nada, las respuestas de IA son personalizadas, y la única vista que cuenta es la del paciente que todavía no me conoce.",
    },
    {
      n: 4,
      label: "Absolution - not his medicine or website (~85% off-site)",
      text: "Creo que mi invisibilidad no es culpa de mi medicina ni de mi sitio web, la IA cita fuentes de terceros donde nunca he trabajado mi presencia, así que mis años de SEO no me protegen aquí.",
    },
    {
      n: 5,
      label: "Paid channels are closed/rigged against him",
      text: "Creo que los canales pagados están cerrados o amañados en mi contra, Meta y Google vetan mis ads mientras los telehealth con cientos de millones de capital de riesgo dominan todo lo comprable.",
    },
    {
      n: 6,
      label: "Hope pivot - AI is a game of signals, not an auction",
      text: "Creo que el canal de IA es distinto: no es una subasta que gana el que más paga, sino un juego de señales, y las señales están hoy al alcance de una clínica local como la mía.",
    },
    {
      n: 7,
      label: "Most 'AEO' is snake oil - demand verifiable results (the contrarian hinge)",
      text: "Creo que la mayoría de quienes venden 'AEO' son humo, y que la única forma legítima de comprar esto es exigir resultados que yo pueda verificar por mí mismo, sin creerle a la agencia.",
    },
    {
      n: 8,
      label: "Trust in SRT - only promises the measurable, never patients",
      text: "Creo que SRT es diferente porque solo promete lo medible, apariciones verificadas en cuentas neutrales, y jamás pacientes ni ingresos, que es exactamente lo que prometería un estafador.",
    },
    {
      n: 9,
      label: "Urgency - the window closes, one clinic per market (warm/retargeting only)",
      text: "Creo que esta ventana se cierra: la posición en la respuesta de IA es acumulativa, solo hay lugar para una clínica por mercado, y si no la tomo yo la tomará mi competidor, y defender cuesta más que conquistar.",
    },
  ],
  offer: {
    ump: "The Invisibility of the Moment of Intent: the high-value patient no longer compares ten clinics on Google, he asks the AI and the AI decides for him, using signals the clinic isn't emitting. ~85% of AI citations come from off-site third-party sources (arXiv; Muck Rack; Ranqo) and web-traffic-to-citation correlation is a flat r=0.02 (Brandlight), so his website and SEO barely count. In TRT the cited sources are a closed affiliate ecosystem of ~10 national $99/month telehealth brands, so local clinics aren't ranked low, they're structurally absent: only 1.2% of local businesses appear in ChatGPT vs 35.9% in Google's local pack (SOCi, 350,000 locations, 2026).",
    ums: "The Citation Signal System: (1) baseline audit from neutral accounts documenting what ChatGPT/Perplexity/Gemini answer today for TRT in his city; (2) presence in the sources the AI actually cites, local 'best TRT clinic in [city]' listicles, medical directories with consistent NAP, a 4.3-star review floor (ChatGPT's de-facto threshold), and the Reddit/forum threads ChatGPT cites ~10x more than any other network; (3) citable content answering the 20 real questions men ask before choosing a clinic; (4) a monthly Share of AI Citations report he can verify himself, on his own device, from a neutral account, with the exact prompts included. We guarantee only measurable visibility (verified appearance), never patients or revenue.",
    big_idea:
      "Right now a man in your city is asking ChatGPT where to treat low testosterone. The answer names Hone, Fountain, and TRT Nation, $99/month telehealth with hundreds of millions in venture capital. Your clinic does not exist in that answer. Meta and Google closed your ads; the VCs bought the paid channels. But the AI channel is not an auction, it is not won with budget, it is won with signals, and today only 1.2% of local businesses have them. That is the window, and it is closing.",
    belief_chains: [
      "My new patients no longer start only on Google, a growing share asks AI directly, and the AI decides for them.",
      "In those answers today only the national $99/month telehealth brands exist; my clinic is invisible at the exact moment of decision.",
      "This is not my medicine's fault or my website's: AI citations come from third-party sources where I have never built a presence.",
      "The paid channels are closed to me (Meta/Google bans), but the AI channel is not an auction: it is won with signals, not budget.",
      "Most who sell 'AEO' are smoke, but there is an honest way: measure real appearances in neutral accounts, never promising patients.",
      "SRT is that honest way, it knows my niche (my patients, my competitors, my questions), and it takes only one clinic per market.",
      "If I do not act now, my city's position goes to my competitor, and defending costs more than conquering.",
    ],
    objections: [
      {
        objection: "This is SEO with a new name, another agency fad.",
        evidence: "\"I can't see how AEO/GEO meaningfully differs from traditional SEO practices.\" (redditor, via CXL)",
        response:
          "Half right, most of it is (the trade press itself calls the category snake oil). The measurable difference: SEO optimizes YOUR site; here ~85% of AI citations come from third-party sources (arXiv, Muck Rack, Ranqo) and the web-traffic-to-citation correlation is r=0.02 (Brandlight). Different game, different rules, and we show you the sources with methodology, not agency blogs.",
      },
      {
        objection: "I already show up in ChatGPT, I checked on my phone.",
        evidence: "\"take a look at my phone\" -> \"You're not one of the best, at least not in the eyes of ChatGPT when it's talking to me.\" (Marcus Sheridan, 21 Hats)",
        response:
          "That's exactly what a business owner told Marcus Sheridan. AI answers are personalized, your phone knows you. That's why all our measurement is from neutral accounts, the view of the patient who doesn't know you yet.",
      },
      {
        objection: "AI is random, you can't 'rank' in it.",
        response:
          "Correct, and anyone promising a '#1 ranking in ChatGPT' is lying, the engines are non-deterministic. What IS measurable is frequency of appearance across N repeated neutral queries, share of citations. We don't promise determinism; we move a ~0% probability to consistent, documented presence.",
      },
      {
        objection: "Two agencies already burned me. Why are you different?",
        response:
          "Because we invert the burden of proof: documented baseline before the second month is billed, reports with neutral-account screenshots you can replicate yourself without us, and a guarantee tied to a verifiable result (appearance in 60-90 days), not to 'impressions' or 'brand positioning.'",
      },
      {
        objection: "How many people actually use this to choose a clinic?",
        evidence: "230M weekly health queries on ChatGPT (OpenAI, Jan 2026); 45% use AI for local recs vs 6% a year ago (BrightLocal, n=1,002, Feb 2026).",
        response:
          "AI is already the #3 local-discovery channel, above Yelp. It's not the future, it's last quarter.",
      },
      {
        objection: "What if I just wait to see if this grows?",
        response:
          "Waiting is asymmetric: position is cumulative (the citable sources consolidate) and we sell one clinic per market. When your competitor takes it, or the niche passes ~10-15% visibility, the pitch changes from 'conquer the answer' to 'fight to displace them.' In 2005 claiming your Google Maps pin also felt optional.",
      },
    ],
    headlines: [
      {
        angle: "Shock / live demo (best for cold email)",
        title: "I Asked ChatGPT for the Best TRT Clinic in [City]. Your Name Didn't Come Up.",
        subtitle:
          "Hone, Fountain, and TRT Nation did, $99/month telehealth. 45% of consumers now ask AI. I'll show you your city's screenshot, free, no strings.",
      },
      {
        angle: "Anti-system / rigged game",
        title: "Meta Banned Your Ads. So Did Google. And ChatGPT Recommends Your Competition, Funded With $876M in Venture Capital.",
        subtitle:
          "The AI channel isn't an auction: it's won with the right signals, not the biggest budget. Only 1.2% of local businesses have them. We put you in that 1.2%, with results you verify on your own phone.",
      },
      {
        angle: "Radical honesty (kills the 'isn't this just SEO' objection)",
        title: "Most 'AEO' Is Snake Oil. That's Why We Only Guarantee What You Can Verify Yourself.",
        subtitle:
          "No promised patients, no magic dashboards: real appearances in ChatGPT, Perplexity, and Gemini for 'best TRT clinic in [your city]', verified from a neutral account, in 60-90 days, or we keep working free.",
      },
      {
        angle: "Historical window",
        title: "It's 2005 Again. The Businesses That Claimed Google Maps First Dominated for 15 Years. Now It's AI's Turn.",
        subtitle:
          "Only 1.2% of local businesses appear in ChatGPT today. In your city, that seat is still empty. One clinic per market, yours or your competitor's.",
      },
    ],
  },
  // Cinematic clinic look for the B-roll suggestion generator (never bright studio/promo gloss).
  style_token:
    "Photorealistic cinematic vertical 9:16, muted desaturated color grade, shallow depth of field, 35mm film look, soft natural or cool clinical lighting, restrained and quiet.",
  house_style_prompt: "",
  soul_id: undefined,
  cta_formats: ["Reply with your city", "Free AI Visibility Audit", "DM the word AUDIT"],
  gold_examples: [],
  // Object b-roll only. Generated clinic-owner portraits read as stock and the operator will
  // not shoot them; empty rooms and lit screens carry the "you are not in the answer" point
  // better than a man standing at a front desk.
  visual_rules: [
    "No people. No faces, no bodies, no hands, no silhouettes, no reflection of a person. If a human would be the subject, shoot the object or the room instead.",
    "The subject is always a thing or a place: documents, printouts, index cards, screens, a phone face-down on a surface, monitors, chat interfaces, waiting rooms, hallways, exam rooms, storefronts, signage, parking lots at night, textures, fog, light.",
    "Shot vocabulary that works: overhead flat-lay on a dark matte surface; a web of string connecting printed cards; a magnifier over printed pages; a lit clinic interior seen from a wet street at night; a neon medical cross in fog; a screen glowing in a dark room; an LED grid with one dot lit; a desk with printed reports and a phone face-down.",
    "Absence carries the meaning: the room with nobody in it, the phone nobody is holding, the chair nobody is sitting in.",
    "Paper and screens are welcome as props, but never ask for readable words on them: describe the lettering as out of focus, too small to read, or turned away. The headline overlay is the only text anyone should be able to read, and generated lettering comes out garbled anyway.",
    "Every shot must leave clear space for the timed headline overlays.",
  ],
  image_negative: "No people, faces, hands, or human figures in the image.",
  drop_mode: "broll_suggestions",
};

export const SEED_VERTICALS: Record<string, Vertical> = {
  pest_control: PEST_CONTROL,
  mca: MCA,
  pest_owner_ai: PEST_OWNER_AI,
  trt_clinic_ai: TRT_CLINIC_AI,
};

function seedFor(id: string): Vertical {
  return SEED_VERTICALS[id] ?? SEED_VERTICALS[DEFAULT_VERTICAL_ID];
}

// ---------------------------------------------------------------------------------------
// Loaders
// ---------------------------------------------------------------------------------------

// Row shape as stored in the `verticals` table (jsonb columns arrive parsed). Every column
// is nullable here so a partially-populated row (e.g. the SQL seed that leaves look fields
// null) merges cleanly over the in-code seed.
interface VerticalRow {
  id: string;
  name?: string | null;
  audience?: string | null;
  language?: string | null;
  status?: string | null;
  business_descriptor?: string | null;
  wearer_role?: string | null;
  avatar_doc_url?: string | null;
  avatar_summary?: string | null;
  beliefs?: Belief[] | null;
  offer?: Offer | null;
  style_token?: string | null;
  house_style_prompt?: string | null;
  soul_id?: string | null;
  cta_formats?: string[] | null;
  gold_examples?: PovGoldExample[] | null;
  slack_drop_channel_id?: string | null;
  owner_vertical_id?: string | null;
  workflow_vertical_id?: string | null;
  sales_letter_examples?: string | null;
  sales_letter_swipe?: string | null;
  drop_mode?: string | null;
}

// Merge a DB row OVER a seed: a non-null/non-empty DB value wins, otherwise the seed fills
// the gap. This is what lets the SQL seed leave look fields null and still get the correct
// (today-faithful) style_token / house_style_prompt / gold_examples / soul_id from the seed.
function mergeRowOverSeed(seed: Vertical, row: VerticalRow): Vertical {
  const pick = <T>(rowVal: T | null | undefined, seedVal: T): T => {
    if (rowVal === null || rowVal === undefined) return seedVal;
    if (typeof rowVal === "string" && rowVal.trim() === "") return seedVal;
    if (Array.isArray(rowVal) && rowVal.length === 0) return seedVal;
    return rowVal;
  };
  return {
    id: row.id || seed.id,
    name: pick(row.name, seed.name),
    audience: pick(row.audience, seed.audience),
    language: pick(row.language, seed.language),
    status: pick(row.status, seed.status),
    business_descriptor: pick(row.business_descriptor, seed.business_descriptor),
    wearer_role: pick(row.wearer_role, seed.wearer_role),
    avatar_doc_url: pick(row.avatar_doc_url, seed.avatar_doc_url ?? null),
    avatar_summary: pick(row.avatar_summary, seed.avatar_summary),
    beliefs: pick(row.beliefs, seed.beliefs),
    offer: pick(row.offer, seed.offer),
    style_token: pick(row.style_token, seed.style_token),
    house_style_prompt: pick(row.house_style_prompt, seed.house_style_prompt),
    soul_id: pick(row.soul_id, seed.soul_id),
    cta_formats: pick(row.cta_formats, seed.cta_formats),
    gold_examples: pick(row.gold_examples, seed.gold_examples),
    // Drop-studio wiring is ROW-ONLY (no seed fallback): seedFor(unknownId) is the pest
    // seed, and inheriting these would bleed pest channel/voice into new avatars.
    slack_drop_channel_id: row.slack_drop_channel_id ?? null,
    owner_vertical_id: row.owner_vertical_id ?? null,
    workflow_vertical_id: row.workflow_vertical_id ?? null,
    sales_letter_examples: row.sales_letter_examples ?? null,
    sales_letter_swipe: row.sales_letter_swipe ?? null,
    // drop_mode is a normal field (not sensitive wiring): a DB value wins, else the seed's
    // (so trt_clinic_ai stays "broll_suggestions" even if a row is inserted without it).
    drop_mode: pick(row.drop_mode, seed.drop_mode ?? null),
    // Scene pools and the subject contract are not DB columns yet, so they always inherit
    // the seed. Deliberately NOT pick()'d: seedFor(unknownId) returns the pest seed, and a
    // new avatar must not silently inherit another avatar's banned-subject law.
    scenes: seed.scenes,
    scene_variations: seed.scene_variations,
    style_version: seed.style_version,
    visual_rules: seed.visual_rules,
    image_negative: seed.image_negative,
  };
}

// Load a vertical kit: DB row merged over the seed; falls back to the seed when the table is
// empty/missing or unreachable (defensive, mirrors the rotation reads in pov.ts). Unknown ids
// fall back to the default vertical so callers always get a usable kit.
export async function loadVertical(id: string): Promise<Vertical> {
  const seed = seedFor(id);
  try {
    const { data, error } = await supabaseAdmin
      .from("verticals")
      .select("*")
      .eq("id", id)
      .maybeSingle();
    if (!error && data) return mergeRowOverSeed(seed, data as VerticalRow);
  } catch (e) {
    console.error("[verticals] loadVertical fell back to seed:", (e as Error).message);
  }
  return seed;
}

// The active vertical, selected by env CONTENT_VERTICAL (default pest_control).
export async function getActiveVertical(): Promise<Vertical> {
  const id = process.env.CONTENT_VERTICAL || DEFAULT_VERTICAL_ID;
  return loadVertical(id);
}

// ---------------------------------------------------------------------------------------
// Drop-studio channel wiring (any vertical can own a Slack drop channel; adding one is a
// SQL paste — set verticals.slack_drop_channel_id — no deploy needed).
// ---------------------------------------------------------------------------------------

/** The avatar the post-render sales letter speaks to. Falls back to the historical
 *  pest_control -> pest_owner_ai pairing; otherwise the vertical speaks for itself. */
export function dropOwnerVerticalId(v: Vertical): string {
  if (v.owner_vertical_id) return v.owner_vertical_id;
  return v.id === DEFAULT_VERTICAL_ID ? "pest_owner_ai" : v.id;
}

/** Which vertical's workflow library this drop channel matches against. Defaults to the
 *  shared pest_control library so new channels reuse the existing workflows. */
export function dropWorkflowLibraryId(v: Vertical): string {
  return v.workflow_vertical_id || DEFAULT_VERTICAL_ID;
}

/** How this vertical's daily drop behaves. "reel_prompts" (default) = the LRU-workflow / 9
 *  image-prompt / auto-render lane; "broll_suggestions" = post 3 cinematic B-roll prompts
 *  (text only, operator generates the video externally). */
export function dropMode(v: Vertical): string {
  return v.drop_mode || "reel_prompts";
}

// channelId -> vertical id (or null = known non-drop channel). Negative entries matter:
// this lookup runs for every Slack message event in every channel, and the cache is what
// keeps it off the events route's 3s ack budget.
const dropChannelCache = new Map<string, { verticalId: string | null; expires: number }>();
const DROP_CHANNEL_CACHE_MS = 60_000;

/** Resolve a Slack channel to its drop vertical. A verticals.slack_drop_channel_id row WINS
 *  (so a new avatar can take over a channel, e.g. trt_clinic_ai over #ai-content-pest-control);
 *  the env pest channel is only the fallback when no row claims it. Returns null when the
 *  channel is not a drop channel (or the DB is unreachable — fail open to the env mapping). */
export async function resolveDropVertical(channelId: string): Promise<Vertical | null> {
  if (!channelId) return null;
  const envPestChannel = process.env.SLACK_AI_CONTENT_PEST_CONTROL_CHANNEL || "";
  const envFallback = (): Promise<Vertical> | null =>
    envPestChannel && channelId === envPestChannel ? loadVertical(DEFAULT_VERTICAL_ID) : null;

  const cached = dropChannelCache.get(channelId);
  if (cached && cached.expires > Date.now()) {
    return cached.verticalId ? loadVertical(cached.verticalId) : envFallback();
  }
  let verticalId: string | null = null;
  try {
    const { data, error } = await supabaseAdmin
      .from("verticals")
      .select("id")
      .eq("slack_drop_channel_id", channelId)
      .maybeSingle();
    if (!error && data?.id) verticalId = data.id as string;
  } catch (e) {
    console.error("[verticals] resolveDropVertical lookup failed:", (e as Error).message);
    return envFallback(); // don't cache errors; keep the env mapping working
  }
  dropChannelCache.set(channelId, { verticalId, expires: Date.now() + DROP_CHANNEL_CACHE_MS });
  return verticalId ? loadVertical(verticalId) : envFallback();
}

/** Every wired drop channel: every verticals row with a slack_drop_channel_id, plus the env
 *  pest channel UNLESS a row already claims it (so trt_clinic_ai taking over
 *  #ai-content-pest-control retires the pest drop). Deduped by channel; used by the cron. */
export async function listDropChannels(): Promise<Array<{ channelId: string; verticalId: string }>> {
  const out = new Map<string, string>();
  try {
    const { data } = await supabaseAdmin
      .from("verticals")
      .select("id,slack_drop_channel_id")
      .not("slack_drop_channel_id", "is", null);
    for (const r of (data ?? []) as Array<{ id: string; slack_drop_channel_id: string | null }>) {
      if (r.slack_drop_channel_id && !out.has(r.slack_drop_channel_id)) {
        out.set(r.slack_drop_channel_id, r.id);
      }
    }
  } catch (e) {
    console.error("[verticals] listDropChannels table read failed:", (e as Error).message);
  }
  const envPestChannel = process.env.SLACK_AI_CONTENT_PEST_CONTROL_CHANNEL || "";
  if (envPestChannel && !out.has(envPestChannel)) out.set(envPestChannel, DEFAULT_VERTICAL_ID);
  return Array.from(out.entries()).map(([channelId, verticalId]) => ({ channelId, verticalId }));
}

// List every avatar (DB rows merged over the in-code seeds), for the `go` picker. Best-effort:
// falls back to the seeds when the table is empty/unreachable.
export async function listVerticals(): Promise<Array<{ id: string; name: string; status: string }>> {
  const byId = new Map<string, { id: string; name: string; status: string }>();
  for (const v of Object.values(SEED_VERTICALS)) byId.set(v.id, { id: v.id, name: v.name, status: v.status });
  try {
    const { data } = await supabaseAdmin.from("verticals").select("id,name,status");
    if (Array.isArray(data)) {
      for (const r of data as Array<{ id: string; name?: string; status?: string }>) {
        byId.set(r.id, { id: r.id, name: r.name || r.id, status: r.status || "active" });
      }
    }
  } catch (e) {
    console.error("[verticals] listVerticals fell back to seed:", (e as Error).message);
  }
  return Array.from(byId.values());
}
