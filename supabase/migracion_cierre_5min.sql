-- ============================================================
--  migracion_cierre_5min.sql
--  AJUSTE DEL CIERRE EFECTIVO: 5 MINUTOS ANTES DEL PARTIDO
--
--  El cierre REAL pasa de 15 a 5 minutos antes de la hora de cada
--  partido. El rótulo que ve el usuario sigue diciendo 15 minutos
--  (texto fijo en la interfaz), pero el bloqueo efectivo ocurre a
--  los 5 minutos. Así los usuarios pueden seguir editando 10 min
--  más de lo que el rótulo indica.
--
--  Ejecutar DESPUÉS de migracion_lock_por_partido.sql.
-- ============================================================

-- ¿El partido pid ya cerró? (now >= hora_del_partido - 5 min)
-- Si el partido no tiene fecha, se considera ABIERTO (false).
create or replace function partido_locked(pid bigint) returns boolean
  language sql stable security definer set search_path = public as $$
  select coalesce(
    (select now() >= fecha - interval '5 minutes'
       from partidos where id = pid),
    false)
$$;
