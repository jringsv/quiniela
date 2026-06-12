# ⚽ Quiniela Mundial 2026

Sistema sencillo para registrar quinielas del Mundial por usuario, compararlas contra
los resultados reales (que carga el **admin**) y mostrar una **tabla de posiciones en
tiempo real**. Frontend estático (HTML/CSS/JS) + base de datos **Supabase** (gratis).
Se despliega gratis en **Vercel** o **GitHub Pages**.

**Incluye:** banderas de los 48 equipos · **tablas de grupo que se arman solas** conforme
llenas los marcadores · **cuadro de eliminatorias (llaves) automático** según las reglas
oficiales del Mundial 2026 (2 primeros de cada grupo + 8 mejores terceros, con la tabla
oficial FIFA de asignación de terceros) · vista "Mundial (real)" con el cuadro verdadero.

## 🧮 Reglas de puntaje

El puntaje se calcula con los **marcadores de los partidos** (grupos **y** llaves por igual):

| Acierto | Puntos |
|---|---|
| Pronóstico exacto con goles (marcador) | **3** |
| Pronóstico al partido (acertar gane o empate) | **1** |

> 🎯 **Uno o dos pronósticos por partido:** el admin define, al activar a cada usuario en un
> partido, si dará **1 o 2** marcadores. Con dos, deben ser **diferentes** y **ambos suman**
> (máximo 3 + 1 = 4: un exacto + un resultado).

> 💾 **Guardado por partido:** cada partido se guarda (y se edita) por separado, así puedes
> llenar poco a poco. Se puede **modificar hasta 15 minutos antes** de que empiece el partido;
> después se cierra (no hay bloqueo "al guardar", solo el cierre por tiempo).

> 🔑 **Las llaves puntúan como partidos normales:** las eliminatorias son partidos como
> cualquier otro (misma regla 3/1). No hay un sistema de puntos aparte para fases o posiciones.

> 👤 **Activación por partido:** el admin habilita, **partido por partido**, qué usuarios
> participan y **cuántos pronósticos** (1 ó 2) da cada uno. El jugador **ve todos** los partidos
> definidos, pero solo puede llenar los pronósticos habilitados: con "1" se bloquea el 2.º, y con
> "No participa" se bloquean ambos (🔒). Por defecto, al crear un partido **nadie** participa.

> ⚑ **Partidos que aplican:** en **Admin** cada partido tiene un check **"aplica"**; al
> desmarcarlo, ese partido deja de otorgar puntos (3/1). Al jugador se le muestra la
> etiqueta *"no suma marcador"*.

Ganan los **3 primeros lugares** de la tabla. Cada **marcador se cierra 15 minutos antes
de que empiece su partido**: a partir de ese momento ese pronóstico ya no se puede
modificar. Cada partido cierra en su propio horario (no hay una fecha única de bloqueo).
Solo el admin queda exceptuado y puede cargar resultados.

---

## 🚀 Puesta en marcha (15 min)

### 1) Crear la base de datos (Supabase)
1. Entra a https://supabase.com → **New project** (plan gratis). Guarda la contraseña de la BD.
2. Cuando esté listo, ve a **SQL Editor → New query**.
3. Ejecuta **en este orden** (cada uno: pegar contenido → **Run**):
   1. [`supabase/schema.sql`](supabase/schema.sql) — tablas, puntajes y seguridad.
   2. [`supabase/migracion_bracket.sql`](supabase/migracion_bracket.sql) — cuadro real de llaves.
   3. [`supabase/seed_partidos.sql`](supabase/seed_partidos.sql) — calendario real de grupos.
   4. [`supabase/seed_llaves.sql`](supabase/seed_llaves.sql) — los 32 partidos de eliminatoria (73–104).
   5. [`supabase/migracion_aprobacion.sql`](supabase/migracion_aprobacion.sql) — autorización de usuarios.
   6. [`supabase/migracion_solo_marcadores.sql`](supabase/migracion_solo_marcadores.sql) — puntaje solo por marcador (3/1).
   7. [`supabase/migracion_lock_por_partido.sql`](supabase/migracion_lock_por_partido.sql) — cierre 15 min antes de cada partido.
   8. [`supabase/migracion_borrar_usuarios.sql`](supabase/migracion_borrar_usuarios.sql) — gestión de usuarios (admin).
   9. [`supabase/migracion_dos_pred_y_activacion.sql`](supabase/migracion_dos_pred_y_activacion.sql) — doble marcador + activación por partido.
   10. [`supabase/migracion_npred_por_activacion.sql`](supabase/migracion_npred_por_activacion.sql) — activar con 1 ó 2 pronósticos por usuario/partido.
   11. [`supabase/migracion_reset_password.sql`](supabase/migracion_reset_password.sql) — el admin resetea contraseñas y obliga al cambio al ingresar.
   12. [`supabase/migracion_control_pagos.sql`](supabase/migracion_control_pagos.sql) — control de pagos por usuario (pronósticos enviados vs. dinero pagado).

   > Nota: si en algún momento corriste `migracion_pred_inmutable.sql` (descartada), ejecuta
   > [`supabase/migracion_pred_editable.sql`](supabase/migracion_pred_editable.sql) para volver a
   > permitir editar el pronóstico hasta el cierre por tiempo.

   > Si tu base **ya existía** antes de la bandera "aplica para quiniela", ejecuta además
   > [`supabase/migracion_aplica_quiniela.sql`](supabase/migracion_aplica_quiniela.sql)
   > (en instalaciones nuevas ya viene incluida en `schema.sql`).
