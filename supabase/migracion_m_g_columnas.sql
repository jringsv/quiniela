-- ============================================================
--  migracion_m_g_columnas.sql
--  Agrega a la tabla de posiciones dos conteos por jugador:
--    • M (marcadores) ... # de partidos con MARCADOR EXACTO (3 pts)
--    • G (ganadores) .... # de partidos donde acertó solo el
--                         RESULTADO / ganador o empate (1 pt)
--
--  Además, el desempate (cuando dos jugadores tienen el mismo
--  total de puntos) ya NO es alfabético: ahora ordena por más
--  marcadores exactos (M) y, si persiste el empate, por más
--  ganadores acertados (G). El nombre queda solo como último
--  criterio estable.
--
--  Ejecutar DESPUÉS de migracion_solo_marcadores.sql.
-- ============================================================

-- La firma cambia (dos columnas nuevas), así que hay que soltar
-- la función anterior antes de recrearla.
drop function if exists get_leaderboard();

create or replace function get_leaderboard()
returns table (
  nombre        text,
  pts_partidos  int,
  marcadores    int,   -- M: aciertos de 3 puntos
  ganadores     int,   -- G: aciertos de 1 punto
  total         int
)
language sql stable security definer set search_path = public as $$
  with mp as (
    select pp.user_id,
      sum(
        case
          when not p.aplica_quiniela then 0
          when p.gol_local is null or p.gol_visitante is null then 0
          when pp.gol_local = p.gol_local and pp.gol_visitante = p.gol_visitante then 3
          when sign(pp.gol_local - pp.gol_visitante) = sign(p.gol_local - p.gol_visitante) then 1
          else 0
        end
      ) as pts,
      -- M: cantidad de marcadores exactos (que dieron 3 puntos)
      count(*) filter (
        where p.aplica_quiniela
          and p.gol_local is not null and p.gol_visitante is not null
          and pp.gol_local = p.gol_local and pp.gol_visitante = p.gol_visitante
      ) as m,
      -- G: cantidad de aciertos de solo resultado/ganador (1 punto),
      --    excluyendo los que ya fueron marcador exacto.
      count(*) filter (
        where p.aplica_quiniela
          and p.gol_local is not null and p.gol_visitante is not null
          and not (pp.gol_local = p.gol_local and pp.gol_visitante = p.gol_visitante)
          and sign(pp.gol_local - pp.gol_visitante) = sign(p.gol_local - p.gol_visitante)
      ) as g
    from pred_partidos pp
    join partidos p on p.id = pp.partido_id
    group by pp.user_id
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
