-- ============================================================
--  migracion_auto_activar_llaves_dos_pred.sql
--  HABILITACIÓN AUTOMÁTICA DE LLAVES (8vos → final) CON 2 PRONÓSTICOS.
--
--  Problema que resuelve: hasta ahora cada ronda de eliminatoria se
--  activaba a mano (p. ej. activar_16avos_dos_pred.sql). Los equipos de
--  cada llave se rellenan solos vía propagarLlaves() (js/app.js) a medida
--  que se cargan resultados, dejando de ser 'Por definir'. Este trigger
--  engancha ahí: EN CUANTO una llave queda FORMADA (sus dos equipos son
--  reales), se habilita sola para TODOS los usuarios autorizados con
--  n_pred = 2. Aplica a 8vos, 4tos, semis, tercer_puesto y final —
--  y también a 16avos (idempotente si ya estaban activados).
--
--  - "Todos" = perfiles con aprobado = true o is_admin = true.
--  - Solo llaves (fase <> 'grupos'). Los grupos siguen su flujo manual.
--  - Idempotente: on conflict asegura n_pred = 2 sin duplicar filas.
--  - NO desactiva: si una llave se "des-define" (se borra un resultado y
--    vuelve a 'Por definir'), las filas quedan; el frontend igual oculta
--    la llave hasta que se redefina. Al redefinirse, el trigger reafirma.
--
--  Ejecutar DESPUÉS de:
--    schema.sql, migracion_bracket.sql, migracion_aprobacion.sql,
--    migracion_dos_pred_y_activacion.sql (crea partido_usuario).
--  Es idempotente (se puede correr varias veces sin efecto extra).
-- ============================================================

-- ------------------------------------------------------------
-- 1) FUNCIÓN DEL TRIGGER
--    Se dispara tras actualizar una fila de "partidos". Si la llave
--    quedó formada (ambos equipos reales) y hubo cambio de equipos,
--    activa a todos los autorizados con 2 pronósticos.
-- ------------------------------------------------------------
create or replace function auto_activar_llave()
returns trigger
language plpgsql
security definer
set search_path = public as $$
begin
  -- Solo llaves; los grupos no se autoactivan por aquí.
  if new.fase = 'grupos' then
    return new;
  end if;

  -- La llave debe estar FORMADA: sus dos equipos ya no son 'Por definir'.
  if new.equipo_local is null or new.equipo_visitante is null
     or new.equipo_local = 'Por definir' or new.equipo_visitante = 'Por definir' then
    return new;
  end if;

  -- Solo actuar en la TRANSICIÓN a formada (cambió algún equipo). Evita
  -- reactivar en cada guardado que no toca esta llave.
  if new.equipo_local is not distinct from old.equipo_local
     and new.equipo_visitante is not distinct from old.equipo_visitante then
    return new;
  end if;

  -- Habilitar a TODOS los autorizados con dos pronósticos.
  insert into partido_usuario (partido_id, user_id, n_pred)
  select new.id, pr.id, 2
  from profiles pr
  where pr.aprobado or pr.is_admin
  on conflict (partido_id, user_id) do update set n_pred = 2;

  return new;
end $$;

-- ------------------------------------------------------------
-- 2) TRIGGER en "partidos"
-- ------------------------------------------------------------
drop trigger if exists trg_auto_activar_llave on partidos;
create trigger trg_auto_activar_llave
  after update of equipo_local, equipo_visitante on partidos
  for each row
  execute function auto_activar_llave();

-- ------------------------------------------------------------
-- 3) BACKFILL: activar YA las llaves que en este momento ya están
--    formadas (p. ej. los 8vos que ya salieron). Idempotente.
-- ------------------------------------------------------------
insert into partido_usuario (partido_id, user_id, n_pred)
select p.id, pr.id, 2
from partidos p
cross join profiles pr
where p.fase <> 'grupos'
  and p.equipo_local  is not null and p.equipo_local  <> 'Por definir'
  and p.equipo_visitante is not null and p.equipo_visitante <> 'Por definir'
  and (pr.aprobado or pr.is_admin)
on conflict (partido_id, user_id) do update set n_pred = 2;

-- ------------------------------------------------------------
-- 4) VERIFICACIÓN: llaves formadas y cuántos usuarios quedaron activos.
--    Las que aún son 'Por definir' aparecen con 0 (se activarán solas).
-- ------------------------------------------------------------
select p.numero, p.fase, p.equipo_local, p.equipo_visitante,
       count(pu.user_id) filter (where pu.n_pred = 2) as activos_con_2
from partidos p
left join partido_usuario pu on pu.partido_id = p.id
where p.fase <> 'grupos'
group by p.numero, p.fase, p.equipo_local, p.equipo_visitante
order by p.numero;

-- ============================================================
--  LISTO. De aquí en adelante, cada llave (8vos → final) se habilita
--  sola con 2 pronósticos en cuanto sus dos equipos quedan definidos.
-- ============================================================
