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
async function onLogin() {
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

    await cargarConfigLock();
    await cargarPartidos();
    showView("quiniela");   // recarga la quiniela (activación + pronósticos) al entrar
    iniciarRealtime();
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
function showAuth() {
  $("#nav").classList.add("hidden"); $("#logoutBtn").classList.add("hidden"); $("#userName").textContent = "";
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
  if (name === "mundial") renderMundialReal();
  if (name === "dashboard") cargarLeaderboard();
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
// ¿Ya cerró este partido? (now >= hora_del_partido - 15 min). Sin fecha => abierto.
function partidoBloqueado(p) {
  if (!p || !p.fecha) return false;
  return Date.now() >= new Date(p.fecha).getTime() - LOCK_MIN * 60000;
}
// Para participar (guardar): ser admin, o estar APROBADO. El cierre por tiempo
// es por partido (ver partidoBloqueado / puedeEditarMarcador).
const estaAprobado = () => !!(S.profile?.is_admin || S.profile?.aprobado);
const puedeEditar = () => !!(S.profile?.is_admin || estaAprobado());
// ¿Puede editar el marcador de ESTE partido ahora mismo?
const puedeEditarMarcador = (p) => S.profile?.is_admin || (estaAprobado() && !partidoBloqueado(p));

// ============================================================
//  DATOS
// ============================================================
async function cargarPartidos() {
  const { data } = await sb.from("partidos").select("*").order("numero", { ascending: true });
  S.partidos = data || [];
}
async function cargarMiQuiniela() {
  S.scores = {}; S.activos = new Map();
  const [{ data: preds }, { data: act }] = await Promise.all([
    sb.from("pred_partidos").select("*").eq("user_id", S.user.id),
    sb.from("partido_usuario").select("partido_id,n_pred").eq("user_id", S.user.id),
  ]);
  (preds || []).forEach((p) => {
    const n = mapIdToNum(p.partido_id);
    (S.scores[n] ||= {})[p.slot || 1] = { gl: p.gol_local, gv: p.gol_visitante };
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
  let sec = null;
  ms.forEach((p) => {
    const s = seccionDe(p);
    if (s !== sec) {
      sec = s;
      const h = document.createElement("div"); h.className = "grupo-h"; h.textContent = s; cont.appendChild(h);
    }
    cont.appendChild(filaMarcador(p));
  });
}
function filaMarcador(p) {
  const aplica = p.aplica_quiniela !== false;
  const cerrado = partidoBloqueado(p) && !S.profile?.is_admin;
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
  // Pie: botón de guardar (mientras sea editable); si cerró, solo la fecha.
  const acciones = editable
    ? `<button class="btn small primary pron-save">💾 Guardar partido</button>
       <span class="msg pron-msg"></span>
       <span class="fch">${ctx}</span>`
    : `<span class="fch">${ctx}</span>`;
  row.innerHTML = `
    <div class="partido2-head">
      <span class="eq">${teamRow(p.equipo_local)}</span>
      <span class="vs">vs</span>
      <span class="eq v">${teamRow(p.equipo_visitante)}</span>
      ${tag}${lockTag}${npTag}
    </div>
    <div class="partido2-prons">${pronsHtml}</div>
    <div class="pron-actions">${acciones}</div>`;
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
  btn.disabled = true;
  try {
    // Reescribe este partido: borra lo previo (incluye slots vaciados) e inserta.
    const { error: delErr } = await sb.from("pred_partidos").delete().eq("user_id", S.user.id).eq("partido_id", p.id);
    if (delErr) throw delErr;
    const rows = Object.entries(filled).map(([slot, s]) =>
      ({ user_id: S.user.id, partido_id: p.id, slot: +slot, gol_local: s.gl, gol_visitante: s.gv }));
    if (rows.length) { const { error } = await sb.from("pred_partidos").insert(rows); if (error) throw error; }
    msg(msgEl, rows.length ? "✅ Guardado." : "Pronóstico borrado.", true);
  } catch (e) { msg(msgEl, "Error: " + e.message, false); }
  finally { btn.disabled = !editableMarcadorAhora(p); }
}
// ¿El usuario puede guardar este marcador ahora? (aprobado/admin + activado + no cerrado)
const editableMarcadorAhora = (p) => puedeEditar() && puedeEditarMarcador(p) && estaActivo(p);

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
//  VISTA: DASHBOARD
// ============================================================
async function cargarLeaderboard() {
  const { data, error } = await sb.rpc("get_leaderboard");
  const body = $("#leaderboardBody");
  if (error) { body.innerHTML = `<tr><td colspan="4" class="muted">Error: ${error.message}</td></tr>`; return; }
  if (!data?.length) { body.innerHTML = '<tr><td colspan="4" class="muted">Sin jugadores aún.</td></tr>'; return; }
  body.innerHTML = data.map((r, i) => {
    const rank = i + 1, medalla = rank === 1 ? "🥇" : rank === 2 ? "🥈" : rank === 3 ? "🥉" : rank;
    const cls = rank <= 3 ? "rank" + rank : "", me = r.nombre === S.profile?.nombre ? "me" : "";
    return `<tr class="${me} ${cls}"><td>${medalla}</td><td>${r.nombre}</td>
      <td>${r.pts_partidos}</td><td class="total">${r.total}</td></tr>`;
  }).join("");
}
function iniciarRealtime() {
  if (S._channel) return;
  const refrescar = () => {
    cargarPartidos().then(() => {
      if (!$("#view-dashboard").classList.contains("hidden")) cargarLeaderboard();
      if (!$("#view-mundial").classList.contains("hidden")) renderMundialReal();
    });
  };
  // Si el admin cambia mi activación/cupo, refresca mi quiniela si la tengo abierta.
  const refrescarQuiniela = () => {
    if (!$("#view-quiniela").classList.contains("hidden")) cargarMiQuiniela().then(renderQuiniela);
  };
  S._channel = sb.channel("quiniela-live")
    .on("postgres_changes", { event: "*", schema: "public", table: "partidos" }, () => { refrescar(); refrescarQuiniela(); })
    .on("postgres_changes", { event: "*", schema: "public", table: "partido_usuario" }, refrescarQuiniela)
    .on("postgres_changes", { event: "*", schema: "public", table: "resultado_avance" }, () => { if (!$("#view-dashboard").classList.contains("hidden")) cargarLeaderboard(); })
    .on("postgres_changes", { event: "*", schema: "public", table: "resultado_posicion" }, () => { if (!$("#view-dashboard").classList.contains("hidden")) cargarLeaderboard(); })
    .on("postgres_changes", { event: "*", schema: "public", table: "res_bracket" }, () => { if (!$("#view-mundial").classList.contains("hidden")) renderMundialReal(); })
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
  let html = pendientes
    ? `<p class="pendientes-aviso">🔔 ${pendientes} usuario(s) pendiente(s) de autorización.</p>`
    : `<p class="muted small">Todos los usuarios están autorizados.</p>`;

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
    // Borrar: solo usuarios que no sean admin y que no sean uno mismo.
    if (!u.is_admin && !esYo) {
      accion += ` <button class="btn small danger" data-borrar="${u.id}" data-nombre="${esc(u.nombre)}" data-npred="${u.n_predicciones || 0}">Borrar</button>`;
    }
    html += `<div class="user-row ${u.aprobado || u.is_admin ? "" : "pend"}">
      <span class="u-nombre">${u.nombre || "(sin nombre)"}${esYo ? " (tú)" : ""}
        <span class="u-email">${u.email || ""}</span></span>
      ${estado}
      <span class="u-accion">${accion}</span>
    </div>`;
  });
  cont.innerHTML = html;

  cont.querySelectorAll("[data-aprobar]").forEach((b) =>
    (b.onclick = () => setAprobado(b.dataset.aprobar, true)));
  cont.querySelectorAll("[data-revocar]").forEach((b) =>
    (b.onclick = () => setAprobado(b.dataset.revocar, false)));
  cont.querySelectorAll("[data-editar]").forEach((b) =>
    (b.onclick = () => editarNombreUsuario(b.dataset.editar, b.dataset.prefill)));
  cont.querySelectorAll("[data-borrar]").forEach((b) =>
    (b.onclick = () => borrarUsuario(b.dataset.borrar, b.dataset.nombre, +b.dataset.npred)));
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
function renderAdminPartidos() {
  const cont = $("#adminPartidos"); cont.innerHTML = "";
  const ms = S.partidos.slice().sort((a, b) => (a.numero || 0) - (b.numero || 0));
  if (!ms.length) { cont.innerHTML = '<p class="muted">Sin partidos. Usa "Agregar / importar".</p>'; return; }
  let sec = null;
  ms.forEach((p) => {
    const s = seccionDe(p);
    if (s !== sec) {
      sec = s;
      const h = document.createElement("div"); h.className = "grupo-h"; h.textContent = s; cont.appendChild(h);
    }
    const aplica = p.aplica_quiniela !== false;   // por defecto aplica
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
    const row = document.createElement("div"); row.className = "admin-partido" + (aplica ? "" : " no-aplica");
    row.innerHTML = `
      <div class="admin-partido-main">
        <span class="eq">${teamRow(p.equipo_local)}</span>
        <input type="number" min="0" max="99" data-rid="${p.id}" data-side="l" value="${p.gol_local ?? ""}">
        <span class="vs">vs</span>
        <input type="number" min="0" max="99" data-rid="${p.id}" data-side="v" value="${p.gol_visitante ?? ""}">
        <span class="eq v">${teamRow(p.equipo_visitante)}</span>
        <button class="btn small" data-save="${p.id}">Guardar</button>
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
    cont.appendChild(row);
  });
  cont.querySelectorAll("[data-save]").forEach((b) => (b.onclick = () => guardarResultado(b.dataset.save)));
  cont.querySelectorAll("[data-aplica]").forEach((c) => (c.onchange = () => guardarAplica(c.dataset.aplica, c.checked)));
  cont.querySelectorAll("[data-act-p]").forEach((c) => (c.onchange = () => setParticipante(+c.dataset.actP, c.dataset.actU, +c.value)));
  cont.querySelectorAll("[data-tb]").forEach((b) => (b.onclick = () => setTiebreak(+b.dataset.tb, b.dataset.side)));
}
async function guardarAplica(id, aplica) {
  const { error } = await sb.from("partidos").update({ aplica_quiniela: aplica }).eq("id", +id);
  if (error) { alert("Error: " + error.message); await cargarPartidos(); renderAdminPartidos(); return; }
  const p = S.partidos.find((x) => x.id === +id); if (p) p.aplica_quiniela = aplica;
  renderAdminPartidos();
}
async function guardarResultado(id) {
  const l = document.querySelector(`[data-rid="${id}"][data-side="l"]`).value;
  const v = document.querySelector(`[data-rid="${id}"][data-side="v"]`).value;
  const upd = { gol_local: l === "" ? null : +l, gol_visitante: v === "" ? null : +v };
  const { error } = await sb.from("partidos").update(upd).eq("id", id);
  if (error) return alert("Error: " + error.message);
  await cargarPartidos();
  await propagarLlaves();     // alimenta las llaves automáticamente
  renderAdminPartidos();
}
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
//  ARRANQUE
// ============================================================
(function init() {
  setAuthMode("login");
  // No llamamos a getSession()/onLogin() aquí: onAuthStateChange emite el
  // evento INITIAL_SESSION al cargar la página y se encarga de mostrar la
  // app (si hay sesión) o el login (si no la hay). Así evitamos ejecutar
  // onLogin dos veces y cualquier carrera con el lock de auth.
})();
