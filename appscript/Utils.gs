/**
 * Utils.gs — Respuestas JSON, apertura de la base, configuración, fechas del negocio y escritura de filas.
 */

/**
 * Apps Script no permite fijar códigos HTTP: toda respuesta es 200.
 * El resultado se comunica con success + code (code es un añadido al contrato base).
 */
function responder_(objeto) {
  // `ms`: lo que tardó el servidor en procesar esta solicitud (para distinguir lentitud del programa de lentitud de red/arranque).
  if (INICIO_EJECUCION_ > 0) { objeto.ms = Date.now() - INICIO_EJECUCION_; }
  return ContentService
    .createTextOutput(JSON.stringify(objeto))
    .setMimeType(ContentService.MimeType.JSON);
}

function respuestaOk_(data, message) {
  return responder_({
    success: true,
    message: message || 'Operación realizada correctamente',
    data: data === undefined ? {} : data
  });
}

/** `extra` (opcional) agrega campos al sobre de error; p. ej. { campos: { placas: 'Formato inválido' } }. */
function respuestaError_(message, code, extra) {
  var sobre = {
    success: false,
    message: message,
    code: code || 'ERROR',
    data: null
  };
  if (extra) {
    Object.keys(extra).forEach(function (k) { sobre[k] = extra[k]; });
  }
  return responder_(sobre);
}

/**
 * Neutraliza la inyección de fórmulas: un texto de usuario que empiece por = + - @ (o tabulación/retorno)
 * se guarda con un apóstrofo inicial para que Sheets lo trate como texto.
 */
function textoSeguroCelda_(valor) {
  var s = valor === null || valor === undefined ? '' : String(valor);
  return /^[=+\-@\t\r]/.test(s) ? "'" + s : s;
}

/** Agrega una fila a AUDITORIA (solo se agregan filas; nunca se modifican ni borran). No debe romper la operación principal. */
function auditar_(usuario, accion, entidad, idRegistro, detalle) {
  try {
    var hoja = hojaBase_('AUDITORIA');
    var fila = [Utilities.getUuid(), new Date(), textoSeguroCelda_(usuario), accion, entidad, textoSeguroCelda_(idRegistro), textoSeguroCelda_(detalle)];
    hoja.getRange(hoja.getLastRow() + 1, 1, 1, fila.length).setValues([fila]);
  } catch (err) {
    console.error('auditar_: ' + err);
  }
}

/* ------------------------- Configuración y fechas del negocio ------------------------- */

// Memo de CONFIGURACION por ejecución (se reinicia al inicio de cada solicitud y al escribir configuración).
var MEMO_CONFIG_ = null;

function reiniciarMemoConfig_() {
  MEMO_CONFIG_ = null;
  MEMO_INSTANTES_ = {};
}

/* ------------------------- Lectura rápida de hojas ------------------------- */

/*
 * Abrir el archivo de Sheets y leer cada pestaña cuesta de 1 a 2 s en Apps Script; CacheService responde en milisegundos.
 * Por eso las hojas de datos se leen una vez y se guardan como copia en CacheService, ligada a una "versión": cualquier
 * escritura de esta API cambia la versión y las copias anteriores dejan de usarse al instante. Lo que lo hace seguro:
 *  - Una escritura (bajo bloqueo) NUNCA lee copias: siempre ve la hoja real, así que no actúa sobre filas desactualizadas.
 *  - Lo que alguien edite A MANO en la hoja se ve al expirar la copia (TTL_COPIA_HOJA_S) o con payload.fresco = true.
 *  - USUARIOS y AUDITORIA nunca se copian.
 */
// Agrega aquí cada hoja de DATOS nueva (nunca USUARIOS ni AUDITORIA).
var HOJAS_CON_COPIA = ['ARCHIVOS', 'ACCESOS', 'CONFIGURACION'];
var TTL_COPIA_HOJA_S = 300;
var TTL_VERSION_COPIA_S = 21600;
var PIEZA_COPIA_CARACTERES = 30000;   // CacheService admite 100 KB por valor; se deja margen para acentos
var MAX_PIEZAS_COPIA = 90;
var LOTE_CLAVES_CACHE = 40;

