-- ============================================================
--  QUINIELA MUNDIAL 2026 — Esquema de base de datos (Supabase / Postgres)
--  Ejecuta TODO este archivo en:  Supabase -> SQL Editor -> New query -> Run
-- ============================================================

create extension if not exists "pgcrypto";

-- ------------------------------------------------------------
--  CONFIGURACIÓN GLOBAL
-- ------------------------------------------------------------
create table if not exists config (
  clave text primary key,
  valor text not null
);

-- Fecha/hora de bloqueo: 11 de junio de 2026, 11:00 a.m. (hora de El Salvador, UTC-6)
insert into config (clave, valor) values
  ('lock_at', '2026-06-11T11:00:00-06:00')
on conflict (clave) do nothing;

-- ------------------------------------------------------------
--  PERFILES DE USUARIO
-- ------------------------------------------------------------
create table if not exists profiles (
  id         uuid primary key references auth.users(id) on delete cascade,
  nombre     text not null,
  is_admin   boolean not null default false,
  aprobado   boolean not null default false,   -- el admin debe autorizar antes de poder jugar
  created_at timestamptz not null default now()
);

-- ------------------------------------------------------------
--  PARTIDOS (calendario + resultados reales que llena el admin)
-- ------------------------------------------------------------
create table if not exists partidos (
  id               bigserial primary key,
  numero           int,                              -- número del partido en el calendario
  fase             text not null default 'grupos',   -- grupos,16avos,8vos,4tos,semis,tercer_puesto,final
  grupo            text,                             -- A..L (solo fase de grupos)
  equipo_local     text not null,
  equipo_visitante text not null,
  fecha            timestamptz,
  gol_local        int,                              -- resultado REAL (NULL = no jugado)
  gol_visitante    int,
  aplica_quiniela  boolean not null default true     -- ¿este partido otorga puntos de marcador (3/1)?
);

-- ------------------------------------------------------------
--  PREDICCIONES DE MARCADOR  (3 pts exacto / 1 pt ganador)
-- ------------------------------------------------------------
create table if not exists pred_partidos (
  user_id       uuid   not null references auth.users(id) on delete cascade,
  partido_id    bigint not null references partidos(id) on delete cascade,
  gol_local     int    not null,
  gol_visitante int    not null,
  updated_at    timestamptz not null default now(),
  primary key (user_id, partido_id)
);

-- ------------------------------------------------------------
--  PREDICCIÓN DE AVANCE DE FASES  (1/2/3/4 pts por equipo acertado)
--  El usuario marca qué equipos cree que LLEGAN a cada fase.
-- ------------------------------------------------------------
create table if not exists pred_avance (
  user_id uuid not null references auth.users(id) on delete cascade,
  fase    text not null,            -- 16avos,8vos,4tos,semis
  equipo  text not null,
  primary key (user_id, fase, equipo)
);

create table if not exists resultado_avance (
  fase   text not null,             -- equipos que REALMENTE llegaron a cada fase
  equipo text not null,
  primary key (fase, equipo)
);

-- ------------------------------------------------------------
--  PREDICCIÓN DE POSICIONES FINALES (campeón 7 / subcampeón 5 / tercero 5)
-- ------------------------------------------------------------
create table if not exists pred_posicion (
  user_id  uuid not null references auth.users(id) on delete cascade,
  posicion text not null,           -- campeon,subcampeon,tercero
  equipo   text not null,
  primary key (user_id, posicion)
);

create table if not exists resultado_posicion (
  posicion text primary key,        -- campeon,subcampeon,tercero
  equipo   text not null
);

-- ============================================================
--  FUNCIONES AUXILIARES
-- ============================================================
create or replace function lock_at() returns timestamptz
  language sql stable as $$
  select (valor)::timestamptz from config where clave = 'lock_at'
$$;

create or replace function locked() returns boolean
  language sql stable as $$
  select now() >= lock_at()
$$;

create or replace function is_admin(uid uuid) returns boolean
  language sql stable security definer set search_path = public as $$
  select coalesce((select is_admin from profiles where id = uid), false)
$$;

create or replace function is_approved(uid uuid) returns boolean
  language sql stable security definer set search_path = public as $$
  select coalesce((select aprobado or is_admin from profiles where id = uid), false)
$$;

