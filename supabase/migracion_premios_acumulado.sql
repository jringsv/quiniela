-- ============================================================
--  migracion_premios_acumulado.sql
--  ACUMULACIÓN DEL PREMIO ENTRE PARTIDOS
--
--  Regla del concurso:
--    "Un partido sin acierto se acumulará el premio para el
--     siguiente partido."
--
--  Hasta ahora, cuando un partido NO tenía ganador (nadie acertó el
--  marcador exacto), su premio (el 75% del bote) simplemente NO se
--  repartía y se perdía. Esto corrige ese comportamiento:
--
--    - Si un partido queda SIN ganador, su premio (75%) se ACUMULA.
--    - Ese acumulado se suma al SIGUIENTE partido (en orden de número)
--      que SÍ tenga ganador(es), y se reparte entre ellos.
--    - Si varios partidos seguidos quedan sin ganador, TODOS se
--      acumulan hasta el próximo partido con ganador.
--
--  Ejemplo (tres partidos seguidos):
--    Partido 1: sin ganador  -> su 75% se acumula
--    Partido 2: sin ganador  -> su 75% + lo acumulado se sigue acumulando
--    Partido 3: con ganador  -> reparte SU 75% + todo lo acumulado de 1 y 2
--
--  Reescribe get_premios_marcador() agregando dos columnas:
--    - premio_acumulado  : monto traído de partidos previos sin ganador
--    - premio_a_repartir  : premio_total (base 75%) + premio_acumulado
--                           (lo que se reparte si hay ganador; lo que se
--                            sigue acumulando si no lo hay)
--
--  El cálculo de "premio_por_ganador" ahora usa premio_a_repartir.
--
--  Implementación: problema clásico de "islas" (gaps & islands). Cada
--  isla agrupa los partidos sin ganador con el siguiente partido con
--  ganador que los cierra. La isla se identifica por la cantidad de
--  partidos CON ganador que ocurrieron ANTES.
--
--  IMPORTANTE: el orden de acumulación es CRONOLÓGICO (por `partidos.fecha`,
--  con `numero` solo como desempate), NO por `numero`. El número de partido
--  no siempre coincide con el orden en que se juegan: p. ej. el 13/06 se jugó
--  Qatar–Suiza (#8, 13:00) y Brasil–Marruecos (#7, 16:00) ANTES que
--  Haití–Escocia (#5, 19:00), así que el acumulado de los dos primeros debe
--  caer en Haití–Escocia y limpiarse ahí.
--
--  Ejecutar DESPUÉS de: migracion_premios_pagado.sql
--  Es idempotente.
-- ============================================================

-- Se debe DROP porque cambia el tipo de retorno (agrega columnas).
drop function if exists get_premios_marcador();

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
  n_pronosticos      int,
  bote               numeric,
  premio_total       numeric,   -- base: 75% del bote de ESTE partido
  premio_acumulado   numeric,   -- traído de partidos previos sin ganador
  premio_a_repartir  numeric,   -- premio_total + premio_acumulado
  n_ganadores        int,
  premio_por_ganador numeric,
  ganadores          jsonb,     -- [{ user_id, nombre, pagado }] (orden alfabético)
  todos_pagados      boolean    -- true si hay ganadores y TODOS están pagados
)
language sql stable security definer set search_path = public as $$
  with elegibles as (
    select pp.partido_id, pp.user_id, pp.gol_local, pp.gol_visitante
    from pred_partidos pp
    join profiles pr        on pr.id = pp.user_id and (pr.aprobado or pr.is_admin)
    join partido_usuario pu on pu.partido_id = pp.partido_id and pu.user_id = pp.user_id
  ),
  jugados as (
    select p.id, p.numero, p.fase, p.grupo, p.equipo_local, p.equipo_visitante,
           p.gol_local, p.gol_visitante, p.fecha
    from partidos p
    where p.gol_local is not null
      and p.gol_visitante is not null
  ),
  bote as (
    select j.id, count(e.user_id) as n_pron
    from jugados j
    join elegibles e on e.partido_id = j.id
    group by j.id
  ),
  ganadores as (
    -- Persona que acertó el marcador exacto (cuenta una sola vez por partido),
    -- junto con su estado de pago (left join a premio_pagado).
    select j.id as partido_id, pr.id as user_id, pr.nombre,
           coalesce(pg.pagado, false) as pagado
    from jugados j
    join elegibles e on e.partido_id = j.id
      and e.gol_local = j.gol_local
      and e.gol_visitante = j.gol_visitante
    join profiles pr on pr.id = e.user_id
    left join premio_pagado pg on pg.partido_id = j.id and pg.user_id = pr.id
    group by j.id, pr.id, pr.nombre, pg.pagado
  ),
  gan_agg as (
    select partido_id,
           count(*)                          as n_gan,
           count(*) filter (where pagado)    as n_pagados,
           jsonb_agg(
             jsonb_build_object('user_id', user_id, 'nombre', nombre, 'pagado', pagado)
             order by nombre
           )                                 as nombres
    from ganadores
    group by partido_id
  ),
  base as (
    -- Una fila por partido jugado: su base (75%) y si tuvo ganador.
    select
      j.id, j.numero, j.fase, j.grupo, j.equipo_local, j.equipo_visitante,
      j.gol_local, j.gol_visitante, j.fecha,
      b.n_pron,
      round(b.n_pron * 0.75, 2)            as premio_base,
      coalesce(g.n_gan, 0)                 as n_gan,
      g.n_pagados,
      g.nombres,
      (coalesce(g.n_gan, 0) > 0)           as tuvo_ganador
    from jugados j
    join bote b         on b.id = j.id
    left join gan_agg g on g.partido_id = j.id
  ),
  islas as (
    -- isla = cantidad de partidos CON ganador ANTES de este (orden CRONOLÓGICO
    -- por fecha, con numero como desempate). Así, los partidos sin ganador
    -- comparten isla con el siguiente partido con ganador (que es la última
    -- fila de la isla, pues cerrarla incrementa el contador para la siguiente).
    select *,
      coalesce(
        sum(case when tuvo_ganador then 1 else 0 end)
          over (order by fecha, numero rows between unbounded preceding and 1 preceding),
        0
      ) as isla
    from base
  ),
  acum as (
    -- premio_acumulado = suma de las bases (75%) de los partidos PREVIOS
    -- de la misma isla (todos ellos sin ganador), en orden cronológico.
    select *,
      coalesce(
        sum(premio_base)
          over (partition by isla order by fecha, numero
                rows between unbounded preceding and 1 preceding),
        0
      ) as premio_acumulado
    from islas
  )
  select
    a.id, a.numero, a.fase, a.grupo, a.equipo_local, a.equipo_visitante,
    a.gol_local, a.gol_visitante, a.fecha,
    a.n_pron::int                                   as n_pronosticos,
    a.n_pron::numeric                               as bote,
    a.premio_base                                   as premio_total,
    a.premio_acumulado                              as premio_acumulado,
    (a.premio_base + a.premio_acumulado)            as premio_a_repartir,
    a.n_gan::int                                    as n_ganadores,
    case when a.n_gan > 0
         then round((a.premio_base + a.premio_acumulado) / a.n_gan, 2)
         else 0 end                                 as premio_por_ganador,
    coalesce(a.nombres, '[]'::jsonb)                as ganadores,
    (a.n_gan > 0 and a.n_pagados = a.n_gan)         as todos_pagados
  from acum a
  order by a.fecha, a.numero;   -- cronológico: igual que la acumulación
$$;

grant execute on function get_premios_marcador() to anon, authenticated;