var INICIO_EJECUCION_ = Date.now();
var MEMO_LIBRO_ = null;
var MEMO_HOJAS_ = {};
var MEMO_VALORES_ = {};
var MEMO_VERSION_COPIA_ = null;
var MODO_LECTURA_ = 'normal';   // 'normal' | 'fresco' (ignora la copia y la renueva) | 'escritura' (hoja real, sin copias)
var DATOS_MODIFICADOS_ = false;

/** Estado limpio al comenzar cada solicitud (en Apps Script cada ejecución arranca de cero; el simulador de pruebas no). */
function reiniciarEjecucion_() {
  INICIO_EJECUCION_ = Date.now();
  MEMO_LIBRO_ = null;
  MEMO_HOJAS_ = {};
  MEMO_VALORES_ = {};
  MEMO_VERSION_COPIA_ = null;
  MODO_LECTURA_ = 'normal';
  DATOS_MODIFICADOS_ = false;
  reiniciarMemoConfig_();
}

/** Hoja por nombre, sin volver a abrir el archivo en cada uso (una vez por ejecución). */
function hojaBase_(nombre) {
  if (MEMO_HOJAS_[nombre]) { return MEMO_HOJAS_[nombre]; }
  var libro = abrirBase_();
  var hoja = libro ? libro.getSheetByName(nombre) : null;
  if (hoja) { MEMO_HOJAS_[nombre] = hoja; }
  return hoja;
}

function versionCopiaHojas_() {
  if (MEMO_VERSION_COPIA_ !== null) { return MEMO_VERSION_COPIA_; }
  var cache = CacheService.getScriptCache();
  var v = cache.get('dv');
  if (!v) {
    v = Utilities.getUuid().replace(/-/g, '').slice(0, 12);
    cache.put('dv', v, TTL_VERSION_COPIA_S);
  }
  MEMO_VERSION_COPIA_ = v;
  return v;
}

/** Descarta todas las copias de hojas (cambia la versión). Se llama tras cualquier escritura en una hoja con copia. */
function invalidarCopiasHojas_() {
  MEMO_VALORES_ = {};
  var nueva = Utilities.getUuid().replace(/-/g, '').slice(0, 12);
  try {
    CacheService.getScriptCache().put('dv', nueva, TTL_VERSION_COPIA_S);
    MEMO_VERSION_COPIA_ = nueva;
  } catch (err) {
    MEMO_VERSION_COPIA_ = null;
    try { CacheService.getScriptCache().remove('dv'); } catch (err2) { console.error('invalidarCopiasHojas_: ' + err2); }
  }
}

/** Avisa que se escribió en una hoja: dentro de un bloqueo se invalida al primer cambio y otra vez al terminar. */
function marcarDatosModificados_() {
  MEMO_VALORES_ = {};
  if (MODO_LECTURA_ === 'escritura') {
    if (!DATOS_MODIFICADOS_) {
      DATOS_MODIFICADOS_ = true;
      invalidarCopiasHojas_();
    }
  } else {
    invalidarCopiasHojas_();
  }
}

function reemplazarFechas_(clave, valor) {
  var original = this[clave];
  if (Object.prototype.toString.call(original) === '[object Date]') { return { __f: original.getTime() }; }
  return valor;
}

function reviverFechas_(clave, valor) {
  if (valor && typeof valor === 'object' && valor.__f !== undefined && Object.keys(valor).length === 1) { return new Date(valor.__f); }
  return valor;
}

function claveCopiaHoja_(version, nombre, i) {
  return 'h:' + version + ':' + nombre + ':' + i;
}

