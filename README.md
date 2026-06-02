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

| Acierto | Puntos |
|---|---|
| Marcador exacto | **3** |
| Solo el ganador / empate | **1** |
| Cada equipo que llega a **16avos** (Ronda de 32) | **1** |
| Cada equipo que llega a **8vos** | **2** |
| Cada equipo que llega a **4tos** | **3** |
| Cada equipo que llega a **semis** | **4** |
| Acertar el **tercer lugar** | **5** |
| Acertar el **subcampeón** (2.º) | **5** |
| Acertar el **campeón** | **7** |

> ⚑ **Partidos que aplican:** según las reglas nuevas, no todos los partidos otorgan los
> puntos de marcador (3/1). En **Admin** cada partido tiene un check **"aplica"**; al
> desmarcarlo, ese partido deja de sumar marcador (el resultado real **sí** sigue armando
> las tablas de grupo y las llaves). Al jugador se le muestra la etiqueta *"no suma marcador"*.

Ganan los **3 primeros lugares** de la tabla. Las quinielas se **bloquean el
11/06/2026 a las 11:00 a.m. (hora El Salvador)**: a partir de ahí los jugadores ya no
pueden modificar nada; solo el admin puede cargar resultados.

---

## 🚀 Puesta en marcha (15 min)

### 1) Crear la base de datos (Supabase)
1. Entra a https://supabase.com → **New project** (plan gratis). Guarda la contraseña de la BD.
2. Cuando esté listo, ve a **SQL Editor → New query**.
3. Ejecuta **en este orden** (cada uno: pegar contenido → **Run**):
   1. [`supabase/schema.sql`](supabase/schema.sql) — tablas, puntajes y seguridad.
   2. [`supabase/migracion_bracket.sql`](supabase/migracion_bracket.sql) — guardado de las llaves.
   3. [`supabase/seed_partidos.sql`](supabase/seed_partidos.sql) — calendario real de grupos.

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
Como la quiniela **se cierra el 11/06 antes de que arranque el torneo**, todavía no se
sabe qué equipos jugarán cada cruce, así que **no se predicen marcadores de eliminatorias**.
Esas rondas se puntúan con las secciones **2) Equipos que avanzan por fase** y
**3) Posiciones finales** (que es justo el esquema de puntos que definiste: 1/2/3/4 por
fase y 7/5/5 por campeón/subcampeón/tercero). Los marcadores (3/1 pts) aplican a los 72
partidos de grupos.

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
La fecha está en la tabla `config` (`lock_at`). Las reglas **RLS** de la base de datos
impiden que un jugador inserte/edite/borre predicciones después de esa fecha; solo el
admin queda exceptuado. La UI además deshabilita los botones.
Para cambiar la fecha:
```sql
update config set valor = '2026-06-11T11:00:00-06:00' where clave = 'lock_at';
```
