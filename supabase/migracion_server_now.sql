-- ============================================================
--  migracion_server_now.sql
--  HORA DEL SERVIDOR para el bloqueo por tiempo
--
--  El cierre de cada partido (15 min antes) se evalúa en el frontend.
--  Si el reloj del navegador/PC del usuario está atrasado o adelantado,
--  el bloqueo visual no coincide con el del backend (que usa now() del
--  servidor). Esta función expone la hora del servidor para que el
--  frontend calcule un "offset" y use la hora REAL.
--
--  Idempotente.
-- ============================================================

create or replace function server_now() returns timestamptz
  language sql stable as $$ select now() $$;

grant execute on function server_now() to anon, authenticated;
