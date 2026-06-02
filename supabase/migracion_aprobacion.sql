-- ============================================================
--  APROBACIÓN DE USUARIOS POR EL ADMIN
--  El admin debe autorizar a cada usuario registrado antes de que
--  pueda GUARDAR su quiniela.
--  Ejecutar UNA VEZ en: Supabase -> SQL Editor -> New query -> Run.
--  Es idempotente y NO destructivo.
-- ============================================================

-- 1) Columna 'aprobado' en profiles (por defecto NO aprobado)
alter table profiles add column if not exists aprobado boolean not null default false;

-- 2) No dejar fuera a quienes YA estaban participando:
--    aprobamos a los usuarios existentes y a los admin.
--    (Si prefieres que TODOS los actuales también requieran aprobación,
--     comenta la línea de abajo y aprueba manualmente desde la pestaña Admin.)
update profiles set aprobado = true;
update profiles set aprobado = true where is_admin = true;  -- el admin siempre aprobado

-- 3) Función: ¿este usuario está aprobado (o es admin)?
create or replace function is_approved(uid uuid) returns boolean
  language sql stable security definer set search_path = public as $$
  select coalesce((select aprobado or is_admin from profiles where id = uid), false)
$$;

-- 4) SEGURIDAD: impedir que un usuario normal se auto-apruebe o se haga admin.
--    Un usuario solo puede cambiar su 'nombre'; 'is_admin' y 'aprobado'
--    quedan congelados salvo que quien edita sea admin.
create or replace function protect_profile_fields() returns trigger
  language plpgsql security definer set search_path = public as $$
begin
  if not is_admin(auth.uid()) then
    new.is_admin := old.is_admin;
    new.aprobado := old.aprobado;
  end if;
  return new;
end $$;

drop trigger if exists trg_protect_profile on profiles;
create trigger trg_protect_profile before update on profiles
  for each row execute function protect_profile_fields();

-- 5) Política: el admin puede actualizar CUALQUIER perfil (para aprobar).
drop policy if exists "perfil admin update" on profiles;
create policy "perfil admin update" on profiles for update
  using (is_admin(auth.uid())) with check (is_admin(auth.uid()));

-- 6) Las predicciones solo se pueden crear/editar si el usuario está APROBADO
--    (además de las reglas de bloqueo por fecha que ya existían).
-- ----- pred_partidos -----
drop policy if exists "pp insert" on pred_partidos;
drop policy if exists "pp update" on pred_partidos;
drop policy if exists "pp delete" on pred_partidos;
create policy "pp insert" on pred_partidos for insert
  with check (auth.uid() = user_id and (is_admin(auth.uid()) or (is_approved(auth.uid()) and not locked())));
create policy "pp update" on pred_partidos for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id and (is_admin(auth.uid()) or (is_approved(auth.uid()) and not locked())));
create policy "pp delete" on pred_partidos for delete
  using (auth.uid() = user_id and (is_admin(auth.uid()) or (is_approved(auth.uid()) and not locked())));

-- ----- pred_avance -----
drop policy if exists "pa insert" on pred_avance;
drop policy if exists "pa delete" on pred_avance;
create policy "pa insert" on pred_avance for insert
  with check (auth.uid() = user_id and (is_admin(auth.uid()) or (is_approved(auth.uid()) and not locked())));
create policy "pa delete" on pred_avance for delete
  using (auth.uid() = user_id and (is_admin(auth.uid()) or (is_approved(auth.uid()) and not locked())));

-- ----- pred_posicion -----
drop policy if exists "px insert" on pred_posicion;
drop policy if exists "px update" on pred_posicion;
drop policy if exists "px delete" on pred_posicion;
create policy "px insert" on pred_posicion for insert
  with check (auth.uid() = user_id and (is_admin(auth.uid()) or (is_approved(auth.uid()) and not locked())));
create policy "px update" on pred_posicion for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id and (is_admin(auth.uid()) or (is_approved(auth.uid()) and not locked())));
create policy "px delete" on pred_posicion for delete
  using (auth.uid() = user_id and (is_admin(auth.uid()) or (is_approved(auth.uid()) and not locked())));

-- 7) La tabla de posiciones solo muestra a usuarios aprobados (o admin).
create or replace function get_leaderboard()
returns table (
  nombre          text,
  pts_partidos    int,
  pts_fases       int,
  pts_posiciones  int,
  total           int
)
language sql stable security definer set search_path = public as $$
  with mp as (
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
  fp as (
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
  posp as (
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
  where pr.aprobado or pr.is_admin
  order by total desc, pr.nombre asc;
$$;
