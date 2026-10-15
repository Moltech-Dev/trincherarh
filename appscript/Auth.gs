/**
 * Auth.gs — Contraseñas, login, sesiones y control de acceso.
 *
 *  - Contraseñas: PBKDF2-HMAC-SHA256 con sal aleatoria por usuario y un pepper del servidor
 *    (PropertiesService). Formato almacenado: pbkdf2-sha256$<iteraciones>$<salHex>$<hashHex>
 *  - Sesión: token aleatorio de 256 bits; el servidor guarda SOLO su hash SHA-256 en CacheService
 *    con {usuario, nombre, rol, creada, renovada}. El token viaja en el cuerpo del POST.
 *  - Límite de intentos por usuario con bloqueo temporal.
 *  - El rol se toma siempre de la sesión del servidor, nunca del cliente.
 *
 * Limitación conocida: CacheService puede descartar entradas antes de su expiración; en ese caso el
 * usuario simplemente vuelve a iniciar sesión.
 */

function ahoraMs_() {
  return Date.now();
}

/* ------------------------------ Contraseñas ------------------------------ */

function obtenerPepper_() {
  var props = PropertiesService.getScriptProperties();
  var pepper = props.getProperty(PROP_PEPPER);
  if (pepper) {
    return pepper;
  }
  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    pepper = props.getProperty(PROP_PEPPER);
    if (!pepper) {
      pepper = aleatorioHex64_();
      props.setProperty(PROP_PEPPER, pepper);
    }
  } finally {
    lock.releaseLock();
  }
  return pepper;
}

function derivarHash_(password, salHex, iteraciones) {
  // El pepper actúa como clave HMAC sobre la contraseña; el resultado alimenta PBKDF2.
  var previo = hmacSha256_(utf8_(obtenerPepper_()), utf8_(password));
  return aHex_(pbkdf2Sha256_(previo, deHex_(salHex), iteraciones));
}

function hashPassword_(password) {
  var salHex = (Utilities.getUuid()).replace(/-/g, '');
  return HASH_PREFIJO + '$' + PBKDF2_ITERACIONES + '$' + salHex + '$' + derivarHash_(password, salHex, PBKDF2_ITERACIONES);
}

function verificarPassword_(password, almacenado) {
  var partes = String(almacenado || '').split('$');
  if (partes.length !== 4 || partes[0] !== HASH_PREFIJO) {
    return false;
  }
  var iteraciones = parseInt(partes[1], 10);
  if (!(iteraciones > 0) || iteraciones > 5000000) {
    return false;
  }
  return igualesConstante_(derivarHash_(password, partes[2], iteraciones), partes[3]);
}

/** Devuelve un mensaje de error si la contraseña no cumple la política; null si es válida. */
function validarPoliticaPassword_(password) {
  if (typeof password !== 'string') {
    return 'La contraseña es obligatoria.';
  }
  if (password.length < PASSWORD_MIN) {
    return 'La contraseña debe tener al menos ' + PASSWORD_MIN + ' caracteres.';
  }
  if (password.length > PASSWORD_MAX) {
    return 'La contraseña no puede exceder ' + PASSWORD_MAX + ' caracteres.';
  }
  return null;
}

/* -------------------------------- Usuarios -------------------------------- */

function normalizarUsuario_(usuario) {
  if (typeof usuario !== 'string') {
    return null;
  }
  var u = usuario.trim().toLowerCase();
  return /^[a-z0-9._-]{3,40}$/.test(u) ? u : null;
}

function esActivo_(valor) {
  return valor === true || String(valor).toUpperCase() === 'TRUE';
}

/** Busca un usuario en la hoja USUARIOS. Devuelve null si no existe. */
function buscarUsuario_(usuarioNormalizado) {
  var hoja = hojaBase_('USUARIOS');
  var ultima = hoja.getLastRow();
  if (ultima < 2) {
    return null;
  }
  var filas = hoja.getRange(2, 1, ultima - 1, ESQUEMA.USUARIOS.length).getValues();
  for (var i = 0; i < filas.length; i++) {
    if (String(filas[i][1]).trim().toLowerCase() === usuarioNormalizado) {
      return {
        fila: i + 2,
        id: filas[i][0],
        usuario: String(filas[i][1]),
        hash: String(filas[i][2]),
        nombre: String(filas[i][3]),
        rol: String(filas[i][4]),
        activo: esActivo_(filas[i][5])
      };
    }
  }
  return null;
}

function siguienteIdUsuario_(hoja) {
  var n = Math.max(hoja.getLastRow() - 1, 0) + 1;
  return 'USR-' + ('0000' + n).slice(-4);
}

