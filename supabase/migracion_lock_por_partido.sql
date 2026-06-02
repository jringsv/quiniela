-- ============================================================
--  migracion_lock_por_partido.sql
--  NUEVA REGLA DE CIERRE (reemplaza el bloqueo global por fecha)
--
--  Cada pronóstico de marcador se cierra 15 MINUTOS ANTES de la
--  hora de SU partido. Pasado ese momento, ese marcador ya no se
--  puede crear ni modificar (ni borrar) — salvo el admin.
--
--  Las llaves (bracket / avance / posiciones) ya no otorgan puntos
--  y no tienen una fecha por cruce, así que dejan de tener bloqueo
--  por tiempo: se pueden ajustar mientras el usuario esté aprobado.
--
--  Ejecutar DESPUÉS de schema.sql, migracion_bracket.sql,
--  migracion_aprobacion.sql y migracion_aplica_quiniela.sql.
-- ============================================================

-- ¿El partido pid ya cerró? (now >= hora_del_partido - 15 min)
-- Si el partido no tiene fecha, se considera ABIERTO (false).
create or replace function partido_locked(pid bigint) returns boolean
  language sql stable security definer set search_path = public as $$
  select coalesce(
    (select now() >= fecha - interval '15 minutes'
       from partidos where id = pid),
    false)
$$;

-- ---------- PRED_PARTIDOS: cierre por partido ----------
drop policy if exists "pp insert" on pred_partidos;
drop policy if exists "pp update" on pred_partidos;
drop policy if exists "pp delete" on pred_partidos;
create policy "pp insert" on pred_partidos for insert
  with check (auth.uid() = user_id and (is_admin(auth.uid())
    or (is_approved(auth.uid()) and not partido_locked(partido_id))));
create policy "pp update" on pred_partidos for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id and (is_admin(auth.uid())
    or (is_approved(auth.uid()) and not partido_locked(partido_id))));
create policy "pp delete" on pred_partidos for delete
  using (auth.uid() = user_id and (is_admin(auth.uid())
    or (is_approved(auth.uid()) and not partido_locked(partido_id))));

-- ---------- PRED_AVANCE: sin bloqueo por tiempo (ya no puntúa) ----------
drop policy if exists "pa insert" on pred_avance;
drop policy if exists "pa delete" on pred_avance;
create policy "pa insert" on pred_avance for insert
  with check (auth.uid() = user_id and (is_admin(auth.uid()) or is_approved(auth.uid())));
create policy "pa delete" on pred_avance for delete
  using (auth.uid() = user_id and (is_admin(auth.uid()) or is_approved(auth.uid())));

-- ---------- PRED_POSICION: sin bloqueo por tiempo (ya no puntúa) ----------
drop policy if exists "px insert" on pred_posicion;
drop policy if exists "px update" on pred_posicion;
drop policy if exists "px delete" on pred_posicion;
create policy "px insert" on pred_posicion for insert
  with check (auth.uid() = user_id and (is_admin(auth.uid()) or is_approved(auth.uid())));
create policy "px update" on pred_posicion for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id and (is_admin(auth.uid()) or is_approved(auth.uid())));
create policy "px delete" on pred_posicion for delete
  using (auth.uid() = user_id and (is_admin(auth.uid()) or is_approved(auth.uid())));

-- ---------- PRED_BRACKET: sin bloqueo por tiempo (ya no puntúa) ----------
drop policy if exists "pb insert" on pred_bracket;
drop policy if exists "pb update" on pred_bracket;
drop policy if exists "pb delete" on pred_bracket;
create policy "pb insert" on pred_bracket for insert
  with check (auth.uid() = user_id and (is_admin(auth.uid()) or is_approved(auth.uid())));
create policy "pb update" on pred_bracket for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id and (is_admin(auth.uid()) or is_approved(auth.uid())));
create policy "pb delete" on pred_bracket for delete
  using (auth.uid() = user_id and (is_admin(auth.uid()) or is_approved(auth.uid())));

-- Nota: las funciones lock_at()/locked() y la fila config('lock_at')
-- quedan sin uso, pero se dejan por compatibilidad. Puedes borrarlas
-- si lo deseas:
--   drop function if exists locked();
--   drop function if exists lock_at();
--   delete from config where clave = 'lock_at';
