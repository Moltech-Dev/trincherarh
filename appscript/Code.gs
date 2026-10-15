/**
 * Code.gs — Punto de entrada de la Web App y enrutador de acciones.
 *
 * Reglas del enrutador:
 *  - GET: solo acciones de lectura públicas marcadas con GET (hoy, únicamente `ping`).
 *  - POST: cuerpo JSON enviado como text/plain (evita el preflight CORS, que Apps Script no soporta).
 *  - Las acciones protegidas exigen sesión válida y un rol permitido; se valida en CADA operación.
 *  - Toda respuesta es HTTP 200 (limitación de Apps Script); el resultado va en success/code.
 *
 * IMPORTANTE (orden de carga): Apps Script evalúa los archivos en el orden de la lista del proyecto.
 * Por eso este archivo NO referencia en el nivel superior variables ni funciones de otros archivos;
 * el catálogo se construye en tiempo de llamada.
 */

var TAMANO_MAXIMO_CUERPO = 100000; // caracteres

/**
 * Catálogo de acciones. `metodos`: verbos admitidos. `publica`: no requiere sesión. `roles`: roles autorizados cuando no
 * es pública. Cada handler recibe (payload, sesion, token, requestId).
 *
 * AL AGREGAR UNA ACCIÓN: (1) regístrala aquí con sus roles; (2) si es lectura, agrégala a LECTURAS en js/auth.js; si es
 * escritura, a ACCIONES_QUE_CAMBIAN_DATOS; (3) cúbrela en la prueba de permisos (tests/prueba-base.js la exige).
 */
function catalogoAcciones_() {
  var ADMIN_ = ['ADMIN'];
  return {
    ping: { metodos: ['GET', 'POST'], publica: true, handler: accionPing_ },
    eco: { metodos: ['POST'], publica: true, handler: accionEco_ },
    login: { metodos: ['POST'], publica: true, handler: accionLogin_ },
    logout: { metodos: ['POST'], publica: false, roles: ROLES, handler: accionLogout_ },
    sesion: { metodos: ['POST'], publica: false, roles: ROLES, handler: accionSesion_ },
    cambiarPassword: { metodos: ['POST'], publica: false, roles: ROLES, handler: accionCambiarPassword_ },

    // Archivos (Archivos.gs): lectura y descarga para todos los roles (el servidor filtra por acceso); sincronizar solo ADMIN
    archivos: { metodos: ['POST'], publica: false, roles: ROLES, handler: accionArchivos_ },
    descargarArchivo: { metodos: ['POST'], publica: false, roles: ROLES, handler: accionDescargarArchivo_ },
    sincronizarArchivos: { metodos: ['POST'], publica: false, roles: ADMIN_, handler: accionSincronizarArchivos_ },

    // Administración (Usuarios.gs): solo ADMIN
    metricas: { metodos: ['POST'], publica: false, roles: ADMIN_, handler: accionMetricas_ },
    resumen: { metodos: ['POST'], publica: false, roles: ADMIN_, handler: accionResumen_ },
    usuarios: { metodos: ['POST'], publica: false, roles: ADMIN_, handler: accionUsuarios_ },
    crearUsuario: { metodos: ['POST'], publica: false, roles: ADMIN_, handler: accionCrearUsuario_ },
    editarUsuario: { metodos: ['POST'], publica: false, roles: ADMIN_, handler: accionEditarUsuario_ }
  };
}

function doGet(e) {
  var accion = (e && e.parameter && e.parameter.action) || 'ping';
  return despachar_('GET', accion, {}, null, null);
}

function doPost(e) {
  var cuerpo = e && e.postData && e.postData.contents;
  if (!cuerpo) {
    return respuestaError_('Solicitud sin cuerpo.', 'SOLICITUD_INVALIDA');
  }
  if (cuerpo.length > TAMANO_MAXIMO_CUERPO) {
    return respuestaError_('Solicitud demasiado grande.', 'SOLICITUD_INVALIDA');
  }

  var solicitud;
  try {
    solicitud = JSON.parse(cuerpo);
  } catch (err) {
    return respuestaError_('El cuerpo no es JSON válido.', 'SOLICITUD_INVALIDA');
  }
  if (!solicitud || typeof solicitud !== 'object' || typeof solicitud.action !== 'string') {
    return respuestaError_('Falta el campo "action".', 'SOLICITUD_INVALIDA');
  }

  var payload = solicitud.payload && typeof solicitud.payload === 'object' ? solicitud.payload : {};
  var requestId = typeof solicitud.requestId === 'string' ? solicitud.requestId : null;
  return despachar_('POST', solicitud.action, payload, solicitud.token || null, requestId);
}

function despachar_(metodo, nombreAccion, payload, token, requestId) {
  reiniciarEjecucion_();
  // "Actualizar" en pantalla pide leer la hoja real (p. ej. tras editarla a mano) en lugar de la copia guardada.
  if (payload && payload.fresco === true) { MODO_LECTURA_ = 'fresco'; }
  try {
    var catalogo = catalogoAcciones_();
    var accion = Object.prototype.hasOwnProperty.call(catalogo, nombreAccion) ? catalogo[nombreAccion] : null;
    if (!accion) {
      return respuestaError_('Acción desconocida.', 'ACCION_DESCONOCIDA');
    }
    if (accion.metodos.indexOf(metodo) === -1) {
      return respuestaError_('Método ' + metodo + ' no permitido para esta acción.', 'METODO_NO_PERMITIDO');
    }

    var sesion = null;
    if (!accion.publica) {
      sesion = validarSesion_(token);
      if (!sesion) {
        return respuestaError_('Sesión requerida o expirada.', 'AUTH_REQUIRED');
      }
      if (accion.roles.indexOf(sesion.rol) === -1) {
        return respuestaError_('No tienes permiso para esta operación.', 'FORBIDDEN');
      }
    }

    return accion.handler(payload, sesion, token, requestId);
  } catch (err) {
    console.error('despachar_ ' + nombreAccion + ': ' + (err && err.stack ? err.stack : err));
    return respuestaError_('Error interno del servidor.', 'ERROR_INTERNO');
  }
}

/* ----------------------------- Acciones públicas ----------------------------- */

/** Sin datos de negocio: solo indica versión y si la base está conectada y con el esquema completo. */
function accionPing_() {
  var estado = estadoBase_();
  return respuestaOk_({
    servicio: NOMBRE_API,
    version: API_VERSION,
    baseConectada: estado.baseConectada,
    hojasCompletas: estado.hojasCompletas
  }, 'API en línea');
}

/** Devuelve lo recibido y la hora del servidor: prueba ida y vuelta del POST text/plain, acentos y zona horaria. */
function accionEco_(payload) {
  var texto = typeof payload.texto === 'string' ? payload.texto.slice(0, 500) : '';
  var ahora = new Date();
  return respuestaOk_({
    texto: texto,
    longitud: texto.length,
    servidor: {
      iso: ahora.toISOString(),
      local: Utilities.formatDate(ahora, zonaHoraria_(), "yyyy-MM-dd'T'HH:mm:ss"),
      zona: zonaHoraria_()
    }
  }, 'Eco correcto');
}
