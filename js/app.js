// ============================================================
//  QUINIELA MUNDIAL 2026 — Lógica principal (con bracket + banderas)
// ============================================================
const CFG = window.QUINIELA_CONFIG;
const FX = window.FIXTURE;
const $ = (s) => document.querySelector(s);
const $$ = (s) => Array.from(document.querySelectorAll(s));

if (CFG.SUPABASE_URL.includes("PEGA_AQUI")) {
  alert("⚠️ Falta configurar Supabase: edita js/config.js con tu URL y ANON KEY.");
}
const sb = supabase.createClient(CFG.SUPABASE_URL, CFG.SUPABASE_ANON_KEY);

const S = {
  user: null, profile: null,
  partidos: [],            // todos los partidos (de la BD)
  scores: {},              // predicción del usuario {numero:{1:{gl,gv}, 2:{gl,gv}}}  (dos slots)
  activos: new Map(),      // partido_id -> n_pred (1 ó 2) donde el admin activó a este usuario
  realWinners: {},         // bracket real (res_bracket)
  authMode: "login",
  clockOffset: 0,          // ms a sumar a Date.now() para igualar la hora del servidor
  cerradosForzados: new Set(), // partido_id que el backend ya confirmó como cerrados
  pronCerrados: new Map(), // partido_id -> [pronósticos de todos] (solo partidos cerrados)
};

const FASES_AVANCE = ["16avos", "8vos", "4tos", "semis"];
const POSICIONES = [
  { key: "campeon", label: "🥇 Campeón" },
  { key: "subcampeon", label: "🥈 Subcampeón" },
  { key: "tercero", label: "🥉 Tercer lugar" },
];

// ---------- Helpers de presentación ----------
function flagImg(team) {
  const c = FX.FLAGS[team];
  return c ? `<img class="flag" src="https://flagcdn.com/32x24/${c}.png" alt="" loading="lazy">` : "";
}
function teamRow(team) {
  return `<span class="team">${flagImg(team)}<span class="nm">${team}</span></span>`;
}
function teamTxt(team) { return team ? teamRow(team) : '<span class="muted">—</span>'; }
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
function fmtFecha(iso) {
  if (!iso) return "";
  // Forzamos zona horaria de El Salvador (GMT-6, sin horario de verano) para
  // que TODOS vean la misma hora sin importar la zona de su navegador.
  return new Date(iso).toLocaleString("es-SV", {
    weekday: "short", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit",
    timeZone: "America/El_Salvador",
  });
}
// Fecha+hora "amigable" para la confirmación de guardado: "11 jun a las 02:30 p. m."
function fmtGuardado(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  const fecha = d.toLocaleDateString("es-SV", { day: "2-digit", month: "short", timeZone: "America/El_Salvador" });
  const hora = d.toLocaleTimeString("es-SV", { hour: "2-digit", minute: "2-digit", timeZone: "America/El_Salvador" });
  return `${fecha} a las ${hora}`;
}
function msg(el, text, ok = true) {
  if (!el) return;
  el.textContent = text; el.className = "msg " + (ok ? "ok" : "err");
  // los mensajes de éxito desaparecen solos; los errores se quedan para poder leerlos
  if (text && ok) setTimeout(() => { if (el.textContent === text) el.textContent = ""; }, 4000);
}
const grupoMatches = () => S.partidos.filter((p) => p.fase === "grupos");
const realScores = () => {
  const o = {};
  S.partidos.forEach((p) => {
    if (p.gol_local != null && p.gol_visitante != null) o[p.numero] = { gl: p.gol_local, gv: p.gol_visitante };
  });
  return o;
};

// ============================================================
//  AUTENTICACIÓN
// ============================================================
const _tl = $("#tabLogin"); if (_tl) _tl.onclick = () => setAuthMode("login");
const _tr = $("#tabRegister"); if (_tr) _tr.onclick = () => setAuthMode("register");
const _tp = $("#togglePass"); if (_tp) _tp.onclick = () => {
  const inp = $("#authPass"); const mostrar = inp.type === "password";
  inp.type = mostrar ? "text" : "password"; _tp.textContent = mostrar ? "🙈" : "👁";
};
function setAuthMode(mode) {
  S.authMode = mode;
  $("#tabLogin").classList.toggle("active", mode === "login");
  $("#tabRegister").classList.toggle("active", mode === "register");
  $("#lblNombre").classList.toggle("hidden", mode !== "register");
  $("#authSubmit").textContent = mode === "register" ? "Crear cuenta" : "Entrar";
}
$("#authForm").onsubmit = async (e) => {
  e.preventDefault();
  const email = $("#authEmail").value.trim(), pass = $("#authPass").value, nombre = $("#authNombre").value.trim();
  const m = $("#authMsg"); $("#authSubmit").disabled = true;
  try {
    if (S.authMode === "register") {
      if (!nombre) throw new Error("Escribe tu nombre.");
      // Guardamos el nombre en los metadatos del usuario: así sobrevive aunque
      // haya que confirmar el correo (en ese caso aún no hay sesión y el upsert
      // de abajo lo bloquearía RLS). Al primer login usamos este metadato.
      const { data, error } = await sb.auth.signUp({ email, password: pass, options: { data: { nombre } } });
      if (error) throw error;
      if (data.session && data.user) await sb.from("profiles").upsert({ id: data.user.id, nombre });
      if (!data.session) { msg(m, "Cuenta creada. Revisa tu correo y luego inicia sesión.", true); setAuthMode("login"); }
    } else {
      const { error } = await sb.auth.signInWithPassword({ email, password: pass });
      if (error) throw error;
    }
  } catch (err) { msg(m, traducirError(err.message), false); }
  finally { $("#authSubmit").disabled = false; }
};
function traducirError(t) {
  if (/Invalid login/i.test(t)) return "Correo o contraseña incorrectos. (¿Ya te registraste? Usa la pestaña Registrarme.)";
  if (/already registered|already exists/i.test(t)) return "Ese correo ya está registrado. Inicia sesión.";
  if (/Email not confirmed/i.test(t)) return "Tu correo no está confirmado. Revisa tu bandeja, o pídele al admin desactivar la confirmación de correo en Supabase.";
  if (/at least 6/i.test(t)) return "La contraseña debe tener al menos 6 caracteres.";
  if (/Failed to fetch|NetworkError/i.test(t)) return "No se pudo conectar con Supabase. Revisa la URL/clave en js/config.js.";
  if (/Invalid API key|JWT|apikey/i.test(t)) return "La clave de Supabase no es válida. Pega la 'Publishable key' en js/config.js.";
  return t;
}
$("#logoutBtn").onclick = async () => { await sb.auth.signOut(); };

sb.auth.onAuthStateChange((_e, session) => {
  S.user = session?.user || null;
  // IMPORTANTE: no hacer llamadas a Supabase (await) DENTRO de este callback.
  // onAuthStateChange se ejecuta tomando un lock interno de auth; cualquier
  // consulta (sb.from(...), que por dentro pide getSession) se queda esperando
  // ese mismo lock -> deadlock -> el login se queda "trabado". Lo diferimos.
  if (S.user) setTimeout(onLogin, 0); else showAuth();
});

let _loginEnCurso = false;
let _cambioForzadoEnCurso = false;   // mientras el modal de cambio de clave está abierto
async function onLogin() {
  // Si estamos en pleno cambio de contraseña forzado, el evento USER_UPDATED que
  // dispara updateUser() no debe reabrir el modal ni recargar: lo controla el modal.
  if (_cambioForzadoEnCurso) return;
  if (_loginEnCurso || !S.user) return;   // evita ejecuciones simultáneas (INITIAL_SESSION + SIGNED_IN)
  _loginEnCurso = true;
  try {
    let { data: prof } = await sb.from("profiles").select("*").eq("id", S.user.id).single();
    if (!prof) {
      // Preferimos el nombre que el usuario escribió al registrarse (guardado en
      // los metadatos); si no existe, caemos al prefijo del correo.
      const nombreReg = (S.user.user_metadata?.nombre || "").trim() || S.user.email.split("@")[0];
      await sb.from("profiles").upsert({ id: S.user.id, nombre: nombreReg });
      ({ data: prof } = await sb.from("profiles").select("*").eq("id", S.user.id).single());
    }
    S.profile = prof;
    // Mostramos solo el primer nombre, con saludo: "Hola, José".
    // Si por alguna razón no hay nombre, caemos al correo.
    const nombreMostrar = (prof?.nombre || S.user.email || "").trim().split(/\s+/)[0];
    $("#userName").textContent = nombreMostrar ? "Hola, " + nombreMostrar : "";
    $("#logoutBtn").classList.remove("hidden");
    $("#nav").classList.remove("hidden");
    $$(".admin-only").forEach((e) => e.classList.toggle("hidden", !prof?.is_admin));
    // El superadmin (por correo) ve además la opción de registrar pronósticos
    // pos-partido. Es una excepción manual y auditada, separada del rol admin.
    $$(".superadmin-only").forEach((e) => e.classList.toggle("hidden", !esSuperadmin()));

    // Si el admin reseteó su contraseña, obligamos a cambiarla antes de entrar.
    // El modal, al terminar con éxito, llama a continuarApp().
    if (S.profile?.must_change_password) { abrirCambioForzado(); return; }

    await continuarApp();
  } catch (e) {
    // Si algo falla al cargar los datos, mostramos el error en vez de dejar
    // la pantalla trabada en blanco.
    console.error("Error al cargar la sesión:", e);
    msg($("#authMsg"), "No se pudieron cargar tus datos: " + (e?.message || e), false);
    showAuth();
  } finally {
    _loginEnCurso = false;
  }
}
// Carga del contenido de la app una vez superado el cambio de contraseña forzado.
async function continuarApp() {
  await cargarConfigLock();
  await syncReloj();          // ajusta el reloj a la hora del servidor antes de evaluar cierres
  await cargarPartidos();
  showView("quiniela");   // recarga la quiniela (activación + pronósticos) al entrar
  iniciarRealtime();
}

// ---------- Cambio de contraseña forzado (tras un reseteo del admin) ----------
function abrirCambioForzado() {
  const m = $("#pwdModal");
  if (!m) { continuarApp(); return; }      // sin modal: no bloqueamos la app
  _cambioForzadoEnCurso = true;
  $("#pwdNew").value = ""; $("#pwdConfirm").value = "";
  msg($("#pwdMsg"), "", true);
  m.classList.remove("hidden");
  setTimeout(() => $("#pwdNew")?.focus(), 50);
}
const _pwt = $("#pwdToggle"); if (_pwt) _pwt.onclick = () => {
  const inp = $("#pwdNew"); const mostrar = inp.type === "password";
  inp.type = mostrar ? "text" : "password"; _pwt.textContent = mostrar ? "🙈" : "👁";
};
const _pwf = $("#pwdForm"); if (_pwf) _pwf.onsubmit = async (e) => {
  e.preventDefault();
  const np = $("#pwdNew").value, conf = $("#pwdConfirm").value, mm = $("#pwdMsg");
  if (np.length < 6) { msg(mm, "La contraseña debe tener al menos 6 caracteres.", false); return; }
  if (np !== conf) { msg(mm, "Las contraseñas no coinciden.", false); return; }
  const btn = $("#pwdSubmit"); btn.disabled = true;
  try {
    const { error } = await sb.auth.updateUser({ password: np });
    if (error) throw error;
    // Apaga el flag (el trigger permite que el propio usuario lo apague).
    const { error: e2 } = await sb.from("profiles")
      .update({ must_change_password: false }).eq("id", S.user.id);
    if (e2) throw e2;
    if (S.profile) S.profile.must_change_password = false;
    $("#pwdModal").classList.add("hidden");
    msg(mm, "", true);
    _cambioForzadoEnCurso = false;
    await continuarApp();
  } catch (err) {
    msg(mm, traducirError(err.message), false);
  } finally { btn.disabled = false; }
};
function showAuth() {
  _cambioForzadoEnCurso = false;
  $("#nav").classList.add("hidden"); $("#logoutBtn").classList.add("hidden"); $("#userName").textContent = "";
  $("#pwdModal")?.classList.add("hidden");   // por si se cerró sesión con el modal abierto
  $$(".view").forEach((v) => v.classList.add("hidden"));
  $("#view-auth").classList.remove("hidden");
}

// ============================================================
//  NAVEGACIÓN
// ============================================================
$$("#nav .tab").forEach((b) => (b.onclick = () => showView(b.dataset.view)));
function showView(name) {
  $$(".view").forEach((v) => v.classList.add("hidden"));
  $("#view-" + name).classList.remove("hidden");
  $$("#nav .tab").forEach((t) => t.classList.toggle("active", t.dataset.view === name));
  // Recarga la activación y los pronósticos cada vez (evita ver datos en caché
  // si el admin cambió el cupo después de iniciar sesión).
  if (name === "quiniela") cargarMiQuiniela().then(renderQuiniela);
  if (name === "calendario") renderCalendario();
  if (name === "mundial") renderMundialReal();
  if (name === "dashboard") cargarLeaderboard();
  if (name === "premios") cargarPremios();
  if (name === "pagos") renderControlPagos();
  if (name === "panelsuper") renderPanelSuper();
  if (name === "admin") renderAdmin();
}

