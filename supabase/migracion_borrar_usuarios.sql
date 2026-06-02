-- ============================================================
--  BORRAR USUARIOS (solo el admin)
--  Elimina por completo a un usuario: su cuenta de auth.users y,
--  por cascada (on delete cascade), su perfil y TODAS sus predicciones.
--  Ejecutar UNA VEZ en: Supabase -> SQL Editor -> New query -> Run.
--  Es idempotente.
-- ============================================================

-- Función segura: solo un admin puede invocarla. No permite borrar al
-- propio admin que la ejecuta ni a otro administrador (medida de seguridad).
-- security definer => se ejecuta con los privilegios del dueño (postgres),
-- que sí puede borrar filas de auth.users; la cascada hace el resto.
create or replace function admin_delete_user(uid uuid)
returns void
language plpgsql
security definer
set search_path = public, auth as $$
begin
  if not is_admin(auth.uid()) then
    raise exception 'Solo un administrador puede borrar usuarios.';
  end if;
  if uid = auth.uid() then
    raise exception 'No puedes borrarte a ti mismo.';
  end if;
  if coalesce((select is_admin from profiles where id = uid), false) then
    raise exception 'No se puede borrar a otro administrador.';
  end if;

  -- Al borrar de auth.users, las claves foráneas con ON DELETE CASCADE
  -- eliminan automáticamente profiles, pred_partidos, pred_avance y pred_posicion.
  delete from auth.users where id = uid;
end $$;

-- Solo usuarios autenticados pueden llamarla (y por dentro se valida que sea admin).
revoke all on function admin_delete_user(uuid) from public;
grant execute on function admin_delete_user(uuid) to authenticated;

-- ============================================================
--  LISTADO DE USUARIOS PARA EL ADMIN
--  Devuelve, para cada usuario, su correo (de auth.users), el nombre con el
--  que se registró (metadatos) y cuántas predicciones tiene. Sirve para que
--  el admin identifique a cada quien, prellene la edición de nombre con el
--  nombre real registrado, y vea cuántas predicciones se borrarían.
--  Solo el admin puede ejecutarla.
-- ============================================================
create or replace function admin_list_users()
returns table (
  id                uuid,
  nombre            text,
  email             text,
  nombre_registrado text,
  aprobado          boolean,
  is_admin          boolean,
  created_at        timestamptz,
  n_predicciones    bigint
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
      as n_predicciones
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
