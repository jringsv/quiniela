-- ============================================================
--  migracion_pronosticos_json_sin_limite.sql
--  EVITA EL TRUNCADO POR "Max rows" (1000) DE SUPABASE.
--
--  PROBLEMA: get_pronosticos_bloqueados() devolvía un conjunto de
--  filas (una por pronóstico). Cuando el total pasa de 1000, PostgREST
--  corta en la fila 1000 y los partidos del final (los más recientes,
--  ej. #39 Bélgica vs Irán) llegan VACÍOS al navegador, aunque en la
--  base sí existen. Por eso "desaparecían otra vez": cada nuevo
--  pronóstico empuja un partido más por debajo del corte.
--
--  SOLUCIÓN: devolver TODO en UN ÚNICO registro JSON (json_agg). Así
--  PostgREST ve 1 sola fila y NUNCA trunca, sin importar cuántos
--  pronósticos haya. El frontend ya trata 'data' como arreglo, así que
--  NO requiere cambios en app.js: data sigue siendo el arreglo de filas.
--
--  Mantiene EXACTAMENTE las mismas columnas y la misma lógica que la
--  versión vigente (migracion_descartar_pronostico.sql):
--    - el admin ve también los partidos abiertos (or is_admin)
--    - actualizado_en (pie "última actualización")
--    - descartado (regla de doble pronóstico)
--
--  Idempotente. Ejecutar DESPUÉS de migracion_descartar_pronostico.sql.
-- ============================================================

-- Cambia el tipo de retorno (de tabla a json), así que hay que borrar antes:
drop function if exists get_pronosticos_bloqueados();

create or replace function get_pronosticos_bloqueados()
returns json
language sql stable security definer set search_path = public as $$
  select coalesce(
    json_agg(t order by t.numero, t.nombre, t.slot),
    '[]'::json
  )
  from (
    select
      p.id               as partido_id,
      p.numero,
      p.fase,
      p.grupo,
      p.equipo_local,
      p.equipo_visitante,
      p.fecha,
      p.gol_local        as gol_local_real,
      p.gol_visitante    as gol_visitante_real,
      pr.nombre,
      pp.slot,
      pp.gol_local       as pred_local,
      pp.gol_visitante   as pred_visitante,
      (p.gol_local is not null and p.gol_visitante is not null
        and pp.gol_local = p.gol_local and pp.gol_visitante = p.gol_visitante) as acerto,
      pp.updated_at      as actualizado_en,
      pp.descartado
    from partidos p
    join pred_partidos pp on pp.partido_id = p.id
    join profiles pr on pr.id = pp.user_id and (pr.aprobado or pr.is_admin)
    where partido_locked(p.id)      -- partidos ya cerrados (regla para todos)
       or is_admin(auth.uid())      -- ...pero el admin los ve siempre, aunque sigan abiertos
  ) t;
$$;

grant execute on function get_pronosticos_bloqueados() to anon, authenticated;

-- Fuerza a PostgREST a recargar su cache de esquema de inmediato (evita la
-- ventana en la que el RPC "no existe" justo después de recrear la función).
notify pgrst, 'reload schema';
