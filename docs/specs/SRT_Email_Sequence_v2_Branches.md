# SRT — EMAIL SEQUENCE v2: LAS 3 RAMAS + LA JUGADA DE PRECIO
**Extiende `SRT_Email_Sequence.md` (que sigue siendo la fuente de la Rama A). Copy de prospecto: inglés. Notas: español.**
Cadencia idéntica en las 3 ramas: **D0 · D+1 · D+2 · D+4 · D+7**, todo en el MISMO hilo (`re:` del mismo asunto). Subject estándar: **`{company} + ChatGPT`** — nunca scores, nunca signos de exclamación, nunca "New website!".

---

## LA REGLA DE MUNICIÓN (por qué existen las ramas)

Cada hallazgo del audit es UNA bala. El email 1 dispara solo la mejor; las demás se guardan para D+2 y D+4. Si metes dos hallazgos en un email, el segundo no genera curiosidad — genera saturación, y te quedas sin nada que decir el día 4.

**El esqueleto universal del D0 (máx. 5 oraciones):**
1. Hallazgo verificable (algo que él puede comprobar en 10 segundos)
2. Stakes en una línea (quién se está llevando la respuesta)
3. Give + permiso ("Mind if I send it here?")
4. "Yours to keep either way."

---

## CÓMO ELEGIR RAMA

| Lo que encontró el audit | Rama |
|---|---|
| No aparece en las respuestas; el competidor sí | **A** — doc original |
| Su infraestructura está rota (redirect, teléfonos duplicados, dominios regados, robots.txt) | **B** — Dead End |
| Aparece parcialmente (ej. 12/20) y ya le construimos el rebuild como give | **C** — Partial + Rebuild |

---

# 🌿 RAMA B — "THE DEAD END" (infraestructura rota — tipo Grove City)

Munición típica del run: (1) el redirect / callejón sin salida, (2) los {N} teléfonos distintos, (3) los {M} dominios separados. Una por email, en ese orden.

### 📧 D0 — El hallazgo más visceral + permiso
**Subject:** `{domain} + ChatGPT`

> Dr. {name} — you filled out our form about AI search, so before calling I typed {domain} into my browser. It sent me to your Facebook page instead. Desktop, mobile, incognito — same result every time.
>
> That's the same dead end AI assistants hit, which is why ChatGPT names {Competitor} when someone asks for a {vertical} in {city}.
>
> I recorded a 4-minute video showing exactly what I found. Mind if I send it here? The one-page scorecard is yours to keep either way.

### 📧 D+1 — Reformula el ask, más corto
> Dr. {name} — following up. The video's 4 minutes: where {company} lands across ChatGPT, Perplexity, Gemini and Google's AI, and what people actually hit when they try to reach you. Want me to drop it here?

### 📧 D+2 — Bala 2: los teléfonos (stakes)
> Quick context on why this matters: {company} is publishing {N} different phone numbers across the web right now. A patient only needs one — but an AI engine that sees {N} conflicting records can't confirm which one is real, so it recommends someone it can verify. In {city}, that's {Competitor}. The 4-minute breakdown is ready whenever you want it.

### 📧 D+4 — Bala 3: los dominios (absolución)
> Dr. {name} — one more thing from the run: your listings live across {M} separate domains. None of that's your fault — it's what happens when a practice has been online since {year} and different people add things over the years. It's also exactly what AI reads to decide who's real, and it's a fix, not a rebuild. Say the word and the video's yours.

### 📧 D+7 — Pattern interrupt + salida limpia
> Dr. {name}, am I chasing a ghost here? 🕵️
>
> Last try — the scorecard showing exactly where {company} dead-ends and which records conflict is done, and it's yours free, video or no video. Reply with a thumbs up and I'll send it over. If it's not for you, no hard feelings and I'll stop the emails.

---

# 🌿 RAMA C — "PARTIAL + REBUILD" (aparece en {X}/20 y ya existe el give — tipo American S&T)

