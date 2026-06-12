-- ============================================================
--  migracion_superadmin_pospartido.sql
--  EXCEPCIÓN DE SUPERADMIN: registrar/corregir el pronóstico de
--  un usuario en un partido YA CERRADO o TERMINADO.
--
--  Contexto: en el primer partido una usuaria no pudo guardar su
--  marcador a tiempo. Se acordó registrárselo pos-partido. Esta
--  migración habilita SOLO al superadministrador (por correo) para
--  hacerlo, dejando SIEMPRE un registro de auditoría con el motivo
--  (mínimo 30 caracteres).
--
--  Importante: la RLS de pred_partidos exige auth.uid() = user_id en
--  TODA escritura, así que ni siquiera un admin puede escribir el
--  pronóstico de OTRO usuario por la vía normal. Por eso se hace con
--  una función SECURITY DEFINER que valida al superadmin y audita.
--
--  Ejecutar DESPUÉS de:
--    schema.sql, migracion_lock_por_partido.sql,
--    migracion_dos_pred_y_activacion.sql, migracion_npred_por_activacion.sql,
--    migracion_borrar_usuarios.sql
--  Es idempotente.
-- ============================================================

-- ------------------------------------------------------------
--  ¿Quién es el superadmin? (se identifica por su correo)
--  Si algún día cambia el correo, solo edita esta función.
-- ------------------------------------------------------------
create or replace function is_superadmin(uid uuid) returns boolean
  language sql stable security definer set search_path = public, auth as $$
  select coalesce(
    (select lower(email) = 'jrobertoma@gmail.com' from auth.users where id = uid),
    false)
$$;

-- ------------------------------------------------------------
--  BITÁCORA DE AUDITORÍA: cada cambio pos-partido queda registrado
--  con el valor anterior, el nuevo, quién lo hizo y el motivo.
-- ------------------------------------------------------------
create table if not exists pred_override_log (
  id                 bigserial primary key,
  superadmin_id      uuid   not null references auth.users(id),
  target_user        uuid   not null references auth.users(id) on delete cascade,
  partido_id         bigint not null references partidos(id)   on delete cascade,
  slot               smallint not null,
  gol_local          int not null,
  gol_visitante      int not null,
  gol_local_prev     int,                 -- NULL = el usuario no tenía pronóstico previo
  gol_visitante_prev int,
  motivo             text not null,
  created_at         timestamptz not null default now()
);

alter table pred_override_log enable row level security;
-- Solo lectura, y solo para administradores. La ESCRITURA jamás pasa por
-- RLS: se hace exclusivamente dentro de la función SECURITY DEFINER de abajo.
drop policy if exists "pol select" on pred_override_log;
create policy "pol select" on pred_override_log for select
  using (is_admin(auth.uid()));

-- ------------------------------------------------------------
--  REGISTRAR / CORREGIR el pronóstico de un usuario pos-partido.
--  Solo el superadmin. Exige motivo >= 30 caracteres. Audita todo.
-- ------------------------------------------------------------
create or replace function admin_set_pronostico_pospartido(
  p_user          uuid,
  p_partido       bigint,
  p_slot          smallint,
  p_gol_local     int,
  p_gol_visitante int,
  p_motivo        text
) returns void
language plpgsql
security definer
set search_path = public, auth as $$
declare
  v_motivo text := trim(coalesce(p_motivo, ''));
  v_npred  smallint;
  v_prev_l int;
  v_prev_v int;