/** Copia guardada de una hoja (matriz de valores) o null si no hay, está incompleta o falla CacheService. */
function leerCopiaHoja_(nombre, version) {
  try {
    var cache = CacheService.getScriptCache();
    var primera = cache.get(claveCopiaHoja_(version, nombre, 0));
    if (primera === null || primera === undefined) { return null; }
    var corte = primera.indexOf('|');
    var n = parseInt(primera.slice(0, corte), 10);
    if (!(n >= 1) || n > MAX_PIEZAS_COPIA) { return null; }
    var texto = primera.slice(corte + 1);
    for (var i = 1; i < n; i += LOTE_CLAVES_CACHE) {
      var claves = [];
      for (var j = i; j < Math.min(n, i + LOTE_CLAVES_CACHE); j++) { claves.push(claveCopiaHoja_(version, nombre, j)); }
      var lote = cache.getAll(claves);
      for (var k = 0; k < claves.length; k++) {
        var pieza = lote[claves[k]];
        if (pieza === undefined || pieza === null) { return null; }
        texto += pieza;
      }
    }
    return JSON.parse(texto, reviverFechas_);
  } catch (err) {
    return null;
  }
}

/** Guarda la copia en piezas; la pieza 0 (que lleva el total de piezas) se escribe al final para no exponer copias a medias. */
function guardarCopiaHoja_(nombre, version, valores) {
  try {
    var texto = JSON.stringify(valores, reemplazarFechas_);
    var n = Math.max(1, Math.ceil(texto.length / PIEZA_COPIA_CARACTERES));
    if (n > MAX_PIEZAS_COPIA) { return; }   // hoja muy grande: se lee siempre de Sheets
    var cache = CacheService.getScriptCache();
    var pieza = function (i) { return texto.substr(i * PIEZA_COPIA_CARACTERES, PIEZA_COPIA_CARACTERES); };
    for (var i = 1; i < n; i += LOTE_CLAVES_CACHE) {
      var lote = {};
      for (var j = i; j < Math.min(n, i + LOTE_CLAVES_CACHE); j++) { lote[claveCopiaHoja_(version, nombre, j)] = pieza(j); }
      cache.putAll(lote, TTL_COPIA_HOJA_S);
    }
    cache.put(claveCopiaHoja_(version, nombre, 0), n + '|' + pieza(0), TTL_COPIA_HOJA_S);
  } catch (err) {
    console.error('guardarCopiaHoja_ ' + nombre + ': ' + err);
  }
}

/** Matriz de valores de una hoja (sin encabezado), de la copia si es seguro usarla y, si no, de Sheets. */
function valoresHoja_(nombre) {
  var copiable = HOJAS_CON_COPIA.indexOf(nombre) !== -1 && MODO_LECTURA_ !== 'escritura';
  var version = null;
  if (copiable) {
    if (MODO_LECTURA_ !== 'fresco' && MEMO_VALORES_[nombre]) { return MEMO_VALORES_[nombre]; }
    try {
      version = versionCopiaHojas_();   // la versión se lee ANTES que la hoja: una copia vieja nunca queda bajo una versión nueva
    } catch (err) {
      copiable = false;               // CacheService no responde: se lee de la hoja y se sigue
    }
  }
  if (copiable) {
    if (MODO_LECTURA_ !== 'fresco') {
      var copia = leerCopiaHoja_(nombre, version);
      if (copia !== null) { MEMO_VALORES_[nombre] = copia; return copia; }
    }
  }
  var hoja = hojaBase_(nombre);
  var ultima = hoja.getLastRow();
  var valores = ultima < 2 ? [] : hoja.getRange(2, 1, ultima - 1, ESQUEMA[nombre].length).getValues();
  if (copiable) {
    guardarCopiaHoja_(nombre, version, valores);
    MEMO_VALORES_[nombre] = valores;
  }
  return valores;
}

/** Lee un valor de la hoja CONFIGURACION (clave–valor). Devuelve null si no existe la clave. */
function leerConfig_(clave) {
  if (MEMO_CONFIG_ === null) {
    MEMO_CONFIG_ = {};
    valoresHoja_('CONFIGURACION').forEach(function (f) {
      MEMO_CONFIG_[String(f[0])] = String(f[1]);
    });
  }
  return Object.prototype.hasOwnProperty.call(MEMO_CONFIG_, clave) ? MEMO_CONFIG_[clave] : null;
}