-- Impide que un usuario normal se auto-apruebe o se vuelva admin:
-- solo un admin puede cambiar 'is_admin' o 'aprobado'.
create or replace function protect_profile_fields() returns trigger
  language plpgsql security definer set search_path = public as $$
begin
  if not is_admin(auth.uid()) then
    new.is_admin := old.is_admin;
    new.aprobado := old.aprobado;
  end if;
  return new;
end $$;

-- ============================================================
--  TABLA DE POSICIONES (calcula TODOS los puntos de forma segura)
--  Se llama desde el frontend con: supabase.rpc('get_leaderboard')
--  No expone las predicciones individuales, solo los totales.
-- ============================================================
create or replace function get_leaderboard()
returns table (
  nombre          text,
  pts_partidos    int,
  pts_fases       int,
  pts_posiciones  int,
  total           int
)
language sql stable security definer set search_path = public as $$
  with mp as (   -- puntos por marcadores (solo partidos marcados "aplica_quiniela")
    select pp.user_id,
      sum(
        case
          when not p.aplica_quiniela then 0
          when p.gol_local is null or p.gol_visitante is null then 0
          when pp.gol_local = p.gol_local and pp.gol_visitante = p.gol_visitante then 3
          when sign(pp.gol_local - pp.gol_visitante) = sign(p.gol_local - p.gol_visitante) then 1
          else 0
        end
      ) as pts
    from pred_partidos pp
    join partidos p on p.id = pp.partido_id
    group by pp.user_id
  ),
  fp as (        -- puntos por avance de fases
    select pa.user_id,
      sum(case pa.fase
            when '16avos' then 1
            when '8vos'   then 2
            when '4tos'   then 3
            when 'semis'  then 4
            else 0 end) as pts
    from pred_avance pa
    join resultado_avance ra on ra.fase = pa.fase and ra.equipo = pa.equipo
    group by pa.user_id
  ),
  posp as (      -- puntos por posiciones finales
    select px.user_id,
      sum(case px.posicion
            when 'campeon'    then 7
            when 'subcampeon' then 5
            when 'tercero'    then 5
            else 0 end) as pts
    from pred_posicion px
    join resultado_posicion rp on rp.posicion = px.posicion and rp.equipo = px.equipo
    group by px.user_id
  )
  select
    pr.nombre,
    coalesce(mp.pts, 0)::int   as pts_partidos,
    coalesce(fp.pts, 0)::int   as pts_fases,
    coalesce(posp.pts, 0)::int as pts_posiciones,
    (coalesce(mp.pts,0) + coalesce(fp.pts,0) + coalesce(posp.pts,0))::int as total
  from profiles pr
  left join mp   on mp.user_id   = pr.id
  left join fp   on fp.user_id   = pr.id
  left join posp on posp.user_id = pr.id
  where pr.aprobado or pr.is_admin   -- solo usuarios autorizados aparecen en la tabla
  order by total desc, pr.nombre asc;
$$;

-- ============================================================
--  SEGURIDAD A NIVEL DE FILA (Row Level Security)
-- ============================================================
alter table profiles            enable row level security;
alter table partidos            enable row level security;
alter table config              enable row level security;
alter table pred_partidos       enable row level security;
alter table pred_avance         enable row level security;
alter table pred_posicion       enable row level security;
alter table resultado_avance    enable row level security;
alter table resultado_posicion  enable row level security;

-- ---------- PROFILES ----------
drop policy if exists "perfiles lectura"      on profiles;
drop policy if exists "perfil propio insert"  on profiles;
drop policy if exists "perfil propio update"  on profiles;
drop policy if exists "perfil admin update"   on profiles;
create policy "perfiles lectura"     on profiles for select using (true);
create policy "perfil propio insert" on profiles for insert with check (auth.uid() = id);
-- El usuario puede editar su propia fila (el trigger protege is_admin/aprobado);
-- el admin puede editar cualquier fila para aprobar usuarios.
create policy "perfil propio update" on profiles for update using (auth.uid() = id);
create policy "perfil admin update"  on profiles for update
  using (is_admin(auth.uid())) with check (is_admin(auth.uid()));

-- Trigger que congela is_admin/aprobado para quien no es admin.
drop trigger if exists trg_protect_profile on profiles;
create trigger trg_protect_profile before update on profiles
  for each row execute function protect_profile_fields();

