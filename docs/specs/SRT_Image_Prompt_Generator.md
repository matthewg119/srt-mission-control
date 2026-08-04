# SRT — GENERADOR DE IMÁGENES DREAM-LEAD
**La imagen que abre cada Loom: el lead exacto que van a recibir.** Se llena el bloque VARIABLES, se copia desde `SYSTEM PROMPT START` hasta `SYSTEM PROMPT END`, se pega en ChatGPT (modo imagen), y se regenera hasta que el texto salga limpio. El prompt va en inglés (los generadores de imagen rinden mejor así); el mensaje del lead va en el idioma del cliente final.

---

## VARIABLES (llenar antes de pegar)
```
{BUSINESS_NAME}     = nombre exacto del prospecto, tal cual su GBP
{CITY}              =
{NICHE}             =
{AVATAR}            = el pick del intel brief (ej. "property manager with 3 office plazas")
{TICKET_SIGNAL}     = detalles concretos que implican el ticket SIN cifras
                      (sq ft, # de propiedades, tipo de tratamiento, headcount del evento)
{AVATAR_QUESTION}   = la pregunta que ese comprador le hace a ChatGPT
{PRESET}            = PHONE_ALERT | INBOX_FORM | SPLIT_SCREEN | BOOKING_ALERT
{LEAD_LANGUAGE}     = English | Español (idioma del CLIENTE FINAL, no del dueño)
{FAILED_COMPETITOR} = sí / no (el lead menciona que otra empresa le falló primero)
{ATTACHMENTS}       = fotos que ese lead subiría (ej. "flooded basement photos",
                      "close-crop smile photo", "office plaza lawns")
```

## PRESETS — cuál usar
- **PHONE_ALERT** — emergencias y servicios de campo (restauración, plomería, pest, HVAC, landscaping). Ese dueño vive en el teléfono. Composición: mano sosteniendo iPhone, inquiry recién abierto.
- **INBOX_FORM** — B2B, bids comerciales, property managers, industrial (tipo Cellunetics). Ese dueño vive en el correo. Composición: bandeja de escritorio con el form submission abierto.
- **SPLIT_SCREEN** — médico / dental / estético (Invisalign, implantes, fillers). Izquierda: el lead form con campos de calificación. Derecha: el teléfono con la alerta y 2–3 badges. Es el formato del ejemplo de Invisalign.
- **BOOKING_ALERT** — restaurantes / catering / venues. Alerta de pedido o booking grande entrando.

---

## SYSTEM PROMPT START

You are generating a hyper-realistic marketing image for a sales presentation targeting {NICHE} business owners.

**Purpose:** demonstrate ONE high-quality {AVATAR} inquiry arriving in the owner's real world — visually proving lead quality, buyer intent, and where the lead came from. The owner must look at this image and feel: *"I want more of exactly this."*

**The image must feel:** authentic, emotionally believable, and operationally realistic. Nothing staged, nothing corporate, no stock-photo energy.

### SCENE OBJECTIVE
*(keep only the block matching {PRESET}, delete the rest)*

**PHONE_ALERT:** A hand holding an iPhone — outdoors near a work truck or at a kitchen counter, natural light — screen in sharp focus showing a just-opened new-inquiry notification/email addressed to {BUSINESS_NAME}. Everything outside the screen softly blurred, shallow depth of field.

**INBOX_FORM:** A realistic desktop inbox (Gmail/Outlook style) with one website contact-form submission open, addressed to {BUSINESS_NAME}. Believable browser chrome, labels/tags visible, office context softly blurred behind.

**SPLIT_SCREEN:** Split composition. LEFT SIDE: a realistic lead-form submission (Facebook lead form or website form) branded {BUSINESS_NAME}, with labeled fields. RIGHT SIDE: an iPhone lock screen showing the same lead arriving as a notification for {BUSINESS_NAME}, with 2–3 small qualification badges (e.g., "High-Intent Lead", "New {Patient/Client}", "{avatar tag}").

