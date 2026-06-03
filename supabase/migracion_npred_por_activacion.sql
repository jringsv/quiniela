-- ============================================================
--  migracion_npred_por_activacion.sql
--  La activación por partido ahora define CUÁNTOS pronósticos da
--  ese usuario en ese partido: 1 o 2.
--   - partido_usuario.n_pred (1 ó 2)
--   - el usuario solo puede guardar el slot <= n_pred (RLS).
--
--  Ejecutar DESPUÉS de migracion_dos_pred_y_activacion.sql
--  (y de migracion_pred_editable.sql si la usaste). Idempotente.
-- ============================================================

-- ¿Cuántos pronósticos puede dar? (por defecto 2)
alter table partido_usuario add column if not exists n_pred smallint not null default 2;
alter table partido_usuario drop constraint if exists partido_usuario_npred_chk;
alter table partido_usuario add constraint partido_usuario_npred_chk check (n_pred in (1, 2));

-- Cuántos pronósticos tiene permitidos uid en el partido pid (0 = no activado).
create or replace function user_npred(pid bigint, uid uuid) returns smallint
  language sql stable security definer set search_path = public as $$
  select coalesce((select n_pred from partido_usuario where partido_id = pid and user_id = uid), 0)::smallint
$$;

-- RLS de pred_partidos: el usuario puede crear/editar/borrar su pronóstico si
-- está aprobado, el slot está dentro de su cupo (1 ó 2) y el partido no cerró.
-- (slot <= user_npred implica además que está activado, porque si no, da 0.)
drop policy if exists "pp insert" on pred_partidos;
drop policy if exists "pp update" on pred_partidos;
drop policy if exists "pp delete" on pred_partidos;
create policy "pp insert" on pred_partidos for insert
  with check (auth.uid() = user_id and (is_admin(auth.uid())
    or (is_approved(auth.uid())
        and slot <= user_npred(partido_id, user_id)
        and not partido_locked(partido_id))));
create policy "pp update" on pred_partidos for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id and (is_admin(auth.uid())
    or (is_approved(auth.uid())
        and slot <= user_npred(partido_id, user_id)
        and not partido_locked(partido_id))));
create policy "pp delete" on pred_partidos for delete
  using (auth.uid() = user_id and (is_admin(auth.uid())
    or (is_approved(auth.uid())
        and user_npred(partido_id, user_id) > 0
        and not partido_locked(partido_id))));
