// ============================================================
//  bracket.js — Calcula tablas de grupo y resuelve las llaves
//  (16avos→final) desde los marcadores, según reglas del Mundial 2026.
//  Funciones puras; no toca la red ni el DOM.
// ============================================================
window.Bracket = (function () {
  const F = () => window.FIXTURE;

  // ---- Tablas de grupo ----
  function cmpTeam(a, b) {
    return b.pts - a.pts || b.dg - a.dg || b.gf - a.gf || a.team.localeCompare(b.team);
  }

  // groupMatches: [{numero, grupo, equipo_local, equipo_visitante}]
  // scores: { numero: {gl, gv} }  (se ignora si falta algún gol)
  function computeGroups(groupMatches, scores) {
    scores = scores || {};
    const G = {};
    groupMatches.forEach((m) => {
      if (!m.grupo) return;
      G[m.grupo] ||= {};
      [m.equipo_local, m.equipo_visitante].forEach((t) => {
        G[m.grupo][t] ||= { team: t, pj: 0, g: 0, e: 0, p: 0, gf: 0, gc: 0, dg: 0, pts: 0 };
      });
    });
    groupMatches.forEach((m) => {
      const s = scores[m.numero];
      if (!s || s.gl == null || s.gv == null || !m.grupo) return;
      const H = G[m.grupo][m.equipo_local], A = G[m.grupo][m.equipo_visitante];
      if (!H || !A) return;
      H.pj++; A.pj++;
      H.gf += s.gl; H.gc += s.gv; A.gf += s.gv; A.gc += s.gl;
      if (s.gl > s.gv) { H.g++; A.p++; H.pts += 3; }
      else if (s.gl < s.gv) { A.g++; H.p++; A.pts += 3; }
      else { H.e++; A.e++; H.pts++; A.pts++; }
    });
    const res = {};
    Object.keys(G).sort().forEach((g) => {
      const arr = Object.values(G[g]);
      arr.forEach((t) => (t.dg = t.gf - t.gc));
      arr.sort(cmpTeam);
      res[g] = arr;
    });
    return res;
  }

  function allGroupsComplete(groups) {
    const ks = Object.keys(groups);
    if (ks.length < 12) return false;
    return ks.every((g) => groups[g].length === 4 && groups[g].every((t) => t.pj === 3));
  }

  // Ranking de los 12 terceros; toma los 8 mejores y arma la combinación
  function rankThirds(groups) {
    const thirds = Object.keys(groups).sort()
      .map((g) => { const t = groups[g][2]; return t ? { ...t, grp: g } : null; })
      .filter(Boolean);
    thirds.sort((a, b) => b.pts - a.pts || b.dg - a.dg || b.gf - a.gf || a.grp.localeCompare(b.grp));
    const top8 = thirds.slice(0, 8);
    const combo = top8.map((t) => t.grp).sort().join("");
    return { thirds, top8, combo };
  }

  // Resuelve TODO el cuadro. winners: { matchNo: 'a' | 'b' }
  function resolve(groupMatches, scores, winners) {
    winners = winners || {};
    const groups = computeGroups(groupMatches, scores);
    const complete = allGroupsComplete(groups);
    const thirds = rankThirds(groups);
    const assign = complete ? (F().ASSIGN_THIRD[thirds.combo] || null) : null;

    const ALL = {};
    F().R32.forEach((m) => (ALL[m.n] = m));
    F().R16.forEach((m) => (ALL[m.n] = m));
    F().QF.forEach((m) => (ALL[m.n] = m));
    F().SF.forEach((m) => (ALL[m.n] = m));
    ALL[F().THIRD.n] = F().THIRD;
    ALL[F().FINAL.n] = F().FINAL;

    const cache = {};
    function teamsOf(n) {
      if (cache[n]) return cache[n];
      const def = ALL[n];
      if (!def) return { a: null, b: null };
      cache[n] = { a: null, b: null }; // evita recursión infinita
      cache[n] = { a: slot(def.a), b: slot(def.b) };
      return cache[n];
    }
    function winnerOf(n) {
      const w = winners[n]; if (!w) return null;
      const t = teamsOf(n);
      return w === "a" ? t.a : w === "b" ? t.b : null;
    }
    function loserOf(n) {
      const w = winners[n]; if (!w) return null;
      const t = teamsOf(n);
      return w === "a" ? t.b : w === "b" ? t.a : null;
    }
    function slot(s) {
      if (s.t === "pos") { const t = groups[s.g] && groups[s.g][s.r - 1]; return t ? t.team : null; }
      if (s.t === "third") { if (!assign) return null; const grp = assign[String(s.m)]; const t = grp && groups[grp] && groups[grp][2]; return t ? t.team : null; }
      if (s.t === "win") return winnerOf(s.m);
      if (s.t === "lose") return loserOf(s.m);
      return null;
    }

    const teams = {};
    Object.keys(ALL).forEach((n) => (teams[n] = teamsOf(+n)));

    const teamsIn = (ns) => { const set = new Set(); ns.forEach((n) => { const t = teamsOf(n); if (t.a) set.add(t.a); if (t.b) set.add(t.b); }); return set; };
    const winnersIn = (ns) => { const set = new Set(); ns.forEach((n) => { const w = winnerOf(n); if (w) set.add(w); }); return set; };

    const adv = {
      "16avos": teamsIn(F().R32.map((m) => m.n)),
      "8vos": winnersIn(F().R32.map((m) => m.n)),
      "4tos": winnersIn(F().R16.map((m) => m.n)),
      "semis": winnersIn(F().QF.map((m) => m.n)),
    };
    const positions = {
      campeon: winnerOf(F().FINAL.n),
      subcampeon: loserOf(F().FINAL.n),
      tercero: winnerOf(F().THIRD.n),
    };

    return { groups, thirds, complete, assignReady: !!assign, teams, winnerOf, loserOf, adv, positions };
  }

  return { computeGroups, rankThirds, resolve, allGroupsComplete, cmpTeam };
})();