4. Ve a **Project Settings → API** y copia:
   - **Project URL**
   - **anon public key**

### 2) Conectar el frontend
Abre [`js/config.js`](js/config.js) y pega la URL y la anon key:
```js
SUPABASE_URL: "https://TU-PROYECTO.supabase.co",
SUPABASE_ANON_KEY: "eyJhbGciOi...",
```
> La *anon key* es pública por diseño; la seguridad la garantiza el RLS de la base de datos.

### 3) Probar localmente
Abre una terminal en esta carpeta y levanta un servidor estático:
```powershell
# Opción A (si tienes Python)
python -m http.server 5500
# Opción B (si tienes Node)
npx serve .
```
Abre http://localhost:5500

> 💡 **Tip:** para que el registro sea inmediato (sin confirmar correo), ve a Supabase →
> **Authentication → Sign In / Providers → Email** y desactiva *Confirm email*.

### 4) Crear el admin
1. **Regístrate** en la app con tu correo (pestaña *Registrarme*).
2. En Supabase → **SQL Editor**, ejecuta (cambia el nombre):
   ```sql
   update profiles set is_admin = true where nombre = 'TU_NOMBRE';
   ```
3. Vuelve a iniciar sesión: ahora verás la pestaña **Admin**.

### 5) Cargar el calendario (ya viene el real del Mundial 2026)
El calendario oficial ya está extraído de tu Excel. **Forma fácil:** en Supabase →
**SQL Editor**, abre [`supabase/seed_partidos.sql`](supabase/seed_partidos.sql), copia su
contenido y dale **Run**. Eso carga los **72 partidos de la fase de grupos** (12 grupos
A–L, 48 equipos) con equipos, grupo y fecha reales.

> **Forma alternativa:** en **Admin → Agregar / importar partidos** pega las filas de
> [`partidos-mundial.txt`](partidos-mundial.txt) (mismo contenido, formato
> `numero | fase | grupo | local | visitante | fecha`).

#### ¿Y las eliminatorias (16avos, 8vos, etc.)?
Las llaves se pronostican **como partidos normales** (marcador 3/1, dos pronósticos, ambos suman).
Los 32 partidos (73–104) se crean con [`supabase/seed_llaves.sql`](supabase/seed_llaves.sql) con sus
fechas/sedes reales y equipos en **"Por definir"**.

**Las llaves se llenan SOLAS.** El admin solo carga marcadores; al guardar, el cuadro se recalcula y
propaga automáticamente:

1. Al guardar resultados de grupos, en cuanto un grupo termina se arman sus llaves de 16avos
   (los slots de "mejor tercero" se completan cuando termina **toda** la fase de grupos).
2. Al guardar el resultado de una llave, su **ganador sale del marcador** y alimenta la ronda
   siguiente. No hay botones de "calcular" ni que elegir ganadores.
3. **Solo si una llave queda empatada** (penales/prórroga) aparece un botón **"⚖️ Empate — pasó:
   [equipo A] / [equipo B]"** para indicar quién avanzó (el marcador empatado no lo dice).

A nivel de jugador, una llave **solo aparece cuando sus dos equipos ya están definidos** (no
"Por definir") **y** el admin lo activó. El **puntaje usa el marcador con que terminó el partido,
sin penales**: un 1–1 definido por penales cuenta como empate para los puntos. La vista
**Mundial (real)** muestra el cuadro verdadero, derivado de esos marcadores y desempates.

---

## ☁️ Desplegar gratis