/** Crea un usuario. Quien llama debe verificar antes que no exista. */
function insertarUsuario_(usuario, nombre, rol, password) {
  var hoja = hojaBase_('USUARIOS');
  var fila = [siguienteIdUsuario_(hoja), usuario, hashPassword_(password), nombre, rol, true];
  hoja.getRange(hoja.getLastRow() + 1, 1, 1, fila.length).setValues([fila]);
}

/* ------------------------------ Límite de intentos ------------------------------ */

function claveIntentos_(usuario) {
  return 'int:' + usuario;
}

function estaBloqueado_(usuario) {
  return !!CacheService.getScriptCache().get('bloq:' + usuario);
}

/** Registra un fallo; devuelve true si con este fallo el usuario queda bloqueado. */
function registrarFallo_(usuario) {
  var cache = CacheService.getScriptCache();
  var lock = LockService.getScriptLock();
  lock.waitLock(5000);
  try {
    var intentos = (parseInt(cache.get(claveIntentos_(usuario)), 10) || 0) + 1;
    if (intentos >= MAX_INTENTOS) {
      cache.put('bloq:' + usuario, '1', BLOQUEO_SEG);
      cache.remove(claveIntentos_(usuario));
      return true;
    }
    cache.put(claveIntentos_(usuario), String(intentos), BLOQUEO_SEG);
    return false;
  } finally {
    lock.releaseLock();
  }
}

function limpiarIntentos_(usuario) {
  CacheService.getScriptCache().remove(claveIntentos_(usuario));
}

/* ------------------------------ Sesiones ------------------------------ */

function hashToken_(token) {
  return aHex_(sha256_(utf8_(String(token))));
}

function crearSesion_(u) {
  var token = aleatorioHex64_();
  var ahora = ahoraMs_();
  CacheService.getScriptCache().put(
    'ses:' + hashToken_(token),
    JSON.stringify({ usuario: u.usuario, nombre: u.nombre, rol: u.rol, creada: ahora, renovada: ahora }),
    SESION_INACTIVIDAD_SEG
  );
  return token;
}

function cerrarSesion_(token) {
  CacheService.getScriptCache().remove('ses:' + hashToken_(token));
}

/** Devuelve { usuario, nombre, rol } si el token corresponde a una sesión vigente; null en caso contrario. */
function validarSesion_(token) {
  if (!token || typeof token !== 'string' || token.length < 32 || token.length > 256) {
    return null;
  }
  var cache = CacheService.getScriptCache();
  var clave = 'ses:' + hashToken_(token);
  var crudo = cache.get(clave);
  if (!crudo) {
    return null;
  }
  var sesion;
  try {
    sesion = JSON.parse(crudo);
  } catch (err) {
    return null;
  }

  var ahora = ahoraMs_();
  if (ahora - sesion.creada > SESION_MAXIMA_SEG * 1000) {
    cache.remove(clave);
    return null;
  }
  // Sesiones anteriores a un restablecimiento de contraseña, cambio de rol o desactivación quedan invalidadas.
  var marca = cache.get('inv:' + String(sesion.usuario).toLowerCase());
  if (marca && sesion.creada < parseInt(marca, 10)) {
    cache.remove(clave);
    return null;
  }

  if (ahora - sesion.renovada > SESION_REVALIDAR_SEG * 1000) {
    var u = buscarUsuario_(normalizarUsuario_(sesion.usuario) || '');
    if (!u || !u.activo || ROLES.indexOf(u.rol) === -1) {
      cache.remove(clave);
      return null;
    }
    sesion.rol = u.rol;
    sesion.nombre = u.nombre;
    sesion.renovada = ahora;
    cache.put(clave, JSON.stringify(sesion), SESION_INACTIVIDAD_SEG);
  }
  return { usuario: sesion.usuario, nombre: sesion.nombre, rol: sesion.rol };
}

/* ------------------------------ Acciones ------------------------------ */

// Hash de relleno para igualar el tiempo de respuesta cuando el usuario no existe.
// Función (no constante global): Apps Script carga los archivos en el orden de la lista y no se
// puede depender de variables de otros archivos al momento de la carga.
function hashRelleno_() {
  return HASH_PREFIJO + '$' + PBKDF2_ITERACIONES + '$00000000000000000000000000000000$' + new Array(65).join('0');
}

