-- ============================================================
--  migracion_habilitar_grupos_restantes.sql
--  HABILITA a TODOS los usuarios (aprobados + admins) con DOS
--  pronósticos (n_pred = 2) en TODOS los partidos de FASE DE GRUPOS
--  que se juegan de MAÑANA EN ADELANTE.
--
--  "de mañana en adelante": partidos con fecha >= 2026-06-20 00:00
--  (hora de El Salvador, UTC-6). Hoy es 2026-06-19.
--
--  Habilitar = crear/actualizar la fila en partido_usuario. Que el
--  usuario meta uno, dos o ningún pronóstico queda a su criterio;
--  el partido ya le aparecerá ABIERTO con cupo para dos.
--
--  Idempotente: se puede correr varias veces. Si un usuario ya tenía
--  una fila (incluso con n_pred = 1), se fuerza a n_pred = 2.
--
--  Ejecutar DESPUÉS de:
--    migracion_dos_pred_y_activacion.sql, migracion_npred_por_activacion.sql,
--    migracion_sync_participacion.sql
-- ============================================================

insert into partido_usuario (partido_id, user_id, n_pred)
select p.id, pr.id, 2::smallint
from partidos p
cross join profiles pr
where p.fase = 'grupos'
  and p.fecha >= '2026-06-20T00:00:00-06:00'::timestamptz
  and (pr.aprobado or pr.is_admin)
on conflict (partido_id, user_id) do update
  set n_pred = 2;

-- ------------------------------------------------------------
-- DIAGNÓSTICO: el resultado que muestra Supabase es ESTA tabla.
-- Una fila por partido de grupos de mañana en adelante, con cuántos
-- usuarios quedaron habilitados con dos pronósticos (con_2) y el total
-- de usuarios elegibles (aprobados + admins).
--   * Si "con_2" = "elegibles" en cada fila  -> los datos SÍ quedaron;
--     el problema es refresco del navegador (haz Ctrl+F5 / re-login).
--   * Si esta tabla sale VACÍA -> ningún partido pasó el filtro de fecha
--     (avísame y ajustamos el corte).
-- ------------------------------------------------------------
select
  p.numero,
  p.grupo,
  p.equipo_local || ' vs ' || p.equipo_visitante as partido,
  p.fecha,
  count(pu.user_id) filter (where pu.n_pred = 2) as con_2,
  (select count(*) from profiles where aprobado or is_admin) as elegibles
from partidos p
left join partido_usuario pu on pu.partido_id = p.id
where p.fase = 'grupos'
  and p.fecha >= '2026-06-20T00:00:00-06:00'::timestamptz
group by p.id, p.numero, p.grupo, p.equipo_local, p.equipo_visitante, p.fecha
order by p.numero;

-- ============================================================
--  LISTO.
-- ============================================================
