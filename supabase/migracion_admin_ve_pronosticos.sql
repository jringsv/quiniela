-- ============================================================
--  migracion_admin_ve_pronosticos.sql
--  LOS ADMIN VEN LOS PRONÓSTICOS DE TODOS DESDE QUE SE GUARDAN
--
--  Por defecto, get_pronosticos_bloqueados() solo devuelve los pronósticos
--  de partidos ya CERRADOS (15 min antes de su hora), para que nadie pueda
--  espiar antes de tiempo. Con esta migración, un ADMINISTRADOR ve TODOS los
--  pronósticos en cuanto se guardan, aunque el partido siga abierto.
--
--  El resto de usuarios mantiene la regla original: solo partidos cerrados.
--
--  Ejecutar DESPUÉS de:
--    migracion_pronosticos_visibles.sql, migracion_aprobacion.sql (define is_admin)
--  Es idempotente (create or replace).
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
  where partido_locked(p.id)      -- partidos ya cerrados (regla para todos)
     or is_admin(auth.uid())      -- ...pero el admin los ve siempre, aunque sigan abiertos
  order by p.numero, pr.nombre, pp.slot;
$$;

grant execute on function get_pronosticos_bloqueados() to anon, authenticated;