// ============================================================
//  BLOQUEO POR PARTIDO (cada marcador cierra 15 min antes del juego)
// ============================================================
const LOCK_MIN = 15;                       // minutos antes de cada partido
function cargarConfigLock() {
  const b = $("#lockBanner");
  if (b) {
    b.className = "banner open";
    b.textContent = "✏️ Cada marcador se cierra " + LOCK_MIN +
      " minutos antes de que empiece su partido. Después ya no podrás modificarlo.";
    b.classList.remove("hidden");
  }
  const fl = $("#footLock");
  if (fl) fl.textContent = "Cada partido cierra " + LOCK_MIN + " min antes de empezar (hora El Salvador).";
}
// Hora actual SEGÚN EL SERVIDOR (corrige el reloj del navegador si está desfasado).
const nowMs = () => Date.now() + (S.clockOffset || 0);
// Sincroniza el reloj con el servidor de Supabase: calcula cuántos ms de
// diferencia hay y los guarda en S.clockOffset. Si falla, usa el reloj local.
async function syncReloj() {
  try {
    const t0 = Date.now();
    const { data, error } = await sb.rpc("server_now");
    if (error || !data) return;
    const t1 = Date.now();
    const serverMs = new Date(data).getTime();
    S.clockOffset = serverMs - (t0 + (t1 - t0) / 2);   // compensa medio round-trip
  } catch { /* sin sincronizar: seguimos con el reloj local */ }
}
// ¿Ya cerró este partido? (now >= hora_del_partido - 15 min). Sin fecha => abierto.
function partidoBloqueado(p) {
  if (!p) return false;
  // Si el backend ya rechazó un guardado por cierre, lo respetamos siempre.
  if (S.cerradosForzados && S.cerradosForzados.has(p.id)) return true;
  if (!p.fecha) return false;
  return nowMs() >= new Date(p.fecha).getTime() - LOCK_MIN * 60000;
}
// Para participar (guardar): ser admin, o estar APROBADO. El cierre por tiempo
// es por partido (ver partidoBloqueado / puedeEditarMarcador).
const estaAprobado = () => !!(S.profile?.is_admin || S.profile?.aprobado);
const puedeEditar = () => !!(S.profile?.is_admin || estaAprobado());
// ¿Puede editar el marcador de ESTE partido ahora mismo?
// El cierre por tiempo aplica a TODOS, incluido el admin: el admin también es un
// participante con su propia cuenta y no debe editar su quiniela tras el cierre.
// (Su rol de admin solo lo exime para cargar resultados/activar, no para jugar.)
const puedeEditarMarcador = (p) => estaAprobado() && !partidoBloqueado(p);

// ============================================================
//  DATOS
// ============================================================
async function cargarPartidos() {
  const { data } = await sb.from("partidos").select("*").order("numero", { ascending: true });
  S.partidos = data || [];
}
async function cargarMiQuiniela() {
  S.scores = {}; S.activos = new Map(); S.savedAt = {};   // savedAt: numero -> última fecha guardada
  const [{ data: preds }, { data: act }] = await Promise.all([
    sb.from("pred_partidos").select("*").eq("user_id", S.user.id),
    sb.from("partido_usuario").select("partido_id,n_pred").eq("user_id", S.user.id),
  ]);
  (preds || []).forEach((p) => {
    const n = mapIdToNum(p.partido_id);
    (S.scores[n] ||= {})[p.slot || 1] = { gl: p.gol_local, gv: p.gol_visitante };
    // Guarda la edición MÁS reciente entre los dos slots de este partido.
    if (p.updated_at && (!S.savedAt[n] || new Date(p.updated_at) > new Date(S.savedAt[n]))) S.savedAt[n] = p.updated_at;
  });
  (act || []).forEach((a) => S.activos.set(a.partido_id, a.n_pred || 2));
}
// ¿Está activado para pronosticar este partido? Se basa SOLO en la activación
// real (partido_usuario), también para el admin: si no se activó a sí mismo,
// también le sale bloqueado.
const estaActivo = (p) => !!p && S.activos.has(p.id);
// Cuántos pronósticos puede dar en este partido: 0 (no participa) | 1 | 2.
const nPredDe = (p) => (p ? (S.activos.get(p.id) || 0) : 0);
// Marcador de equipos "por definir" en llaves aún no calculadas.
const POR_DEFINIR = "Por definir";
// Una llave solo está lista cuando sus dos equipos son reales (no 'Por definir').
const partidoDefinido = (p) => !!p && !!p.equipo_local && !!p.equipo_visitante
  && p.equipo_local !== POR_DEFINIR && p.equipo_visitante !== POR_DEFINIR;
function mapIdToNum(id) { const p = S.partidos.find((x) => x.id === id); return p ? p.numero : id; }
function numToId(num) { const p = S.partidos.find((x) => x.numero === num); return p ? p.id : null; }

// ============================================================
//  VISTA: MI QUINIELA
// ============================================================
function renderQuiniela() {
  renderApprovalBanner();
  renderMarcadores();
  cargarPronosticosCerrados();
}
// Trae los pronósticos de TODOS para los partidos ya cerrados y los guarda en
// S.pronCerrados (agrupados por partido). Luego re-pinta los marcadores para que
// cada bloque aparezca debajo de su partido. El backend solo devuelve partidos
// cerrados, así que nadie puede espiar antes de tiempo.
async function cargarPronosticosCerrados() {
  const { data, error } = await sb.rpc("get_pronosticos_bloqueados");
  S.pronCerrados = new Map();
  if (!error) {
    (data || []).forEach((r) => {
      if (!S.pronCerrados.has(r.partido_id)) S.pronCerrados.set(r.partido_id, []);
      S.pronCerrados.get(r.partido_id).push(r);
    });
  }
  renderMarcadores();   // re-pinta con los pronósticos debajo de cada partido
}
// Bloque compacto (letra pequeña) con los pronósticos de todos para UN partido.
// Para todos: solo si el partido ya cerró. Para el ADMIN: siempre que haya
// pronósticos, aunque el partido siga abierto (el backend ya se los entrega).
function bloquePronosticosCerrados(p) {
  const esAdmin = !!S.profile?.is_admin;
  const cerrado = partidoBloqueado(p);
  if (!cerrado && !esAdmin) return "";
  const preds = S.pronCerrados.get(p.id) || [];
  if (!preds.length) return "";
  const yo = (S.profile?.nombre || "").trim();
  const lis = preds.map((r) => {
    const dup = preds.filter((x) => x.nombre === r.nombre).length > 1;   // tiene 2 pronósticos
    return `<li class="${r.nombre === yo ? "me" : ""}${r.acerto ? " ok" : ""}">
        <span class="pcm-nom">${esc(r.nombre)}${dup ? ` · P${r.slot}` : ""}</span>
        <span class="pcm-mar">${r.pred_local}-${r.pred_visitante}${r.acerto ? " ✅" : ""}</span>
      </li>`;
  }).join("");
  // Total de PARTICIPANTES distintos (alguien con 2 cuenta 1) y total de
  // PRONÓSTICOS (cada slot cuenta; suele ser mayor porque varios ponen 2).
  const nParticipantes = new Set(preds.map((r) => r.nombre)).size;
  const nPron = preds.length;
  const cntPart =
    `<span class="pcm-count">👥 ${nParticipantes} participante${nParticipantes === 1 ? "" : "s"}</span>` +
    `<span class="pcm-count">🎟️ ${nPron} pronóstico${nPron === 1 ? "" : "s"}</span>`;
  // Si aún no cierra y solo lo ve el admin, lo indicamos para evitar confusiones.
  const title = (cerrado ? "🔒 Pronósticos de todos" : "👁️ Pronósticos de todos (vista admin · aún abierto)") + " " + cntPart;
  // Pie de auditoría: la edición más reciente de este partido y quién la registró.
  const conFecha = preds.filter((r) => r.actualizado_en);
  const ult = conFecha.length
    ? conFecha.reduce((a, b) => (new Date(b.actualizado_en) > new Date(a.actualizado_en) ? b : a))
    : null;
  const footer = ult
    ? `<div class="pcm-foot">🕒 Última actualización: ${fmtFecha(ult.actualizado_en)} · por <strong>${esc(ult.nombre)}</strong></div>`
    : "";
  return `<div class="pron-cerrados-mini${cerrado ? "" : " admin-peek"}">
      <div class="pcm-title">${title}</div>
      <ul>${lis}</ul>
      ${footer}
    </div>`;
}
// Partidos en los que el usuario fue activado por el admin (admin ve todos),
// ordenados por fecha (los sin fecha al final) y luego por número.
function partidosVisibles() {
  // Se ven TODOS los partidos definidos (las llaves "Por definir" no se muestran
  // hasta que el admin calcula los cruces). El cupo (0/1/2) controla cuántos
  // pronósticos puede editar en cada partido. Mismo criterio para todos (incluido
  // el admin: si no está activado, le sale bloqueado).
  // Orden por número: agrupa por sección (grupos 1–72, luego llaves 73–104).
  return S.partidos.filter((p) => partidoDefinido(p))
    .slice().sort((a, b) => (a.numero || 0) - (b.numero || 0));
}
const FASES_LABEL = (window.QUINIELA_CONFIG && window.QUINIELA_CONFIG.FASES_LABEL) || {};
const fmtFase = (f) => FASES_LABEL[f] || f || "";
// Encabezado de sección para agrupar visualmente: "Grupo X" o el nombre de la ronda.
const seccionDe = (p) => p.fase === "grupos" ? "Grupo " + (p.grupo || "?") : fmtFase(p.fase);
// Aviso para usuarios que aún no han sido autorizados por el admin.
function renderApprovalBanner() {
  const b = $("#approvalBanner");
  if (!b) return;
  if (!estaAprobado()) {
    b.className = "banner locked";
    b.textContent = "⏳ Tu cuenta está pendiente de autorización por el administrador. " +
      "Puedes ver todo, pero aún no puedes guardar tu quiniela.";
    b.classList.remove("hidden");
  } else {
    b.classList.add("hidden");
  }
}
// Fecha (YYYY-MM-DD) de un partido en zona horaria de El Salvador, para comparar
// días sin que la zona del navegador altere el resultado.
function diaSV(iso) {
  return new Date(iso).toLocaleDateString("en-CA", { timeZone: "America/El_Salvador" });
}
// Un partido es "anterior" si tiene fecha y su día ya pasó (antes de hoy en SV).
// Los sin fecha ("Por definir") se consideran futuros y quedan visibles.
function partidoAnterior(p) {
  if (!p.fecha) return false;
  return diaSV(p.fecha) < diaSV(nowMs());
}
// Pinta una lista de partidos con sus encabezados de sección dentro de `cont`.
function pintarMarcadores(cont, lista) {
  let sec = null;
  lista.forEach((p) => {
    const s = seccionDe(p);
    if (s !== sec) {
      sec = s;
      const h = document.createElement("div"); h.className = "grupo-h"; h.textContent = s; cont.appendChild(h);
    }
    cont.appendChild(filaMarcador(p));
  });
}
function renderMarcadores() {
  const cont = $("#partidosList"); cont.innerHTML = "";
  if (!S.partidos.length) {
    cont.innerHTML = '<p class="muted">Aún no hay partidos cargados (el admin debe importarlos).</p>'; return;
  }
  const ms = partidosVisibles();
  if (!ms.length) {
    cont.innerHTML = '<p class="muted">Aún no hay partidos disponibles.</p>';
    return;
  }
  // Separamos los partidos ya pasados (días anteriores a hoy) para colapsarlos en
  // un panel cerrado: por defecto solo se ven los de hoy en adelante.
  const anteriores = ms.filter(partidoAnterior);
  const actuales = ms.filter((p) => !partidoAnterior(p));
  if (anteriores.length) {
    const det = document.createElement("details");
    det.className = "partidos-anteriores";
    const sum = document.createElement("summary");
    sum.textContent = `📁 Partidos anteriores (${anteriores.length})`;
    det.appendChild(sum);
    // Pintamos las filas solo cuando el usuario abre el panel (no de primeras).
    let pintado = false;
    det.addEventListener("toggle", () => {
      if (det.open && !pintado) { pintarMarcadores(det, anteriores); pintado = true; }
    });
    cont.appendChild(det);
  }
  if (actuales.length) {
    pintarMarcadores(cont, actuales);
  } else {
    const m = document.createElement("p");
    m.className = "muted";
    m.textContent = "No hay partidos de hoy en adelante. Abre “Partidos anteriores” para consultarlos.";
    cont.appendChild(m);
  }
}
// Texto persistente de confirmación de guardado para UN partido (o "" si el
// usuario aún no ha guardado ningún pronóstico en él).
function guardadoLine(p) {
  const at = S.savedAt && S.savedAt[p.numero];
  if (!at) return "";
  const yo = (S.profile?.nombre || "").trim();
  return `<span class="pron-guardado">✅ Guardado el ${fmtGuardado(at)}${yo ? ` por <strong>${esc(yo)}</strong>` : ""}</span>`;
}
function filaMarcador(p) {
  const aplica = p.aplica_quiniela !== false;
  const cerrado = partidoBloqueado(p);   // el cierre por tiempo aplica también al admin
  const editable = puedeEditarMarcador(p) && estaActivo(p);   // editable hasta 15 min antes
  const row = document.createElement("div");
  row.className = "partido2" + (aplica ? "" : " no-aplica") + (cerrado ? " cerrado" : "");
  const sc = S.scores[p.numero] || {};
  const ctx = fmtFecha(p.fecha);
  const tag = aplica ? "" : `<span class="tag-no-aplica" title="Este partido no otorga los puntos de marcador (3/1).">no suma marcador</span>`;
  const lockTag = cerrado ? `<span class="tag-cerrado" title="Este partido cerró ${LOCK_MIN} min antes de empezar. Ya no se puede modificar.">🔒 cerrado</span>` : "";
  const np = nPredDe(p);   // 0 = no participa · 1 ó 2 = pronósticos permitidos
  const npTag = (np === 0)
    ? `<span class="tag-cerrado" title="No estás activado para pronosticar en este partido.">no participas</span>` : "";
  const slotBloqTitle = np === 0 ? "No participas en este partido." : "Solo tienes 1 pronóstico en este partido.";
  const slotInputs = (slot) => {
    const s = sc[slot] || {};
    const bloq = slot > np;   // este pronóstico no está habilitado para el usuario
    return `<div class="pron-slot${bloq ? " slot-bloqueado" : ""}"${bloq ? ` title="${slotBloqTitle}"` : ""}>
      <span class="pron-label">Pronóstico ${slot}${bloq ? " 🔒" : ""}</span>
      <input type="number" min="0" max="99" data-n="${p.numero}" data-slot="${slot}" data-side="l" value="${s.gl ?? ""}">
      <span class="vs">-</span>
      <input type="number" min="0" max="99" data-n="${p.numero}" data-slot="${slot}" data-side="v" value="${s.gv ?? ""}">
    </div>`;
  };
  const pronsHtml = slotInputs(1) + slotInputs(2);
  // Confirmación PERSISTENTE: como el partido sigue abierto tras guardar, dejamos
  // un texto fijo "Guardado el … por …" para que el usuario compruebe que quedó.
  const guardadoTxt = guardadoLine(p);
  // Pie: botón de guardar (mientras sea editable); si cerró, solo la fecha.
  const acciones = editable
    ? `<button class="btn small primary pron-save">💾 Guardar partido</button>
       <span class="msg pron-msg"></span>
       ${guardadoTxt}
       <span class="fch">${ctx}</span>`
    : `${guardadoTxt}<span class="fch">${ctx}</span>`;
  row.innerHTML = `
    <div class="partido2-head">
      <span class="eq">${teamRow(p.equipo_local)}</span>
      <span class="vs">vs</span>
      <span class="eq v">${teamRow(p.equipo_visitante)}</span>
      ${tag}${lockTag}${npTag}
    </div>
    <div class="partido2-prons">${pronsHtml}</div>
    <div class="pron-actions">${acciones}</div>
    ${bloquePronosticosCerrados(p)}`;
  row.querySelectorAll("input").forEach((i) => {
    i.disabled = !editable || (+i.dataset.slot > np);   // slot fuera del cupo => bloqueado
    i.oninput = () => {
      const n = +i.dataset.n, slot = +i.dataset.slot;
      ((S.scores[n] ||= {})[slot] ||= {});
      S.scores[n][slot][i.dataset.side === "l" ? "gl" : "gv"] = i.value === "" ? null : Math.max(0, Math.min(99, +i.value));
    };
  });
  const saveBtn = row.querySelector(".pron-save");
  if (saveBtn) saveBtn.onclick = () => guardarPartido(p, saveBtn, row.querySelector(".pron-msg"));
  return row;
}
// Guarda los pronósticos de UN solo partido. Se puede re-guardar (editar)
// mientras el partido no haya cerrado (15 min antes de empezar).
async function guardarPartido(p, btn, msgEl) {
  if (!editableMarcadorAhora(p)) return;
  const np = nPredDe(p);
  const slots = S.scores[p.numero] || {};
  const filled = {};
  [1, 2].forEach((slot) => {
    if (slot > np) return;   // fuera del cupo permitido para este usuario
    const s = slots[slot];
    if (s && s.gl != null && s.gv != null) filled[slot] = { gl: s.gl, gv: s.gv };
  });
  if (filled[1] && filled[2] && filled[1].gl === filled[2].gl && filled[1].gv === filled[2].gv) {
    msg(msgEl, "Los dos pronósticos deben ser diferentes.", false); return;
  }
  // Los dos pronósticos pueden variar en el marcador, pero no pueden cubrir ganadores
  // opuestos (uno gana local y el otro gana visitante). Sí se permite combinar un
  // empate con una victoria. El doble pronóstico es una segunda oportunidad de acertar
  // el marcador exacto, no para cubrir ambos posibles ganadores del partido.
  if (filled[1] && filled[2]) {
    const r1 = Math.sign(filled[1].gl - filled[1].gv);
    const r2 = Math.sign(filled[2].gl - filled[2].gv);
    if (r1 * r2 < 0) {
      msg(msgEl, "Los dos pronósticos no pueden tener ganadores opuestos. Pueden variar el marcador, pero deben mantener al mismo equipo ganador.", false); return;
    }
  }
  btn.disabled = true;
  try {
    // Reescribe este partido: borra lo previo (incluye slots vaciados) e inserta.
    const { error: delErr } = await sb.from("pred_partidos").delete().eq("user_id", S.user.id).eq("partido_id", p.id);
    if (delErr) throw delErr;
    const rows = Object.entries(filled).map(([slot, s]) =>
      ({ user_id: S.user.id, partido_id: p.id, slot: +slot, gol_local: s.gl, gol_visitante: s.gv }));
    if (rows.length) { const { error } = await sb.from("pred_partidos").insert(rows); if (error) throw error; }
    msg(msgEl, rows.length ? "✅ Guardado." : "Pronóstico borrado.", true);
    // Actualiza la confirmación PERSISTENTE en el sitio (sin recargar la fila),
    // así el toast breve queda y además permanece el "Guardado el … por …".
    S.savedAt = S.savedAt || {};
    if (rows.length) S.savedAt[p.numero] = new Date(nowMs()).toISOString();
    else delete S.savedAt[p.numero];
    const fila = btn.closest(".partido2");
    if (fila) {
      const span = fila.querySelector(".pron-guardado");
      if (rows.length) {
        if (span) span.outerHTML = guardadoLine(p);
        else {
          const fch = fila.querySelector(".pron-actions .fch");
          if (fch) fch.insertAdjacentHTML("beforebegin", guardadoLine(p));
        }
      } else if (span) {
        span.remove();
      }
    }
  } catch (e) {
    // El backend (RLS con partido_locked) rechaza guardar después del cierre.
    if (esErrorDeCierre(e) || partidoBloqueado(p)) {
      // El servidor manda: marcamos el partido como cerrado (aunque el reloj del
      // navegador vaya atrasado) y bloqueamos ESTA fila en el sitio, sin re-render,
      // para que el mensaje quede visible y los campos se deshabiliten al instante.
      (S.cerradosForzados ||= new Set()).add(p.id);
      const fila = btn.closest(".partido2");
      if (fila) {
        fila.classList.add("cerrado");
        fila.querySelectorAll("input").forEach((i) => (i.disabled = true));
      }
      btn.style.display = "none";
      msg(msgEl, "⏱️ Este partido ya cerró (15 min antes de empezar). Ya no se puede modificar.", false);
    } else {
      msg(msgEl, "Error: " + e.message, false);
    }
  }
  finally { btn.disabled = !editableMarcadorAhora(p); }
}
// ¿El usuario puede guardar este marcador ahora? (aprobado/admin + activado + no cerrado)
const editableMarcadorAhora = (p) => puedeEditar() && puedeEditarMarcador(p) && estaActivo(p);
// ¿El error de Supabase viene del RLS (típicamente, partido ya cerrado)?
// Código 42501 = insufficient_privilege; el mensaje menciona "row-level security".
const esErrorDeCierre = (e) =>
  e?.code === "42501" || /row-level security|violates row-level/i.test(e?.message || "");