function accionLogin_(payload) {
  var credencialesInvalidas = function () {
    return respuestaError_('Usuario o contraseña incorrectos.', 'CREDENCIALES_INVALIDAS');
  };

  var usuario = normalizarUsuario_(payload.usuario);
  var password = payload.password;
  if (!usuario || typeof password !== 'string' || password.length === 0 || password.length > PASSWORD_MAX) {
    return credencialesInvalidas();
  }

  if (estaBloqueado_(usuario)) {
    return respuestaError_('Demasiados intentos fallidos. Intenta de nuevo en 15 minutos.', 'BLOQUEADO');
  }

  var u = buscarUsuario_(usuario);
  var valido = verificarPassword_(password, u ? u.hash : hashRelleno_());

  if (!u || !u.activo || ROLES.indexOf(u.rol) === -1 || !valido) {
    var bloqueado = registrarFallo_(usuario);
    if (u) {
      auditar_(u.usuario, bloqueado ? 'LOGIN_BLOQUEADO' : 'LOGIN_FALLIDO', 'USUARIOS', u.id, '');
    }
    if (bloqueado) {
      return respuestaError_('Demasiados intentos fallidos. Intenta de nuevo en 15 minutos.', 'BLOQUEADO');
    }
    return credencialesInvalidas();
  }

  limpiarIntentos_(usuario);
  var token = crearSesion_(u);
  auditar_(u.usuario, 'LOGIN_OK', 'USUARIOS', u.id, '');
  return respuestaOk_({
    token: token,
    usuario: { usuario: u.usuario, nombre: u.nombre, rol: u.rol },
    expiraEnSegundos: SESION_INACTIVIDAD_SEG
  }, 'Sesión iniciada');
}

function accionLogout_(payload, sesion, token) {
  cerrarSesion_(token);
  auditar_(sesion.usuario, 'LOGOUT', 'USUARIOS', '', '');
  return respuestaOk_({}, 'Sesión cerrada');
}

/** Invalida todas las sesiones abiertas de un usuario (las creadas antes de este instante). */
function invalidarSesionesDe_(usuario) {
  CacheService.getScriptCache().put('inv:' + String(usuario).toLowerCase(), String(ahoraMs_()), SESION_INACTIVIDAD_SEG);
}

/** Levanta el bloqueo temporal y el conteo de intentos fallidos de un usuario. */
function desbloquearUsuario_(usuario) {
  var cache = CacheService.getScriptCache();
  cache.remove('bloq:' + usuario);
  cache.remove(claveIntentos_(usuario));
}

function accionSesion_(payload, sesion) {
  return respuestaOk_({
    usuario: sesion.usuario,
    nombre: sesion.nombre,
    rol: sesion.rol,
    negocio: {
      nombre: leerConfig_('NOMBRE_NEGOCIO') || 'Trinchera RH',
      moneda: leerConfig_('MONEDA') || 'MXN'
    }
  }, 'Sesión válida');
}

function accionCambiarPassword_(payload, sesion) {
  var usuario = normalizarUsuario_(sesion.usuario);
  var actual = payload.actual;
  var nueva = payload.nueva;

  if (typeof actual !== 'string' || typeof nueva !== 'string') {
    return respuestaError_('Debes indicar la contraseña actual y la nueva.', 'SOLICITUD_INVALIDA');
  }
  var problema = validarPoliticaPassword_(nueva);
  if (problema) {
    return respuestaError_(problema, 'PASSWORD_DEBIL');
  }
  if (nueva === actual) {
    return respuestaError_('La nueva contraseña debe ser distinta de la actual.', 'PASSWORD_DEBIL');
  }
  if (estaBloqueado_(usuario)) {
    return respuestaError_('Demasiados intentos fallidos. Intenta de nuevo en 15 minutos.', 'BLOQUEADO');
  }

  var u = buscarUsuario_(usuario);
  if (!u || !u.activo) {
    return respuestaError_('Sesión requerida o expirada.', 'AUTH_REQUIRED');
  }
  if (!verificarPassword_(actual, u.hash)) {
    var bloqueado = registrarFallo_(usuario);
    auditar_(u.usuario, bloqueado ? 'LOGIN_BLOQUEADO' : 'PASSWORD_ACTUAL_INCORRECTA', 'USUARIOS', u.id, '');
    return respuestaError_(bloqueado ? 'Demasiados intentos fallidos. Intenta de nuevo en 15 minutos.' : 'La contraseña actual es incorrecta.', bloqueado ? 'BLOQUEADO' : 'CREDENCIALES_INVALIDAS');
  }

  limpiarIntentos_(usuario);
  establecerHashUsuario_(u.fila, hashPassword_(nueva));
  auditar_(u.usuario, 'PASSWORD_CAMBIADA', 'USUARIOS', u.id, '');
  return respuestaOk_({}, 'Contraseña actualizada');
}

function establecerHashUsuario_(fila, hash) {
  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    hojaBase_('USUARIOS').getRange(fila, 3).setValue(hash);
  } finally {
    lock.releaseLock();
  }
}
