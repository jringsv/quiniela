-- ============================================================
--  migracion_premios_pagado.sql
--  MARCAR PREMIOS COMO PAGADOS (solo administradores)
--
--  Permite que un admin marque, junto a CADA ganador de un partido, un
--  "chequesito" de PAGADO. Cuando TODOS los ganadores de un partido están
--  marcados, ese partido queda como "pagado" (bandera todos_pagados).
--
--  - Los administradores pueden marcar/desmarcar (editar).
--  - El resto de usuarios solo CONSULTA (ve el estado, no lo cambia).
--
--  Reescribe get_premios_marcador() para que "ganadores" sea un JSONB con
--  { user_id, nombre, pagado } y agrega la bandera "todos_pagados".
--
--  Ejecutar DESPUÉS de: migracion_premios_marcador.sql
--  Es idempotente.
-- ============================================================

-- ---------- Tabla: estado de pago por ganador/partido ----------
create table if not exists premio_pagado (
  partido_id  bigint  not null references partidos(id) on delete cascade,
  user_id     uuid    not null references auth.users(id) on delete cascade,
  pagado      boolean not null default true,
  marcado_por uuid,
  marcado_en  timestamptz not null default now(),
  primary key (partido_id, user_id)
);

alter table premio_pagado enable row level security;

-- Todos los autenticados pueden CONSULTAR el estado de pago.
drop policy if exists premio_pagado_sel on premio_pagado;
create policy premio_pagado_sel on premio_pagado
  for select to authenticated using (true);

-- Solo administradores pueden escribir directamente (la escritura normal va por
-- el RPC set_premio_pagado, pero dejamos la política coherente por seguridad).
drop policy if exists premio_pagado_admin on premio_pagado;
create policy premio_pagado_admin on premio_pagado
  for all to authenticated
  using (is_admin(auth.uid()))
  with check (is_admin(auth.uid()));

-- ---------- RPC: marcar/desmarcar UN ganador ----------
create or replace function set_premio_pagado(
  p_partido_id bigint,
  p_user_id    uuid,
  p_pagado     boolean
) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not is_admin(auth.uid()) then
    raise exception 'Solo los administradores pueden marcar premios como pagados';
  end if;

  if p_pagado then
    insert into premio_pagado (partido_id, user_id, pagado, marcado_por, marcado_en)
    values (p_partido_id, p_user_id, true, auth.uid(), now())
    on conflict (partido_id, user_id)
    do update set pagado = true, marcado_por = auth.uid(), marcado_en = now();
  else
    -- Desmarcar = quitar el registro (ausencia = no pagado).
    delete from premio_pagado
    where partido_id = p_partido_id and user_id = p_user_id;
  end if;
end;
$$;

grant execute on function set_premio_pagado(bigint, uuid, boolean) to authenticated;

-- ---------- RPC: marcar/desmarcar TODO un partido a la vez ----------
-- Conveniencia: marca (o desmarca) a TODOS los ganadores de un partido.
-- Solo afecta a quienes realmente acertaron el marcador exacto.
create or replace function set_premio_partido_pagado(
  p_partido_id bigint,
  p_pagado     boolean
) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not is_admin(auth.uid()) then
    raise exception 'Solo los administradores pueden marcar premios como pagados';
  end if;

  if p_pagado then
    -- Inserta/actualiza a TODOS los ganadores del partido como pagados.
    insert into premio_pagado (partido_id, user_id, pagado, marcado_por, marcado_en)
    select g.partido_id, g.user_id, true, auth.uid(), now()
    from (
      select pp.partido_id, pp.user_id
      from pred_partidos pp
      join profiles pr        on pr.id = pp.user_id and (pr.aprobado or pr.is_admin)
      join partido_usuario pu on pu.partido_id = pp.partido_id and pu.user_id = pp.user_id
      join partidos p         on p.id = pp.partido_id
      where pp.partido_id = p_partido_id
        and p.gol_local is not null and p.gol_visitante is not null
        and pp.gol_local = p.gol_local and pp.gol_visitante = p.gol_visitante
      group by pp.partido_id, pp.user_id
    ) g
    on conflict (partido_id, user_id)
    do update set pagado = true, marcado_por = auth.uid(), marcado_en = now();
  else
    delete from premio_pagado where partido_id = p_partido_id;
  end if;
end;
$$;

grant execute on function set_premio_partido_pagado(bigint, boolean) to authenticated;

-- ---------- Reescritura de get_premios_marcador() ----------
-- Cambia "ganadores" de text[] a jsonb [{ user_id, nombre, pagado }] y agrega
-- "todos_pagados" (true solo si hay ganadores y TODOS están pagados).
-- Se debe DROP porque cambia el tipo de retorno.
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
  premio_total       numeric,
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
    coalesce(g.nombres, '[]'::jsonb)                as ganadores,
    (coalesce(g.n_gan, 0) > 0 and g.n_pagados = g.n_gan) as todos_pagados
  from jugados j
  join bote b      on b.id = j.id
  left join gan_agg g on g.partido_id = j.id
  order by j.numero;
$$;

grant execute on function get_premios_marcador() to anon, authenticated;