/** Lee todas las filas de una hoja como objetos { COLUMNA: valor, _fila: n } (una sola lectura de la hoja). */
function leerFilas_(nombreHoja) {
  var columnas = ESQUEMA[nombreHoja];
  return valoresHoja_(nombreHoja).map(function (valores, i) {
    var o = { _fila: i + 2 };
    for (var j = 0; j < columnas.length; j++) {
      o[columnas[j]] = valores[j];
    }
    return o;
  });
}

/** Escribe una celda de una fila existente, identificada por hoja, número de fila y nombre de columna. */
function escribirCelda_(nombreHoja, fila, columna, valor) {
  var indice = ESQUEMA[nombreHoja].indexOf(columna);
  if (indice === -1) {
    throw new Error('Columna inexistente: ' + nombreHoja + '.' + columna);
  }
  hojaBase_(nombreHoja).getRange(fila, indice + 1).setValue(valor);
  marcarDatosModificados_();
}

/** Ejecuta `fn` bajo el bloqueo global del script; si no se obtiene a tiempo devuelve OCUPADO sin ejecutar nada. */
function conBloqueo_(fn) {
  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(ESPERA_BLOQUEO_MS);
  } catch (err) {
    return { ok: false, message: 'El sistema está ocupado. Intenta de nuevo en unos segundos.', code: 'OCUPADO' };
  }
  // Bajo bloqueo siempre se lee la hoja real (nunca una copia) para no escribir sobre datos desactualizados.
  var modoPrevio = MODO_LECTURA_;
  MODO_LECTURA_ = 'escritura';
  MEMO_VALORES_ = {};
  reiniciarMemoConfig_();
  try {
    return fn();
  } finally {
    MODO_LECTURA_ = modoPrevio;
    if (DATOS_MODIFICADOS_) {
      DATOS_MODIFICADOS_ = false;
      invalidarCopiasHojas_();
    }
    lock.releaseLock();
  }
}

var MENSAJE_BASE_PENDIENTE = 'Falta preparar la base de datos: un administrador debe ejecutar inicializarBase en Apps Script tras la actualización.';

/** true si inicializarBase ya aplicó el esquema y los formatos de esta versión (sin esto no se escribe: se corromperían fechas y placas). */
function baseLista_() {
  return PropertiesService.getScriptProperties().getProperty(PROP_FORMATOS) === VERSION_FORMATOS;
}

/** Convierte el resultado interno { ok, data, message } / { ok:false, message, code, extra } en la respuesta HTTP. */
function aRespuesta_(r) {
  if (r.ok) {
    return respuestaOk_(r.data, r.message);
  }
  return respuestaError_(r.message, r.code, r.extra);
}

function falla_(message, code, extra) {
  return { ok: false, message: message, code: code || 'ERROR', extra: extra };
}

function exito_(data, message) {
  return { ok: true, data: data, message: message };
}

/**
 * Operación de escritura idempotente y exclusiva: bajo bloqueo, si el requestId ya produjo un resultado devuelve
 * ese mismo resultado (marcado repetida); si no, ejecuta `fn` y guarda su resultado exitoso.
 * `fn` devuelve exito_(...) o falla_(...).
 */
function escrituraIdempotente_(sesion, nombre, requestId, fn) {
  if (!baseLista_()) {
    return falla_(MENSAJE_BASE_PENDIENTE, 'CONFIGURACION_PENDIENTE');
  }
  if (requestId !== null && requestId !== undefined && !/^[A-Za-z0-9-]{8,64}$/.test(String(requestId))) {
    return falla_('Identificador de solicitud inválido.', 'SOLICITUD_INVALIDA');
  }
  return conBloqueo_(function () {
    var cache = CacheService.getScriptCache();
    var clave = 'idem:' + nombre + ':' + sesion.usuario + ':' + requestId;
    if (requestId) {
      var previo = cache.get(clave);
      if (previo) {
        var datos = JSON.parse(previo);
        datos.repetida = true;
        return exito_(datos, 'Esta operación ya estaba registrada (solicitud repetida).');
      }
    }
    var r = fn();
    if (r.ok && requestId) {
      r.data.repetida = false;
      cache.put(clave, JSON.stringify(r.data), IDEMPOTENCIA_TTL_SEG);
    }
    return r;
  });
}