// ============================================================
//  TABLAS DE GRUPO + TERCEROS
// ============================================================
function renderGroups(mount, terceMount, groups, thirds) {
  const qual = new Set(thirds.top8.map((t) => t.grp));
  let html = "";
  Object.keys(groups).sort().forEach((g) => {
    html += `<div class="gtable"><h5>Grupo ${g}</h5><table>
      <thead><tr><th></th><th></th><th>PJ</th><th>DG</th><th>Pts</th></tr></thead><tbody>`;
    groups[g].forEach((t, i) => {
      const cls = i === 0 ? "q1" : i === 1 ? "q2" : (i === 2 && qual.has(g) ? "q2" : "");
      html += `<tr class="${cls}"><td class="pos">${i + 1}</td><td class="tn">${teamRow(t.team)}</td>
        <td>${t.pj}</td><td>${t.dg > 0 ? "+" : ""}${t.dg}</td><td class="pts">${t.pts}</td></tr>`;
    });
    html += "</tbody></table></div>";
  });
  mount.innerHTML = html;
  if (terceMount) {
    let h = "<h5>Mejores terceros (clasifican 8)</h5>";
    thirds.thirds.forEach((t, i) => {
      const inq = i < 8;
      h += `<div class="row3 ${inq ? "in" : "out"}">${teamRow(t.team)}
        <span class="muted small">Gpo ${t.grp} · ${t.pts} pts · DG ${t.dg}</span>
        <span class="mark ${inq ? "si" : "no"}">${inq ? "clasifica" : "fuera"}</span></div>`;
    });
    terceMount.innerHTML = thirds.thirds.length ? h : "";
  }
}

// ============================================================
//  CALENDARIO DE LAS LLAVES (fecha, hora y sede por nº de partido)
//  Horas convertidas a hora de El Salvador (UTC-6), igual que la fase
//  de grupos. Fuente: calendario oficial del Mundial 2026.
//  Formato:  nº: [fecha DD/MM/AAAA, hora, sede]
// ============================================================
const CALENDARIO_LLAVES = {
  // 16avos (Ronda de 32)
  73: ["28/06/2026", "13:00", "SoFi Stadium, Los Ángeles"],
  74: ["29/06/2026", "14:30", "Gillette Stadium, Boston"],
  75: ["29/06/2026", "19:00", "Estadio BBVA, Monterrey"],
  76: ["29/06/2026", "11:00", "NRG Stadium, Houston"],
  77: ["30/06/2026", "15:00", "MetLife Stadium, Nueva York"],
  78: ["30/06/2026", "11:00", "AT&T Stadium, Dallas"],
  79: ["30/06/2026", "19:00", "Estadio Azteca, Ciudad de México"],
  80: ["01/07/2026", "10:00", "Mercedes-Benz Stadium, Atlanta"],
  81: ["01/07/2026", "18:00", "Levi's Stadium, San Francisco"],
  82: ["01/07/2026", "14:00", "Lumen Field, Seattle"],
  83: ["02/07/2026", "17:00", "BMO Field, Toronto"],
  84: ["02/07/2026", "13:00", "SoFi Stadium, Los Ángeles"],
  85: ["02/07/2026", "21:00", "BC Place, Vancouver"],
  86: ["03/07/2026", "16:00", "Hard Rock Stadium, Miami"],
  87: ["03/07/2026", "19:30", "Arrowhead Stadium, Kansas City"],
  88: ["03/07/2026", "12:00", "AT&T Stadium, Dallas"],
  // 8vos (Octavos)
  89: ["04/07/2026", "15:00", "Lincoln Financial Field, Filadelfia"],
  90: ["04/07/2026", "11:00", "NRG Stadium, Houston"],
  91: ["05/07/2026", "14:00", "MetLife Stadium, Nueva York"],
  92: ["05/07/2026", "18:00", "Estadio Azteca, Ciudad de México"],
  93: ["06/07/2026", "13:00", "AT&T Stadium, Dallas"],
  94: ["06/07/2026", "18:00", "Lumen Field, Seattle"],
  95: ["07/07/2026", "10:00", "Mercedes-Benz Stadium, Atlanta"],
  96: ["07/07/2026", "14:00", "BC Place, Vancouver"],
  // 4tos (Cuartos)
  97: ["09/07/2026", "14:00", "Gillette Stadium, Boston"],
  98: ["10/07/2026", "13:00", "SoFi Stadium, Los Ángeles"],
  99: ["11/07/2026", "15:00", "Hard Rock Stadium, Miami"],
  100: ["11/07/2026", "19:00", "Arrowhead Stadium, Kansas City"],
  // Semifinales
  101: ["14/07/2026", "13:00", "AT&T Stadium, Dallas"],
  102: ["15/07/2026", "13:00", "Mercedes-Benz Stadium, Atlanta"],
  // Tercer puesto
  103: ["18/07/2026", "15:00", "Hard Rock Stadium, Miami"],
  // Final
  104: ["19/07/2026", "13:00", "MetLife Stadium, Nueva York"],
};

// ============================================================
//  BRACKET (reutilizable)
// ============================================================
function renderBracket(mount, res, winners, editable, onPick) {
  const cols = [
    { t: "16avos", ms: FX.R32 },
    { t: "8vos", ms: FX.R16 },
    { t: "4tos", ms: FX.QF },
    { t: "Semifinales", ms: FX.SF },
    { t: "Final / 3.º", ms: [FX.FINAL, FX.THIRD] },
  ];
  let html = '<div class="bracket' + (editable ? "" : " ko-readonly") + '">';
  cols.forEach((col) => {
    html += `<div class="ko-col"><h4>${col.t}</h4>`;
    col.ms.forEach((def) => {
      const n = def.n, t = res.teams[n] || { a: null, b: null }, w = winners[n];
      const label = n === 103 ? "3.er puesto" : n === 104 ? "Final" : "Partido " + n;
      const info = CALENDARIO_LLAVES[n];
      const fechaHtml = info
        ? `<div class="ko-fecha">📅 ${info[0]} · 🕒 ${info[1]}<span class="ko-sede">📍 ${info[2]}</span></div>`
        : "";
      html += `<div class="ko-match"><div class="ko-num">${label}</div>${fechaHtml}`;
      ["a", "b"].forEach((side) => {
        const team = t[side];
        const cls = "ko-team" + (team ? "" : " empty") + (w === side ? " win" : "");
        html += `<div class="${cls}" data-n="${n}" data-side="${side}">${team ? teamRow(team) : '<span class="nm">— por definir —</span>'}</div>`;
      });
      html += "</div>";
    });
    html += "</div>";
  });
  html += "</div>";
  const p = res.positions;
  html += `<div class="podio"><span class="p">🥇 ${teamTxt(p.campeon)}</span>
    <span class="p">🥈 ${teamTxt(p.subcampeon)}</span>
    <span class="p">🥉 ${teamTxt(p.tercero)}</span></div>`;
  mount.innerHTML = html;
  if (editable && onPick) {
    mount.querySelectorAll(".ko-team:not(.empty)").forEach((el) =>
      (el.onclick = () => onPick(+el.dataset.n, el.dataset.side)));
  }
}

async function guardarDerivados(tablaAvance, tablaPos, res, userId) {
  const avRows = [];
  FASES_AVANCE.forEach((f) => res.adv[f].forEach((eq) => avRows.push(userId ? { user_id: userId, fase: f, equipo: eq } : { fase: f, equipo: eq })));
  const posRows = [];
  POSICIONES.forEach((p) => { const eq = res.positions[p.key]; if (eq) posRows.push(userId ? { user_id: userId, posicion: p.key, equipo: eq } : { posicion: p.key, equipo: eq }); });
  if (userId) {
    await sb.from(tablaAvance).delete().eq("user_id", userId);
    await sb.from(tablaPos).delete().eq("user_id", userId);
  } else {
    await sb.from(tablaAvance).delete().neq("fase", "___");
    await sb.from(tablaPos).delete().neq("posicion", "___");
  }
  if (avRows.length) { const { error } = await sb.from(tablaAvance).insert(avRows); if (error) throw error; }
  if (posRows.length) { const { error } = await sb.from(tablaPos).insert(posRows); if (error) throw error; }
}

