-- ============================================================
--  migracion_control_pagos.sql
--  CONTROL DE PAGOS POR USUARIO (solo admin)
--
--  Idea:
--   - Cada PRONÓSTICO ENVIADO cuesta $1 (igual que el bote de premios).
--   - Un pronóstico se considera ENVIADO cuando:
--       (1) el partido YA CERRÓ (partido_locked = 15 min antes del juego), y
--       (2) el usuario registró un marcador NO vacío (cada fila de
--           pred_partidos = un marcador no vacío = $1), y
--       (3) el usuario estaba ACTIVADO como participante de ese partido
--           (partido_usuario). Así no se cobran pronósticos que un admin
--           haya guardado en partidos donde no participa, y coincide con
--           el dinero que recauda get_premios_marcador().
--   - El admin registra cuánto DINERO ha PAGADO cada usuario (tabla pagos).
--   - DISPONIBLE = dinero_pagado − pronosticos_enviados.
--       * Si puso más pronósticos de los que pagó => negativo (en rojo en la UI).
--
--  Expone get_control_pagos() (security definer: necesita leer TODAS las
--  predicciones, que el RLS normalmente oculta). El ADMIN ve a todos; un usuario
--  normal AUTORIZADO solo ve SU propio saldo (solo lectura). Solo el admin puede
--  REGISTRAR/borrar pagos (RLS de la tabla pagos). Los usuarios con 0 pronósticos
--  enviados se ordenan al final.
--
--  Ejecutar DESPUÉS de:
--    schema.sql, migracion_lock_por_partido.sql,
--    migracion_dos_pred_y_activacion.sql, migracion_npred_por_activacion.sql
--  Es idempotente.
-- ============================================================

-- ------------------------------------------------------------
--  PAGOS registrados por el admin (cuánto ha pagado cada usuario)
-- ------------------------------------------------------------
create table if not exists pagos (
  id         bigserial primary key,
  user_id    uuid        not null references auth.users(id) on delete cascade,
  monto      numeric     not null check (monto <> 0),
  nota       text,
  created_by uuid        references auth.users(id),
  created_at timestamptz not null default now()
);
create index if not exists pagos_user_idx on pagos(user_id);

alter table pagos enable row level security;

-- Solo el admin lee y escribe los pagos.
drop policy if exists "pagos admin" on pagos;
create policy "pagos admin" on pagos for all
  using (is_admin(auth.uid())) with check (is_admin(auth.uid()));

-- ------------------------------------------------------------
--  RESUMEN: enviados, pagado y disponible por usuario
-- ------------------------------------------------------------
create or replace function get_control_pagos()
returns table (
  user_id              uuid,
  nombre               text,
  pronosticos_enviados int,
  dinero_pagado        numeric,
  disponible           numeric
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
  )
  select
    pr.id,
    pr.nombre,
    coalesce(e.n, 0)::int                                   as pronosticos_enviados,
    coalesce(pg.total, 0)::numeric                          as dinero_pagado,
    (coalesce(pg.total, 0) - coalesce(e.n, 0))::numeric     as disponible
  from profiles pr
  left join enviados e on e.user_id = pr.id
  left join pagado   pg on pg.user_id = pr.id
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
