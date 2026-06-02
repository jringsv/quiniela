-- ============================================================
--  migracion_pred_editable.sql
--  El usuario puede CREAR, EDITAR y BORRAR su pronóstico mientras
--  esté aprobado, activado en ese partido, y el partido NO haya
--  cerrado (15 minutos antes de empezar). No hay bloqueo "al guardar":
--  el único cierre es por tiempo (partido_locked).
--
--  Restaura las políticas correctas de pred_partidos. Ejecútala SOLO
--  si antes corriste la (descartada) migracion_pred_inmutable.sql;
--  si no, ya están así por migracion_dos_pred_y_activacion.sql.
--  Idempotente.
-- ============================================================
drop policy if exists "pp insert" on pred_partidos;
drop policy if exists "pp update" on pred_partidos;
drop policy if exists "pp delete" on pred_partidos;
create policy "pp insert" on pred_partidos for insert
  with check (auth.uid() = user_id and (is_admin(auth.uid())
    or (is_approved(auth.uid())
        and user_activado(partido_id, user_id)
        and not partido_locked(partido_id))));
create policy "pp update" on pred_partidos for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id and (is_admin(auth.uid())
    or (is_approved(auth.uid())
        and user_activado(partido_id, user_id)
        and not partido_locked(partido_id))));
create policy "pp delete" on pred_partidos for delete
  using (auth.uid() = user_id and (is_admin(auth.uid())
    or (is_approved(auth.uid())
        and user_activado(partido_id, user_id)
        and not partido_locked(partido_id))));
