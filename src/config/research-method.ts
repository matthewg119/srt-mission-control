// Matthew's three-message ChatGPT research framework, as text.
//
// ‼️ EMBEDDED AS CONSTANTS, NOT READ FROM DISK, AND THAT IS NOT A PREFERENCE.
//
// REFERENCE, NOT PAYLOAD, since 2026-08-27. These transcripts are no longer pasted into any
// prompt: deep-research-run.ts encodes the method as instructions in its SYSTEM constant instead,
// because a first-person teaching transcript handed to a model gets summarised back rather than
// followed. They stay here as the documented source of that method, and buildFullPrompt has the
// same hard contract they were written for: the same input produces the same bytes, and
// scripts/test-onboarding-artifacts.ts asserts it. A file read makes that a property of the
// filesystem rather than of the function, and a file read inside a Vercel lambda is a deployment
// concern on top of it. The method is words; words are what a constant holds.
//
// ‼️ VERBATIM. These are transcripts of how HE researches, in the language he runs the framework
// in. Do not translate them, do not tidy the punctuation, do not shorten the worked example. Same
// rule the owner's own words carry in the brief itself: the register is the finding.
//
// Source: docs/lanes/research-method-parte-1.md and -2.md, which stay in the repo as the readable
// copies. The editorial note at the top of each markdown file is a comment about the REPO and is
// not part of the method, so it is the one thing dropped on the way in.
//
// GENERATED FROM THOSE FILES ON 2026-08-25. If they are corrected, regenerate rather than editing
// both copies by hand: two copies of a transcript drift, and the drift is invisible.

