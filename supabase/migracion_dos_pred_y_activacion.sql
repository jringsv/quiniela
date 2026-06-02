-- ============================================================
--  migracion_dos_pred_y_activacion.sql
--  TRES CAMBIOS:
--   1) Doble marcador por partido: cada usuario puede guardar hasta
--      DOS pronósticos (slot 1 y 2) del mismo partido. Ambos suman.
--   2) Activación de usuarios por partido: el admin habilita quién
--      puede pronosticar cada partido (por defecto, NADIE).
--   3) Las llaves puntúan como partidos normales (3/1) — esto ya lo
--      cubre get_leaderboard al sumar todas las filas de pred_partidos
--      con aplica_quiniela = true, sin importar la fase. No cambia.
--
--  Ejecutar DESPUÉS de:
--    schema.sql, migracion_bracket.sql, migracion_aprobacion.sql,
--    migracion_aplica_quiniela.sql, migracion_solo_marcadores.sql,
--    migracion_lock_por_partido.sql
--  Es idempotente.
-- ============================================================

-- ------------------------------------------------------------
-- 1) DOBLE MARCADOR: columna slot + nueva PK (user_id, partido_id, slot)
-- ------------------------------------------------------------
alter table pred_partidos add column if not exists slot smallint not null default 1;

do $$
begin
  -- Cambiar la PK solo si todavía es la antigua (user_id, partido_id).
  if exists (
    select 1 from pg_constraint
    where conname = 'pred_partidos_pkey'
      and array_length(conkey, 1) = 2
  ) then
    alter table pred_partidos drop constraint pred_partidos_pkey;
    alter table pred_partidos add primary key (user_id, partido_id, slot);
  end if;
end $$;

alter table pred_partidos drop constraint if exists pred_partidos_slot_chk;
alter table pred_partidos add constraint pred_partidos_slot_chk check (slot in (1, 2));

-- ------------------------------------------------------------
-- 2) ACTIVACIÓN POR PARTIDO: tabla partido_usuario
-- ------------------------------------------------------------
create table if not exists partido_usuario (
  partido_id bigint not null references partidos(id)    on delete cascade,
  user_id    uuid   not null references auth.users(id)  on delete cascade,
  primary key (partido_id, user_id)
);
alter table partido_usuario enable row level security;

-- ¿El usuario uid está activado para el partido pid?
create or replace function user_activado(pid bigint, uid uuid) returns boolean
  language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from partido_usuario where partido_id = pid and user_id = uid
  )
$$;

-- ---------- RLS de partido_usuario ----------
drop policy if exists "pu select"      on partido_usuario;
drop policy if exists "pu admin write" on partido_usuario;
-- El jugador ve su propia activación; el admin ve todo.
create policy "pu select" on partido_usuario for select
  using (auth.uid() = user_id or is_admin(auth.uid()));
-- Solo el admin activa/desactiva participantes.
create policy "pu admin write" on partido_usuario for all
  using (is_admin(auth.uid()))
  with check (is_admin(auth.uid()));

-- ------------------------------------------------------------
-- 3) RLS de PRED_PARTIDOS: aprobado + ACTIVADO en ese partido + no cerrado
--    (el admin queda exceptuado de todo). partido_locked() viene de
--    migracion_lock_por_partido.sql.
-- ------------------------------------------------------------
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

-- ------------------------------------------------------------
-- Nota sobre el PUNTAJE (get_leaderboard): NO cambia.
-- Suma 3 (exacto) / 1 (resultado) sobre TODAS las filas de pred_partidos
-- (ambos slots, cualquier fase) con aplica_quiniela = true. Por eso:
--   - los dos marcadores suman, y
--   - las llaves puntúan igual que los partidos de grupos.
-- Quedó definido en migracion_solo_marcadores.sql.
-- ============================================================
-- LISTO.
-- ============================================================