Aquí el give (el homepage reconstruido) ES la munición central. El link del preview se entrega SOLO después de que contesten — nunca en frío (deliverability + les da una razón física para responder).

### 📧 D0 — El score parcial + el give
**Subject:** `{company} + ChatGPT`

> Hi {name} — I asked the AI engines where a {county} homeowner should {buy/hire} {service}. {company} shows up in {X} of the 20 answers. The other {20-X} send them to {Competitor}.
>
> Rather than just send the news, I rebuilt your homepage the way the engines need to read it — from your own collections, your {years} years. Nothing owed, nothing to sign.
>
> Want the preview link and the breakdown?

### 📧 D+1 — El give como gancho, ultra corto
> Hi {name} — the rebuilt homepage is sitting here with your name on it. Two-minute look, nothing owed. Want the link?

### 📧 D+2 — Stakes con el dato aprobado
> Context on why I checked in the first place: a year ago 6% of people used AI to find a local business — today it's 45%. Every answer that skips {company} sends a {county} homeowner to {Competitor} instead. The preview and the full breakdown are ready whenever you say the word.

### 📧 D+4 — Va más profundo: las preguntas exactas que pierde
> Hi {name} — one number stood out: the {20-X} answers you're missing are the exact questions buyers type before choosing — {question1}, {question2}, {question3}. Your business knows those answers; the engines just can't read them yet. That's what the rebuild fixes, and it's yours to look at either way.

### 📧 D+7 — Salida limpia con el regalo doble
> {name}, last one from me. The rebuilt homepage and the scorecard are done and they're yours free — no call, no contract. Thumbs up and I'll send both. If it's not for you, no hard feelings and I'll close the file.

---

# 💰 LA JUGADA DE PRECIO (cualquier rama, cualquier momento)

Cuando preguntan cuánto cuesta, se responde EL MISMO DÍA con esta estructura — sin excepciones, sin video de precios, sin dos opciones iguales:

1. **El número — UNA opción recomendada** (la alternativa, máximo en un paréntesis)
2. **Una línea de qué compra ese número**, en el idioma de su mercado
3. **El paso exacto de compra:** `Reply "I'm in" and I'll send the start link — [deliverable] live in [X] days.`
4. **Qué pasa después de pagar**, una línea ("no fireworks, just work")
5. **Número de texto en el cuerpo**
6. P.S. opcional: exclusividad o timeline. Nada más.

### Modelo (el email que Raul debió recibir):
> {Name} — glad it beats what you have. Straight answer:
>
> **$349/month, all in** — the new site live, your SEO, and the AI visibility work that puts {company} in the answer when someone asks ChatGPT for {their category} in {city}. No build fee, the site's included. (There's a $299 version without the site, but you already like the site — take the $349.)
>
> To start: reply **"I'm in"** and I'll send the setup link. Five minutes on your end, site's live within [X] days. The full audit report I'll send you today either way — that's yours to keep.
>
> Questions? Text me: {phone}.

**Reglas duras del cierre:** el give nunca se convierte en rehén ("just a demo" está prohibido); el email termina en UNA acción; timeline siempre concreto y siempre cumplible; espeja su registro (casual recibe casual, móvil recibe corto); proofread — "Kind regards", no "King regards".

---

## SLOTS NUEVOS (todos del run del día — cero research el día de envío)

| Slot | Qué es |
|---|---|
| `{N}` | teléfonos distintos encontrados |
| `{M}` | dominios separados |
| `{year}` | año desde que está online |
| `{X}` / `{20-X}` | respuestas donde aparece / donde no |
| `{question1..3}` | preguntas reales del set de 20 donde NO aparece |
| `{county}` | mercado corrido |

**Compliance sin cambios:** screenshots reales y de hoy, números solo del run o de la tabla aprobada, cero claims médicos o de revenue, "yours to keep either way" es literal.
