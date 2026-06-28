-- ============================================================
--  migracion_premios_acumulado_simultaneos.sql
--  ACUMULACIÓN DEL PREMIO ENTRE BLOQUES DE PARTIDOS SIMULTÁNEOS
--
--  Reemplaza la acumulación "partido a partido" de
--  migracion_premios_acumulado.sql por una acumulación "bloque a bloque",
--  donde un BLOQUE = todos los partidos que se juegan a la MISMA hora
--  (mismo `partidos.fecha`).
--
--  Regla nueva (la del concurso para partidos simultáneos):
--    1. Los partidos del MISMO bloque NO se acumulan entre sí. Un partido
--       sin ganador NO le pasa su premio a su pareja simultánea.
--    2. El premio sin repartir viaja al SIGUIENTE bloque (la siguiente hora).
--    3. Al llegar a un bloque, ese acumulado se reparte en partes IGUALES
--       SOLO entre los partidos de ese bloque que SÍ tuvieron ganador.
--         - 2 partidos del bloque con ganador -> mitad y mitad.
--         - 1 solo con ganador -> recibe todo el acumulado.
--    4. Cada partido conserva su propia base (75%) para SUS propios ganadores;
--       solo el acumulado HEREDADO de bloques previos se divide por igual.
--    5. Si un bloque entero queda SIN ningún ganador, todo (el acumulado que
--       entró + las bases de ese bloque) sigue viajando al siguiente bloque.
--
--  Ejemplo:
--    1 pm  -> Partido A (sin ganador, base $10) y Partido B (con ganador).
--             A NO le pasa nada a B. Los $10 de A viajan al bloque de las 3 pm.
--    3 pm  -> Partido C y Partido D (ambos con ganador).
--             Reciben los $10: $5 para C y $5 para D, además de su propia base.
--    (Si a las 3 pm solo C tuviera ganador, C recibiría los $10 completos.)
--
--  Implementación: mismo problema de "islas" (gaps & islands), pero a nivel de
--  BLOQUE (agrupando por `fecha`) en vez de a nivel de partido. El acumulado
--  que un bloque-con-ganador recibe es la suma de las bases sin ganador desde
--  el último bloque que tuvo ganador. Como ese prefijo es monótono no
--  decreciente, el máximo entre los bloques-con-ganador previos coincide con el
--  más reciente, lo que evita una subconsulta correlacionada.
--
--  El contrato de columnas NO cambia (mismas que get_premios_marcador()):
--    - premio_total      : base 75% de ESTE partido (sin cambios).
--    - premio_acumulado  : la PARTE del acumulado heredado que le toca a este
--                          partido. Solo > 0 en partidos con ganador; es
--                          acum_entrante_del_bloque / (n.º de partidos del
--                          bloque con ganador).
--    - premio_a_repartir : premio_total + premio_acumulado.
--    - premio_por_ganador: premio_a_repartir / n_ganadores.
--
--  NOTA de redondeo: la parte de cada partido se redondea a 2 decimales. Con
--  montos de centavos impares, las mitades pueden diferir 1 centavo del total
--  exacto (p. ej. $10.01 / 2 -> $5.01 + $5.01 = $10.02). Es el mismo criterio
--  de redondeo que ya usaba premio_por_ganador.
--
--  Ejecutar DESPUÉS de: migracion_premios_acumulado.sql
--  Es idempotente.
-- ============================================================

-- Se debe DROP porque el cuerpo cambia (el tipo de retorno se mantiene igual).
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
  premio_acumulado   numeric,   -- parte del acumulado heredado que le toca
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
  -- ----------- Acumulación a nivel de BLOQUE (partidos simultáneos) -----------
  slots as (
    -- Un BLOQUE por cada `fecha` (misma hora = simultáneos). Por bloque:
    --   base_sin_ganador  = suma de las bases de SUS partidos sin ganador
    --                       (lo que el bloque aporta hacia adelante).
    --   n_part_ganadores  = cuántos partidos del bloque tuvieron ganador
    --                       (entre cuántos se reparte el acumulado entrante).
    select
      b.fecha,
      bool_or(b.tuvo_ganador)                                         as slot_tiene_ganador,
      coalesce(sum(b.premio_base) filter (where not b.tuvo_ganador), 0) as base_sin_ganador,
      count(*) filter (where b.tuvo_ganador)                          as n_part_ganadores
    from base b
    group by b.fecha
  ),
  slots_pref as (
    -- pre_prefijo = suma de las bases sin ganador de TODOS los bloques previos
    -- (en orden cronológico). Es monótono no decreciente (las bases son >= 0).
    select s.*,
      coalesce(
        sum(s.base_sin_ganador)
          over (order by s.fecha rows between unbounded preceding and 1 preceding),
        0
      ) as pre_prefijo
    from slots s
  ),
  slots_acc as (
    -- base_en_ult_ganador = pre_prefijo del ÚLTIMO bloque CON ganador anterior a
    -- este. Como pre_prefijo es monótono no decreciente, el máximo entre los
    -- bloques-con-ganador previos = el más reciente.
    select sp.*,
      coalesce(
        max(case when sp.slot_tiene_ganador then sp.pre_prefijo end)
          over (order by sp.fecha rows between unbounded preceding and 1 preceding),
        0
      ) as base_en_ult_ganador
    from slots_pref sp
  ),
  slots_final as (
    -- acum_entrante = lo acumulado desde el último bloque con ganador, que ESTE
    -- bloque debe repartir entre sus partidos con ganador.
    select
      sa.fecha,
      sa.n_part_ganadores,
      (sa.pre_prefijo - sa.base_en_ult_ganador) as acum_entrante
    from slots_acc sa
  )
  select
    b.id, b.numero, b.fase, b.grupo, b.equipo_local, b.equipo_visitante,
    b.gol_local, b.gol_visitante, b.fecha,
    b.n_pron::int                                   as n_pronosticos,
    b.n_pron::numeric                               as bote,
    b.premio_base                                   as premio_total,
    -- La parte del acumulado HEREDADO que le toca a este partido: solo si tuvo
    -- ganador, repartida por igual entre los partidos del bloque con ganador.
    case when b.tuvo_ganador and sf.n_part_ganadores > 0
         then round(sf.acum_entrante / sf.n_part_ganadores, 2)
         else 0 end                                 as premio_acumulado,
    (b.premio_base
      + case when b.tuvo_ganador and sf.n_part_ganadores > 0
             then round(sf.acum_entrante / sf.n_part_ganadores, 2)
             else 0 end)                            as premio_a_repartir,
    b.n_gan::int                                    as n_ganadores,
    case when b.n_gan > 0
         then round(
                (b.premio_base
                  + case when b.tuvo_ganador and sf.n_part_ganadores > 0
                         then round(sf.acum_entrante / sf.n_part_ganadores, 2)
                         else 0 end) / b.n_gan, 2)
         else 0 end                                 as premio_por_ganador,
    coalesce(b.nombres, '[]'::jsonb)                as ganadores,
    (b.n_gan > 0 and b.n_pagados = b.n_gan)         as todos_pagados
  from base b
  join slots_final sf on sf.fecha is not distinct from b.fecha
  order by b.fecha, b.numero;   -- cronológico, numero solo como desempate visual
$$;

grant execute on function get_premios_marcador() to anon, authenticated;