-- ---------- CONFIG ----------
drop policy if exists "config lectura" on config;
drop policy if exists "config admin"   on config;
create policy "config lectura" on config for select using (true);
create policy "config admin"   on config for all
  using (is_admin(auth.uid())) with check (is_admin(auth.uid()));

-- ---------- PARTIDOS ----------
drop policy if exists "partidos lectura" on partidos;
drop policy if exists "partidos admin"   on partidos;
create policy "partidos lectura" on partidos for select using (true);
create policy "partidos admin"   on partidos for all
  using (is_admin(auth.uid())) with check (is_admin(auth.uid()));

-- ---------- PRED_PARTIDOS (editable solo antes del bloqueo, salvo admin) ----------
drop policy if exists "pp select" on pred_partidos;
drop policy if exists "pp insert" on pred_partidos;
drop policy if exists "pp update" on pred_partidos;
drop policy if exists "pp delete" on pred_partidos;
create policy "pp select" on pred_partidos for select
  using (auth.uid() = user_id or is_admin(auth.uid()));
create policy "pp insert" on pred_partidos for insert
  with check (auth.uid() = user_id and (is_admin(auth.uid()) or (is_approved(auth.uid()) and not locked())));
create policy "pp update" on pred_partidos for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id and (is_admin(auth.uid()) or (is_approved(auth.uid()) and not locked())));
create policy "pp delete" on pred_partidos for delete
  using (auth.uid() = user_id and (is_admin(auth.uid()) or (is_approved(auth.uid()) and not locked())));

-- ---------- PRED_AVANCE ----------
drop policy if exists "pa select" on pred_avance;
drop policy if exists "pa insert" on pred_avance;
drop policy if exists "pa delete" on pred_avance;
create policy "pa select" on pred_avance for select
  using (auth.uid() = user_id or is_admin(auth.uid()));
create policy "pa insert" on pred_avance for insert
  with check (auth.uid() = user_id and (is_admin(auth.uid()) or (is_approved(auth.uid()) and not locked())));
create policy "pa delete" on pred_avance for delete
  using (auth.uid() = user_id and (is_admin(auth.uid()) or (is_approved(auth.uid()) and not locked())));

-- ---------- PRED_POSICION ----------
drop policy if exists "px select" on pred_posicion;
drop policy if exists "px insert" on pred_posicion;
drop policy if exists "px update" on pred_posicion;
drop policy if exists "px delete" on pred_posicion;
create policy "px select" on pred_posicion for select
  using (auth.uid() = user_id or is_admin(auth.uid()));
create policy "px insert" on pred_posicion for insert
  with check (auth.uid() = user_id and (is_admin(auth.uid()) or (is_approved(auth.uid()) and not locked())));
create policy "px update" on pred_posicion for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id and (is_admin(auth.uid()) or (is_approved(auth.uid()) and not locked())));
create policy "px delete" on pred_posicion for delete
  using (auth.uid() = user_id and (is_admin(auth.uid()) or (is_approved(auth.uid()) and not locked())));

-- ---------- RESULTADOS (lectura pública, escritura admin) ----------
drop policy if exists "ra lectura" on resultado_avance;
drop policy if exists "ra admin"   on resultado_avance;
create policy "ra lectura" on resultado_avance for select using (true);
create policy "ra admin"   on resultado_avance for all
  using (is_admin(auth.uid())) with check (is_admin(auth.uid()));

drop policy if exists "rp lectura" on resultado_posicion;
drop policy if exists "rp admin"   on resultado_posicion;
create policy "rp lectura" on resultado_posicion for select using (true);
create policy "rp admin"   on resultado_posicion for all
  using (is_admin(auth.uid())) with check (is_admin(auth.uid()));

-- ============================================================
--  TIEMPO REAL: habilita replicación para el dashboard en vivo
-- ============================================================
alter publication supabase_realtime add table partidos;
alter publication supabase_realtime add table resultado_avance;
alter publication supabase_realtime add table resultado_posicion;

-- ============================================================
--  LISTO. Recuerda convertir tu usuario en admin DESPUÉS de registrarte:
--    update profiles set is_admin = true where nombre = 'TU_NOMBRE';
-- ============================================================
