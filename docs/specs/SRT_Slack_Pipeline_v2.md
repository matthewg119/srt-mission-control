# SRT — PIPELINE SLACK v2 (audit → email → botón → paquete de pitch)

**Qué cambia vs. lo actual:**
1. El **Email 1** ahora instala una creencia y pre-vende los tres movimientos — sin romper la simpleza que ya está convirtiendo (máximo 2 frases nuevas sobre el esqueleto).
2. Entra el **INTEL BRIEF** entre el email y el guion: miedos, deseos, horror stories con el lenguaje exacto del dueño, 3 peores / 3 mejores clientes + el pick.
3. El botón de "generar guion" ahora entrega el **paquete completo en una pasada**: el doc que se comparte en pantalla + el guion lleno + los prompts de imagen ya llenos para ChatGPT.

## FLUJO
```
Audit corre → ETAPA 1: Email 1 con semilla  → [el prospecto dice sí]
→ [BOTÓN] → ETAPA 2: Intel Brief → ETAPA 3: Paquete de Pitch
→ grabas el Loom (manda SRT_Loom_Playbook) → entrega same-day
```
*ETAPA 2 es POR NICHO y reutilizable: para el prospecto #2 del mismo vertical se salta el research y solo se regenera lo específico del prospecto.*

---

## ETAPA 1 — EMAIL 1 (se redacta junto con el audit)

**Trabajo del email:** UNA creencia instalada + el score mostrado + el video ofrecido. Nada más.

**Regla de selección de semilla:**
- **Default → Creencia 1** (la bisagra): una frase de comportamiento del comprador + una frase de consecuencia.
- **Si el perfil de Google es fuerte** (≥4.7★ con 100+ reseñas, o presumió su ranking en la llamada) → **Creencia 4**: reconoce su fuerza en Google primero, luego "casi nada de eso se traslada — juego distinto, ganadores distintos."
- Nunca más de una creencia por email. Las demás viven en el funnel (ver mapa al final).

**Esqueleto ES** — ①②③ son las únicas líneas nuevas vs. el control:
```
{Nombre},

Hice las búsquedas que hace {el comprador} en {ciudad} cuando {situación}.

① Hoy muchas de esas búsquedas ya no pasan por Google: la persona le pregunta a
ChatGPT, recibe 3 o 4 nombres, y de esa misma conversación sale la llamada.

Ahora mismo {empresa} no aparece en {N} de esas conversaciones, y en su lugar sale
{competidor} — mencionado {X} veces en las mismas búsquedas donde usted no aparece.
② Cada una de esas respuestas termina en una llamada, solo que a otro número.

Tengo las capturas y le adjunto el reporte.

[SOLO si el robots-check disparó] Y hay algo más en su propio sitio web que está
jugando en su contra ahí — justo la parte que casi ninguna compañía detecta por su cuenta.

③ Te hice un video de 4 minutos con el análisis completo y los tres movimientos
que cierran ese hueco.

¿Quieres que te lo envíe por aquí en el correo?

{despedida},
```

**Esqueleto EN** — mismas líneas, mismo orden:
```
Hey {Name},

I ran the searches {the buyer} in {city} makes when {situation}.

① More and more, that search never touches Google: they ask ChatGPT, it hands
them 3 or 4 names, and the call comes straight out of that conversation.

Right now {company} doesn't appear in {N} of those conversations. {Competitor}
shows up {X} times in the same searches where you're absent — ② and every one of
those answers turns into a phone call, just to someone else's number.

I've got the screenshots and I've attached the report.

[ONLY if robots-check fired] There's also something on your own website working
against you here — the part almost no company catches on its own.

③ I made you a 4-minute video with the full breakdown and the three moves that
close the gap.

Want me to send it over right here?

{sign-off},
```

**Reglas duras:** asunto = `{Empresa} + ChatGPT` · la línea del sitio web es condicional al robots-check (regla de honestidad — no fabricamos problemas) · el ask no se toca · idioma = el de la llamada · se mide en watch-through y cierre, no solo en replies.

---

## ETAPA 2 — INTEL BRIEF (el research que alimenta el guion y las imágenes)

**Input:** nicho + ciudad + notas de la llamada + scorecard.
**Research (máx ~8 búsquedas, Reddit primero):** `"[nicho] worst customers reddit"` · `"[nicho] most profitable jobs reddit"` · `"[nicho] wasted money on website/marketing reddit"` · `"[nicho] regret hiring agency"` · r/sweatystartup, r/smallbusiness + el subreddit del nicho.

**Salida — formato exacto, en este orden:**

### A. DOLORES (5, en primera persona — estilo Market Research Bot)
Cada uno: la frase como ellos la dicen (≤15 palabras) + una línea de por qué duele.
> Ej.: *"I'm booked… but not profitable."* — sillas llenas, pero después de nómina, seguros y supplies no queda nada.