/** Investigacion, parte 1: the questions. Verbatim. */
export const RESEARCH_METHOD_PART_1 = `¿Por qué empezamos con la investigación? Necesitas entender tu mercado, tu cliente, los
productos de la competencia que existen, otras soluciones, qué le gusta al mercado de esas
soluciones y qué no le gusta, los puntos de dolor, en realidad todo. Necesitas una visión
holística y amplia del panorama, y esa es la forma en que vas a escribir el texto más
efectivo.

Lo que suele pasar muchas veces es que los redactores creen que conocen el mercado, y quizás
sí sepan algunas cosas, así que se saltan la investigación o no la hacen del todo, y eso casi
siempre es perjudicial para el texto, porque están adivinando lo que el mercado quiere
escuchar. Pero lo que realmente podemos hacer es dejar que el mercado nos diga lo que quiere
escuchar, de qué quiere que escribamos. Podemos hacerlo en el propio lenguaje del mercado,
porque básicamente puedes tomar lo que el mercado dice y usarlo en tu texto de ventas,
hablando con ellos en su propio idioma.

## Insights demográficos

Lo primero que abordaremos son los insights demográficos del mercado que estás apuntando.
Preguntas básicas: ¿quién es tu cliente?, ¿qué actitudes tienen?, ¿cuáles son sus esperanzas
y sueños?, ¿cuáles son sus victorias y fracasos?, ¿qué fuerzas externas creen que les han
impedido vivir su mejor vida?, ¿cuáles son sus prejuicios? Y luego resumiremos sus creencias
fundamentales sobre la vida, el amor y la familia en una a tres oraciones.

**Quién es tu cliente.** Aquí iría información como: mayores de 55 años, principalmente
hombres, ingresos medios, viven en Estados Unidos o en el extranjero, o amas de casa entre 40
y 65 años. Cosas básicas. Generalmente ya tienes una idea de esto antes de escribir el texto.
Si no, existen herramientas analíticas que te pueden ayudar con estos datos.

**Sus actitudes: religiosas, políticas, sociales, económicas.** Esto es muy importante.
Por ejemplo, si tu mercado es principalmente cristiano, deberías saberlo, ya que el lenguaje
que uses debe estar dirigido a otros cristianos. Si son musulmanes o judíos o lo que sea,
también vale la pena saberlo. Si estás escribiendo para ateos o para biohackers de 20 años
que escuchan el pódcast de Tim Ferriss, probablemente muchos de ellos no sean religiosos, y
eso debes considerarlo.

Lo mismo pasa con la política: si son muy conservadores, tu lenguaje será distinto que si son
liberales. En lo social, hay ideas sobre el rol del gobierno, la educación, la familia.
Queremos capturar todo eso, porque cuando llegue el momento de escribir, queremos que nuestra
voz les resulte familiar y confiable.

Económicamente también importa: ¿son clase baja, media o alta?, ¿jubilados?, ¿gastadores o
ahorradores? Queremos entender sus actitudes hacia la economía en general.

**Esperanzas y sueños.** Esto es clave. Queremos saber qué quieren lograr, no solo con
respecto al producto, sino en su vida. ¿Quieren retirarse a los 40?, ¿vivir 100 años?, ¿ser
millonarios?, ¿tener su propio negocio?

**Victorias y fracasos**, sobre todo los relacionados con su problema o dolor principal.

**Qué fuerzas externas creen que les han impedido vivir su mejor vida.** Ejemplo: "Wall
Street está manipulado, por eso no progreso", o "Big Pharma está podrido y por eso estoy
enfermo", o "Si hubiera ido a la universidad, sería millonario". La mayoría de las personas
tienen narrativas sobre por qué no están donde quisieran estar. Queremos capturar esas
historias.

**Sus prejuicios:** actitudes, estereotipos, juicios. No necesariamente raciales, sino
generales, como "los italianos son buenos cocineros" o "los influencers en yoga pants no son
profesionales". Si tu mercado comparte un prejuicio así y lo reflejas en tu texto, generas
conexión y confianza.

**Sus creencias fundamentales sobre la vida, el amor y la familia,** en una a tres oraciones.
Ejemplo: "Tienen entre 45 y 65 años, creen que la economía está manipulada y la política
rota, pero valoran la familia por encima de todo. Creen que el matrimonio es sagrado y que el
mayor regalo de la vida es ser un padre o abuelo amoroso."

## Otras soluciones existentes

¿Qué está usando actualmente el mercado? Si es pérdida de peso, ¿usan suplementos, dietas
keto, entrenadores personales, membresías de gimnasio, cursos online? Debemos listar todo eso
y analizar su experiencia con esas soluciones. ¿Les funcionó?, ¿las abandonaron?, ¿por qué?

Queremos saber **qué les gusta y qué no les gusta** de las soluciones actuales. Por ejemplo,
"me gusta que es rápido y fácil" o "no me gusta que es una dieta de hambre". Con eso, cuando
presentemos nuestro producto, podremos destacar lo que sí tienen en común con lo que aman y
diferenciarnos de lo que odian.

Esto nos permite **anticipar objeciones**. Cuando lean nuestro texto, el cliente pensará:
"¿Será esto diferente de lo que ya probé?" Queremos responder eso desde antes.

También debemos investigar **si hay historias de terror** sobre esas soluciones. Si las hay,
podemos usarlas en nuestro texto como advertencias que captan la atención y posicionan
nuestro producto como la alternativa segura.

Otra pregunta clave: **¿el mercado cree que las soluciones actuales funcionan?** Si creen que
sí, debemos trabajar más para diferenciarnos. Si creen que no, debemos explicar por qué no
funcionan y por qué la nuestra sí.

## Curiosidad

¿Alguien intentó resolver este problema antes de una forma única? ¿Qué pasó? Si hubo un
intento antiguo o una "solución perdida", podemos rescatar esa historia. La gente ama lo
"antiguo redescubierto" o la "sabiduría ancestral".

Ejemplo: historias de descubrimientos antiguos ocultados o conspiraciones, como "¿Quién mató
al auto eléctrico?" o "Big Pharma no quiere que sepas esto". Esas historias generan atención
y hacen que el texto sea irresistible.

Ejemplo clásico: Tesla y la energía libre, o la historia del ácido undecilénico, un
tratamiento olvidado para el pie de atleta descubierto en la Segunda Guerra Mundial, que
ayudó a los soldados. Ese tipo de historia da un gancho poderoso y posiciona el producto como
algo histórico y heroico.

## Corrupción

Aquí hablamos de la creencia de que "antes las cosas eran mejores" y de cómo una fuerza
corrupta arruinó el equilibrio.

Ejemplo: el Dr. Ancel Keys en 1948 culpó a las grasas por los problemas cardíacos, cambiando
toda la industria alimenticia y provocando el auge de la obesidad y la diabetes. Este "ángulo
de corrupción" es excelente porque apela a la sensación de injusticia y la necesidad de
redención.

Puedes aplicar este enfoque a salud, dinero o estilo de vida. Por ejemplo: "Antes, cualquier
familia podía tener una casa; ahora es casi imposible. ¿Por culpa de quién?"

## Fuentes de investigación

Principalmente tres:

1. **Amazon** (reseñas y lenguaje del cliente).
2. **Foros** (comentarios reales y sin filtros).
3. **Google** (búsqueda general y artículos antiguos).`;

