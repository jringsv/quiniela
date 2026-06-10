-- ============================================================
--  migracion_admin_tambien_bloquea.sql
--  EL CIERRE POR TIEMPO TAMBIÉN APLICA AL ADMIN (en SU quiniela)
--
--  Hasta ahora el admin estaba exento del cierre de 15 min para
--  crear/editar/borrar sus pronósticos de marcador. Pero el admin
--  también es un participante con su propia cuenta, así que su
--  quiniela debe cerrarse igual que la de cualquiera.
--
--  IMPORTANTE: esto SOLO afecta pred_partidos (los marcadores que el
--  admin juega con su cuenta). NO toca su capacidad de cargar
--  resultados reales (tabla partidos), activar participantes
--  (partido_usuario) ni administrar usuarios: esas siguen siendo
--  exclusivas del admin y sin límite de tiempo.
--
--  Nuevas reglas para pred_partidos (para TODOS, incluido el admin):
--    - debe ser su propia fila (auth.uid() = user_id),
--    - estar autorizado (is_approved = aprobado o admin),
--    - estar ACTIVADO en ese partido con cupo para el slot
--      (slot <= user_npred), y
--    - que el partido NO esté cerrado (not partido_locked).
--
--  Ejecutar DESPUÉS de migracion_npred_por_activacion.sql. Idempotente.
-- ============================================================

drop policy if exists "pp insert" on pred_partidos;
drop policy if exists "pp update" on pred_partidos;
drop policy if exists "pp delete" on pred_partidos;

create policy "pp insert" on pred_partidos for insert
  with check (
    auth.uid() = user_id
    and is_approved(auth.uid())
    and slot <= user_npred(partido_id, user_id)
    and not partido_locked(partido_id)
  );

create policy "pp update" on pred_partidos for update
  using (auth.uid() = user_id)
  with check (
    auth.uid() = user_id
    and is_approved(auth.uid())
    and slot <= user_npred(partido_id, user_id)
    and not partido_locked(partido_id)
  );

create policy "pp delete" on pred_partidos for delete
  using (
    auth.uid() = user_id
    and is_approved(auth.uid())
    and user_npred(partido_id, user_id) > 0
    and not partido_locked(partido_id)
  );

-- Nota: el SELECT no cambia. El admin sigue pudiendo ver todas las
-- predicciones (política "pp select" con is_admin), lo cual es necesario
-- para las funciones de premios y de pronósticos visibles.
