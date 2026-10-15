/**
 * api.js — Cliente de la API de Apps Script.
 *
 * Decisiones de conectividad (ver references/arquitectura.md de la skill apps-script-sheets-webapp):
 *  - POST con Content-Type: text/plain;charset=utf-8 y el JSON como cuerpo. Es una "solicitud simple"
 *    de CORS: el navegador NO envía preflight (OPTIONS), que Apps Script no soporta.
 *  - Sin headers personalizados (Authorization, X-*): forzarían preflight. El token va en el cuerpo.
 *  - Sin credenciales/cookies (credentials: 'omit'); la Web App se despliega con acceso "Cualquier persona".
 *  - Apps Script responde 302 hacia script.googleusercontent.com; fetch sigue la redirección y esa
 *    respuesta final incluye Access-Control-Allow-Origin: *.
 *  - Los GET se limitan a lecturas públicas sin datos sensibles; nada sensible en la query string.
 */
(function () {
  'use strict';

  class ApiError extends Error {
    constructor(message, code) {
      super(message);
      this.name = 'ApiError';
      this.code = code || 'ERROR';
    }
  }

  function urlBase() {
    const url = (window.APP_CONFIG && window.APP_CONFIG.API_URL) || '';
    if (!/^https:\/\/script\.google\.com\/macros\/s\/[^/]+\/exec$/.test(url)) {
      throw new ApiError('API_URL no está configurada o no tiene el formato https://script.google.com/macros/s/<ID>/exec', 'NO_CONFIGURADA');
    }
    return url;
  }

  function nuevoIdSolicitud() {
    if (window.crypto && typeof window.crypto.randomUUID === 'function') {
      return window.crypto.randomUUID();
    }
    return 'req-' + Date.now() + '-' + Math.random().toString(16).slice(2);
  }

  // Acciones que legítimamente tardan más que una consulta normal (leer toda una carpeta de Drive, entregar un archivo grande).
  const TIMEOUT_LARGO_MS = { sincronizarArchivos: 170000, descargarArchivo: 90000 };

  async function ejecutar(url, opciones, esperaMs) {
    const controlador = new AbortController();
    const limite = setTimeout(() => controlador.abort(), esperaMs || window.APP_CONFIG.API_TIMEOUT_MS);
    let respuesta;
    try {
      respuesta = await fetch(url, Object.assign({}, opciones, {
        redirect: 'follow',
        credentials: 'omit',
        signal: controlador.signal
      }));
    } catch (err) {
      if (err.name === 'AbortError') {
        throw new ApiError('Tiempo de espera agotado al contactar la API.', 'TIMEOUT');
      }
      throw new ApiError('No se pudo contactar la API (red, CORS o URL incorrecta).', 'RED');
    } finally {
      clearTimeout(limite);
    }

    const texto = await respuesta.text();
    let json;
    try {
      json = JSON.parse(texto);
    } catch (err) {
      // Apps Script devuelve una página HTML (login de Google o error) si el despliegue no es público o falló.
      throw new ApiError('La API no devolvió JSON (HTTP ' + respuesta.status + '). Revisa que el despliegue tenga acceso "Cualquier persona" y que la URL sea la de /exec.', 'RESPUESTA_NO_JSON');
    }
    if (!json || typeof json.success !== 'boolean') {
      throw new ApiError('Respuesta fuera del contrato {success, message, data}.', 'CONTRATO');
    }
    return json;
  }

  /** Lectura pública vía GET (solo `ping` en Fase 1). */
  function get(action) {
    const url = urlBase() + '?action=' + encodeURIComponent(action);
    return ejecutar(url, { method: 'GET' });
  }

  /**
   * Operación vía POST. Devuelve el sobre completo {success, message, data, code?} para que el
   * llamador decida; no lanza por errores de negocio, solo por fallos de transporte/contrato.
   * `requestId` identifica la operación lógica: en escrituras, reintentar con el MISMO requestId
   * hace que el servidor devuelva el resultado original en lugar de repetir la operación.
   */
  function post(action, payload, token, requestId) {
    const cuerpo = JSON.stringify({
      action: action,
      payload: payload || {},
      token: token || null,
      requestId: requestId || nuevoIdSolicitud()
    });
    const inicio = performance.now();
    return ejecutar(urlBase(), {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: cuerpo
    }, TIMEOUT_LARGO_MS[action]).then(function (json) {
      registrar(action, inicio, json, null);
      return json;
    }, function (err) {
      registrar(action, inicio, null, err);
      throw err;
    });
  }

  // Últimas llamadas (acción, tiempo total, tiempo que tardó el servidor en procesarla y error si lo hubo): sirven para ver
  // si una lentitud viene de la conexión/arranque de Apps Script (total muy mayor que servidor) o del programa.
  const ultimas = [];
  function registrar(accion, inicio, json, err) {
    ultimas.push({
      accion: accion,
      total: Math.round(performance.now() - inicio),
      servidor: json && typeof json.ms === 'number' ? json.ms : null,
      error: err ? (err.code || 'ERROR') : null
    });
    if (ultimas.length > 40) ultimas.shift();
  }

  window.Api = Object.freeze({ get, post, ApiError, nuevoIdSolicitud, ultimas });
})();