**BOOKING_ALERT:** A phone in hand showing a large incoming order/booking notification for {BUSINESS_NAME}, with order details, headcount, and date visible.

### THE LEAD — non-negotiable content
- The person inquiring IS: {AVATAR}.
- Ticket size is implied ONLY through concrete details: {TICKET_SIGNAL}. Never show dollar amounts.
- The message is first person, motivated, slightly urgent, 60–110 words, written in {LEAD_LANGUAGE}. It reads like a real human typing fast — not marketing copy.
- It MUST contain this line, nearly verbatim: **"I asked ChatGPT for {AVATAR_QUESTION} and {BUSINESS_NAME} came up."**
- *(If {FAILED_COMPETITOR} = sí)* The message mentions they tried another company first and got no answer or got let down.
- It includes readiness signals natural to the niche: timeline ("this week", "before the 15th"), decision authority, insurance/financing/budget-ready phrasing where relevant.
- Attached: {ATTACHMENTS}, shown as 2–4 small realistic photo thumbnails.

### FIELDS (only when the preset shows a form)
Show labeled fields the owner instantly recognizes: Name, Phone, Email, Address — all visibly filled but blurred — plus 3–5 qualification fields specific to the niche (e.g., Insurance: Yes · Payment Preference: Open to plans · Timeline: Wants to start soon · Property type · Preferred day). **Qualification fields stay legible — they are the proof of lead quality.**

### PRIVACY & REALISM
- Name, phone number, email, street address: present but blurred.
- Photos may include close-crop, non-identifiable shots (a smile crop, a flooded basement, a lawn) — never a full recognizable face.
- Native, pixel-accurate UI ({iOS Mail / notification shade / Facebook lead form}), believable timestamp, "Submitted 2 minutes ago."
- Natural lighting, shallow depth of field, correct spelling on every legible word.
- {BUSINESS_NAME} appears exactly as written — it is the one name that must be perfectly legible.

### OUTPUT
ONE image, ONE lead. This will be shown full-screen as the opening of a sales video — every legible word must be clean and correctly spelled.

## SYSTEM PROMPT END

---

## LOOP DE RENDER (reglas de la casa)
1. Texto deforme → responde: *"Same scene, same layout — fix all on-screen text so every word is spelled correctly."* Repite hasta limpio.
2. La línea de ChatGPT no se negocia. Si el modelo la parafrasea raro, pídela textual.
3. Un lead por imagen. ¿Quieres form + teléfono? Eso es SPLIT_SCREEN, no dos imágenes.
4. Archivo: `{Business}_dreamlead.png` → página 1 del doc del pitch.
5. **Honestidad:** en el Loom, la imagen se presenta SIEMPRE como *"the exact kind of inquiry we point at your phone"* — jamás como un lead real ya generado. Lo mostrado es el objetivo, no el historial.

---

## EJEMPLO LLENO — Grove City Family Dentistry (SPLIT_SCREEN)
```
{BUSINESS_NAME}     = Grove City Family Dentistry
{CITY}              = Grove City, OH
{NICHE}             = family & cosmetic dentistry
{AVATAR}            = adult professional, 35–55, ready to fix their smile
{TICKET_SIGNAL}     = full Invisalign treatment, has insurance, open to financing,
                      wants consultation next week
{AVATAR_QUESTION}   = the best Invisalign provider in Grove City
{PRESET}            = SPLIT_SCREEN
{LEAD_LANGUAGE}     = English
{FAILED_COMPETITOR} = no
{ATTACHMENTS}       = close-crop smile photo
```
Mensaje del lead que debe aparecer en pantalla (referencia de tono):
> "I've been thinking about fixing my smile for years — my teeth shifted after braces and it's started affecting me professionally. I asked ChatGPT for the best Invisalign provider in Grove City and Grove City Family Dentistry came up. I have insurance and I'm open to financing. I'd love to schedule a consultation — I'm available next week."
