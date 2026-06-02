-- ============================================================
--  seed_llaves.sql
--  Crea los 32 partidos de eliminatoria (números 73–104) como
--  filas en "partidos", para poder capturar su MARCADOR (3/1) igual
--  que cualquier otro partido, tanto en pronóstico como en real.
--
--  Fechas/horas tomadas de CALENDARIO_LLAVES (js/app.js), zona
--  El Salvador (-06:00). Equipos quedan como 'Por definir'; el admin
--  pone los nombres reales (en el panel) a medida que se resuelven
--  los cruces. A nivel de jugador, una llave SOLO se habilita cuando
--  sus dos equipos ya están definidos (≠ 'Por definir').
--
--  El puntaje usa el marcador con que terminó el partido (sin penales):
--  un 1–1 que se define por penales cuenta como empate. El ganador del
--  cuadro visual se elige aparte (selector en "Resultados reales — llaves").
--
--  Idempotente: solo inserta los números que aún no existen.
--  Ejecutar DESPUÉS de schema.sql / seed_partidos.sql.
-- ============================================================
insert into partidos (numero, fase, grupo, equipo_local, equipo_visitante, fecha, aplica_quiniela)
select v.numero, v.fase, null, 'Por definir', 'Por definir', v.fecha::timestamptz, true
from (values
  (73,  '16avos',       '2026-06-28T13:00:00-06:00'),
  (74,  '16avos',       '2026-06-29T14:30:00-06:00'),
  (75,  '16avos',       '2026-06-29T19:00:00-06:00'),
  (76,  '16avos',       '2026-06-29T11:00:00-06:00'),
  (77,  '16avos',       '2026-06-30T15:00:00-06:00'),
  (78,  '16avos',       '2026-06-30T11:00:00-06:00'),
  (79,  '16avos',       '2026-06-30T19:00:00-06:00'),
  (80,  '16avos',       '2026-07-01T10:00:00-06:00'),
  (81,  '16avos',       '2026-07-01T18:00:00-06:00'),
  (82,  '16avos',       '2026-07-01T14:00:00-06:00'),
  (83,  '16avos',       '2026-07-02T17:00:00-06:00'),
  (84,  '16avos',       '2026-07-02T13:00:00-06:00'),
  (85,  '16avos',       '2026-07-02T21:00:00-06:00'),
  (86,  '16avos',       '2026-07-03T16:00:00-06:00'),
  (87,  '16avos',       '2026-07-03T19:30:00-06:00'),
  (88,  '16avos',       '2026-07-03T12:00:00-06:00'),
  (89,  '8vos',         '2026-07-04T15:00:00-06:00'),
  (90,  '8vos',         '2026-07-04T11:00:00-06:00'),
  (91,  '8vos',         '2026-07-05T14:00:00-06:00'),
  (92,  '8vos',         '2026-07-05T18:00:00-06:00'),
  (93,  '8vos',         '2026-07-06T13:00:00-06:00'),
  (94,  '8vos',         '2026-07-06T18:00:00-06:00'),
  (95,  '8vos',         '2026-07-07T10:00:00-06:00'),
  (96,  '8vos',         '2026-07-07T14:00:00-06:00'),
  (97,  '4tos',         '2026-07-09T14:00:00-06:00'),
  (98,  '4tos',         '2026-07-10T13:00:00-06:00'),
  (99,  '4tos',         '2026-07-11T15:00:00-06:00'),
  (100, '4tos',         '2026-07-11T19:00:00-06:00'),
  (101, 'semis',        '2026-07-14T13:00:00-06:00'),
  (102, 'semis',        '2026-07-15T13:00:00-06:00'),
  (103, 'tercer_puesto','2026-07-18T15:00:00-06:00'),
  (104, 'final',        '2026-07-19T13:00:00-06:00')
) as v(numero, fase, fecha)
where not exists (select 1 from partidos p where p.numero = v.numero);