// ============================================================
//  VISTA: MUNDIAL REAL
// ============================================================
async function renderMundialReal() {
  const { data: rb } = await sb.from("res_bracket").select("*");
  S.realWinners = {}; (rb || []).forEach((r) => (S.realWinners[r.match_no] = r.ganador));
  const w = winnersReales();
  const res = Bracket.resolve(grupoMatches(), realScores(), w);
  renderGroups($("#gruposReal"), $("#tercerosReal"), res.groups, res.thirds);
  renderBracket($("#bracketReal"), res, w, false, null);
}

// ============================================================
//  VISTA: PARTIDOS POR DÍA (calendario)
// ============================================================
let _calDia = "all";   // día seleccionado en el filtro ("all" = hoy en adelante)
// Clave ordenable del día (YYYY-MM-DD) en hora de El Salvador, para agrupar.
function diaKey(iso) {
  if (!iso) return "";
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/El_Salvador", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date(iso));   // en-CA => "2026-06-11"
}
// Etiqueta legible del día: "miércoles, 11 de junio".
function diaLabel(key) {
  if (!key) return "";
  return new Date(key + "T12:00:00").toLocaleDateString("es-SV", {
    weekday: "long", day: "2-digit", month: "long",
  });
}
// Una fila compacta de solo lectura para el calendario.
function filaCalendario(p) {
  const jugado = p.gol_local != null && p.gol_visitante != null;
  const hora = new Date(p.fecha).toLocaleTimeString("es-SV", {
    hour: "2-digit", minute: "2-digit", timeZone: "America/El_Salvador",
  });
  const centro = jugado
    ? `<span class="cal-score">${p.gol_local} - ${p.gol_visitante}</span>`
    : `<span class="cal-hora">🕒 ${hora}</span>`;
  return `<div class="cal-row${jugado ? " jugado" : ""}">
      <span class="cal-sec">${esc(seccionDe(p))}</span>
      <span class="eq">${teamRow(p.equipo_local)}</span>
      ${centro}
      <span class="eq v">${teamRow(p.equipo_visitante)}</span>
    </div>`;
}
function renderCalendario() {
  const cont = $("#calendarioList"); if (!cont) return;
  const sel = $("#calFiltroDia");
  // Todos los partidos con fecha, ordenados cronológicamente (y por número).
  const ms = S.partidos.filter((p) => p.fecha).slice()
    .sort((a, b) => new Date(a.fecha) - new Date(b.fecha) || (a.numero || 0) - (b.numero || 0));
  if (!ms.length) {
    if (sel) sel.innerHTML = '<option value="all">Hoy en adelante</option>';
    cont.innerHTML = '<p class="muted">Aún no hay partidos con fecha.</p>';
    return;
  }
  // Días distintos (ya en orden, porque ms viene ordenado por fecha).
  const dias = [];
  const vistos = new Set();
  ms.forEach((p) => { const k = diaKey(p.fecha); if (k && !vistos.has(k)) { vistos.add(k); dias.push(k); } });
  // Hoy según el reloj del servidor (mismo huso que el resto de la app).
  const hoyKey = diaKey(new Date(nowMs()).toISOString());
  const futuros = dias.filter((k) => k >= hoyKey);   // hoy en adelante (las claves YYYY-MM-DD ordenan como texto)
  // Pobla el filtro conservando la selección si sigue siendo válida.
  if (sel) {
    if (_calDia !== "all" && !dias.includes(_calDia)) _calDia = "all";
    sel.innerHTML = `<option value="all">Hoy en adelante (${futuros.length})</option>` +
      dias.map((k) => `<option value="${k}">${diaLabel(k)}${k < hoyKey ? " ·  ✓" : ""}</option>`).join("");
    sel.value = _calDia;
  }
  const diasMostrar = _calDia === "all" ? futuros : [_calDia];
  if (!diasMostrar.length) {
    cont.innerHTML = '<p class="muted">No quedan partidos próximos. Usa el filtro para revisar días anteriores.</p>';
    return;
  }
  cont.innerHTML = diasMostrar.map((k) => {
    const delDia = ms.filter((p) => diaKey(p.fecha) === k);
    return `<div class="cal-dia">
        <div class="grupo-h cal-dia-h">📅 ${diaLabel(k)} <span class="cal-cnt">${delDia.length} partido(s)</span></div>
        ${delDia.map(filaCalendario).join("")}
      </div>`;
  }).join("");
}
// El filtro persiste tras los re-render porque solo cambiamos su innerHTML.
{ const s = $("#calFiltroDia"); if (s) s.onchange = () => { _calDia = s.value; renderCalendario(); }; }

