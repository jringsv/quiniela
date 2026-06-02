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
  partidos: [],            // partidos de grupos (de la BD)
  scores: {},              // predicción del usuario {numero:{gl,gv}}
  winners: {},             // bracket del usuario {matchNo:'a'|'b'}
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
    await cargarMiQuiniela();
    showView("quiniela");
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
  if (name === "quiniela") renderQuiniela();
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
  S.scores = {}; S.winners = {};
  const [{ data: preds }, { data: brk }] = await Promise.all([
    sb.from("pred_partidos").select("*").eq("user_id", S.user.id),
    sb.from("pred_bracket").select("*").eq("user_id", S.user.id),
  ]);
  (preds || []).forEach((p) => { const n = mapIdToNum(p.partido_id); S.scores[n] = { gl: p.gol_local, gv: p.gol_visitante }; });
  (brk || []).forEach((b) => (S.winners[b.match_no] = b.ganador));
}
function mapIdToNum(id) { const p = S.partidos.find((x) => x.id === id); return p ? p.numero : id; }
function numToId(num) { const p = S.partidos.find((x) => x.numero === num); return p ? p.id : null; }

// ============================================================
//  VISTA: MI QUINIELA
// ============================================================
function renderQuiniela() {
  renderApprovalBanner();
  renderMarcadores();
  refreshLive();
  $("#saveAll").disabled = !puedeEditar();
}
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
  const ms = grupoMatches();
  if (!ms.length) { cont.innerHTML = '<p class="muted">Aún no hay partidos cargados (el admin debe importarlos).</p>'; return; }
  const grupos = {};
  ms.forEach((p) => { (grupos["Grupo " + (p.grupo || "?")] ||= []).push(p); });
  for (const [titulo, lista] of Object.entries(grupos)) {
    const h = document.createElement("div"); h.className = "grupo-h"; h.textContent = titulo; cont.appendChild(h);
    lista.forEach((p) => cont.appendChild(filaMarcador(p)));
  }
}
function filaMarcador(p) {
  const aplica = p.aplica_quiniela !== false;
  const cerrado = partidoBloqueado(p) && !S.profile?.is_admin;
  const row = document.createElement("div");
  row.className = "partido" + (aplica ? "" : " no-aplica") + (cerrado ? " cerrado" : "");
  const s = S.scores[p.numero] || {};
  const tag = aplica ? "" : `<span class="tag-no-aplica" title="Este partido no otorga los puntos de marcador (3/1). Tu pronóstico igual arma tus tablas y llaves.">no suma marcador</span>`;
  const lockTag = cerrado ? `<span class="tag-cerrado" title="Este partido cerró ${LOCK_MIN} min antes de empezar. Ya no se puede modificar.">🔒 cerrado</span>` : "";
  row.innerHTML = `
    <span class="eq">${teamRow(p.equipo_local)}</span>
    <input type="number" min="0" max="99" data-n="${p.numero}" data-side="l" value="${s.gl ?? ""}">
    <span class="vs">vs</span>
    <input type="number" min="0" max="99" data-n="${p.numero}" data-side="v" value="${s.gv ?? ""}">
    <span class="eq v">${teamRow(p.equipo_visitante)}</span>
    ${tag}${lockTag}
    <span class="fch">${fmtFecha(p.fecha)}</span>`;
  row.querySelectorAll("input").forEach((i) => {
    i.disabled = !puedeEditarMarcador(p);
    i.oninput = () => {
      const n = +i.dataset.n; S.scores[n] ||= {};
      S.scores[n][i.dataset.side === "l" ? "gl" : "gv"] = i.value === "" ? null : Math.max(0, Math.min(99, +i.value));
      refreshLive();
    };
  });
  return row;
}
function refreshLive() {
  const res = Bracket.resolve(grupoMatches(), S.scores, S.winners);
  renderGroups($("#gruposLive"), $("#tercerosLive"), res.groups, res.thirds);
  renderBracket($("#bracketMount"), res, S.winners, puedeEditar(), (n, side) => {
    S.winners[n] = side; refreshLive();
  });
}

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

