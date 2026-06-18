-- ============================================================
--  migracion_mejor_de_dos.sql
--  REGLA: con DOS pronósticos en un mismo partido, solo cuenta UNO
--
--  Interpretación de la regla del concurso:
--    Cuando un jugador registra dos pronósticos para el mismo
--    partido, NO suma los puntos de ambos. Solo gana los puntos
--    del MEJOR de los dos (el que le dé más: 3 si uno es marcador
--    exacto, 1 si uno acierta el resultado/ganador, 0 si ninguno).
--
--  Ejemplo:
--    Colombia juega y queda 3-1.
--    El jugador puso 2-1 y 1-0 (ambos predicen que Colombia gana).
--    Antes: 1 + 1 = 2 puntos (mal).
--    Ahora: max(1, 1) = 1 punto (correcto).
--
--  Antes (migracion_m_g_columnas.sql) get_leaderboard() sumaba los
--  puntos de TODAS las filas de pred_partidos (slot 1 y slot 2),
--  por lo que un partido con dos pronósticos podía sumar hasta 4
--  o 6 puntos. Esta migración reescribe la función para que, por
--  jugador y partido, solo cuente el mejor pronóstico.
--
--  Las columnas M (marcadores exactos) y G (ganadores) también
--  respetan la regla: un partido aporta a M si su MEJOR pronóstico
--  fue exacto (3), o a G si su mejor pronóstico fue solo resultado
--  (1). Nunca aporta a ambos ni cuenta dos veces.
--
--  Mismo tipo de retorno y mismo desempate que migracion_m_g_columnas.sql,
--  así que basta con create or replace (no cambia la firma).
--
--  Ejecutar DESPUÉS de migracion_m_g_columnas.sql. Es idempotente.
-- ============================================================

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
    -- Puntos de CADA pronóstico individual (puede haber 2 por partido).
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
  -- Desempate: total, luego más marcadores exactos (M), luego más
  -- ganadores (G); el nombre solo como criterio estable final.
  order by total desc, marcadores desc, ganadores desc, pr.nombre asc;
$$;

grant execute on function get_leaderboard() to anon, authenticated;
