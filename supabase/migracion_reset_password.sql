-- ============================================================
--  RESETEO DE CONTRASEÑA POR EL ADMIN + CAMBIO FORZADO AL INGRESAR
--  El admin puede asignarle a un usuario una contraseña temporal; al
--  iniciar sesión, la app le obliga a definir una nueva.
--  Ejecutar UNA VEZ en: Supabase -> SQL Editor -> New query -> Run.
--  Es idempotente.
-- ============================================================

-- pgcrypto da crypt()/gen_salt() para regenerar el hash bcrypt que usa el auth.
create extension if not exists "pgcrypto";

-- ------------------------------------------------------------
--  1) Bandera "debe cambiar la contraseña" en el perfil
-- ------------------------------------------------------------
alter table profiles
  add column if not exists must_change_password boolean not null default false;

-- ------------------------------------------------------------
--  2) Trigger de protección de campos sensibles
--     Se reemplaza para que el usuario NO pueda encender por su cuenta
--     'must_change_password' (eso es exclusivo del admin), pero SÍ pueda
--     apagarlo cuando cambia su contraseña.
-- ------------------------------------------------------------
create or replace function protect_profile_fields() returns trigger
  language plpgsql security definer set search_path = public as $$
begin
  if not is_admin(auth.uid()) then
    new.is_admin := old.is_admin;
    new.aprobado := old.aprobado;
    -- El usuario solo puede APAGAR su propio flag (al cambiar su contraseña),
    -- nunca encenderlo: encenderlo es exclusivo de admin_reset_password().
    if coalesce(new.must_change_password, false) = true
       and coalesce(old.must_change_password, false) = false then
      new.must_change_password := old.must_change_password;
    end if;
  end if;
  return new;
end $$;

-- ------------------------------------------------------------
--  3) Función: el admin resetea la contraseña de un usuario
--     - Solo un admin puede invocarla.
--     - No permite resetearse a sí mismo (usa "Salir" + recuperación normal).
--     - Reescribe el hash bcrypt en auth.users y marca must_change_password.
--     security definer => corre con privilegios del dueño (postgres), que sí
--     puede escribir en auth.users.
-- ------------------------------------------------------------
create or replace function admin_reset_password(uid uuid, new_password text)
returns void
language plpgsql
security definer
set search_path = public, auth, extensions as $$
begin
  if not is_admin(auth.uid()) then
    raise exception 'Solo un administrador puede resetear contraseñas.';
  end if;
  if uid = auth.uid() then
    raise exception 'No puedes resetear tu propia contraseña aquí.';
  end if;
  if length(coalesce(new_password, '')) < 6 then
    raise exception 'La contraseña debe tener al menos 6 caracteres.';
  end if;
  if not exists (select 1 from profiles where id = uid) then
    raise exception 'El usuario no existe.';
  end if;

  -- Regenera el hash de contraseña con el mismo algoritmo (bcrypt) que usa el auth.
  update auth.users
     set encrypted_password = crypt(new_password, gen_salt('bf')),
         updated_at         = now()
   where id = uid;

  -- Al próximo inicio de sesión, la app le pedirá cambiarla.
  update profiles
     set must_change_password = true
   where id = uid;
end $$;

revoke all on function admin_reset_password(uuid, text) from public;
grant execute on function admin_reset_password(uuid, text) to authenticated;

-- ------------------------------------------------------------
--  4) admin_list_users(): se añade la columna must_change_password
--     para que el admin vea quién tiene un cambio de clave pendiente.
--     (Cambiar el tipo de retorno obliga a DROP + CREATE.)
-- ------------------------------------------------------------
drop function if exists admin_list_users();
create or replace function admin_list_users()
returns table (
  id                   uuid,
  nombre               text,
  email                text,
  nombre_registrado    text,
  aprobado             boolean,
  is_admin             boolean,
  created_at           timestamptz,
  n_predicciones       bigint,
  must_change_password boolean
)
language sql
security definer
set search_path = public, auth as $$
  select
    p.id,
    p.nombre,
    u.email::text,
    nullif(trim(u.raw_user_meta_data->>'nombre'), '') as nombre_registrado,
    p.aprobado,
    p.is_admin,
    p.created_at,
    coalesce((select count(*) from pred_partidos pp where pp.user_id = p.id), 0)
      + coalesce((select count(*) from pred_avance   pa where pa.user_id = p.id), 0)
      + coalesce((select count(*) from pred_posicion px where px.user_id = p.id), 0)
      as n_predicciones,
    p.must_change_password
  from profiles p
  left join auth.users u on u.id = p.id
  where is_admin(auth.uid())   -- si no es admin, no devuelve filas
  order by p.aprobado asc, p.created_at asc;
$$;

revoke all on function admin_list_users() from public;
grant execute on function admin_list_users() to authenticated;

-- ============================================================
--  LISTO.
-- ============================================================