/** Texto obligatorio de 'motivo' (descuentos, cancelaciones, liberaciones con saldo). Devuelve { motivo } o { error }. */
function leerMotivo_(valor) {
  var s = typeof valor === 'string' ? valor.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim() : '';
  if (s.length < MOTIVO_MIN) {
    return { error: 'Indica el motivo (al menos ' + MOTIVO_MIN + ' caracteres).' };
  }
  if (s.length > 200) {
    return { error: 'El motivo no puede exceder 200 caracteres.' };
  }
  return { motivo: s };
}

/** Zona horaria del negocio (CONFIGURACION.ZONA_HORARIA); si es inválida o falta, la zona por defecto de abajo. */
function zonaHoraria_() {
  var porDefecto = 'America/Mexico_City';   // cambia a la zona de tu negocio (y en appsscript.json)
  var zona = leerConfig_('ZONA_HORARIA') || porDefecto;
  try {
    Utilities.formatDate(new Date(ahoraMs_()), zona, 'yyyy');
    return zona;
  } catch (err) {
    return porDefecto;
  }
}

/** Fecha y hora actuales en la zona del negocio, como texto (sin depender de UTC ni del navegador). */
function ahoraLocal_() {
  var completo = Utilities.formatDate(new Date(ahoraMs_()), zonaHoraria_(), 'yyyy-MM-dd HH:mm:ss');
  return { fecha: completo.slice(0, 10), hora: completo.slice(11, 16), completo: completo, anio: completo.slice(0, 4) };
}

/**
 * Agrega una fila a una hoja a partir de un objeto { COLUMNA: valor }, respetando el orden del ESQUEMA.
 * Las columnas ausentes quedan vacías. Devuelve el número de fila escrita.
 */
function agregarFila_(nombreHoja, valores) {
  var hoja = hojaBase_(nombreHoja);
  var columnas = ESQUEMA[nombreHoja];
  var fila = columnas.map(function (c) { return Object.prototype.hasOwnProperty.call(valores, c) ? valores[c] : ''; });
  var numero = hoja.getLastRow() + 1;
  hoja.getRange(numero, 1, 1, columnas.length).setValues([fila]);
  marcarDatosModificados_();
  return numero;
}

/**
 * Abre el archivo de Sheets. Prioridad: propiedad privada SPREADSHEET_ID;
 * si no existe, el archivo al que está vinculado el script. Devuelve null si no hay ninguno.
 */
function abrirBase_() {
  if (MEMO_LIBRO_ !== null) { return MEMO_LIBRO_; }   // abrir el archivo cuesta ~1 s: una sola vez por ejecución
  var id = PropertiesService.getScriptProperties().getProperty(PROP_SPREADSHEET_ID);
  var libro = id ? SpreadsheetApp.openById(id) : SpreadsheetApp.getActiveSpreadsheet();
  if (libro) { MEMO_LIBRO_ = libro; }
  return libro;
}

/**
 * Estado del esquema sin exponer nombres de hojas ni datos.
 * Seguro para el endpoint público de diagnóstico.
 */
function estadoBase_() {
  var estado = { baseConectada: false, hojasCompletas: false };
  try {
    var libro = abrirBase_();
    if (!libro) {
      return estado;
    }
    estado.baseConectada = true;
    var completas = true;
    Object.keys(ESQUEMA).forEach(function (nombre) {
      var hoja = libro.getSheetByName(nombre);
      if (!hoja) {
        completas = false;
        return;
      }
      var encabezados = hoja.getRange(1, 1, 1, ESQUEMA[nombre].length).getValues()[0];
      if (encabezados.join('|') !== ESQUEMA[nombre].join('|')) {
        completas = false;
      }
    });
    estado.hojasCompletas = completas;
  } catch (err) {
    console.error('estadoBase_: ' + err);
  }
  return estado;
}
