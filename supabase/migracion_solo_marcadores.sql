-- ============================================================
--  migracion_solo_marcadores.sql
--  NUEVAS REGLAS DE PUNTAJE
--  El total se calcula ÚNICAMENTE con los marcadores de los
--  partidos (todas las fases que tengan aplica_quiniela = true):
--    • Marcador exacto (goles) .............. 3 puntos
--    • Acertar el resultado (gane o empate) . 1 punto
--
--  Se ELIMINAN del puntaje las Fases (avance) y las Posiciones.
--  Las predicciones de llaves se siguen guardando para armar
--  las tablas y los cruces de cada usuario, pero ya NO otorgan
--  puntos.
--
--  Ejecutar este script DESPUÉS de migracion_aprobacion.sql.
-- ============================================================

-- La firma cambia (menos columnas), así que hay que soltar la
-- función anterior antes de recrearla.
drop function if exists get_leaderboard();

create or replace function get_leaderboard()
returns table (
  nombre        text,
  pts_partidos  int,
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
      ) as pts
    from pred_partidos pp
    join partidos p on p.id = pp.partido_id
    group by pp.user_id
  )
  select
    pr.nombre,
    coalesce(mp.pts, 0)::int as pts_partidos,
    coalesce(mp.pts, 0)::int as total
  from profiles pr
  left join mp on mp.user_id = pr.id
  where pr.aprobado or pr.is_admin
  order by total desc, pr.nombre asc;
$$;
