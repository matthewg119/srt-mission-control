# SRT — LOOM ADD-ON: "The Second Gap" (AI Access / Crawler Check)
**Para pegar en `SRT_Loom_Script.md`. Es un BEAT OPCIONAL — solo se graba cuando el sitio de la clínica realmente bloquea un crawler que controla citas en vivo.**
Va DESPUÉS de `[1:15–2:15] EL SCORECARD` y ANTES de `[2:15–3:15] CÓMO SE ARREGLA`. Suma ~30 seg.

Copy de prospecto: inglés. Notas: español.

---

## QUÉ ES

Tu audit chequea si la clínica aparece en las **respuestas**. Esto chequea algo distinto: si el propio sitio le está diciendo al crawler que **se largue**. Es un SEGUNDO momento "Gap" — más concreto y visual (se ve en su propio robots.txt) — y el fix es de una línea, así que refuerza que sabes exactamente qué hacer.

---

## LOS 3 BOTS QUE IMPORTAN (verificado jul 2026)

Cada motor separa **entrenamiento** de **search/citas en vivo**. Son directivas distintas en robots.txt:

| Motor | Bot de ENTRENAMIENTO | Bot de SEARCH/CITAS EN VIVO (el que importa para el pitch) |
|---|---|---|
| OpenAI / ChatGPT | `GPTBot` | **`OAI-SearchBot`** (+ `ChatGPT-User` para fetch en vivo) |
| Perplexity | — | **`PerplexityBot`** (+ `Perplexity-User`) |
| Anthropic / Claude | `ClaudeBot` | **`Claude-SearchBot`** (+ `Claude-User`) |
| Google / Gemini | `Google-Extended` (training + grounding; **NO** afecta Google Search) | — |

---

## ⚠️ LA REGLA DE HONESTIDAD (esto te salva de quedar como snake-oil)

**Bloquear `GPTBot` solo detiene el ENTRENAMIENTO — NO te saca de las respuestas en vivo.** Lo que te saca de las respuestas de ChatGPT es bloquear **`OAI-SearchBot`**.

Entonces: **NUNCA digas "tu sitio bloquea a ChatGPT" si solo está bloqueado `GPTBot` y `OAI-SearchBot` está abierto.** Un doctor técnico te caza en 5 segundos y pierdes el cuarto. El beat devastador **solo** es honesto cuando el bloqueado es un bot de search/citas: `OAI-SearchBot`, `PerplexityBot` o `Claude-SearchBot`.

---

## EL CHECK DE 2 MINUTOS (mételo a la corrida de ciudad, por clínica)

1. Abre `{clinic-domain}/robots.txt`.
2. Ctrl-F por: `OAI-SearchBot` · `PerplexityBot` · `Claude-SearchBot` · `Google-Extended` · `GPTBot`.
3. Loga cuáles tienen `Disallow: /`.
4. **Caveat:** el robots.txt puede decir *Allow* y aun así un WAF/Cloudflare (regla anti-bots o rate-limit 429) bloquea al crawler. El robots.txt es la versión de 2 min; el check completo es un live crawl test. **Solo afirmas lo que puedes VER en pantalla.**

---

## DECISIÓN → QUÉ PUEDES DECIR HONESTAMENTE

| Lo que ves en robots.txt | Beat |
|---|---|
| `OAI-SearchBot` / `PerplexityBot` / `Claude-SearchBot` con `Disallow: /` | ✅ **Beat devastador** (grábalo) |
| Solo `GPTBot` (o `Google-Extended`) bloqueado | ⚠️ **Beat suave y preciso** (training, no citas en vivo) — opcional |
| Nada bloqueado | ❌ **Sáltatelo.** No fabriques un problema que no existe. |

---

## EL SCRIPT

### [~2:15–2:45] THE SECOND GAP — versión devastadora (search bot bloqueado)
> "And here's the part that makes this worse — and honestly easier to fix. This is {clinic}'s own robots.txt file, live right now. See this line? Your site is telling OAI-SearchBot — that's the crawler ChatGPT uses to pull its live answers — not to come in. So even if everything else were perfect, you've locked yourself out of your own front door. The good news: that's a one-line fix, and it's the first thing we'd do."

### [~2:15–2:45] versión suave y precisa (solo GPTBot / training bloqueado)
> "One more thing worth flagging: your site currently opts out of the AI *training* crawlers. That's not why you're missing from today's answers — that's the content and authority side we just covered — but it's a setting worth making on purpose instead of by accident, and we'd walk you through it."

*(Si es este caso, no lo infles. Es un dato, no el golpe. El golpe sigue siendo el scorecard.)*

---

## COMPLIANCE DEL BEAT

- Solo dices que un bot está bloqueado si **ves la línea `Disallow`** — y la muestras en pantalla.
- **Nunca** confundas entrenamiento (`GPTBot`) con citas en vivo (`OAI-SearchBot`). El claim fuerte exige un bot de search/citas bloqueado.
- El screenshot del robots.txt es real y actual, igual que todo lo demás.
- Contexto que puedes mencionar sin exagerar: es un problema COMÚN (una parte grande de los sitios todavía bloquea algún bot de AI por un leftover del pánico de "bloquéalo todo" de 2023–24), así que no es que la clínica hizo algo raro — casi siempre lo dejó un dev o un plugin sin avisar.
