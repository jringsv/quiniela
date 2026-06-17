-- ============================================================
--  migracion_sync_participacion.sql
--  MANTIENE partido_usuario CONSISTENTE CON pred_partidos
--
--  Problema:
--    La participación vive en DOS lugares: los pronósticos (pred_partidos) y la
--    fila de activación (partido_usuario, con n_pred). El panel de Participantes
--    (select 1/2), su conteo y los premios se basan SOLO en partido_usuario. Si
--    esa fila queda desincronizada de los pronósticos guardados (p. ej. la RLS
--    exime al admin de estar activado; o una fila se borró tras pronosticar),
--    el usuario aparece como "No participa" y no se cuenta como participante,
--    aunque SÍ tenga sus pronósticos (cada slot = $1). Esto se observó en TODOS
--    los usuarios que pusieron 2 pronósticos cuya fila quedó descuadrada.
--
--  Regla nueva (fuente de verdad única):
--    Cualquier persona —incluido el admin— que tenga al menos un pronóstico en
--    un partido queda marcada como PARTICIPANTE de ese partido, con n_pred al
--    menos igual al slot más alto que haya pronosticado. Nunca se reduce un
--    n_pred ya asignado por el admin (se conserva el mayor).
--
--  Ejecutar DESPUÉS de:
--    migracion_dos_pred_y_activacion.sql, migracion_npred_por_activacion.sql
--  Es idempotente.
-- ============================================================

-- ------------------------------------------------------------
-- 1) BACKFILL: crear las filas de participación que falten a partir de los
--    pronósticos ya existentes (resuelve los pronósticos "huérfanos" del admin).
-- ------------------------------------------------------------
insert into partido_usuario (partido_id, user_id, n_pred)
select pp.partido_id, pp.user_id, greatest(max(pp.slot), 1)::smallint
from pred_partidos pp
group by pp.partido_id, pp.user_id
on conflict (partido_id, user_id) do update
  set n_pred = greatest(partido_usuario.n_pred, excluded.n_pred);

-- ------------------------------------------------------------
-- 2) TRIGGER: al guardar/editar un pronóstico, asegurar la fila de participación
--    con cupo suficiente para ese slot. SECURITY DEFINER porque la RLS de
--    partido_usuario solo deja escribir al admin; así también funciona para un
--    usuario normal (cuya fila ya existe: queda como no-op).
-- ------------------------------------------------------------
create or replace function sync_participacion() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into partido_usuario (partido_id, user_id, n_pred)
  values (new.partido_id, new.user_id, greatest(new.slot, 1)::smallint)
  on conflict (partido_id, user_id) do update
    set n_pred = greatest(partido_usuario.n_pred, excluded.n_pred);
  return new;
end $$;

drop trigger if exists trg_sync_participacion on pred_partidos;
create trigger trg_sync_participacion
  after insert or update on pred_partidos
  for each row execute function sync_participacion();

-- ============================================================
--  LISTO.
-- ============================================================
