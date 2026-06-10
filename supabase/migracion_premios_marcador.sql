-- ============================================================
--  migracion_premios_marcador.sql
--  PREMIOS EN DINERO POR MARCADOR EXACTO
--
--  Regla:
--   - Se recauda $1 por CADA marcador que cumpla DOS condiciones: que la persona
--     esté marcada como PARTICIPANTE de ese partido (partido_usuario) y que haya
--     METIDO el marcador (no vacío). Cada slot cuenta, así que un participante con
--     2 pronósticos aporta $2. (Esto excluye pronósticos que un admin haya guardado
--     en partidos donde no es participante.) NO importa si el partido "aplica" (3/1).
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
    -- Cuenta un marcador SOLO si la persona: (1) está autorizada,
    -- (2) está marcada como PARTICIPANTE de ese partido (partido_usuario) y
    -- (3) digitó el marcador (cada fila de pred_partidos = un marcador = $1).
    -- El join con partido_usuario es clave: excluye los pronósticos que un
    -- admin haya guardado en partidos donde NO fue activado como participante.
    select pp.partido_id, pp.user_id, pp.gol_local, pp.gol_visitante
    from pred_partidos pp
    join profiles pr        on pr.id = pp.user_id and (pr.aprobado or pr.is_admin)
    join partido_usuario pu on pu.partido_id = pp.partido_id and pu.user_id = pp.user_id
  ),
  jugados as (
    -- CUALQUIER partido ya jugado (con resultado real), SIN importar si "aplica"
    -- para los puntos 3/1. Lo que define el bote es que la persona haya metido su
    -- marcador (cada fila de pred_partidos es un marcador no vacío = $1).
    select p.id, p.numero, p.fase, p.grupo, p.equipo_local, p.equipo_visitante,
           p.gol_local, p.gol_visitante, p.fecha
    from partidos p
    where p.gol_local is not null
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
