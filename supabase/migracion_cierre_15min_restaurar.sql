-- ============================================================
--  migracion_cierre_15min_restaurar.sql
--  RESTAURA EL CIERRE A 15 MINUTOS ANTES DEL PARTIDO
--
--  Devuelve la función partido_locked a su regla original de 15
--  minutos. Solo es necesario ejecutarla si previamente se corrió
--  migracion_cierre_5min.sql en el servidor. Si nunca se ejecutó,
--  esta migración es inofensiva (la función ya está en 15 min).
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
