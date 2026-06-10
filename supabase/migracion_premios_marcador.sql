-- ============================================================
--  migracion_premios_marcador.sql
--  PREMIOS EN DINERO POR MARCADOR EXACTO
--
--  Regla:
--   - Por cada partido se recauda $1 por CADA pronóstico digitado y
--     bloqueado (cada slot cuenta; un usuario con 2 pronósticos aporta $2).
--   - El premio del partido es el 75% de lo recaudado en ESE partido.
--   - Ganan quienes acertaron el marcador EXACTO (goles local y visitante).
--   - Si hay más de un ganador, ese 75% se reparte en partes iguales.
--   - El 25% restante queda para la organización (no se reparte).
--
--  Expone get_premios_marcador() para el frontend (security definer:
--  necesita leer TODAS las predicciones, que normalmente el RLS oculta).
--  Solo revela el marcador real, el bote y los NOMBRES de los ganadores;
--  nunca las predicciones de quienes no ganaron.
--
--  Ejecutar DESPUÉS de:
--    schema.sql, migracion_dos_pred_y_activacion.sql,
--    migracion_npred_por_activacion.sql, migracion_aplica_quiniela.sql
--  Es idempotente.
-- ============================================================

create or replace function get_premios_marcador()
returns table (
  partido_id         bigint,
  numero             int,
  fase               text,
  grupo              text,
  equipo_local       text,
  equipo_visitante   text,
  gol_local          int,
  gol_visitante      int,
  fecha              timestamptz,
  n_pronosticos      int,       -- total de pronósticos digitados (= bote en $)
  bote               numeric,   -- lo recaudado ($1 por pronóstico)
  premio_total       numeric,   -- 75% del bote (se reparte entre ganadores)
  n_ganadores        int,
  premio_por_ganador numeric,   -- premio_total / n_ganadores
  ganadores          text[]     -- nombres de los ganadores (orden alfabético)
)
language sql stable security definer set search_path = public as $$
  with elegibles as (
    -- Solo cuentan las predicciones de usuarios autorizados (igual que la
    -- tabla de posiciones). Cada fila es un pronóstico digitado = $1.
    select pp.partido_id, pp.user_id, pp.gol_local, pp.gol_visitante
    from pred_partidos pp
    join profiles pr on pr.id = pp.user_id and (pr.aprobado or pr.is_admin)
  ),
  jugados as (
    -- Partidos que ya tienen resultado real y que otorgan marcador (3/1).
    select p.id, p.numero, p.fase, p.grupo, p.equipo_local, p.equipo_visitante,
           p.gol_local, p.gol_visitante, p.fecha
    from partidos p
    where p.aplica_quiniela
      and p.gol_local is not null
      and p.gol_visitante is not null
  ),
  bote as (
    select j.id, count(e.user_id) as n_pron   -- cada slot suma $1
    from jugados j
    join elegibles e on e.partido_id = j.id
    group by j.id
  ),
  ganadores as (
    -- Un ganador es una PERSONA que acertó el marcador exacto (los dos
    -- pronósticos de un partido son distintos, así que cuenta una sola vez).
    select j.id as partido_id, pr.nombre
    from jugados j
    join elegibles e on e.partido_id = j.id
      and e.gol_local = j.gol_local
      and e.gol_visitante = j.gol_visitante
    join profiles pr on pr.id = e.user_id
    group by j.id, pr.id, pr.nombre
  ),
  gan_agg as (
    select partido_id,
           count(*)                         as n_gan,
           array_agg(nombre order by nombre) as nombres
    from ganadores
    group by partido_id
  )
  select
    j.id, j.numero, j.fase, j.grupo, j.equipo_local, j.equipo_visitante,
    j.gol_local, j.gol_visitante, j.fecha,
    b.n_pron::int                                   as n_pronosticos,
    b.n_pron::numeric                               as bote,
    round(b.n_pron * 0.75, 2)                       as premio_total,
    coalesce(g.n_gan, 0)::int                       as n_ganadores,
    case when coalesce(g.n_gan, 0) > 0
         then round((b.n_pron * 0.75) / g.n_gan, 2)
         else 0 end                                 as premio_por_ganador,
    coalesce(g.nombres, '{}')                       as ganadores
  from jugados j
  join bote b      on b.id = j.id           -- solo partidos con al menos 1 pronóstico
  left join gan_agg g on g.partido_id = j.id
  order by j.numero;
$$;

grant execute on function get_premios_marcador() to anon, authenticated;
