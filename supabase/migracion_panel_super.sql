-- ============================================================
--  migracion_panel_super.sql
--  PANEL DE INTELIGENCIA — SOLO SUPERADMIN (jrobertoma@gmail.com)
--
--  Expone get_panel_super(): un único jsonb con todas las métricas del
--  tablero privado del superadministrador. Reutiliza la lógica ya existente
--  (mismas reglas que get_leaderboard, get_control_pagos y get_premios_marcador)
--  para que los números COINCIDAN con el resto de la app:
--
--    Por cada usuario autorizado (aprobado o admin):
--      - invertido      : pronósticos ENVIADOS ($1 c/u). Un pronóstico se
--                         considera enviado cuando su partido ya cerró y el
--                         usuario es participante (igual que get_control_pagos).
--      - ganado         : suma de premio_por_ganador de cada partido donde
--                         acertó el marcador exacto (incluye acumulados).
--      - premios_pagados: de lo ganado, cuánto ya se le abonó.
--      - n_pronosticos  : total de marcadores digitados (no descartados),
--                         contando ambos slots (1 y 2).
--      - n_dobles       : partidos donde puso DOS pronósticos.
--      - puntos         : puntaje de marcador (3 exacto / 1 resultado, mejor
--                         de los dos), idéntico a get_leaderboard.
--      - marcadores / ganadores : desglose M (exactos) y G (solo resultado).
--      - pendientes     : partidos que aplican quiniela, en los que el usuario
--                         está activo y que AÚN NO tienen resultado real.
--      - max_posible    : puntos + 3 × pendientes (techo si acierta todo lo que
--                         le queda) — base de la proyección de ganadores.
--
--    Globales:
--      - partidos_jugados / partidos_pendientes
--      - puntos_en_juego  : 3 × partidos pendientes que aplican quiniela
--                           (cuántos puntos quedan por repartir en total).
--      - total_invertido / total_repartido
--      - n_usuarios
--
--  SEGURIDAD: security definer (lee TODAS las predicciones, normalmente ocultas
--  por RLS) PERO valida is_superadmin(auth.uid()) y aborta para cualquier otro,
--  incluso para un admin normal. Así la pestaña es realmente privada.
--
--  Ejecutar DESPUÉS de:
--    schema.sql, migracion_superadmin_pospartido.sql,
--    migracion_control_pagos.sql, migracion_control_pagos_premios.sql,
--    migracion_premios_acumulado_simultaneos.sql,
--    migracion_descartar_pronostico.sql
--  Es idempotente.
-- ============================================================

create or replace function get_panel_super()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, auth as $$
declare
  v jsonb;
