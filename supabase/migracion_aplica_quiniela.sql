-- ============================================================
--  MIGRACIÓN: bandera "aplica para quiniela" por partido
--  Ejecuta este archivo UNA VEZ en:  Supabase -> SQL Editor -> Run
--  (sólo para bases que ya existían antes de esta función;
--   el schema.sql nuevo ya la incluye.)
-- ============================================================

-- 1) Nueva columna. Por defecto TODOS los partidos aplican (true);
--    el admin desmarca los que, según las nuevas reglas, no cuentan.
alter table partidos
  add column if not exists aplica_quiniela boolean not null default true;

-- 2) Recalcular puntos: los partidos con aplica_quiniela = false
--    ya NO otorgan los 3/1 puntos de marcador. (El resultado real
--    del partido sigue armando las tablas de grupo y las llaves.)
create or replace function get_leaderboard()
returns table (
  nombre          text,
  pts_partidos    int,
  pts_fases       int,
  pts_posiciones  int,
  total           int
)
language sql stable security definer set search_path = public as $$
  with mp as (   -- puntos por marcadores (solo partidos marcados "aplica_quiniela")
    select pp.user_id,
      sum(
        case
          when not p.aplica_quiniela then 0
          when p.gol_local is null or p.gol_visitante is null then 0
          when pp.gol_local = p.gol_local and pp.gol_visitante = p.gol_visitante then 3
          when sign(pp.gol_local - pp.gol_visitante) = sign(p.gol_local - p.gol_visitante) then 1
          else 0
        end
      ) as pts
    from pred_partidos pp
    join partidos p on p.id = pp.partido_id
    group by pp.user_id
  ),
  fp as (        -- puntos por avance de fases
    select pa.user_id,
      sum(case pa.fase
            when '16avos' then 1
            when '8vos'   then 2
            when '4tos'   then 3
            when 'semis'  then 4
            else 0 end) as pts
    from pred_avance pa
    join resultado_avance ra on ra.fase = pa.fase and ra.equipo = pa.equipo
    group by pa.user_id
  ),
  posp as (      -- puntos por posiciones finales
    select px.user_id,
      sum(case px.posicion
            when 'campeon'    then 7
            when 'subcampeon' then 5
            when 'tercero'    then 5
            else 0 end) as pts
    from pred_posicion px
    join resultado_posicion rp on rp.posicion = px.posicion and rp.equipo = px.equipo
    group by px.user_id
  )
  select
    pr.nombre,
    coalesce(mp.pts, 0)::int   as pts_partidos,
    coalesce(fp.pts, 0)::int   as pts_fases,
    coalesce(posp.pts, 0)::int as pts_posiciones,
    (coalesce(mp.pts,0) + coalesce(fp.pts,0) + coalesce(posp.pts,0))::int as total
  from profiles pr
  left join mp   on mp.user_id   = pr.id
  left join fp   on fp.user_id   = pr.id
  left join posp on posp.user_id = pr.id
  order by total desc, pr.nombre asc;
$$;