/** Investigacion, parte 2: somebody actually doing it, on weight loss. Verbatim. */
export const RESEARCH_METHOD_PART_2 = `Vamos a hacer un ejemplo en tiempo real, con **pérdida de peso**.

## Demografía básica

El mercado de pérdida de peso es mayormente femenino; normalmente apuntas a mujeres de 30
años en adelante, entre 30 y 55. También hombres entre 30 y 55 años y, en general, con al
menos unas 20 libras de peso que quieren perder.

Si tú no lo sabes, puedes ir a Google y escribir "weight loss market demographics". Yo abro
varios resultados en pestañas nuevas y veo qué encuentro. Lo que realmente quiero ver es si
hay algo sobre las **demografías de quienes compran**.

Encuentro algo: *"73% de los hombres en EE.UU. tienen sobrepeso, comparado con 63% de las
mujeres, pero la membresía en programas de pérdida de peso está dominada por mujeres; se
estima que el 90% de los miembros de Weight Watchers son mujeres."*

No es sorprendente: muchos hombres con sobrepeso, pero las que se apuntan a programas son
sobre todo mujeres.

Otra herramienta: **SimilarWeb**. Entras a sitios grandes de tu nicho, ves sus datos de
tráfico, y esas herramientas suelen mostrarte también edad, género, países. Usas esos datos
como referencia para tu propio mercado. Pero no nos desviemos demasiado con herramientas.

## Actitudes y creencias: los foros

Busco "weight loss forum" y abro las primeras páginas en pestañas nuevas. Quiero ver foros
activos, con secciones como "Weight Loss with Health Conditions", "Newcomers", "Advanced
Weight Loss", "Diet Motivation", "Weight Loss Diary", "Before and After", "Weight Loss
Programs", y a veces "Off topic" por curiosidad.

Lo ideal es **ordenar por número de respuestas o por número de vistas**, para encontrar los
hilos con más participación.

- Muchos **views** = buenos títulos para usar como ideas de asuntos de email o titulares.
- Muchos **replies** = discusiones muy cargadas de creencias, emociones, historias y lenguaje
  del mercado.

Si un hilo tiene decenas de miles de vistas, es señal de que ese tema interesa muchísimo al
mercado.

### Ejemplo práctico: "Drinking Water for Weight Loss"

Entro al hilo y empiezo a **copiar y pegar** fragmentos que muestren creencias y experiencias.

Una persona dice: *"Drinking water is good to lose weight easily. Research has shown that
drinking up to 8 glasses of water will help you burn fat."*

Otra cuenta: *"Water makes a huge difference. I've been dehydrated most of my life, sluggish,
always tired. Me obligué a tomar agua, añadí limón, frutas, llevaba una botella conmigo.
Desde que empecé a tomar más agua, tengo más energía, mi piel está limpia y bajó la hinchazón
de la cara."*

Todo eso lo copio literalmente a mi documento de investigación, en la sección de:

- **Qué ya está usando el mercado** (beber agua).
- **Qué les gusta de esa solución** (más energía, piel más clara, menos hinchazón).
- **Problemas con esa solución** (me olvido de tomar agua, tengo que obligarme).

Otro usuario: *"I think I drink too much water, isn't fat expelled through urine?"* Otro:
*"There is no connection between water and weight loss. Too much water can lead to water
intoxication."*

Aunque algunas cosas no sean científicamente correctas, **no nos importa si tienen razón o
no. Lo que nos importa es lo que ELLOS CREEN**, porque eso es lo que usaremos en el copy. Por
ejemplo, "water intoxication" podría ser usado más tarde como un mecanismo sorprendente: "La
razón oculta por la que tomar demasiada agua puede hacerte sentir peor, no mejor."

### Otro hilo: falta de apoyo de la familia

Una mujer responde: *"He estado en tus zapatos. He luchado con mi peso toda mi vida. Mi mamá
no apoyaba mi pérdida de peso, ella también tiene sobrepeso. Le contaba mis progresos y casi
no los reconocía. Mi consejo: no dejes que nadie afecte tu lucha."*

Otra: *"Mi mamá también tiene sobrepeso. Cuando bajé de peso dijo que era solo porque crecí.
Cuando íbamos de compras me decía que la ropa que miraba no me iba a quedar."*

Todo eso lo copio en **fuerzas externas que creen que les impiden vivir su mejor vida**: "Mi
mamá no me apoya", "Mi familia no entiende mi lucha". Es perfecto para luego escribir
mensajes tipo: "¿Alguna vez sentiste que la gente que más debería apoyarte es la que menos
cree en ti?"

### Lenguaje real y nivel de lectura

Otro detalle de estos hilos es la cantidad de **errores ortográficos y gramaticales**. Eso te
recuerda algo importante: el promedio de lectura y escritura de la gente es nivel sexto o
séptimo grado. Si escribes "la adiposidad marrón activa rutas inflamatorias y tejido adiposo
subcutáneo", tu mercado no tiene idea de lo que estás diciendo. Da igual si hablas de salud,
inversiones o hipotecas: tienes que **simplificar**. Los foros te aterrizan en el mundo real
y te muestran cómo la gente realmente se expresa.

### Puntos de dolor y deseos

Otro usuario: ha tenido problemas con su peso desde niño, esconde la barriga en la escuela,
tiene poca energía, y no quiere un plan difícil y rápido, quiere algo **sostenible, fácil de
seguir, lento pero seguro**.

Eso lo copio en:

- **Fracasos:** "He intentado planes difíciles, me quedo sin energía, lo dejo."
- **Deseos:** "Quiero algo fácil de mantener, que me ayude a perder grasa lentamente y ganar
  algo de músculo, sin ser fisicoculturista."

Esto es mucho mejor que inventar "quiere bajar de peso" como algo genérico.

### El diario de "Tina"

Aquí es donde la investigación se vuelve realmente poderosa. Encuentro a una mujer que
comparte un diario completo de su proceso:

*"Hoy es el día. Llevo años queriendo cambiar."*
*"Ya bajé de talla 14 a 12, pero algo siempre pasa y lo dejo."*
*"Me siento enojada y deprimida porque siempre tengo que ser la diferente en las reuniones
con amigos: ellos comen frituras y toman, yo debería llevar mi propia comida."*
*"Siempre he querido ser como mi hermana, a la que todo parece salirse natural."*
*"Quiero que mi esposo me mire con orgullo y diga: esta es mi esposa, mira lo bien que se ve.
Él siempre me ha apoyado, no creo que le importe cómo me veo, pero yo sí. Estoy cansada de
fallar."*

En vez de un deseo genérico como "quiere bajar de peso", ahora tienes algo específico:

- "Quiere que su esposo se sienta orgulloso de ella."
- "Está cansada de ser la diferente en las reuniones."
- "Se siente fracasada cada vez que recupera el peso perdido."
- "Admira a su hermana, pero siente que ella nunca logra lo mismo."

### Escenas de fracaso y culpa

En otra entrada Tina escribe sobre un fin de semana: su esposo la invita a cenar tarde, toman
vino, comparten entradas con salsa de crema y pan tostado. Ella sabe, *"con cada bocado sabía
que la estaba cagando en grande"*. Al final del fin de semana está furiosa consigo misma:
*"¿Dónde está mi fuerza de voluntad? Ahora tengo que vivir con lo que diga la báscula. Es muy
difícil seguir fallando."*

Todo ese párrafo es oro para **fracasos, autoculpa y vergüenza, lenguaje emocional real**.
Frases como esas podrían literalmente ser la apertura de tu carta de ventas.

Luego una actualización: *"Esta semana por fin vi bajar el número en la báscula. Perdí 2
libras. Caminé o troté 5 días esta semana, quiero estar en mejor forma cuando mi hermana
venga de visita para poder ir a hacer hiking con ella."* Eso va a **victorias** (aunque sea
algo pequeño) y **sueños**.

## De los foros a Amazon

Luego paso a Amazon para ver qué productos están usando y qué dicen en las reseñas de 5 y de
1 estrella.

Busco "weight loss supplement" y encuentro Alli. Gente que jura que funciona, pero: *"Mi
estómago empezó a rugir, terminé defecando en la silla del salón y tuve que limpiar todo."*
*"Never trust a fart."* Eso es perfecto para **historias de terror de soluciones existentes**.

Y también: *"Soy una comedora emocional compulsiva. He probado todo tipo de dietas en 40
años. He perdido y recuperado las mismas 100 libras una y otra vez."* Eso va a **quién es tu
cliente** y a **fracasos**.

Las reseñas negativas también cuentan: ingredientes que causan diarrea, efectos secundarios
horribles, el sentimiento de "me estafaron otra vez". Todo eso va a **qué no les gusta de las
soluciones actuales** e **historias de terror**.

Que luego puedes usar en líneas tipo: *"Si alguna vez probaste una pastilla milagrosa para
bajar de peso y terminaste rogando que nadie se enterara de lo que pasó en el baño, no estás
sola."*

## Más horror stories, curiosidad y corrupción

También puedes buscar en Google "weight loss horror stories", "obesity horror stories",
"dating while plus-size horror stories". Encuentras artículos y testimonios sobre citas
arruinadas, parejas que dejan de tocar a la persona por su peso, comentarios crueles de
extraños. No es una "solución" que falló, pero muestra el **dolor profundo** asociado al
problema.

Para **curiosidad y corrupción**: busco "places where obesity doesn't exist", o artículos
sobre islas del Pacífico donde antes la gente estaba delgada y comía comida tradicional, y
luego con la llegada de la comida procesada y los refrescos se convirtieron en los países más
obesos del mundo. Perfecto para: "Antes vivían en un paraíso sin obesidad, hasta que llegó
[X fuerza corrupta]."

También busco "popular diets 1900s" y encuentro dietas rarísimas: masticar 100 veces cada
bocado, fumar para suprimir el apetito, dietas de toronja. Eso alimenta:

- **Curiosidad:** "Las dietas más extrañas de los últimos 100 años."
- **Corrupción:** "Si las dietas llevan 100 años cambiando, ¿por qué cada vez estamos más
  enfermos y con más sobrepeso?"

## Resumen del proceso

1. **Definir una vertical.**
2. **Investigar demografía básica** (edad, género, país) con Google y herramientas de
   tráfico.
3. **Sumergirse en foros:** ordenar por respuestas o vistas, leer los hilos con más
   participación, y **copiar y pegar literalmente** frases de puntos de dolor, deseos,
   fracasos, historias familiares, creencias y prejuicios.
4. **Ir a Amazon:** buscar productos relevantes, leer reseñas de 5 y de 1 estrella, copiar
   historias de éxito y de horror.
5. **Usar Google** para historias antiguas, curiosas o conspirativas, y ejemplos de
   corrupción.
6. **Volcar todo en el documento de investigación**, organizado por: quién es tu cliente,
   actitudes, esperanzas y sueños, victorias y fracasos, fuerzas externas que culpan,
   prejuicios, creencias sobre soluciones existentes, qué les gusta y qué odian de las
   soluciones actuales, historias de terror, curiosidad y corrupción.

Al final, aunque parezca largo (pueden ser 2 o 3 horas de investigación sólida), terminas con
un documento repleto de **frases reales de tu mercado**, historias crudas, emociones
auténticas y creencias exactas.

Y eso hace que, cuando te sientes a escribir el copy, ya no estés adivinando lo que el
mercado quiere escuchar. Simplemente estás **organizando y amplificando lo que ya te
dijeron**.`;

/**
 * The two documents as message 2 sends them.
 *
 * One constant rather than two call sites joining them, so the separator cannot drift between the
 * brief and anything else that ever needs to hand a model the method.
 */
export const RESEARCH_METHOD_DOCUMENTS = [
  "DOCUMENTO 1 de 2 - INVESTIGACION, PARTE 1",
  "",
  RESEARCH_METHOD_PART_1,
  "",
  "DOCUMENTO 2 de 2 - INVESTIGACION, PARTE 2",
  "",
  RESEARCH_METHOD_PART_2,
].join("\n");
