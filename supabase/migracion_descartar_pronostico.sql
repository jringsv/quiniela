-- ============================================================
--  migracion_descartar_pronostico.sql
--  Descarta los pronósticos INFRACTORES (doble pronóstico con
--  ganadores OPUESTOS) que sumaron punto, y hace que el puntaje
--  (get_leaderboard) ignore las filas descartadas.
--
--  REGLA DEL CONCURSO: con dos pronósticos en un mismo partido,
--  ambos pueden variar en el marcador pero deben mantener al MISMO
--  equipo ganador (o ambos empate). Cubrir ambos ganadores (uno
--  gana local y el otro gana visitante) no está permitido.
--
--  Qué hace, en un solo script (idempotente):
--    1) Agrega la columna pred_partidos.descartado (no borra nada).
--    2) Marca como descartado el slot que acertó el ganador, SOLO en
--       partidos donde el usuario puso dos pronósticos con ganadores
--       opuestos. El otro slot (ganador equivocado) ya valía 0, así
--       que el partido pasa a valer 0 para ese usuario.
--    3) Reescribe get_leaderboard() (versión de migracion_mejor_de_dos.sql)
--       para que ignore las filas con descartado = true.
--
--  REVERSIBLE:  update pred_partidos set descartado = false where descartado;
--
--  Ejecutar DESPUÉS de migracion_mejor_de_dos.sql. Es idempotente.
-- ============================================================

-- 1) Columna de marca (no borra nada).
alter table pred_partidos
  add column if not exists descartado boolean not null default false;

-- 2) Marca el slot que acertó el ganador, SOLO en partidos donde el usuario
--    puso dos pronósticos con ganadores opuestos (uno gana local, otro visitante).
update pred_partidos pp
set descartado = true
from partidos p
where p.id = pp.partido_id
  and p.aplica_quiniela
  and p.gol_local is not null and p.gol_visitante is not null
  and sign(pp.gol_local - pp.gol_visitante) = sign(p.gol_local - p.gol_visitante)
  and exists (
    select 1 from pred_partidos x
    where x.user_id = pp.user_id and x.partido_id = pp.partido_id
    group by x.user_id, x.partido_id
    having count(*) = 2
       and min(sign(x.gol_local - x.gol_visitante)) = -1
       and max(sign(x.gol_local - x.gol_visitante)) = 1
  );

-- 3) Puntaje: get_leaderboard ignora las filas descartadas.
create or replace function get_leaderboard()
returns table (
  nombre        text,
  pts_partidos  int,
  marcadores    int,   -- M: # de partidos cuyo mejor pronóstico fue exacto (3)
  ganadores     int,   -- G: # de partidos cuyo mejor pronóstico fue resultado (1)
  total         int
)
language sql stable security definer set search_path = public as $$
  with por_pred as (
    -- Puntos de CADA pronóstico individual (puede haber 2 por partido),
    -- excluyendo los marcados como descartados.
    select pp.user_id, pp.partido_id,
      case
        when not p.aplica_quiniela then 0
        when p.gol_local is null or p.gol_visitante is null then 0
        when pp.gol_local = p.gol_local and pp.gol_visitante = p.gol_visitante then 3
        when sign(pp.gol_local - pp.gol_visitante) = sign(p.gol_local - p.gol_visitante) then 1
        else 0
      end as pts
    from pred_partidos pp
    join partidos p on p.id = pp.partido_id
    where not pp.descartado
  ),
  por_partido as (
    -- Por jugador y partido, solo cuenta el MEJOR de sus pronósticos.
    select user_id, partido_id, max(pts) as pts
    from por_pred
    group by user_id, partido_id
  ),
  mp as (
    select user_id,
      sum(pts)                          as pts,
      count(*) filter (where pts = 3)   as m,   -- mejor pronóstico exacto
      count(*) filter (where pts = 1)   as g    -- mejor pronóstico solo resultado
    from por_partido
    group by user_id
  )
  select
    pr.nombre,
    coalesce(mp.pts, 0)::int as pts_partidos,
    coalesce(mp.m, 0)::int   as marcadores,
    coalesce(mp.g, 0)::int   as ganadores,
    coalesce(mp.pts, 0)::int as total
  from profiles pr
  left join mp on mp.user_id = pr.id
  where pr.aprobado or pr.is_admin
  order by total desc, marcadores desc, ganadores desc, pr.nombre asc;
$$;

grant execute on function get_leaderboard() to anon, authenticated;

-- 4) Detalle por jugador (tabla "Ver detalle" del dashboard) + pronósticos de todos.
--    Reescribe la versión VIGENTE (migracion_admin_ve_pronosticos.sql) conservando
--    TODO lo suyo: el admin ve partidos abiertos (or is_admin) y la columna
--    actualizado_en (pie "última actualización"). Solo se AÑADE la columna
--    descartado al final para que el frontend muestre el pronóstico anulado en 0
--    y no lo elija como "mejor de dos".
-- Se hace DROP antes del CREATE porque cambia el tipo de retorno (agrega una
-- columna) y Postgres no permite eso con create or replace.
drop function if exists get_pronosticos_bloqueados();
create or replace function get_pronosticos_bloqueados()
returns table (
  partido_id         bigint,
  numero             int,
  fase               text,
  grupo              text,
  equipo_local       text,
  equipo_visitante   text,
  fecha              timestamptz,
  gol_local_real     int,
  gol_visitante_real int,
  nombre             text,
  slot               smallint,
  pred_local         int,
  pred_visitante     int,
  acerto             boolean,
  actualizado_en     timestamptz, -- cuándo se guardó/editó por última vez este pronóstico
  descartado         boolean      -- pronóstico anulado por la regla de doble pronóstico
)
language sql stable security definer set search_path = public as $$
  select
    p.id, p.numero, p.fase, p.grupo, p.equipo_local, p.equipo_visitante, p.fecha,
    p.gol_local, p.gol_visitante,
    pr.nombre, pp.slot, pp.gol_local, pp.gol_visitante,
    (p.gol_local is not null and p.gol_visitante is not null
      and pp.gol_local = p.gol_local and pp.gol_visitante = p.gol_visitante) as acerto,
    pp.updated_at,
    pp.descartado
  from partidos p
  join pred_partidos pp on pp.partido_id = p.id
  join profiles pr on pr.id = pp.user_id and (pr.aprobado or pr.is_admin)
  where partido_locked(p.id)      -- partidos ya cerrados (regla para todos)
     or is_admin(auth.uid())      -- ...pero el admin los ve siempre, aunque sigan abiertos
  order by p.numero, pr.nombre, pp.slot;
$$;

grant execute on function get_pronosticos_bloqueados() to anon, authenticated;
