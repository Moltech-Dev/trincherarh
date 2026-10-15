/**
 * config.js — Configuración pública del frontend.
 * La URL de la Web App de Apps Script NO es un secreto (no autentica); aquí solo se centraliza.
 * Nunca colocar contraseñas, tokens ni IDs privados en este archivo.
 *
 * Pega aquí la URL de despliegue (termina en /exec) tras publicar appscript/ como Web App.
 * Mientras esté vacía, la app fallará de forma explícita (no se simula ninguna respuesta).
 */
window.APP_CONFIG = Object.freeze({
  API_URL: 'https://script.google.com/macros/s/AKfycbxD-pf_PEjsYtWvpoX1k69fzk5pl_YOke2sGDSbP_XWAHcmM0dsOhz8NdLhbzL0g4Hg/exec',
  API_TIMEOUT_MS: 30000
});