begin
  -- 1) Solo el superadministrador.
  if not is_superadmin(auth.uid()) then
    raise exception 'Solo el superadministrador puede registrar pronósticos pos-partido.';
  end if;

  -- 2) Motivo obligatorio de al menos 30 caracteres.
  if char_length(v_motivo) < 30 then
    raise exception 'El motivo debe tener al menos 30 caracteres (actual: %).', char_length(v_motivo);
  end if;

  -- 3) Validaciones del marcador.
  if p_slot not in (1, 2) then
    raise exception 'El pronóstico debe ser 1 o 2.';
  end if;
  if p_gol_local is null or p_gol_visitante is null
     or p_gol_local < 0 or p_gol_visitante < 0
     or p_gol_local > 99 or p_gol_visitante > 99 then
    raise exception 'Marcador inválido: los goles deben estar entre 0 y 99.';
  end if;

  -- 4) El usuario destino debe estar autorizado para participar.
  if not coalesce((select aprobado or is_admin from profiles where id = p_user), false) then
    raise exception 'El usuario destino no está autorizado para participar.';
  end if;

  -- 5) El usuario debe estar activado con cupo para ese pronóstico
  --    (1 ó 2). Si no, hay que activarlo antes en "Participantes".
  v_npred := user_npred(p_partido, p_user);
  if p_slot > v_npred then
    raise exception 'El usuario no está activado para el pronóstico % en este partido (cupo actual: %). Actívalo primero en Participantes.', p_slot, v_npred;
  end if;

  -- 6) Los dos pronósticos del mismo usuario no pueden ser idénticos.
  if exists (
    select 1 from pred_partidos
    where user_id = p_user and partido_id = p_partido and slot <> p_slot
      and gol_local = p_gol_local and gol_visitante = p_gol_visitante
  ) then
    raise exception 'Los dos pronósticos del usuario deben ser diferentes.';
  end if;

  -- Valor anterior (para la auditoría) antes de sobrescribir.
  select gol_local, gol_visitante into v_prev_l, v_prev_v
    from pred_partidos
    where user_id = p_user and partido_id = p_partido and slot = p_slot;

  -- 7) Escribe el pronóstico (crea o actualiza ese slot).
  insert into pred_partidos (user_id, partido_id, slot, gol_local, gol_visitante, updated_at)
    values (p_user, p_partido, p_slot, p_gol_local, p_gol_visitante, now())
  on conflict (user_id, partido_id, slot) do update
    set gol_local     = excluded.gol_local,
        gol_visitante = excluded.gol_visitante,
        updated_at    = now();

  -- 8) Auditoría.
  insert into pred_override_log
    (superadmin_id, target_user, partido_id, slot, gol_local, gol_visitante,
     gol_local_prev, gol_visitante_prev, motivo)
  values
    (auth.uid(), p_user, p_partido, p_slot, p_gol_local, p_gol_visitante,
     v_prev_l, v_prev_v, v_motivo);
end $$;

revoke all on function admin_set_pronostico_pospartido(uuid, bigint, smallint, int, int, text) from public;
grant execute on function admin_set_pronostico_pospartido(uuid, bigint, smallint, int, int, text) to authenticated;

-- ------------------------------------------------------------
--  HISTORIAL legible para el panel de admin (últimos 100 cambios).
--  Lo puede leer cualquier admin (auditoría compartida).
-- ------------------------------------------------------------
create or replace function admin_list_overrides()
returns table (
  created_at  timestamptz,
  superadmin  text,
  usuario     text,
  partido_no  int,
  partido     text,
  slot        smallint,
  marcador    text,
  anterior    text,
  motivo      text
)
language sql
security definer
set search_path = public, auth as $$
  select
    l.created_at,
    coalesce(sp.nombre, su.email::text)            as superadmin,
    coalesce(tp.nombre, tu.email::text)            as usuario,
    p.numero                                       as partido_no,
    (p.equipo_local || ' vs ' || p.equipo_visitante) as partido,
    l.slot,
    (l.gol_local || '-' || l.gol_visitante)        as marcador,
    case when l.gol_local_prev is null then '(sin pronóstico)'
         else (l.gol_local_prev || '-' || l.gol_visitante_prev) end as anterior,
    l.motivo
  from pred_override_log l
  join partidos p                on p.id = l.partido_id
  left join profiles sp          on sp.id = l.superadmin_id
  left join auth.users su        on su.id = l.superadmin_id
  left join profiles tp          on tp.id = l.target_user
  left join auth.users tu        on tu.id = l.target_user
  where is_admin(auth.uid())     -- si no es admin, no devuelve filas
  order by l.created_at desc
  limit 100;
$$;

revoke all on function admin_list_overrides() from public;
grant execute on function admin_list_overrides() to authenticated;

-- ============================================================
--  LISTO.
-- ============================================================