### Vercel (recomendado)
1. Sube esta carpeta a un repositorio de GitHub.
2. En https://vercel.com → **Add New → Project** → importa el repo → **Deploy**.
   (No requiere configuración: es un sitio estático.)

### GitHub Pages
1. Sube la carpeta a un repo.
2. **Settings → Pages → Source: Deploy from a branch** → rama `main`, carpeta `/root`.

> En Supabase → **Authentication → URL Configuration**, agrega la URL pública de tu
> sitio en *Site URL* y *Redirect URLs*.

---

## 🗂️ Estructura
```
Mundial/
├── index.html            # App (login, quiniela, dashboard, admin)
├── css/styles.css        # Estilos
├── js/config.js          # ← pega aquí tu URL y anon key de Supabase
├── js/app.js             # Lógica (auth, quiniela, tiempo real, admin)
├── supabase/schema.sql   # ← ejecuta esto una vez en Supabase
├── partidos-ejemplo.txt  # Ejemplo de importación de calendario
├── vercel.json
└── README.md
```

## 🔄 Cómo funciona el tiempo real
El dashboard llama a la función `get_leaderboard()` (calcula todos los puntos de forma
segura, sin exponer las predicciones individuales). Cuando el admin guarda un resultado,
Supabase Realtime avisa al navegador y la tabla se vuelve a calcular sola.

## 🔒 Cómo funciona el bloqueo
El cierre es **por partido**: cada marcador se bloquea **15 minutos antes** de la hora
del juego (`partidos.fecha`). La función `partido_locked(id)` y las reglas **RLS** de la
base de datos impiden que un jugador inserte/edite/borre el pronóstico de un partido ya
cerrado; solo el admin queda exceptuado. La UI además deshabilita los inputs cerrados.

Para mover la hora de cierre de un partido, basta con cambiar su fecha:
```sql
update partidos set fecha = '2026-06-11T13:00:00-06:00' where numero = 1;
```
El margen de 15 min vive en `partido_locked()` (SQL) y en `LOCK_MIN` (en `js/app.js`).
Esto aplica a **todos** los partidos por igual (grupos y eliminatorias), ya que las llaves
se pronostican como partidos normales.

## 👤 Activación de participantes por partido
Por defecto, al crear un partido **nadie** puede pronosticarlo. En **Admin → Resultados
reales → cada partido** hay un desplegable **"👥 Participantes"** con la lista de usuarios
aprobados; el admin elige, por cada uno, **No participa / 1 pronóstico / 2 pronósticos**.
La tabla `partido_usuario` (con RLS) guarda esas activaciones y su `n_pred`, y `pred_partidos`
solo acepta el pronóstico de un usuario si su slot está dentro de su cupo (además de estar
aprobado y no haber cerrado).

## 🛡️ Varios administradores
Puede haber **más de un administrador**. En **Admin → Usuarios** cada usuario tiene un botón
**"Hacer admin"** / **"Quitar admin"**. No te puedes quitar el admin a ti mismo (evita quedarte
sin acceso). A nivel de base de datos no hace falta nada extra: la columna `profiles.is_admin`,
la política `perfil admin update` y el trigger `protect_profile_fields` ya permiten que **solo un
admin** promueva a otros (un usuario normal no puede auto-promoverse).

## 🎯 Doble marcador
`pred_partidos` tiene una columna `slot` (1 o 2): cada usuario puede guardar hasta dos
marcadores **distintos** por partido. El puntaje (`get_leaderboard`) suma **ambas** filas,
por lo que los dos pronósticos acumulan.

## 💵 Control de pagos
La pestaña **Control de Pagos** la **ven todos** los usuarios autorizados (solo lectura);
**solo el admin** puede registrar/editar pagos. Por cada usuario muestra:
**pronósticos enviados**, **dinero pagado** y **disponible**. Un pronóstico se considera
**enviado** (y cuesta **$1**) cuando **su partido ya cerró** (15 min antes del juego, igual
que el bloqueo) **y** el usuario había registrado un marcador (cada `slot` digitado = $1),
estando activado como participante. El **disponible** = `dinero pagado − pronósticos enviados`;
si el usuario puso más pronósticos de los que pagó, queda **negativo en rojo**.

El admin registra abonos (positivos, o negativos para corregir) que se guardan en la tabla
`pagos` (con RLS solo-admin: nadie más puede escribirla). El resumen lo calcula
`get_control_pagos()` (security definer; responde a cualquier usuario autorizado, pero la
escritura sigue bloqueada al admin). Lo ejecuta
[`supabase/migracion_control_pagos.sql`](supabase/migracion_control_pagos.sql).