// ============================================================
//  VISTA: DASHBOARD
// ============================================================
async function cargarLeaderboard() {
  const body = $("#leaderboardBody");
  // Traemos la tabla y, en paralelo, el detalle por partido (solo partidos ya
  // cerrados; el backend nunca devuelve pronósticos de partidos abiertos).
  const [{ data, error }, det] = await Promise.all([
    sb.rpc("get_leaderboard"),
    sb.rpc("get_pronosticos_bloqueados"),
  ]);
  if (error) { body.innerHTML = `<tr><td colspan="5" class="muted">Error: ${error.message}</td></tr>`; return; }
  if (!data?.length) { body.innerHTML = '<tr><td colspan="5" class="muted">Sin jugadores aún.</td></tr>'; return; }
  // Agrupa por jugador SOLO los partidos FINALIZADOS (con resultado real cargado).
  S.detalleLB = new Map();
  (det?.data || []).forEach((r) => {
    if (r.gol_local_real == null || r.gol_visitante_real == null) return; // aún sin resultado real
    if (!S.detalleLB.has(r.nombre)) S.detalleLB.set(r.nombre, []);
    S.detalleLB.get(r.nombre).push(r);
  });
  // Solo aparecen en la tabla quienes YA participaron en algún partido finalizado
  // (tienen al menos un pronóstico sobre un partido con resultado real). Los demás
  // se ocultan hasta que participen.
  const jugadores = data.filter((r) => (S.detalleLB.get(r.nombre) || []).length > 0);
  if (!jugadores.length) {
    body.innerHTML = '<tr><td colspan="5" class="muted">Nadie ha participado en un partido finalizado todavía.</td></tr>';
    return;
  }
  body.innerHTML = jugadores.map((r, i) => {
    const rank = i + 1, medalla = rank === 1 ? "🥇" : rank === 2 ? "🥈" : rank === 3 ? "🥉" : rank;
    const cls = rank <= 3 ? "rank" + rank : "", me = r.nombre === S.profile?.nombre ? "me" : "";
    const hayDet = (S.detalleLB.get(r.nombre) || []).length > 0;
    const btn = hayDet ? ` <button type="button" class="ver-detalle" aria-expanded="false">Ver detalle</button>` : "";
    return `<tr class="${me} ${cls}"><td>${medalla}</td><td>${esc(r.nombre)}${btn}</td>
      <td>${r.marcadores}</td><td>${r.ganadores}</td><td class="total">${r.total}</td></tr>
      <tr class="lb-detalle hidden"><td colspan="5">${hayDet ? detalleLeaderboard(r.nombre) : ""}</td></tr>`;
  }).join("");
  // Conecta cada botón "Ver detalle" con la fila de detalle que va justo debajo.
  body.querySelectorAll(".ver-detalle").forEach((b) => {
    b.onclick = () => {
      const fila = b.closest("tr").nextElementSibling;
      if (!fila) return;
      const oculto = fila.classList.toggle("hidden");
      b.setAttribute("aria-expanded", oculto ? "false" : "true");
      b.textContent = oculto ? "Ver detalle" : "Ocultar detalle";
    };
  });
}
// Tabla de detalle (igual que la de posiciones): un renglón por pronóstico de un
// partido ya FINALIZADO, con resultado real, marcador del jugador y puntos
// (misma regla que get_leaderboard: 3 exacto · 1 acertar resultado · 0 fallar;
// un partido marcado "no aplica" no suma). Con DOS pronósticos en un mismo
// partido solo cuenta el MEJOR de los dos (el otro se marca "descartado" y no
// suma). El total puede ser menor al de la tabla si hay partidos cerrados sin
// resultado todavía.
function detalleLeaderboard(nombre) {
  const rows = (S.detalleLB.get(nombre) || []).slice()
    .sort((a, b) => (a.numero || 0) - (b.numero || 0) || (a.slot || 1) - (b.slot || 1));
  if (!rows.length) return '<p class="muted small">Sin partidos finalizados todavía.</p>';
  const signo = (x) => (x > 0 ? 1 : x < 0 ? -1 : 0);
  // Puntos crudos de un pronóstico (sin aplicar aún la regla del mejor de dos).
  // Un pronóstico anulado por el admin (descartado) nunca suma.
  const ptsDe = (r) => {
    if (r.descartado) return 0;
    const aplica = S.partidos.find((p) => p.id === r.partido_id)?.aplica_quiniela !== false;
    if (!aplica) return 0;
    if (r.pred_local === r.gol_local_real && r.pred_visitante === r.gol_visitante_real) return 3;
    if (signo(r.pred_local - r.pred_visitante) === signo(r.gol_local_real - r.gol_visitante_real)) return 1;
    return 0;
  };
  // Por partido, el slot que CUENTA es el del mejor pronóstico NO descartado
  // (empate -> slot 1, porque rows viene ordenado por slot ascendente).
  const cuentaSlot = new Map();   // numero -> slot ganador
  rows.forEach((r) => {
    if (r.descartado) return;     // un pronóstico anulado nunca puede ser el que cuenta
    const prev = cuentaSlot.get(r.numero);
    if (!prev || ptsDe(r) > ptsDe(prev)) cuentaSlot.set(r.numero, r);
  });
  let total = 0;
  const trs = rows.map((r) => {
    const aplica = S.partidos.find((p) => p.id === r.partido_id)?.aplica_quiniela !== false;
    const dup = rows.filter((x) => x.numero === r.numero).length > 1;   // tiene 2 pronósticos
    const ganador = cuentaSlot.get(r.numero);
    const cuenta = !r.descartado && (!dup || (ganador && ganador.slot === r.slot));
    const raw = ptsDe(r);
    let pts = cuenta ? raw : 0, motivo = "";
    if (r.descartado) motivo = "descartado";
    else if (!aplica) motivo = "no suma";
    else if (!cuenta) motivo = "descartado";
    else if (raw === 3) motivo = "exacto";
    else if (raw === 1) motivo = "resultado";
    total += pts;
    const cls = !cuenta ? "zero" : pts === 3 ? "ok3" : pts === 1 ? "ok1" : "zero";
    return `<tr class="${cls}">
        <td>${r.numero}${dup ? ` · P${r.slot}` : ""}</td>
        <td class="lbd-part">${esc(r.equipo_local)} <span class="vs">vs</span> ${esc(r.equipo_visitante)}</td>
        <td>${r.gol_local_real}-${r.gol_visitante_real}</td>
        <td>${r.pred_local}-${r.pred_visitante}</td>
        <td class="lbd-pts">${pts}${motivo ? `<span class="lbd-mot">${motivo}</span>` : ""}</td>
      </tr>`;
  }).join("");
  const nPartidos = new Set(rows.map((r) => r.numero)).size;
  return `<div class="lbd-cap">${nPartidos} ${nPartidos === 1 ? "partido finalizado" : "partidos finalizados"}</div>
    <table class="lb-detalle-tabla">
      <thead><tr><th>#</th><th>Partido</th><th>Real</th><th>Pronóstico</th><th>Pts</th></tr></thead>
      <tbody>${trs}</tbody>
      <tfoot><tr><td colspan="4">Total de puntos</td><td class="lbd-pts">${total}</td></tr></tfoot>
    </table>`;
}
// ============================================================
//  VISTA: PREMIOS (dinero por marcador exacto)
// ============================================================
const money = (n) => "$" + Number(n || 0).toLocaleString("es-SV", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
// Cuota de inscripción: monto fijo que paga cada usuario autorizado por el admin.
const INSCRIPCION_PRECIO = 3;
async function cargarPremios() {
  const cont = $("#premiosList"), res = $("#premiosResumen");
  const { data, error } = await sb.rpc("get_premios_marcador");
  if (error) {
    res.innerHTML = "";
    cont.innerHTML = `<p class="muted">Error: ${esc(error.message)}</p>`;
    return;
  }
  if (!data?.length) {
    res.innerHTML = "";
    cont.innerHTML = '<p class="muted">Aún no hay partidos con resultado y pronósticos cargados.</p>';
    return;
  }
  // Resumen global: total repartido y total recaudado.
  // Lo repartido en un partido con ganador es premio_a_repartir (su 75% base
  // MÁS lo acumulado de partidos previos sin ganador).
  const totRepartido = data.reduce((a, r) => a + (r.n_ganadores > 0 ? Number(r.premio_a_repartir ?? r.premio_total) : 0), 0);
  const totBote = data.reduce((a, r) => a + Number(r.bote), 0);
  // 25% de la organización: lo que NO se reparte como premio (bote - 75% base),
  // acumulado sobre TODOS los partidos con resultado.
  const totOrg = data.reduce((a, r) => a + (Number(r.bote) - Number(r.premio_total)), 0);
  // Inscripciones: $INSCRIPCION_PRECIO por cada usuario autorizado por el admin
  // (aprobado o admin). Las RLS de profiles permiten leer el conteo a todos.
  const { count: nInscritos } = await sb.from("profiles")
    .select("id", { count: "exact", head: true }).eq("aprobado", true);
  const totInscrip = (nInscritos || 0) * INSCRIPCION_PRECIO;
  res.innerHTML = `
    <div class="premio-stat"><span class="big">${money(totBote)}</span><span class="lbl">recaudado en total</span></div>
    <div class="premio-stat"><span class="big">${money(totRepartido)}</span><span class="lbl">repartido en premios</span></div>
    <div class="premio-stat"><span class="big">${money(totOrg)}</span><span class="lbl">25% organización (acumulado)</span></div>
    <div class="premio-stat"><span class="big">${money(totInscrip)}</span><span class="lbl">inscripciones (${nInscritos || 0} × ${money(INSCRIPCION_PRECIO)})</span></div>
    <div class="premio-stat"><span class="big">${money(totInscrip + totOrg)}</span><span class="lbl">inscripciones + 25% acumulado</span></div>`;

  // Solo el admin puede marcar/desmarcar pagos; los demás usuarios solo consultan.
  const esAdmin = !!S.profile?.is_admin;

  cont.innerHTML = data.map((r) => {
    const yo = (S.profile?.nombre || "").trim();
    const ganadores = r.ganadores || [];
    const hayGan = r.n_ganadores > 0;
    const seccion = r.fase === "grupos" ? "Grupo " + (r.grupo || "?") : fmtFase(r.fase);
    // Cada ganador lleva un "chequesito" de pagado: editable para el admin,
    // de solo lectura (✅/⬜) para el resto.
    const chkGan = (g) => {
      if (esAdmin) {
        return `<label class="g-pago" title="Marcar como pagado">
            <input type="checkbox" class="g-chk" data-partido="${r.partido_id}" data-uid="${g.user_id}"
                   ${g.pagado ? "checked" : ""} aria-label="Pagado a ${esc(g.nombre)}" />
            <span class="g-pago-lbl">Pagado</span>
          </label>`;
      }
      return `<span class="g-pago ro ${g.pagado ? "on" : ""}"
                title="${g.pagado ? "Pagado" : "Pendiente"}">${g.pagado ? "✅ Pagado" : "⬜ Pendiente"}</span>`;
    };
    // Lo que realmente se reparte (o se acumula) = 75% base + acumulado previo.
    const acumulado = Number(r.premio_acumulado || 0);
    const aRepartir = Number(r.premio_a_repartir ?? r.premio_total);
    // 25% del bote que retiene la organización en este partido (bote - 75%).
    const orgPartido = Number(r.bote) - Number(r.premio_total);
    const ganHtml = hayGan
      ? `<ul class="premio-ganadores">${ganadores.map((g) =>
          `<li class="${g.nombre === yo ? "me" : ""} ${g.pagado ? "pagado" : ""}">
             <span class="g-nombre">🏅 ${esc(g.nombre)}</span>
             <span class="g-monto">${money(r.premio_por_ganador)}</span>
             ${chkGan(g)}
           </li>`).join("")}</ul>`
      : `<p class="premio-sin">Nadie acertó el marcador exacto. El premio (${money(aRepartir)}) se acumula para el siguiente partido. 🔁</p>`;
    // Línea informativa de acumulación (cuando este partido arrastra premio de
    // partidos previos sin ganador).
    const acumHtml = acumulado > 0
      ? `<span title="Premio acumulado de partidos previos sin ganador">🔁 Acumulado previo: <strong>${money(acumulado)}</strong></span>
         <span>🎯 Total ${hayGan ? "a repartir" : "acumulado"}: <strong>${money(aRepartir)}</strong></span>`
      : "";
    // Badge de estado en la cabecera: "PAGADO" cuando todos los ganadores están
    // marcados, o "ACUMULADO" cuando el partido no tuvo ganador (se ve aun
    // estando la tarjeta colapsada).
    const badge = r.todos_pagados
      ? `<span class="premio-pagado-badge">✅ PAGADO</span>`
      : (!hayGan ? `<span class="premio-acum-badge">🔁 ACUMULADO</span>` : "");
    // Botón de conveniencia (solo admin) para marcar/desmarcar todo el partido.
    const accionTodo = (esAdmin && hayGan)
      ? `<div class="premio-acciones">
           <button class="btn small ghost" data-pagar-todo="${r.partido_id}" data-estado="${r.todos_pagados ? "1" : "0"}">
             ${r.todos_pagados ? "Desmarcar todo el partido" : "Marcar todo el partido como pagado"}
           </button>
         </div>`
      : "";
    // Cabecera (sección + marcador) y cuerpo (info + ganadores + acciones).
    const headHtml = `
        <div class="premio-head">
          <span class="premio-sec">#${r.numero ?? "?"} · ${esc(seccion)}</span>
          <span class="premio-head-r">${badge}<span class="premio-fecha">${fmtFecha(r.fecha)}</span></span>
        </div>
        <div class="premio-match">
          <span class="eq">${teamRow(r.equipo_local)}</span>
          <span class="premio-score">${r.gol_local} - ${r.gol_visitante}</span>
          <span class="eq v">${teamRow(r.equipo_visitante)}</span>
        </div>`;
    const bodyHtml = `
        <div class="premio-info">
          <span title="${r.n_pronosticos} pronóstico(s) × $1 — total recaudado del partido">🎟️ Recaudado: <strong>${money(r.bote)}</strong></span>
          <span>💰 Premio (75%): <strong>${money(r.premio_total)}</strong></span>
          <span title="25% del bote que retiene la organización">🏦 Organización (25%): <strong>${money(orgPartido)}</strong></span>
          ${acumHtml}
          <span>🏆 Ganadores: <strong>${r.n_ganadores}</strong></span>
        </div>
        ${ganHtml}
        ${accionTodo}`;
    // Se colapsan (solo se ve la cabecera, se expanden con un clic) tanto los
    // partidos totalmente pagados como los acumulados sin ganador. Los que aún
    // tienen ganadores por pagar se muestran siempre completos.
    if (r.todos_pagados || !hayGan) {
      return `
      <details class="premio-card ${r.todos_pagados ? "pagado" : "sin"}">
        <summary class="premio-summary">${headHtml}</summary>
        ${bodyHtml}
      </details>`;
    }
    return `
      <div class="premio-card">
        ${headHtml}
        ${bodyHtml}
      </div>`;
  }).join("");

  if (esAdmin) {
    cont.querySelectorAll(".g-chk").forEach((c) =>
      (c.onchange = () => togglePremioPagado(c.dataset.partido, c.dataset.uid, c.checked, c)));
    cont.querySelectorAll("[data-pagar-todo]").forEach((b) =>
      (b.onclick = () => togglePremioPartido(b.dataset.pagarTodo, b.dataset.estado !== "1")));
  }
}
// Marca/desmarca a UN ganador como pagado (solo admin). Refresca la vista.
async function togglePremioPagado(partidoId, uid, pagado, chk) {
  if (chk) chk.disabled = true;
  const { error } = await sb.rpc("set_premio_pagado", {
    p_partido_id: Number(partidoId), p_user_id: uid, p_pagado: pagado,
  });
  if (error) {
    alert("Error al marcar el pago: " + error.message);
    if (chk) { chk.checked = !pagado; chk.disabled = false; }
    return;
  }
  await cargarPremios();
}
// Marca/desmarca a TODOS los ganadores de un partido a la vez (solo admin).
async function togglePremioPartido(partidoId, pagado) {
  const { error } = await sb.rpc("set_premio_partido_pagado", {
    p_partido_id: Number(partidoId), p_pagado: pagado,
  });
  if (error) { alert("Error al actualizar el partido: " + error.message); return; }
  await cargarPremios();
}

function iniciarRealtime() {
  if (S._channel) return;
  const refrescar = () => {
    cargarPartidos().then(() => {
      if (!$("#view-calendario").classList.contains("hidden")) renderCalendario();
      if (!$("#view-dashboard").classList.contains("hidden")) cargarLeaderboard();
      if (!$("#view-mundial").classList.contains("hidden")) renderMundialReal();
      if (!$("#view-premios").classList.contains("hidden")) cargarPremios();
    });
  };
  // Si el admin cambia mi activación/cupo, refresca mi quiniela si la tengo abierta.
  const refrescarQuiniela = () => {
    if (!$("#view-quiniela").classList.contains("hidden")) cargarMiQuiniela().then(renderQuiniela);
  };
  // El cierre es por TIEMPO (15 min antes) y no genera evento en la BD; por eso
  // revisamos cada 30 s: re-pintamos la quiniela para mostrar los 🔒 y exponer
  // los pronósticos de los partidos que acaban de cerrar.
  if (!S._lockTimer) {
    S._lockTimer = setInterval(() => {
      if (!$("#view-quiniela").classList.contains("hidden")) renderQuiniela();
    }, 30000);
  }
  S._channel = sb.channel("quiniela-live")
    .on("postgres_changes", { event: "*", schema: "public", table: "partidos" }, () => { refrescar(); refrescarQuiniela(); })
    .on("postgres_changes", { event: "*", schema: "public", table: "partido_usuario" }, refrescarQuiniela)
    .on("postgres_changes", { event: "*", schema: "public", table: "resultado_avance" }, () => { if (!$("#view-dashboard").classList.contains("hidden")) cargarLeaderboard(); })
    .on("postgres_changes", { event: "*", schema: "public", table: "resultado_posicion" }, () => { if (!$("#view-dashboard").classList.contains("hidden")) cargarLeaderboard(); })
    .on("postgres_changes", { event: "*", schema: "public", table: "res_bracket" }, () => { if (!$("#view-mundial").classList.contains("hidden")) renderMundialReal(); })
    .on("postgres_changes", { event: "*", schema: "public", table: "premio_pagado" }, () => { if (!$("#view-premios").classList.contains("hidden")) cargarPremios(); })
    .subscribe();
}

// ============================================================
//  VISTA: ADMIN
// ============================================================
async function renderAdmin() {
  if (!S.profile?.is_admin) return;
  await renderAdminUsuarios();
  await cargarAdminActivacion();
  renderAdminPartidos();
  renderSuperPanel();   // solo hace algo si el usuario es el superadmin
  const { data: rb } = await sb.from("res_bracket").select("*");
  S.realWinners = {}; (rb || []).forEach((r) => (S.realWinners[r.match_no] = r.ganador));
}
// Carga usuarios elegibles (aprobados/admin) y el mapa de activaciones por partido.
async function cargarAdminActivacion() {
  const [{ data: us }, { data: pu }] = await Promise.all([
    sb.rpc("admin_list_users"),
    sb.from("partido_usuario").select("partido_id,user_id,n_pred"),
  ]);
  S.adminUsers = (us || []).filter((u) => u.aprobado || u.is_admin);
  S.activByPartido = {};   // partido_id -> Map(user_id -> n_pred)
  (pu || []).forEach((r) => { (S.activByPartido[r.partido_id] ||= new Map()).set(r.user_id, r.n_pred || 2); });
}
// n = 0 (no participa) | 1 | 2 pronósticos para ese usuario en ese partido.
async function setParticipante(pid, uid, n) {
  // Borrar + insertar (determinista; evita rarezas de upsert/onConflict).
  const { error: delErr } = await sb.from("partido_usuario").delete().eq("partido_id", pid).eq("user_id", uid);
  if (delErr) { alert("Error: " + delErr.message); return; }
  if (n !== 0) {
    const { error } = await sb.from("partido_usuario").insert({ partido_id: pid, user_id: uid, n_pred: n });
    if (error) { alert("Error: " + error.message); await cargarAdminActivacion(); renderAdminPartidos(); return; }
  }
  const m = (S.activByPartido[pid] ||= new Map());
  if (n === 0) m.delete(uid); else m.set(uid, n);
  const cnt = document.querySelector(`[data-count="${pid}"]`); if (cnt) cnt.textContent = m.size;
}

// ---------- Admin: aprobar usuarios ----------
async function renderAdminUsuarios() {
  const cont = $("#adminUsuarios"); if (!cont) return;
  // admin_list_users() trae además el correo, el nombre con el que se registró
  // y cuántas predicciones tiene cada usuario.
  const { data: usuarios, error } = await sb.rpc("admin_list_users");
  if (error) { cont.innerHTML = `<p class="muted">Error: ${error.message}</p>`; return; }
  if (!usuarios?.length) { cont.innerHTML = '<p class="muted">Aún no hay usuarios registrados.</p>'; return; }

  const pendientes = usuarios.filter((u) => !u.aprobado && !u.is_admin).length;
  // El aviso de pendientes queda SIEMPRE visible; la lista de usuarios se colapsa
  // en un panel cerrado (igual que los partidos) y se despliega al abrirlo.
  let html = pendientes
    ? `<p class="pendientes-aviso">🔔 ${pendientes} usuario(s) pendiente(s) de autorización.</p>`
    : `<p class="muted small">Todos los usuarios están autorizados.</p>`;
  html += `<details class="partidos-anteriores"><summary>👥 Usuarios (${usuarios.length})</summary>`;

  usuarios.forEach((u) => {
    const esYo = u.id === S.user.id;
    const estado = u.is_admin
      ? '<span class="badge-admin">admin</span>'
      : u.aprobado
        ? '<span class="badge-ok">autorizado</span>'
        : '<span class="badge-pend">pendiente</span>';
    const esc = (s) => (s || "").replace(/"/g, "&quot;");
    // Autorizar / revocar (solo para no-admins).
    let accion = u.is_admin
      ? ""
      : u.aprobado
        ? `<button class="btn small ghost" data-revocar="${u.id}">Revocar</button>`
        : `<button class="btn small" data-aprobar="${u.id}">Autorizar</button>`;
    // Promover / quitar admin (puede haber varios administradores).
    if (u.is_admin) {
      if (!esYo) accion += ` <button class="btn small ghost" data-quitaradmin="${u.id}" data-nombre="${esc(u.nombre)}">Quitar admin</button>`;
    } else {
      accion += ` <button class="btn small" data-haceradmin="${u.id}" data-nombre="${esc(u.nombre)}">Hacer admin</button>`;
    }
    // Para editar prellenamos con el nombre real con el que se registró
    // (si existe); así se corrige fácil cuando quedó guardado el correo.
    const prefill = u.nombre_registrado || u.nombre || "";
    // Editar nombre: disponible para CUALQUIER usuario, incluido el admin.
    accion += ` <button class="btn small ghost" data-editar="${u.id}" data-prefill="${esc(prefill)}">Editar nombre</button>`;
    // Resetear contraseña: cualquier usuario menos uno mismo.
    if (!esYo) {
      accion += ` <button class="btn small ghost" data-resetpwd="${u.id}" data-nombre="${esc(u.nombre)}">🔑 Resetear contraseña</button>`;
    }
    // Borrar: solo usuarios que no sean admin y que no sean uno mismo.
    if (!u.is_admin && !esYo) {
      accion += ` <button class="btn small danger" data-borrar="${u.id}" data-nombre="${esc(u.nombre)}" data-npred="${u.n_predicciones || 0}">Borrar</button>`;
    }
    // Aviso de que tiene un cambio de contraseña pendiente (reseteada por el admin).
    const pwdBadge = u.must_change_password
      ? '<span class="badge-pwd" title="El usuario debe cambiar su contraseña al ingresar.">🔑 cambio pendiente</span>'
      : "";
    html += `<div class="user-row ${u.aprobado || u.is_admin ? "" : "pend"}">
      <span class="u-nombre">${u.nombre || "(sin nombre)"}${esYo ? " (tú)" : ""}
        <span class="u-email">${u.email || ""}</span></span>
      ${estado}${pwdBadge}
      <span class="u-accion">${accion}</span>
    </div>`;
  });
  html += `</details>`;
  cont.innerHTML = html;

  cont.querySelectorAll("[data-aprobar]").forEach((b) =>
    (b.onclick = () => setAprobado(b.dataset.aprobar, true)));
  cont.querySelectorAll("[data-revocar]").forEach((b) =>
    (b.onclick = () => setAprobado(b.dataset.revocar, false)));
  cont.querySelectorAll("[data-editar]").forEach((b) =>
    (b.onclick = () => editarNombreUsuario(b.dataset.editar, b.dataset.prefill)));
  cont.querySelectorAll("[data-borrar]").forEach((b) =>
    (b.onclick = () => borrarUsuario(b.dataset.borrar, b.dataset.nombre, +b.dataset.npred)));
  cont.querySelectorAll("[data-resetpwd]").forEach((b) =>
    (b.onclick = () => resetearPassword(b.dataset.resetpwd, b.dataset.nombre)));
  cont.querySelectorAll("[data-haceradmin]").forEach((b) =>
    (b.onclick = () => setAdmin(b.dataset.haceradmin, true, b.dataset.nombre)));
  cont.querySelectorAll("[data-quitaradmin]").forEach((b) =>
    (b.onclick = () => setAdmin(b.dataset.quitaradmin, false, b.dataset.nombre)));
}
async function setAprobado(id, aprobado) {
  const { error } = await sb.from("profiles").update({ aprobado }).eq("id", id);
  if (error) { alert("Error: " + error.message); return; }
  await renderAdminUsuarios();
}
// Promueve o quita el rol de administrador. Pueden coexistir varios admins.
// (La RLS + el trigger protect_profile_fields solo permiten esto a un admin.)
async function setAdmin(id, make, nombre) {
  if (!make && id === S.user.id) { alert("No puedes quitarte el rol de admin a ti mismo."); return; }
  const quien = nombre || "este usuario";
  const aviso = make
    ? `¿Dar permisos de ADMINISTRADOR a "${quien}"?\n\nPodrá cargar resultados, activar usuarios, promover admins y gestionar todo.`
    : `¿Quitar los permisos de administrador a "${quien}"?`;
  if (!confirm(aviso)) return;
  // Al promover, queda también aprobado (un admin siempre participa).
  const upd = make ? { is_admin: true, aprobado: true } : { is_admin: false };
  const { error } = await sb.from("profiles").update(upd).eq("id", id);
  if (error) { alert("Error: " + error.message); return; }
  await renderAdminUsuarios();
}
async function editarNombreUsuario(id, nombreActual) {
  const nombre = prompt("Nuevo nombre para el usuario:", nombreActual || "");
  if (nombre === null) return;                 // canceló
  const limpio = nombre.trim();
  if (!limpio) { alert("El nombre no puede quedar vacío."); return; }
  const { error } = await sb.from("profiles").update({ nombre: limpio }).eq("id", id);
  if (error) { alert("Error: " + error.message); return; }
  await renderAdminUsuarios();
}
async function borrarUsuario(id, nombre, nPred) {
  const aviso = nPred > 0
    ? `Se eliminarán su cuenta y sus ${nPred} predicción(es).`
    : `Se eliminará su cuenta (no tiene predicciones guardadas).`;
  if (!confirm(`¿Borrar a "${nombre || "este usuario"}"?\n\n${aviso}\nEsta acción NO se puede deshacer.`)) return;
  const { error } = await sb.rpc("admin_delete_user", { uid: id });
  if (error) { alert("Error al borrar: " + error.message); return; }
  await renderAdminUsuarios();
}

// ---------- Admin: control de pagos ----------
// Muestra, por usuario: pronósticos ENVIADOS (partido cerrado + marcador puesto,
// $1 c/u), DINERO PAGADO (registrado por el admin) y DISPONIBLE (pagado − enviados).
// El disponible negativo (debe más de lo que pagó) se pinta en rojo.
async function renderControlPagos() {
  const cont = $("#adminPagos"), res = $("#adminPagosResumen");
  if (!cont) return;
  const { data, error } = await sb.rpc("get_control_pagos");
  if (error) { if (res) res.innerHTML = ""; cont.innerHTML = `<p class="muted">Error: ${esc(error.message)}</p>`; return; }
  if (!data?.length) { if (res) res.innerHTML = ""; cont.innerHTML = '<p class="muted">Aún no hay datos de pago.</p>'; return; }

  // Solo el admin puede registrar/editar pagos; los demás usuarios solo ven.
  const esAdmin = !!S.profile?.is_admin;

  // El resumen global (totales de todos) es solo para el admin; un usuario normal
  // únicamente recibe SU propia fila, así que no tiene sentido un "total global".
  if (res) {
    if (esAdmin) {
      const totEnviados = data.reduce((a, r) => a + Number(r.pronosticos_enviados), 0);
      const totPagado   = data.reduce((a, r) => a + Number(r.dinero_pagado), 0);
      const totDisp     = totPagado - totEnviados;
      const totGanado   = data.reduce((a, r) => a + Number(r.premios_ganados || 0), 0);
      const totPrePag   = data.reduce((a, r) => a + Number(r.premios_pagados || 0), 0);
      const totPorCobrar = totGanado - totPrePag;
      res.innerHTML = `
        <div class="premio-stat"><span class="big">${totEnviados}</span><span class="lbl">pronósticos enviados ($${totEnviados})</span></div>
        <div class="premio-stat"><span class="big">${money(totPagado)}</span><span class="lbl">pagado en total</span></div>
        <div class="premio-stat"><span class="big ${totDisp < 0 ? "neg" : ""}">${money(totDisp)}</span><span class="lbl">disponible global</span></div>
        <div class="premio-stat"><span class="big">${money(totGanado)}</span><span class="lbl">ganado en premios</span></div>
        <div class="premio-stat"><span class="big">${money(totPrePag)}</span><span class="lbl">pagado en premios</span></div>
        <div class="premio-stat"><span class="big ${totPorCobrar > 0 ? "neg" : ""}">${money(totPorCobrar)}</span><span class="lbl">pendiente de cobrar</span></div>`;
    } else {
      res.innerHTML = "";
    }
  }
  // Render de una tarjeta de usuario (se reutiliza para activos y sin movimiento).
  const cardHtml = (r) => {
    const env = Number(r.pronosticos_enviados);
    const disp = Number(r.disponible);
    // Lo que el usuario ganó en premios y aún no se le ha pagado.
    const porCobrar = Number(r.premios_ganados || 0) - Number(r.premios_pagados || 0);
    const yo = r.user_id === S.user.id;
    const accion = esAdmin
      ? `<div class="pago-card-form">
           <input type="number" step="0.01" class="pago-monto" data-uid="${r.user_id}"
                  placeholder="Monto $" aria-label="Monto a registrar para ${esc(r.nombre)}" />
           <button class="btn small" data-pago="${r.user_id}" data-nombre="${esc(r.nombre)}">Abonar</button>
           <button class="btn small ghost" data-histpago="${r.user_id}" data-nombre="${esc(r.nombre)}"
                   aria-expanded="false">Historial</button>
         </div>
         <div class="pago-hist" data-histbox="${r.user_id}" hidden></div>`
      : "";
    return `
      <div class="pago-card ${yo ? "me" : ""} ${disp < 0 ? "debe" : ""}">
        <div class="pago-card-head">
          <span class="pc-nombre">${esc(r.nombre || "(sin nombre)")}${yo ? " (tú)" : ""}</span>
          <span class="pc-disp ${disp < 0 ? "neg" : "pos"}">
            <span class="pc-disp-val">${money(disp)}</span>
            <span class="pc-disp-lbl">disponible</span>
          </span>
        </div>
        <div class="pago-card-stats">
          <div class="pc-stat"><span class="pc-val">${env}</span><span class="pc-lbl">enviados</span></div>
          <div class="pc-stat"><span class="pc-val">${money(env)}</span><span class="pc-lbl">a pagar</span></div>
          <div class="pc-stat"><span class="pc-val">${money(r.dinero_pagado)}</span><span class="pc-lbl">pagado</span></div>
          <div class="pc-stat"><span class="pc-val">${money(r.premios_ganados)}</span><span class="pc-lbl">ganado</span></div>
          <div class="pc-stat"><span class="pc-val">${money(r.premios_pagados)}</span><span class="pc-lbl">prem. pagado</span></div>
          <div class="pc-stat ${porCobrar > 0 ? "pend" : ""}"><span class="pc-val">${money(porCobrar)}</span><span class="pc-lbl">por cobrar</span></div>
        </div>
        ${accion}
      </div>`;
  };

  // "Sin movimiento" = 0 en todo (no envió, no pagó, no ganó ni cobró premios).
  // Esos se agrupan en una sección colapsada al final para no llenar la vista.
  const sinMovimiento = (r) =>
    Number(r.pronosticos_enviados) === 0 && Number(r.dinero_pagado) === 0 &&
    Number(r.premios_ganados || 0) === 0 && Number(r.premios_pagados || 0) === 0;
  const activos = data.filter((r) => !sinMovimiento(r));
  const vacios = data.filter(sinMovimiento);

  cont.innerHTML =
    activos.map(cardHtml).join("") +
    (vacios.length
      ? `<details class="pagos-vacios">
           <summary>Sin movimiento (${vacios.length}) — 0 en todo</summary>
           <div class="pagos-admin pagos-vacios-grid">${vacios.map(cardHtml).join("")}</div>
         </details>`
      : "");

  if (esAdmin) {
    cont.querySelectorAll("[data-pago]").forEach((b) =>
      (b.onclick = () => registrarPago(b.dataset.pago, b.dataset.nombre)));
    cont.querySelectorAll("[data-histpago]").forEach((b) =>
      (b.onclick = () => toggleHistorialPagos(b)));
  }
}
// Registra un abono (positivo) o ajuste (negativo) para un usuario.
async function registrarPago(uid, nombre) {
  const inp = document.querySelector(`.pago-monto[data-uid="${uid}"]`);
  const monto = Number(inp?.value);
  if (!monto) { alert("Escribe un monto distinto de 0 (usa negativo para corregir)."); return; }
  const nota = prompt(`Nota para el abono de ${money(monto)} a "${nombre || "este usuario"}" (opcional):`, "");
  if (nota === null) return;                       // canceló
  const { error } = await sb.from("pagos").insert({
    user_id: uid, monto, nota: nota.trim() || null, created_by: S.user.id,
  });
  if (error) { alert("Error al registrar el pago: " + error.message); return; }
  await renderControlPagos();
}
// Abre/cierra el historial de abonos de un usuario como panel desplegable
// dentro de su tarjeta. Carga los pagos al abrir; cada uno se puede borrar.
async function toggleHistorialPagos(btn) {
  const uid = btn.dataset.histpago, nombre = btn.dataset.nombre;
  const box = document.querySelector(`.pago-hist[data-histbox="${uid}"]`);
  if (!box) return;
  // Si ya está abierto, lo cerramos.
  if (!box.hidden) { box.hidden = true; btn.setAttribute("aria-expanded", "false"); return; }
  box.hidden = false; btn.setAttribute("aria-expanded", "true");
  box.innerHTML = '<p class="muted small">Cargando…</p>';
  const { data, error } = await sb.from("pagos")
    .select("*").eq("user_id", uid).order("created_at", { ascending: false });
  if (error) { box.innerHTML = `<p class="muted small">Error: ${esc(error.message)}</p>`; return; }
  if (!data?.length) { box.innerHTML = '<p class="muted small">Sin pagos registrados.</p>'; return; }
  const total = data.reduce((a, p) => a + Number(p.monto), 0);
  box.innerHTML = `
    <div class="pago-hist-total">Total abonado: <strong>${money(total)}</strong></div>
    <ul class="pago-hist-list">
      ${data.map((p) => `
        <li>
          <span class="ph-monto ${Number(p.monto) < 0 ? "neg" : ""}">${money(p.monto)}</span>
          <span class="ph-fecha">${fmtFecha(p.created_at)}</span>
          <button class="btn small ghost ph-del" data-delpago="${p.id}"
                  data-monto="${p.monto}" title="Borrar este pago" aria-label="Borrar pago de ${money(p.monto)}">✕</button>
          ${p.nota ? `<span class="ph-nota">${esc(p.nota)}</span>` : ""}
        </li>`).join("")}
    </ul>`;
  box.querySelectorAll("[data-delpago]").forEach((db) =>
    (db.onclick = () => borrarPago(db.dataset.delpago, db.dataset.monto)));
}
// Borra un abono concreto (por id) y refresca el control de pagos.
async function borrarPago(id, monto) {
  if (!confirm(`¿Borrar el pago de ${money(monto)}?`)) return;
  const { error } = await sb.from("pagos").delete().eq("id", id);
  if (error) { alert("Error al borrar: " + error.message); return; }
  await renderControlPagos();
}
// Genera una contraseña temporal legible (sin caracteres ambiguos como O/0, l/1).
function genPasswordTemporal() {
  const may = "ABCDEFGHJKLMNPQRSTUVWXYZ", min = "abcdefghijkmnpqrstuvwxyz", num = "23456789";
  const tomar = (s, n) => Array.from({ length: n }, () => s[Math.floor(Math.random() * s.length)]).join("");
  return tomar(may, 2) + tomar(min, 3) + tomar(num, 4);
}
// El admin asigna una contraseña temporal; al ingresar, el usuario deberá cambiarla.
async function resetearPassword(id, nombre) {
  const quien = nombre || "este usuario";
  let pass = prompt(
    `Nueva contraseña temporal para "${quien}" (mín. 6 caracteres).\n` +
    `Deja el campo vacío para generar una automáticamente:`, "");
  if (pass === null) return;                       // canceló
  pass = pass.trim();
  if (pass && pass.length < 6) { alert("La contraseña debe tener al menos 6 caracteres."); return; }
  if (!pass) pass = genPasswordTemporal();
  const { error } = await sb.rpc("admin_reset_password", { uid: id, new_password: pass });
  if (error) { alert("Error al resetear: " + error.message); return; }
  // Mostramos la contraseña temporal para que el admin se la comunique al usuario.
  alert(
    `✅ Contraseña reseteada para "${quien}".\n\n` +
    `Contraseña temporal:\n\n    ${pass}\n\n` +
    `Compártela con la persona. Al iniciar sesión se le pedirá definir una nueva.`);
  await renderAdminUsuarios();
}
// Números de partido de eliminatoria (73..104), en orden de ronda.
const KO_NUMS = Array.from({ length: 32 }, (_, i) => 73 + i);
// Ganador real de cada llave: del MARCADOR si es decisivo; del desempate
// guardado (penales/prórroga) si quedó empatado. Devuelve {numero: 'a'|'b'}.
function winnersReales() {
  const w = {};
  KO_NUMS.forEach((n) => {
    const p = S.partidos.find((x) => x.numero === n);
    if (!p || p.gol_local == null || p.gol_visitante == null) return;
    if (p.gol_local > p.gol_visitante) w[n] = "a";
    else if (p.gol_visitante > p.gol_local) w[n] = "b";
    else if (S.realWinners[n] === "a" || S.realWinners[n] === "b") w[n] = S.realWinners[n];
  });
  return w;
}
// Recalcula el cuadro (tablas + ganadores) y ESCRIBE los equipos de cada llave
// en "partidos". Se llama tras cada guardado de resultado. Solo actualiza filas
// que cambian. Las llaves sin definir quedan en 'Por definir'.
async function propagarLlaves() {
  const res = Bracket.resolve(grupoMatches(), realScores(), winnersReales());
  const ups = [];
  KO_NUMS.forEach((n) => {
    const p = S.partidos.find((x) => x.numero === n); if (!p) return;
    const t = res.teams[n] || {};
    const a = t.a || POR_DEFINIR, b = t.b || POR_DEFINIR;
    if (p.equipo_local !== a || p.equipo_visitante !== b) ups.push({ id: p.id, a, b });
  });
  for (const u of ups) {
    const { error } = await sb.from("partidos").update({ equipo_local: u.a, equipo_visitante: u.b }).eq("id", u.id);
    if (error) { console.error("propagarLlaves:", error.message); break; }
  }
  if (ups.length) await cargarPartidos();
}
// Desempate manual SOLO para llaves que terminaron empatadas (define quién pasó).
async function setTiebreak(numero, side) {
  await sb.from("res_bracket").delete().eq("match_no", numero);
  const { error } = await sb.from("res_bracket").insert({ match_no: numero, ganador: side });
  if (error) { alert("Error: " + error.message); return; }
  S.realWinners[numero] = side;
  await propagarLlaves();
  renderAdminPartidos();
}
// Un partido del admin queda BLOQUEADO cuando ya pasó su día y ya tiene marcador
// cargado: no se puede volver a editar el resultado (evita cambios accidentales).
function partidoBloqueadoAdmin(p) {
  return partidoAnterior(p) && p.gol_local != null && p.gol_visitante != null;
}
// Construye la fila de un partido en el panel de admin.
function filaAdminPartido(p) {
  const aplica = p.aplica_quiniela !== false;   // por defecto aplica
  const bloq = partidoBloqueadoAdmin(p);        // ya pasó el día y tiene marcador
  const activos = (S.activByPartido && S.activByPartido[p.id]) || new Map();
  const opt = (u) => {
    const n = activos.get(u.id) || 0;
    return `<label class="part-chk">
      <select data-act-p="${p.id}" data-act-u="${u.id}">
        <option value="0" ${n === 0 ? "selected" : ""}>No participa</option>
        <option value="1" ${n === 1 ? "selected" : ""}>1 pronóstico</option>
        <option value="2" ${n === 2 ? "selected" : ""}>2 pronósticos</option>
      </select> ${esc(u.nombre || u.email || "—")}</label>`;
  };
  const usersHtml = (S.adminUsers || []).length
    ? S.adminUsers.map(opt).join("")
    : '<span class="muted small">No hay usuarios aprobados todavía.</span>';
  // Los equipos de llaves se rellenan SOLOS al guardar resultados (no se editan).
  const esLlave = p.fase !== "grupos";
  const empate = p.gol_local != null && p.gol_local === p.gol_visitante;
  const win = S.realWinners[p.numero];
  // Selector de desempate: solo en llaves empatadas y ya definidas (penales/prórroga).
  const tbHtml = (esLlave && empate && partidoDefinido(p))
    ? `<div class="tiebreak">⚖️ Empate — pasó:
        <button class="btn small ${win === "a" ? "sel" : ""}" data-tb="${p.numero}" data-side="a">${esc(p.equipo_local)}</button>
        <button class="btn small ${win === "b" ? "sel" : ""}" data-tb="${p.numero}" data-side="b">${esc(p.equipo_visitante)}</button>
      </div>`
    : "";
  const dis = bloq ? "disabled" : "";
  const lockTag = bloq ? `<span class="tag-cerrado" title="Partido pasado con marcador. Resultado bloqueado.">🔒 bloqueado</span>` : "";
  const row = document.createElement("div");
  row.className = "admin-partido" + (aplica ? "" : " no-aplica") + (bloq ? " cerrado" : "");
  row.innerHTML = `
    <div class="admin-partido-main">
      <span class="eq">${teamRow(p.equipo_local)}</span>
      <input type="number" min="0" max="99" data-rid="${p.id}" data-side="l" value="${p.gol_local ?? ""}" ${dis}>
      <span class="vs">vs</span>
      <input type="number" min="0" max="99" data-rid="${p.id}" data-side="v" value="${p.gol_visitante ?? ""}" ${dis}>
      <span class="eq v">${teamRow(p.equipo_visitante)}</span>
      ${bloq ? lockTag : `<button class="btn small" data-save="${p.id}">Guardar</button>`}
      <label class="chk-aplica" title="Si lo desmarcas, este partido NO otorga los puntos (3/1).">
        <input type="checkbox" data-aplica="${p.id}" ${aplica ? "checked" : ""}> aplica
      </label>
      <span class="fch">#${p.numero ?? "?"} · ${fmtFecha(p.fecha)}</span>
    </div>
    ${tbHtml}
    <details class="part-box">
      <summary>👥 Participantes (<span data-count="${p.id}">${activos.size}</span>)</summary>
      <div class="part-list">${usersHtml}</div>
    </details>`;
  return row;
}
// Pinta una lista de partidos (con encabezados de sección) y enlaza sus eventos.
function pintarAdminPartidos(cont, lista) {
  let sec = null;
  lista.forEach((p) => {
    const s = seccionDe(p);
    if (s !== sec) {
      sec = s;
      const h = document.createElement("div"); h.className = "grupo-h"; h.textContent = s; cont.appendChild(h);
    }
    cont.appendChild(filaAdminPartido(p));
  });
  cont.querySelectorAll("[data-save]").forEach((b) => (b.onclick = () => guardarResultado(b.dataset.save)));
  cont.querySelectorAll("[data-aplica]").forEach((c) => (c.onchange = () => guardarAplica(c.dataset.aplica, c.checked)));
  cont.querySelectorAll("[data-act-p]").forEach((c) => (c.onchange = () => setParticipante(+c.dataset.actP, c.dataset.actU, +c.value)));
  cont.querySelectorAll("[data-tb]").forEach((b) => (b.onclick = () => setTiebreak(+b.dataset.tb, b.dataset.side)));
}
function renderAdminPartidos() {
  const cont = $("#adminPartidos"); cont.innerHTML = "";
  const ms = S.partidos.slice().sort((a, b) => (a.numero || 0) - (b.numero || 0));
  if (!ms.length) { cont.innerHTML = '<p class="muted">Sin partidos. Usa "Agregar / importar".</p>'; return; }
  // Igual que en Mi Quiniela: los partidos de días anteriores van colapsados en un
  // panel cerrado; por defecto solo se ven los de hoy en adelante.
  const anteriores = ms.filter(partidoAnterior);
  const actuales = ms.filter((p) => !partidoAnterior(p));
  if (anteriores.length) {
    const det = document.createElement("details");
    det.className = "partidos-anteriores";
    const sum = document.createElement("summary");
    sum.textContent = `📁 Partidos anteriores (${anteriores.length})`;
    det.appendChild(sum);
    let pintado = false;
    det.addEventListener("toggle", () => {
      if (det.open && !pintado) { pintarAdminPartidos(det, anteriores); pintado = true; }
    });
    cont.appendChild(det);
  }
  if (actuales.length) {
    pintarAdminPartidos(cont, actuales);
  } else {
    cont.insertAdjacentHTML("beforeend",
      '<p class="muted">No hay partidos de hoy en adelante. Abre “Partidos anteriores” para consultarlos.</p>');
  }
}
async function guardarAplica(id, aplica) {
  const { error } = await sb.from("partidos").update({ aplica_quiniela: aplica }).eq("id", +id);
  if (error) { alert("Error: " + error.message); await cargarPartidos(); renderAdminPartidos(); return; }
  const p = S.partidos.find((x) => x.id === +id); if (p) p.aplica_quiniela = aplica;
  renderAdminPartidos();
}
async function guardarResultado(id) {
  const p = S.partidos.find((x) => x.id === +id);
  if (p && partidoBloqueadoAdmin(p)) { alert("Partido bloqueado: ya pasó su día y tiene marcador."); return; }
  const l = document.querySelector(`[data-rid="${id}"][data-side="l"]`).value;
  const v = document.querySelector(`[data-rid="${id}"][data-side="v"]`).value;
  const upd = { gol_local: l === "" ? null : +l, gol_visitante: v === "" ? null : +v };
  const { error } = await sb.from("partidos").update(upd).eq("id", id);
  if (error) return alert("Error: " + error.message);
  await cargarPartidos();
  await propagarLlaves();     // alimenta las llaves automáticamente
  renderAdminPartidos();
}
// Pone TODOS los resultados reales a cero: limpia marcadores (gol_local/visitante
// = null) y desempates (res_bracket), las llaves vuelven a "Por definir". NO toca
// las predicciones de los usuarios (pred_partidos) ni sus derivados.
async function resetResultadosReales() {
  if (!S.profile?.is_admin) return;
  const m = $("#resetResultadosMsg");
  if (!confirm("¿Poner TODOS los resultados reales a cero?\n\n" +
    "Se borrarán todos los marcadores y desempates reales (las llaves vuelven a " +
    "\"Por definir\"). Las quinielas de los usuarios NO se tocan.\n\n" +
    "Esta acción no se puede deshacer.")) return;
  const btn = $("#resetResultadosBtn"); if (btn) btn.disabled = true;
  try {
    // Limpia marcadores reales en todos los partidos (filtro que matchea todo).
    const { error: e1 } = await sb.from("partidos")
      .update({ gol_local: null, gol_visitante: null }).not("id", "is", null);
    if (e1) throw e1;
    // Borra los desempates manuales de llaves (penales/prórroga).
    const { error: e2 } = await sb.from("res_bracket").delete().not("match_no", "is", null);
    if (e2) throw e2;
    S.realWinners = {};
    await cargarPartidos();
    await propagarLlaves();     // recalcula: sin resultados, las llaves quedan "Por definir"
    renderAdminPartidos();
    msg(m, "✅ Resultados reales puestos a cero.", true);
  } catch (e) {
    msg(m, "Error: " + e.message, false);
  } finally {
    if (btn) btn.disabled = false;
  }
}
{ const b = $("#resetResultadosBtn"); if (b) b.onclick = resetResultadosReales; }

// Activa con 1 pronóstico a TODOS los usuarios autorizados en los partidos de HOY
// (día en hora El Salvador, GMT-6) que aún no han cerrado. Solo agrega: a quien ya
// esté activado (1 ó 2) no lo toca; así no degrada a quien el admin puso con 2.
async function habilitarHoyTodos() {
  if (!S.profile?.is_admin) return;
  const m = $("#habilitarHoyMsg");
  const usuarios = S.adminUsers || [];
  if (!usuarios.length) { msg(m, "No hay usuarios autorizados todavía.", false); return; }

  const hoyKey = diaKey(new Date(nowMs()).toISOString());
  const abiertos = (S.partidos || []).filter(
    (p) => p.fecha && diaKey(p.fecha) === hoyKey && !partidoBloqueado(p),
  );
  if (!abiertos.length) { msg(m, "Hoy no hay partidos abiertos por habilitar.", false); return; }

  if (!confirm(`¿Habilitar ${abiertos.length} partido(s) de HOY con 1 pronóstico para ` +
    `${usuarios.length} usuario(s) autorizado(s)?\n\nA quien ya esté activado no se le cambia.`)) return;

  const btn = $("#habilitarHoyBtn"); if (btn) btn.disabled = true;
  try {
    // Solo inserta a los usuarios que aún NO participan (n_pred 0) en cada partido.
    const filas = [];
    abiertos.forEach((p) => {
      const yaActivos = (S.activByPartido && S.activByPartido[p.id]) || new Map();
      usuarios.forEach((u) => {
        if (!yaActivos.has(u.id)) filas.push({ partido_id: p.id, user_id: u.id, n_pred: 1 });
      });
    });
    if (!filas.length) { msg(m, "Todos los autorizados ya estaban activados en los partidos de hoy.", true); return; }

    const { error } = await sb.from("partido_usuario").insert(filas);
    if (error) throw error;

    // Refresca el estado en memoria y la vista del admin.
    await cargarAdminActivacion();
    renderAdminPartidos();
    msg(m, `✅ Habilitados ${abiertos.length} partido(s) de hoy · ${filas.length} activación(es) nueva(s).`, true);
  } catch (e) {
    msg(m, "Error: " + e.message, false);
    await cargarAdminActivacion();
    renderAdminPartidos();
  } finally {
    if (btn) btn.disabled = false;
  }
}
{ const b = $("#habilitarHoyBtn"); if (b) b.onclick = habilitarHoyTodos; }

$("#importBtn").onclick = async () => {
  const txt = $("#importBox").value.trim(); if (!txt) return;
  const rows = txt.split("\n").map((l) => l.split("|").map((c) => c.trim())).filter((c) => c.length >= 5);
  const payload = rows.map((c) => ({
    numero: c[0] ? +c[0] : null, fase: c[1] || "grupos", grupo: c[2] || null,
    equipo_local: c[3], equipo_visitante: c[4],
    fecha: c[5] ? new Date(c[5].replace(" ", "T")).toISOString() : null,
  })).filter((r) => r.equipo_local && r.equipo_visitante);
  if (!payload.length) return alert("No se reconocieron filas válidas.");
  const { error } = await sb.from("partidos").insert(payload);
  if (error) return alert("Error: " + error.message);
  $("#importBox").value = ""; await cargarPartidos(); await propagarLlaves(); renderAdminPartidos();
  alert(`✅ ${payload.length} partidos importados.`);
};

// ============================================================
//  SUPERADMIN: registrar pronóstico pos-partido (excepción auditada)
// ============================================================
// Solo este correo ve y usa la opción. El backend lo vuelve a validar
// (función is_superadmin): el correo aquí solo controla la UI.
const SUPERADMIN_EMAIL = "jrobertoma@gmail.com";
const esSuperadmin = () => (S.user?.email || "").trim().toLowerCase() === SUPERADMIN_EMAIL;

// Llena los selectores (usuarios + partidos) y el historial. Se apoya en
// S.adminUsers (cargado por cargarAdminActivacion) y S.partidos.
function renderSuperPanel() {
  if (!esSuperadmin()) return;
  const selU = $("#superUser"), selP = $("#superPartido");
  if (!selU || !selP) return;
  const users = (S.adminUsers || []).slice()
    .sort((a, b) => (a.nombre || "").localeCompare(b.nombre || "", "es"));
  selU.innerHTML = users.map((u) =>
    `<option value="${u.id}">${esc(u.nombre || u.email || "—")}${u.email ? " · " + esc(u.email) : ""}</option>`).join("");
  const ms = S.partidos.slice().sort((a, b) => (a.numero || 0) - (b.numero || 0));
  selP.innerHTML = ms.map((p) =>
    `<option value="${p.id}">#${p.numero ?? "?"} · ${esc(p.equipo_local)} vs ${esc(p.equipo_visitante)}${p.fecha ? " · " + fmtFecha(p.fecha) : ""}</option>`).join("");
  cargarHistorialOverrides();
}

// ============================================================
//  SUPERADMIN: Panel de inteligencia (tablero privado del superadmin)
// ============================================================
// Llama a get_panel_super() (RPC SECURITY DEFINER que valida is_superadmin en
// el backend) y dibuja: globales, rankings con barras y proyección de ganadores.
async function renderPanelSuper() {
  if (!esSuperadmin()) return;
  const gEl = $("#psGlobales"), rEl = $("#psRankings"), pEl = $("#psProyeccion");
  if (!gEl) return;
  gEl.innerHTML = '<p class="muted small">Cargando…</p>';
  rEl.innerHTML = ""; pEl.innerHTML = "";
  const { data, error } = await sb.rpc("get_panel_super");
  if (error) { gEl.innerHTML = `<p class="muted">Error: ${esc(error.message)}</p>`; return; }
  const usuarios = data?.usuarios || [];
  const g = data?.globales || {};
  if (!usuarios.length) { gEl.innerHTML = '<p class="muted">Aún no hay jugadores autorizados.</p>'; return; }

  // ---------- Globales ----------
  gEl.innerHTML = `
    <div class="ps-stat hot"><span class="big">${g.puntos_en_juego ?? 0}</span><span class="lbl">puntos en juego</span></div>
    <div class="ps-stat"><span class="big">${g.partidos_pendientes ?? 0}</span><span class="lbl">partidos pendientes</span></div>
    <div class="ps-stat"><span class="big">${g.partidos_jugados ?? 0}</span><span class="lbl">partidos jugados</span></div>
    <div class="ps-stat"><span class="big">${g.n_usuarios ?? usuarios.length}</span><span class="lbl">jugadores</span></div>
    <div class="ps-stat"><span class="big">${money(g.total_invertido)}</span><span class="lbl">total invertido</span></div>
    <div class="ps-stat"><span class="big">${money(g.total_repartido)}</span><span class="lbl">total en premios</span></div>`;

  // ---------- Rankings (gráficos de barra) ----------
  // Dibuja una barra horizontal por jugador (top N), escalada al máximo del grupo.
  const barChart = (titulo, hint, getVal, fmt, top = 8) => {
    const filas = usuarios.map((u) => ({ nombre: u.nombre, val: Number(getVal(u)) || 0 }))
      .filter((x) => x.val > 0)
      .sort((a, b) => b.val - a.val)
      .slice(0, top);
    if (!filas.length) {
      return `<div class="ps-chart"><h3>${titulo}</h3>
        ${hint ? `<p class="muted small ps-chart-hint">${hint}</p>` : ""}
        <p class="muted small">Sin datos todavía.</p></div>`;
    }
    const max = filas[0].val || 1;
    const barras = filas.map((x, i) => {
      const pct = Math.max(4, Math.round((x.val / max) * 100));
      const medalla = i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : (i + 1) + ".";
      return `<div class="ps-bar-row">
          <span class="ps-bar-rank">${medalla}</span>
          <span class="ps-bar-name" title="${esc(x.nombre)}">${esc(x.nombre)}</span>
          <span class="ps-bar-track"><span class="ps-bar-fill ${i === 0 ? "lead" : ""}" style="width:${pct}%"></span></span>
          <span class="ps-bar-val">${fmt(x.val)}</span>
        </div>`;
    }).join("");
    return `<div class="ps-chart"><h3>${titulo}</h3>
        ${hint ? `<p class="muted small ps-chart-hint">${hint}</p>` : ""}
        <div class="ps-bars">${barras}</div></div>`;
  };

  const intFmt = (n) => Number(n).toLocaleString("es-SV");
  const rendimiento = (u) => (Number(u.invertido) > 0 ? Number(u.puntos) / Number(u.invertido) : 0);

  rEl.innerHTML =
    barChart("💸 Mayor inversión", "Pronósticos enviados ($1 c/u).", (u) => u.invertido, money) +
    barChart("🏆 Más ganado", "Premios por marcador exacto (incluye acumulados).", (u) => u.ganado, money) +
    barChart("📝 Más pronósticos", "Marcadores digitados (cuenta ambos pronósticos).", (u) => u.n_pronosticos, intFmt) +
    barChart("✌️ Más dobles pronósticos", "Partidos con dos marcadores distintos.", (u) => u.n_dobles, intFmt) +
    barChart("📈 Más puntos", "Puntaje (mejor de dos: 3 exacto · 1 resultado).", (u) => u.puntos, intFmt) +
    barChart("⚡ Mejor rendimiento", "Puntos por cada $1 invertido.", rendimiento, (v) => v.toFixed(2) + " pts/$");

  // ---------- Proyección de ganadores ----------
  const ordenados = usuarios.slice().sort((a, b) =>
    Number(b.puntos) - Number(a.puntos) || Number(b.max_posible) - Number(a.max_posible));
  const lider = ordenados[0];
  const ptsLider = Number(lider?.puntos || 0);
  const enJuego = g.puntos_en_juego ?? 0;
  const contendientes = ordenados.filter((u) => Number(u.max_posible) >= ptsLider);

  pEl.innerHTML = `
    <p class="ps-proy-lead">🔝 Líder actual: <strong>${esc(lider.nombre)}</strong> con
       <strong>${ptsLider}</strong> puntos · quedan <strong>${enJuego}</strong> puntos por repartir.</p>
    <div class="ps-proy-scroll">
    <table class="ps-proy-tabla">
      <thead><tr><th>#</th><th>Jugador</th><th>Puntos</th><th>Pend.</th><th>Máx. posible</th><th>Estado</th></tr></thead>
      <tbody>
        ${ordenados.map((u, i) => {
          const esLider = i === 0;
          const enContencion = Number(u.max_posible) >= ptsLider;
          const estado = esLider ? '<span class="ps-tag lead">Líder</span>'
            : enContencion ? '<span class="ps-tag vivo">En contención</span>'
            : '<span class="ps-tag fuera">Sin alcance</span>';
          const medalla = i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : (i + 1);
          return `<tr class="${esLider ? "lead" : enContencion ? "" : "off"}">
              <td>${medalla}</td>
              <td class="ps-proy-nom">${esc(u.nombre)}</td>
              <td class="num"><strong>${u.puntos}</strong></td>
              <td class="num">${u.pendientes}</td>
              <td class="num">${u.max_posible}</td>
              <td>${estado}</td>
            </tr>`;
        }).join("")}
      </tbody>
    </table>
    </div>
    <p class="muted small">${contendientes.length} de ${ordenados.length} jugadores siguen con opción matemática al primer lugar.</p>`;
}

// Registra/corrige el pronóstico vía RPC SECURITY DEFINER (única vía que
// puede escribir el pronóstico de otro usuario saltándose el cierre).
async function guardarPronosticoPospartido() {
  if (!esSuperadmin()) return;
  const m = $("#superMsg");
  const uid = $("#superUser").value, pid = +$("#superPartido").value, slot = +$("#superSlot").value;
  const gl = $("#superGL").value, gv = $("#superGV").value;
  const motivo = ($("#superMotivo").value || "").trim();
  if (!uid || !pid) { msg(m, "Elige usuario y partido.", false); return; }
  if (gl === "" || gv === "") { msg(m, "Escribe el marcador (local y visitante).", false); return; }
  if (motivo.length < 30) { msg(m, "El motivo debe tener al menos 30 caracteres.", false); return; }
  const btn = $("#superGuardarBtn"); btn.disabled = true;
  try {
    const { error } = await sb.rpc("admin_set_pronostico_pospartido", {
      p_user: uid, p_partido: pid, p_slot: slot,
      p_gol_local: Math.max(0, Math.min(99, +gl)),
      p_gol_visitante: Math.max(0, Math.min(99, +gv)),
      p_motivo: motivo,
    });
    if (error) throw error;
    msg(m, "✅ Pronóstico registrado y auditado.", true);
    $("#superGL").value = ""; $("#superGV").value = ""; $("#superMotivo").value = "";
    actualizarContadorMotivo();
    cargarHistorialOverrides();
  } catch (e) {
    msg(m, "Error: " + (e.message || e), false);
  } finally {
    actualizarContadorMotivo();   // re-evalúa si el botón debe seguir habilitado
  }
}

// Trae el historial legible (últimos cambios) y lo pinta en el panel.
async function cargarHistorialOverrides() {
  const cont = $("#superHistorial"); if (!cont) return;
  const { data, error } = await sb.rpc("admin_list_overrides");
  if (error) { cont.innerHTML = `<p class="muted small">No se pudo cargar el historial: ${esc(error.message)}</p>`; return; }
  if (!data?.length) { cont.innerHTML = '<p class="muted small">Aún no hay cambios registrados.</p>'; return; }
  cont.innerHTML = data.map((r) => `
    <div class="super-log-row">
      <div><strong>${esc(r.usuario)}</strong> · #${r.partido_no} ${esc(r.partido)} · P${r.slot}</div>
      <div>${esc(r.anterior)} → <strong>${esc(r.marcador)}</strong> · por ${esc(r.superadmin)} · ${fmtFecha(r.created_at)}</div>
      <div class="muted small">📝 ${esc(r.motivo)}</div>
    </div>`).join("");
}

// Contador de caracteres del motivo + habilita/inhabilita el botón (≥30).
function actualizarContadorMotivo() {
  const mot = $("#superMotivo"), cnt = $("#superMotivoCount"), btn = $("#superGuardarBtn");
  const len = (mot?.value || "").trim().length;
  if (cnt) { cnt.textContent = `${len} / 30`; cnt.className = "small " + (len >= 30 ? "ok" : "muted"); }
  if (btn) btn.disabled = len < 30;
}
{
  const mot = $("#superMotivo"), btn = $("#superGuardarBtn");
  if (mot) mot.oninput = actualizarContadorMotivo;
  if (btn) btn.onclick = guardarPronosticoPospartido;
  actualizarContadorMotivo();
}

// ============================================================
//  ARRANQUE
// ============================================================
(function init() {
  setAuthMode("login");
  // No llamamos a getSession()/onLogin() aquí: onAuthStateChange emite el
  // evento INITIAL_SESSION al cargar la página y se encarga de mostrar la
  // app (si hay sesión) o el login (si no la hay). Así evitamos ejecutar
  // onLogin dos veces y cualquier carrera con el lock de auth.
})();
