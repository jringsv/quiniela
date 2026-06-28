-- ============================================================
--  activar_16avos_dos_pred.sql
--  Activa los 16 partidos de 16avos (números 73–88) para TODOS
--  los usuarios autorizados, con DOS pronósticos (n_pred = 2).
--
--  - "Todos" = perfiles con aprobado = true (incluye admins).
--  - Idempotente: si ya estaba activado, solo asegura n_pred = 2.
--  - Ejecutar en Supabase -> SQL Editor (corre como service-role,
--    por eso puede saltarse el RLS de partido_usuario).
-- ============================================================
insert into partido_usuario (partido_id, user_id, n_pred)
select p.id, pr.id, 2
from partidos p
cross join profiles pr
where p.fase = '16avos'              -- partidos 73–88
  and (pr.aprobado or pr.is_admin)   -- solo usuarios autorizados
on conflict (partido_id, user_id) do update set n_pred = 2;

-- Verificación rápida: cuántas activaciones por partido (debería = nº de aprobados)
select p.numero, p.equipo_local, p.equipo_visitante,
       count(pu.user_id) as usuarios_activados,
       count(*) filter (where pu.n_pred = 2) as con_dos_pred
from partidos p
left join partido_usuario pu on pu.partido_id = p.id
where p.fase = '16avos'
group by p.numero, p.equipo_local, p.equipo_visitante
order by p.numero;