begin
  -- Solo el superadministrador. Ni un admin normal puede ver este panel.
  if not is_superadmin(auth.uid()) then
    raise exception 'Solo el superadministrador puede ver este panel.';
  end if;

  with
  base_users as (
    select id, nombre from profiles where aprobado or is_admin
  ),
  -- INVERSIÓN: pronósticos enviados ($1 c/u). Mismo criterio que get_control_pagos.
  inv as (
    select pp.user_id, count(*)::int as invertido
    from pred_partidos pp
    join partido_usuario pu
      on pu.partido_id = pp.partido_id and pu.user_id = pp.user_id
    where partido_locked(pp.partido_id)
    group by pp.user_id
  ),
  -- TOTAL DE PRONÓSTICOS digitados (no descartados), ambos slots.
  npron as (
    select user_id, count(*)::int as n_pron
    from pred_partidos
    where not descartado
    group by user_id
  ),
  -- DOBLES: partidos donde el usuario puso dos pronósticos.
  dobles as (
    select user_id, count(*)::int as n_dobles
    from (
      select user_id, partido_id
      from pred_partidos
      where not descartado
      group by user_id, partido_id
      having count(*) >= 2
    ) t
    group by user_id
  ),
  -- PUNTAJE: mismas reglas que get_leaderboard (mejor de los dos pronósticos).
  por_pred as (
    select pp.user_id, pp.partido_id,
      case
        when not p.aplica_quiniela then 0
        when p.gol_local is null or p.gol_visitante is null then 0
        when pp.gol_local = p.gol_local and pp.gol_visitante = p.gol_visitante then 3
        when sign(pp.gol_local - pp.gol_visitante) = sign(p.gol_local - p.gol_visitante) then 1
        else 0
      end as pts
    from pred_partidos pp
    join partidos p on p.id = pp.partido_id
    where not pp.descartado
  ),
  por_partido as (
    select user_id, partido_id, max(pts) as pts
    from por_pred group by user_id, partido_id
  ),
  pts as (
    select user_id,
      sum(pts)::int                         as total,
      count(*) filter (where pts = 3)::int  as m,
      count(*) filter (where pts = 1)::int  as g
    from por_partido group by user_id
  ),
  -- PREMIOS ganados / pagados por usuario (reusa get_premios_marcador).
  premios as (
    select (gan->>'user_id')::uuid as user_id,
      coalesce(sum(pm.premio_por_ganador), 0)                               as ganado,
      coalesce(sum(pm.premio_por_ganador) filter (where (gan->>'pagado')::boolean), 0) as pagado
    from get_premios_marcador() pm
    cross join lateral jsonb_array_elements(pm.ganadores) gan
    group by (gan->>'user_id')::uuid
  ),
  -- PENDIENTES: partidos activos del usuario que aplican y aún sin resultado.
  pend as (
    select pu.user_id, count(distinct p.id)::int as n_pend
    from partido_usuario pu
    join partidos p on p.id = pu.partido_id
    where p.aplica_quiniela
      and (p.gol_local is null or p.gol_visitante is null)
    group by pu.user_id
  )
  select jsonb_build_object(
    'usuarios', coalesce((
      select jsonb_agg(jsonb_build_object(
          'nombre',          u.nombre,
          'invertido',       coalesce(inv.invertido, 0),
          'ganado',          coalesce(prm.ganado, 0),
          'premios_pagados', coalesce(prm.pagado, 0),
          'n_pronosticos',   coalesce(np.n_pron, 0),
          'n_dobles',        coalesce(d.n_dobles, 0),
          'puntos',          coalesce(pt.total, 0),
          'marcadores',      coalesce(pt.m, 0),
          'ganadores',       coalesce(pt.g, 0),
          'pendientes',      coalesce(pe.n_pend, 0),
          'max_posible',     coalesce(pt.total, 0) + 3 * coalesce(pe.n_pend, 0)
        ) order by coalesce(pt.total, 0) desc, u.nombre asc)
      from base_users u
      left join inv     on inv.user_id = u.id
      left join npron   np  on np.user_id  = u.id
      left join dobles  d   on d.user_id   = u.id
      left join pts     pt  on pt.user_id  = u.id
      left join premios prm on prm.user_id = u.id
      left join pend    pe  on pe.user_id  = u.id
    ), '[]'::jsonb),
    'globales', jsonb_build_object(
      'n_usuarios',          (select count(*) from base_users),
      'partidos_jugados',    (select count(*) from partidos
                               where gol_local is not null and gol_visitante is not null),
      'partidos_pendientes', (select count(*) from partidos
                               where aplica_quiniela
                                 and (gol_local is null or gol_visitante is null)),
      'puntos_en_juego',     3 * (select count(*) from partidos
                               where aplica_quiniela
                                 and (gol_local is null or gol_visitante is null)),
      'total_invertido',     coalesce((select sum(invertido) from inv), 0),
      'total_repartido',     coalesce((select sum(ganado) from premios), 0)
    )
  ) into v;

  return v;
end $$;

revoke all on function get_panel_super() from public;
grant execute on function get_panel_super() to authenticated;

-- ============================================================
--  LISTO. La pestaña "Panel Super" del frontend llama a get_panel_super().
-- ============================================================
