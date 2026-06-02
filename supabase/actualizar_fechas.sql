-- ============================================================
--  Rellenar FECHA y HORA de los 72 partidos de la fase de grupos.
--  NO destructivo: actualiza por 'numero' sin borrar partidos
--  ni las predicciones ya guardadas (conserva los id).
--  Ejecutar en: Supabase -> SQL Editor -> New query -> Run
--  Hora en zona de El Salvador (UTC-6).
-- ============================================================
update partidos p
set fecha = v.fecha
from (values
  (1,  '2026-06-11T13:00:00-06:00'::timestamptz),
  (2,  '2026-06-11T20:00:00-06:00'::timestamptz),
  (3,  '2026-06-12T13:00:00-06:00'::timestamptz),
  (4,  '2026-06-12T19:00:00-06:00'::timestamptz),
  (5,  '2026-06-13T19:00:00-06:00'::timestamptz),
  (6,  '2026-06-13T22:00:00-06:00'::timestamptz),
  (7,  '2026-06-13T16:00:00-06:00'::timestamptz),
  (8,  '2026-06-13T13:00:00-06:00'::timestamptz),
  (9,  '2026-06-14T17:00:00-06:00'::timestamptz),
  (10, '2026-06-14T11:00:00-06:00'::timestamptz),
  (11, '2026-06-14T14:00:00-06:00'::timestamptz),
  (12, '2026-06-14T20:00:00-06:00'::timestamptz),
  (13, '2026-06-15T16:00:00-06:00'::timestamptz),
  (14, '2026-06-15T10:00:00-06:00'::timestamptz),
  (15, '2026-06-15T19:00:00-06:00'::timestamptz),
  (16, '2026-06-15T13:00:00-06:00'::timestamptz),
  (17, '2026-06-16T13:00:00-06:00'::timestamptz),
  (18, '2026-06-16T16:00:00-06:00'::timestamptz),
  (19, '2026-06-16T19:00:00-06:00'::timestamptz),
  (20, '2026-06-16T22:00:00-06:00'::timestamptz),
  (21, '2026-06-17T17:00:00-06:00'::timestamptz),
  (22, '2026-06-17T14:00:00-06:00'::timestamptz),
  (23, '2026-06-17T11:00:00-06:00'::timestamptz),
  (24, '2026-06-17T20:00:00-06:00'::timestamptz),
  (25, '2026-06-18T10:00:00-06:00'::timestamptz),
  (26, '2026-06-18T13:00:00-06:00'::timestamptz),
  (27, '2026-06-18T16:00:00-06:00'::timestamptz),
  (28, '2026-06-18T19:00:00-06:00'::timestamptz),
  (29, '2026-06-19T18:30:00-06:00'::timestamptz),
  (30, '2026-06-19T16:00:00-06:00'::timestamptz),
  (31, '2026-06-19T21:00:00-06:00'::timestamptz),
  (32, '2026-06-19T13:00:00-06:00'::timestamptz),
  (33, '2026-06-20T14:00:00-06:00'::timestamptz),
  (34, '2026-06-20T18:00:00-06:00'::timestamptz),
  (35, '2026-06-20T11:00:00-06:00'::timestamptz),
  (36, '2026-06-20T22:00:00-06:00'::timestamptz),
  (37, '2026-06-21T16:00:00-06:00'::timestamptz),
  (38, '2026-06-21T10:00:00-06:00'::timestamptz),
  (39, '2026-06-21T13:00:00-06:00'::timestamptz),
  (40, '2026-06-21T19:00:00-06:00'::timestamptz),
  (41, '2026-06-22T18:00:00-06:00'::timestamptz),
  (42, '2026-06-22T15:00:00-06:00'::timestamptz),
  (43, '2026-06-22T11:00:00-06:00'::timestamptz),
  (44, '2026-06-22T21:00:00-06:00'::timestamptz),
  (45, '2026-06-23T14:00:00-06:00'::timestamptz),
  (46, '2026-06-23T17:00:00-06:00'::timestamptz),
  (47, '2026-06-23T11:00:00-06:00'::timestamptz),
  (48, '2026-06-23T20:00:00-06:00'::timestamptz),
  (49, '2026-06-24T16:00:00-06:00'::timestamptz),
  (50, '2026-06-24T16:00:00-06:00'::timestamptz),
  (51, '2026-06-24T13:00:00-06:00'::timestamptz),
  (52, '2026-06-24T13:00:00-06:00'::timestamptz),
  (53, '2026-06-24T19:00:00-06:00'::timestamptz),
  (54, '2026-06-24T19:00:00-06:00'::timestamptz),
  (55, '2026-06-25T14:00:00-06:00'::timestamptz),
  (56, '2026-06-25T14:00:00-06:00'::timestamptz),
  (57, '2026-06-25T17:00:00-06:00'::timestamptz),
  (58, '2026-06-25T17:00:00-06:00'::timestamptz),
  (59, '2026-06-25T20:00:00-06:00'::timestamptz),
  (60, '2026-06-25T20:00:00-06:00'::timestamptz),
  (61, '2026-06-26T13:00:00-06:00'::timestamptz),
  (62, '2026-06-26T13:00:00-06:00'::timestamptz),
  (63, '2026-06-26T21:00:00-06:00'::timestamptz),
  (64, '2026-06-26T21:00:00-06:00'::timestamptz),
  (65, '2026-06-26T18:00:00-06:00'::timestamptz),
  (66, '2026-06-26T18:00:00-06:00'::timestamptz),
  (67, '2026-06-27T15:00:00-06:00'::timestamptz),
  (68, '2026-06-27T15:00:00-06:00'::timestamptz),
  (69, '2026-06-27T20:00:00-06:00'::timestamptz),
  (70, '2026-06-27T20:00:00-06:00'::timestamptz),
  (71, '2026-06-27T17:30:00-06:00'::timestamptz),
  (72, '2026-06-27T17:30:00-06:00'::timestamptz)
) as v(numero, fecha)
where p.numero = v.numero and p.fase = 'grupos';

-- Comprobar cuántos partidos quedaron con fecha:
-- select count(*) filter (where fecha is not null) as con_fecha, count(*) as total
-- from partidos where fase = 'grupos';
