-- ============================================================
--  migracion_pronosticos_visibles.sql
--  VER LOS PRONÓSTICOS DE TODOS EN LOS PARTIDOS YA CERRADOS
--
--  Una vez que un partido se BLOQUEA (15 min antes de su hora, ver
--  partido_locked()), sus pronósticos dejan de ser secretos: cualquiera
--  puede ver qué marcador puso cada persona. Antes del cierre siguen
--  ocultos (el RLS de pred_partidos solo deja ver los propios).
--
--  get_pronosticos_bloqueados() es security definer porque necesita leer
--  TODAS las predicciones; pero SOLO devuelve las de partidos cerrados,
--  así que no se puede usar para espiar antes de tiempo.
--
--  Ejecutar DESPUÉS de:
--    migracion_lock_por_partido.sql, migracion_dos_pred_y_activacion.sql,
--    migracion_npred_por_activacion.sql
--  Es idempotente.
-- ============================================================

create or replace function get_pronosticos_bloqueados()
returns table (
  partido_id         bigint,
  numero             int,
  fase               text,
  grupo              text,
  equipo_local       text,
  equipo_visitante   text,
  fecha              timestamptz,
  gol_local_real     int,       -- resultado real (NULL si cerró pero aún no se juega)
  gol_visitante_real int,
  nombre             text,
  slot               smallint,
  pred_local         int,
  pred_visitante     int,
  acerto             boolean     -- ¿este pronóstico es el marcador exacto?
)
language sql stable security definer set search_path = public as $$
  select
    p.id, p.numero, p.fase, p.grupo, p.equipo_local, p.equipo_visitante, p.fecha,
    p.gol_local, p.gol_visitante,
    pr.nombre, pp.slot, pp.gol_local, pp.gol_visitante,
    (p.gol_local is not null and p.gol_visitante is not null
      and pp.gol_local = p.gol_local and pp.gol_visitante = p.gol_visitante) as acerto
  from partidos p
  join pred_partidos pp on pp.partido_id = p.id
  join profiles pr on pr.id = pp.user_id and (pr.aprobado or pr.is_admin)
  where partido_locked(p.id)      -- SOLO partidos ya cerrados (15 min antes)
  order by p.numero, pr.nombre, pp.slot;
$$;

grant execute on function get_pronosticos_bloqueados() to anon, authenticated;
