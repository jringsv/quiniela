-- ============================================================
--  MIGRACIÓN: llaves (bracket) — ejecutar UNA vez en Supabase
--  (SQL Editor) DESPUÉS de schema.sql, si ya tenías la base creada.
--  Agrega el guardado de los ganadores de cada partido de eliminatoria.
-- ============================================================

-- Ganadores de eliminatorias que predice cada usuario ('a' = local, 'b' = visitante)
create table if not exists pred_bracket (
  user_id  uuid not null references auth.users(id) on delete cascade,
  match_no int  not null,            -- 73..104 (16avos..final, 103 = tercer puesto)
  ganador  text not null check (ganador in ('a','b')),
  primary key (user_id, match_no)
);

-- Ganadores REALES de eliminatorias (los pone el admin)
create table if not exists res_bracket (
  match_no int  primary key,
  ganador  text not null check (ganador in ('a','b'))
);

alter table pred_bracket enable row level security;
alter table res_bracket  enable row level security;

-- pred_bracket: el dueño edita solo antes del bloqueo (salvo admin)
drop policy if exists "pb select" on pred_bracket;
drop policy if exists "pb insert" on pred_bracket;
drop policy if exists "pb update" on pred_bracket;
drop policy if exists "pb delete" on pred_bracket;
create policy "pb select" on pred_bracket for select
  using (auth.uid() = user_id or is_admin(auth.uid()));
create policy "pb insert" on pred_bracket for insert
  with check (auth.uid() = user_id and (is_admin(auth.uid()) or not locked()));
create policy "pb update" on pred_bracket for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id and (is_admin(auth.uid()) or not locked()));
create policy "pb delete" on pred_bracket for delete
  using (auth.uid() = user_id and (is_admin(auth.uid()) or not locked()));

-- res_bracket: lectura pública, escritura admin
drop policy if exists "rb lectura" on res_bracket;
drop policy if exists "rb admin"   on res_bracket;
create policy "rb lectura" on res_bracket for select using (true);
create policy "rb admin"   on res_bracket for all
  using (is_admin(auth.uid())) with check (is_admin(auth.uid()));

-- Tiempo real para el cuadro real
alter publication supabase_realtime add table res_bracket;