### B. HORROR STORIES (3–5) ← lo nuevo
Cada una trae cuatro piezas:
- **HISTORIA** — situación + cifra, 1–2 líneas (solo si el hilo trae la cifra).
- **VOZ** — la frase textual corta como la escribió el dueño (≤15 palabras) + link del hilo.
- **HOOK** — reescrita como pregunta lista para cold open o email. Ej.: *"¿Gastó $40,000 en un sitio web que parece revista de dientes… y la silla de la higienista sigue vacía?"*
- **INSTALA** — qué creencia dispara (casi siempre B3 o B4).

Reglas: se usan como patrón del mercado (*"esto lo escuchamos todas las semanas"*), jamás atribuidas al prospecto; cero cifras inventadas; si la historia es larga, se parafrasea y solo la VOZ queda textual.

### C. QUÉ HACEN HOY para conseguir clientes + qué odian de cada canal
### D. PREGUNTAS QUE SE HACEN DE NOCHE (5, en sus palabras)
### E. LOS BILLETES DE $100 — qué venden más caro / qué quieren vender más
### F. AVATARES — 3 peores · 3 mejores · EL PICK
Formato del `MASTER_PROMPT.md`: label memorable, economía en una línea, la pregunta exacta que ese comprador le hace a la IA. El pick con 2–3 frases de razón; marcar si es **reposicionamiento** (residencial→comercial, limpiezas→implantes) — el reposicionamiento ES el ángulo del pitch.
### G. MIEDOS DE COMPRARNOS (3 objeciones) + la línea que desarma cada una en el cierre

---

## ETAPA 3 — EL BOTÓN: PAQUETE DE PITCH (una sola pasada, tres bloques)

**Input:** audit de HOY + intel brief + el pick. **Output, en este orden:**

### A. EL DOC (lo que se comparte en pantalla — páginas en orden)
1. **DREAM LEAD** — `{Business}_dreamlead.png`. Página limpia, la imagen habla sola. *(El prompt para generarla es el bloque C-#1.)*
2. **LA PREGUNTA EN VIVO** — la pregunta exacta que se corre en cámara desde cuenta neutral + espacio para la captura real de hoy.
3. **SCORECARD** — {X} vs {Y}, quién es dueño de las respuestas. Capturas reales.
4. **SEGUNDO GAP** — solo si la tabla de `SRT_Loom_AI_Access_Check` lo autoriza.
5. **LOS TRES MOVIMIENTOS** — una página por paso, cada una con un visual REAL (su GBP, su página, el fix).
6. **CIERRE** — qualifier + inversión + *reply "I'm in"* + número de texto.

**Regla de imágenes:** IA = SOLO el dream lead (el futuro). Toda evidencia del presente = capturas reales del run de hoy. Nunca al revés.

### B. EL GUION — bloques del `SRT_Loom_Playbook` llenos con los datos del prospecto
**Delta al playbook (cold open actualizado):** la imagen del dream lead abre el video; su sitio entra en el segundo beat.
> "Dr. {name} — this on your screen is the kind of inquiry we're going to talk about: {avatar}, {ticket signal} — and notice the line: *'I asked ChatGPT… and {company} came up.'* In the next four minutes you'll see exactly where {company} shows up today when someone in {city} asks AI where to {X}, who's taking those answers instead, and the three moves that close the gap."

- **Hook de horror story (opcional):** entra como beat al pasar al hallazgo (~0:20), nunca reemplaza el outcome del cold open. *"…and look, we hear this every week: {HOOK}. Almost every time, the cause is the same — so watch this."*
- **Cierre pre-armado:** usa la objeción #1 del bloque G para la línea de absolución.
- Todo lo demás (tiempos, anti-patterns, entrega same-day, transcript a Slack) **manda el playbook** — no se duplica aquí.

**Mapa de creencias por bloque (anotar en el guion generado):**
imagen + cold open → refuerza **B1** · live run → **B2** · scorecard → **B3** · segundo gap → **B4** · tres movimientos + ventana → **B5** · el ask del email 1 y el *"I'm in"* → umbral de acción (**B6**).

### C. PROMPTS DE IMAGEN (llenos, cero edición antes de pegar)
- **#1 obligatorio** — dream lead del pick: entregar el bloque `SYSTEM PROMPT START → END` de `SRT_Image_Prompt_Generator.md` con TODAS las variables ya sustituidas, preset elegido según nicho.
- **#2 opcional** — variante SPLIT_SCREEN si el vertical es médico/dental/estético.

---

## REGLAS DE HONESTIDAD DEL PIPELINE (heredan del playbook)
- Capturas del run de HOY, siempre. Nada reciclado, nada de otra ciudad.
- La imagen de IA se presenta como objetivo ("the exact kind of inquiry we point at your phone"), nunca como resultado ya generado.
- Horror stories = patrón del mercado, no biografía del prospecto.
- Si el dato no existe, no existe. Cero cifras inventadas, cero problemas fabricados.
