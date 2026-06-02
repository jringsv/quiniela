// ============================================================
//  CONFIGURACIÓN — Pega aquí los datos de TU proyecto Supabase
//  (Supabase -> Project Settings -> API)
// ============================================================
window.QUINIELA_CONFIG = {
  // URL del proyecto, ej: "https://abcdxyz.supabase.co"
  SUPABASE_URL: "https://stroxsyzojuwhbalamob.supabase.co",

  // Clave pública "anon" (es segura para el navegador, la protege el RLS)
  SUPABASE_ANON_KEY: "sb_publishable_-Z8l-mWgN6OwHNaaHsHs_A_IAKlEwlc",

  // Reglas de puntaje (informativo / se muestran en la UI).
  // El cálculo REAL vive en la función get_leaderboard() de la base de datos.
  REGLAS: {
    marcador_exacto: 3,    // marcador exacto con goles
    ganador_acertado: 1,   // acertar el resultado (gane o empate)
    // Las llaves (avance/posiciones) ya NO otorgan puntos: solo arman el cuadro.
  },

  // Cuántos equipos clasifican a cada fase (para validar la quiniela del usuario)
  CUPOS_FASE: { "16avos": 32, "8vos": 16, "4tos": 8, "semis": 4 },

  // Etiquetas legibles
  FASES_LABEL: {
    grupos: "Fase de grupos",
    "16avos": "16avos (Ronda de 32)",
    "8vos": "Octavos de final",
    "4tos": "Cuartos de final",
    semis: "Semifinales",
    tercer_puesto: "Tercer puesto",
    final: "Final",
  },
};
