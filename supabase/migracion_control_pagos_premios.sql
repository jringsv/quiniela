-- ============================================================
--  migracion_control_pagos_premios.sql
--  CONTROL DE PAGOS: columnas informativas de PREMIOS por usuario
--
--  Agrega al resumen de get_control_pagos() dos columnas SOLO INFORMATIVAS
--  (no afectan el cálculo de "disponible", que sigue siendo
--  dinero_pagado − pronosticos_enviados):
--
--    - premios_ganados : total que el usuario HA GANADO en premios, es decir
--                        la suma de premio_por_ganador de cada partido donde
--                        acertó el marcador exacto (incluye el acumulado).
--    - premios_pagados : de lo anterior, cuánto ya se le ha PAGADO (los
--                        premios marcados como pagados por el admin).
--
--  Reutiliza get_premios_marcador() (que ya resuelve el reparto y la
--  acumulación entre partidos) y desglosa su columna jsonb "ganadores"
--  por usuario, así no se duplica esa lógica aquí.
--
--  Ejecutar DESPUÉS de:
--    migracion_control_pagos.sql, migracion_premios_acumulado.sql
--  Es idempotente. Cambia el tipo de retorno, por eso hace DROP primero.
-- ============================================================

drop function if exists get_control_pagos();

create or replace function get_control_pagos()
returns table (
  user_id              uuid,
  nombre               text,
  pronosticos_enviados int,
  dinero_pagado        numeric,
  disponible           numeric,
  premios_ganados      numeric,   -- informativo: total ganado en premios
  premios_pagados      numeric    -- informativo: de lo ganado, cuánto se pagó
)
language sql stable security definer set search_path = public as $$
  with enviados as (
    -- Cada marcador (slot) cuenta $1 si: el partido ya cerró, está digitado
    -- (toda fila de pred_partidos lo está) y la persona es participante.
    select pp.user_id, count(*)::int as n
    from pred_partidos pp
    join partido_usuario pu
      on pu.partido_id = pp.partido_id and pu.user_id = pp.user_id
    where partido_locked(pp.partido_id)
    group by pp.user_id
  ),
  pagado as (
    select user_id, coalesce(sum(monto), 0) as total
    from pagos
    group by user_id
  ),
  premios as (
    -- Desglosa los ganadores de cada partido (jsonb) por usuario y suma el
    -- premio que le tocó; "pagado" marca si ese premio ya fue abonado.
    select
      (gan->>'user_id')::uuid                                  as user_id,
      coalesce(sum(pm.premio_por_ganador), 0)                  as ganados,
      coalesce(sum(pm.premio_por_ganador)
               filter (where (gan->>'pagado')::boolean), 0)    as pagados
    from get_premios_marcador() pm
    cross join lateral jsonb_array_elements(pm.ganadores) gan
    group by (gan->>'user_id')::uuid
  )
  select
    pr.id,
    pr.nombre,
    coalesce(e.n, 0)::int                                   as pronosticos_enviados,
    coalesce(pg.total, 0)::numeric                          as dinero_pagado,
    (coalesce(pg.total, 0) - coalesce(e.n, 0))::numeric     as disponible,
    coalesce(prm.ganados, 0)::numeric                       as premios_ganados,
    coalesce(prm.pagados, 0)::numeric                       as premios_pagados
  from profiles pr
  left join enviados e   on e.user_id = pr.id
  left join pagado   pg  on pg.user_id = pr.id
  left join premios  prm on prm.user_id = pr.id
  where (pr.aprobado or pr.is_admin)
    and is_approved(auth.uid())          -- debe estar autorizado para ver algo
    -- El admin ve a TODOS; un usuario normal solo ve SU propio saldo.
    and (is_admin(auth.uid()) or pr.id = auth.uid())
  -- Primero quienes ya enviaron pronósticos; los de 0 enviados quedan al final.
  order by (coalesce(e.n, 0) = 0) asc, disponible asc, pr.nombre asc;
$$;

revoke all on function get_control_pagos() from public;
grant execute on function get_control_pagos() to authenticated;

-- ============================================================
--  LISTO.
-- ============================================================