// ============================================================
//  GUARDAR MI QUINIELA
// ============================================================
$("#saveAll").onclick = async () => {
  if (!puedeEditar()) return;
  const btn = $("#saveAll"); btn.disabled = true;
  try {
    const pp = [];
    Object.entries(S.scores).forEach(([n, s]) => {
      const p = S.partidos.find((x) => x.numero === +n);
      if (!p) return;
      if (partidoBloqueado(p) && !S.profile?.is_admin) return;   // ese partido ya cerró: no se reenvía
      if (s && s.gl != null && s.gv != null) pp.push({ user_id: S.user.id, partido_id: p.id, gol_local: s.gl, gol_visitante: s.gv });
    });
    if (pp.length) { const { error } = await sb.from("pred_partidos").upsert(pp, { onConflict: "user_id,partido_id" }); if (error) throw error; }

    await sb.from("pred_bracket").delete().eq("user_id", S.user.id);
    const br = Object.entries(S.winners).filter(([, v]) => v === "a" || v === "b")
      .map(([n, v]) => ({ user_id: S.user.id, match_no: +n, ganador: v }));
    if (br.length) { const { error } = await sb.from("pred_bracket").insert(br); if (error) throw error; }

    const res = Bracket.resolve(grupoMatches(), S.scores, S.winners);
    await guardarDerivados("pred_avance", "pred_posicion", res, S.user.id);
    msg($("#saveMsg"), "✅ Quiniela guardada.", true);
  } catch (e) { msg($("#saveMsg"), "Error: " + e.message, false); }
  finally { btn.disabled = !puedeEditar(); }
};

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
  const res = Bracket.resolve(grupoMatches(), realScores(), S.realWinners);
  renderGroups($("#gruposReal"), $("#tercerosReal"), res.groups, res.thirds);
  renderBracket($("#bracketReal"), res, S.realWinners, false, null);
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
  S._channel = sb.channel("quiniela-live")
    .on("postgres_changes", { event: "*", schema: "public", table: "partidos" }, refrescar)
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
  renderAdminPartidos();
  const { data: rb } = await sb.from("res_bracket").select("*");
  S.realWinners = {}; (rb || []).forEach((r) => (S.realWinners[r.match_no] = r.ganador));
  refreshAdminBracket();
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
    // El admin no puede revocarse a sí mismo ni cambiar/borrar a otros admins desde aquí.
    let accion = u.is_admin
      ? ""
      : u.aprobado
        ? `<button class="btn small ghost" data-revocar="${u.id}">Revocar</button>`
        : `<button class="btn small" data-aprobar="${u.id}">Autorizar</button>`;
    const esc = (s) => (s || "").replace(/"/g, "&quot;");
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
}
async function setAprobado(id, aprobado) {
  const { error } = await sb.from("profiles").update({ aprobado }).eq("id", id);
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
function refreshAdminBracket() {
  const res = Bracket.resolve(grupoMatches(), realScores(), S.realWinners);
  renderBracket($("#bracketAdmin"), res, S.realWinners, true, (n, side) => {
    S.realWinners[n] = side; refreshAdminBracket();
  });
}
function renderAdminPartidos() {
  const cont = $("#adminPartidos"); cont.innerHTML = "";
  const ms = grupoMatches();
  if (!ms.length) { cont.innerHTML = '<p class="muted">Sin partidos. Usa "Agregar / importar".</p>'; return; }
  ms.forEach((p) => {
    const aplica = p.aplica_quiniela !== false;   // por defecto aplica
    const row = document.createElement("div"); row.className = "partido" + (aplica ? "" : " no-aplica");
    row.innerHTML = `
      <span class="eq">${teamRow(p.equipo_local)}</span>
      <input type="number" min="0" max="99" data-rid="${p.id}" data-side="l" value="${p.gol_local ?? ""}">
      <span class="vs">vs</span>
      <input type="number" min="0" max="99" data-rid="${p.id}" data-side="v" value="${p.gol_visitante ?? ""}">
      <span class="eq v">${teamRow(p.equipo_visitante)}</span>
      <button class="btn small" data-save="${p.id}">Guardar</button>
      <label class="chk-aplica" title="Si lo desmarcas, este partido NO otorga los puntos de marcador (3/1).">
        <input type="checkbox" data-aplica="${p.id}" ${aplica ? "checked" : ""}> aplica
      </label>
      <span class="fch">${p.grupo ? "Gpo " + p.grupo : ""} · ${fmtFecha(p.fecha)}</span>`;
    cont.appendChild(row);
  });
  cont.querySelectorAll("[data-save]").forEach((b) => (b.onclick = () => guardarResultado(b.dataset.save)));
  cont.querySelectorAll("[data-aplica]").forEach((c) => (c.onchange = () => guardarAplica(c.dataset.aplica, c.checked)));
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
  await cargarPartidos(); renderAdminPartidos(); refreshAdminBracket();
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
  $("#importBox").value = ""; await cargarPartidos(); renderAdminPartidos(); refreshAdminBracket();
  alert(`✅ ${payload.length} partidos importados.`);
};
$("#saveAdminBracket").onclick = async () => {
  const btn = $("#saveAdminBracket"); btn.disabled = true;
  try {
    await sb.from("res_bracket").delete().neq("match_no", -1);
    const br = Object.entries(S.realWinners).filter(([, v]) => v === "a" || v === "b")
      .map(([n, v]) => ({ match_no: +n, ganador: v }));
    if (br.length) { const { error } = await sb.from("res_bracket").insert(br); if (error) throw error; }
    const res = Bracket.resolve(grupoMatches(), realScores(), S.realWinners);
    await guardarDerivados("resultado_avance", "resultado_posicion", res, null);
    msg($("#adminBracketMsg"), "✅ Llaves reales guardadas. La tabla de posiciones se recalculó.", true);
  } catch (e) { msg($("#adminBracketMsg"), "Error: " + e.message, false); }
  finally { btn.disabled = false; }
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
