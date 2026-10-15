/**
 * Archivos.gs — Catálogo de archivos de una carpeta de Google Drive y su descarga con permisos.
 *
 * Los archivos NO se alojan en el servidor: viven en Drive y este script (que corre como la cuenta dueña) los lee con
 * DriveApp. Solo se pueden descargar archivos registrados en la hoja ARCHIVOS (por sincronización de la carpeta) y solo
 * por quien tenga acceso (ACCESOS) o sea ADMIN: el cliente nunca manda un ID de Drive, manda el ID interno del catálogo.
 *
 * El archivo viaja dentro de la respuesta JSON en base64 (Apps Script no sirve binarios), por eso hay un tope de tamaño.
 */

var TIPOS_NATIVOS_EXPORTABLES_ = ['document', 'spreadsheet', 'presentation', 'drawing'];

function archivoParaApi_(a) {
  return {
    idArchivo: String(a.ID_ARCHIVO), nombre: String(a.NOMBRE), mime: String(a.MIME), tamano: Number(a.TAMANO_BYTES) || 0,
    categoria: String(a.CATEGORIA), estatus: String(a.ESTATUS), fechaSync: String(a.FECHA_SYNC)
  };
}

/** Mapa { ID_ARCHIVO: true } de los accesos VIGENTES de un usuario (hoja ACCESOS). */
function accesosVigentesDe_(usuario) {
  var u = String(usuario).toLowerCase();
  var mapa = {};
  leerFilas_('ACCESOS').forEach(function (f) {
    if (String(f.USUARIO).toLowerCase() === u && esActivo_(f.ACTIVO)) { mapa[String(f.ID_ARCHIVO)] = true; }
  });
  return mapa;
}

/** Lectura: payload { q?: texto }. ADMIN ve todo el catálogo; USUARIO solo lo activo que se le asignó. */
function accionArchivos_(payload, sesion) {
  var q = typeof payload.q === 'string' ? payload.q.trim().toLowerCase().slice(0, 60) : '';
  var esAdmin = sesion.rol === 'ADMIN';
  var permitidos = esAdmin ? null : accesosVigentesDe_(sesion.usuario);
  var lista = leerFilas_('ARCHIVOS').filter(function (a) {
    if (!esAdmin && (String(a.ESTATUS) !== 'ACTIVO' || !permitidos[String(a.ID_ARCHIVO)])) { return false; }
    return !q || (String(a.NOMBRE) + ' ' + String(a.CATEGORIA)).toLowerCase().indexOf(q) !== -1;
  }).slice(0, MAX_FILAS_CONSULTA).map(archivoParaApi_);
  var data = { archivos: lista, total: lista.length };
  if (esAdmin) { data.carpetaConfigurada = !!leerConfig_('CARPETA_DRIVE_ID'); }
  return respuestaOk_(data, 'Archivos consultados');
}

/* ------------------------------ Sincronizar la carpeta de Drive ------------------------------ */

/** Acepta el enlace de la carpeta (…/folders/<id>) o el ID suelto. Devuelve '' si no se reconoce. */
function idCarpetaDe_(valor) {
  var s = typeof valor === 'string' ? valor.trim() : '';
  var m = /\/folders\/([A-Za-z0-9_-]{10,})/.exec(s) || /[?&]id=([A-Za-z0-9_-]{10,})/.exec(s);
  if (m) { return m[1]; }
  return /^[A-Za-z0-9_-]{10,}$/.test(s) ? s : '';
}

function textoArchivo_(valor, max) {
  return String(valor === null || valor === undefined ? '' : valor).replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
}

var MIME_CARPETA_ = 'application/vnd.google-apps.folder';

/**
 * Hijos directos de una carpeta: [{ id, name, mime, size }] (las subcarpetas traen mime de carpeta). Sin la papelera.
 * Con el servicio avanzado Drive (v3, declarado en appsscript.json) es UNA llamada por carpeta; leer archivo por archivo con
 * DriveApp cuesta varias llamadas por archivo y una carpeta grande rebasaba el tiempo de espera. Si el servicio avanzado no
 * está disponible se usa DriveApp (más lento pero equivalente). El ID de carpeta solo trae [A-Za-z0-9_-]: no inyecta en la consulta.
 */
function hijosDeCarpeta_(idCarpeta) {
  var lista = [];
  if (typeof Drive !== 'undefined' && Drive.Files && typeof Drive.Files.list === 'function') {
    var pagina = null;
    do {
      var r = Drive.Files.list({
        q: "'" + idCarpeta + "' in parents and trashed = false", fields: 'nextPageToken, files(id, name, mimeType, size)', pageSize: 1000,
        pageToken: pagina || undefined, supportsAllDrives: true, includeItemsFromAllDrives: true
      });
      (r.files || []).forEach(function (f) { lista.push({ id: String(f.id), name: String(f.name), mime: String(f.mimeType), size: Number(f.size) || 0 }); });
      pagina = r.nextPageToken || null;
    } while (pagina);
    return lista;
  }
  var carpeta = DriveApp.getFolderById(idCarpeta);
  var archivosIt = carpeta.getFiles();
  while (archivosIt.hasNext()) {
    var f = archivosIt.next();
    if (!f.isTrashed()) { lista.push({ id: String(f.getId()), name: String(f.getName()), mime: String(f.getMimeType()), size: Number(f.getSize()) || 0 }); }
  }
  var carpetasIt = carpeta.getFolders();
  while (carpetasIt.hasNext()) {
    var c = carpetasIt.next();
    lista.push({ id: String(c.getId()), name: String(c.getName()), mime: MIME_CARPETA_, size: 0 });
  }
  return lista;
}

/**
 * Recorre la carpeta (y sus subcarpetas) y devuelve los archivos descargables. La categoría es la ruta de subcarpetas.
 * Omite la papelera, los accesos directos y los tipos de Google que no se pueden exportar (formularios, sitios…).
 */
function listarCarpetaDrive_(idCarpeta) {
  DriveApp.getFolderById(idCarpeta);   // falla si la carpeta no existe o la cuenta no tiene acceso (el servicio avanzado devolvería una lista vacía)
  var pendientes = [{ id: idCarpeta, ruta: '' }];
  var archivos = [];
  var truncado = false;
  while (pendientes.length && !truncado) {
    var actual = pendientes.shift();
    hijosDeCarpeta_(actual.id).forEach(function (h) {
      if (truncado) { return; }
      if (h.mime === MIME_CARPETA_) {
        pendientes.push({ id: h.id, ruta: actual.ruta ? actual.ruta + ' / ' + h.name : h.name });
        return;
      }
      var nativo = /^application\/vnd\.google-apps\.(.+)$/.exec(h.mime);
      if (nativo && TIPOS_NATIVOS_EXPORTABLES_.indexOf(nativo[1]) === -1) { return; }
      if (archivos.length >= MAX_ARCHIVOS_SYNC) { truncado = true; return; }
      archivos.push({
        driveId: h.id, nombre: textoArchivo_(h.name, NOMBRE_ARCHIVO_MAX) || 'Sin nombre', mime: h.mime,
        tamano: nativo ? 0 : h.size, categoria: textoArchivo_(actual.ruta, 100) || 'General'
      });
    });
  }
  return { archivos: archivos, truncado: truncado };
}

/** Escribe un valor de CONFIGURACION (la clave debe existir: la siembra inicializarBase). Se llama bajo bloqueo. */
function guardarConfig_(clave, valor) {
  var hoja = hojaBase_('CONFIGURACION');
  var ultima = hoja.getLastRow();
  var filas = ultima >= 2 ? hoja.getRange(2, 1, ultima - 1, 2).getValues() : [];
  for (var i = 0; i < filas.length; i++) {
    if (String(filas[i][0]) === clave) {
      hoja.getRange(i + 2, 2).setValue(valor);
      marcarDatosModificados_();
      reiniciarMemoConfig_();
      return;
    }
  }
  throw new Error('Falta ' + clave + ' en CONFIGURACION. Ejecuta inicializarBase.');
}

/** Solo ADMIN: payload { carpeta?: enlace o ID }. Sin `carpeta` usa la guardada. Registra nuevos, actualiza y marca INACTIVOS. */
function accionSincronizarArchivos_(payload, sesion, token, requestId) {
  var errores = {};
  var nueva = '';
  if (typeof payload.carpeta === 'string' && payload.carpeta.trim()) {
    nueva = idCarpetaDe_(payload.carpeta);
    if (!nueva) { errores.carpeta = 'No reconozco el enlace o el ID de la carpeta de Drive.'; }
  }
  if (Object.keys(errores).length) {
    return respuestaError_('Revisa los datos del formulario.', 'VALIDACION', { campos: errores });
  }

  return aRespuesta_(escrituraIdempotente_(sesion, 'sincronizarArchivos', requestId, function () {
    var idCarpeta = nueva || String(leerConfig_('CARPETA_DRIVE_ID') || '');
    if (!idCarpeta) {
      return falla_('Indica la carpeta de Drive con los archivos.', 'VALIDACION', { campos: { carpeta: 'Pega el enlace de la carpeta de Drive.' } });
    }
    var listado;
    try {
      listado = listarCarpetaDrive_(idCarpeta);
    } catch (err) {
      console.error('sincronizarArchivos: ' + err);
      return falla_('No se pudo abrir la carpeta de Drive. Revisa el enlace y que la carpeta esté en tu Drive o compartida con la cuenta que publicó el sistema.', 'DRIVE_NO_DISPONIBLE', { campos: { carpeta: 'No se pudo abrir esta carpeta.' } });
    }

    var ahora = ahoraDePared_();
    var existentes = {};
    leerFilas_('ARCHIVOS').forEach(function (a) { existentes[String(a.DRIVE_ID)] = a; });
    var vistos = {};
    var cuenta = { nuevos: 0, actualizados: 0, inactivados: 0 };
    var filasNuevas = [];

    listado.archivos.forEach(function (d) {
      if (vistos[d.driveId]) { return; }   // un archivo con varios padres aparece más de una vez: se registra una sola
      vistos[d.driveId] = true;
      var previo = existentes[d.driveId];
      if (!previo) {
        filasNuevas.push(filaParaHoja_('ARCHIVOS', {
          ID_ARCHIVO: 'ARC-' + Utilities.getUuid().replace(/-/g, '').slice(0, 10), DRIVE_ID: d.driveId, NOMBRE: d.nombre, MIME: d.mime,
          TAMANO_BYTES: d.tamano, CATEGORIA: d.categoria, ESTATUS: 'ACTIVO', FECHA_SYNC: ahora.completo
        }));
        cuenta.nuevos++;
      } else if (String(previo.NOMBRE) !== d.nombre || String(previo.MIME) !== d.mime || Number(previo.TAMANO_BYTES) !== d.tamano ||
                 String(previo.CATEGORIA) !== d.categoria || String(previo.ESTATUS) !== 'ACTIVO') {
        previo.NOMBRE = d.nombre; previo.MIME = d.mime; previo.TAMANO_BYTES = d.tamano; previo.CATEGORIA = d.categoria;
        previo.ESTATUS = 'ACTIVO'; previo.FECHA_SYNC = ahora.completo;
        guardarFila_('ARCHIVOS', previo);
        cuenta.actualizados++;
      }
    });
    if (filasNuevas.length) {   // todas las filas nuevas en una sola escritura (una por archivo era lentísimo)
      var hojaArchivos = hojaBase_('ARCHIVOS');
      hojaArchivos.getRange(hojaArchivos.getLastRow() + 1, 1, filasNuevas.length, filasNuevas[0].length).setValues(filasNuevas);
      marcarDatosModificados_();
    }
    // Si el listado se truncó no se puede afirmar que lo que falta ya no existe: no se inactiva nada.
    if (!listado.truncado) {
      Object.keys(existentes).forEach(function (driveId) {
        var a = existentes[driveId];
        if (!vistos[driveId] && String(a.ESTATUS) === 'ACTIVO') {
          a.ESTATUS = 'INACTIVO'; a.FECHA_SYNC = ahora.completo;
          guardarFila_('ARCHIVOS', a);
          cuenta.inactivados++;
        }
      });
    }
    if (nueva && nueva !== String(leerConfig_('CARPETA_DRIVE_ID') || '')) { guardarConfig_('CARPETA_DRIVE_ID', nueva); }

    auditar_(sesion.usuario, 'ARCHIVOS_SINCRONIZADOS', 'ARCHIVOS', '', cuenta.nuevos + ' nuevos; ' + cuenta.actualizados + ' actualizados; ' + cuenta.inactivados + ' inactivos');
    var msg = 'Sincronizado: ' + cuenta.nuevos + ' nuevo(s), ' + cuenta.actualizados + ' actualizado(s), ' + cuenta.inactivados + ' ya no está(n) en la carpeta.' +
      (listado.truncado ? ' Atención: la carpeta tiene más de ' + MAX_ARCHIVOS_SYNC + ' archivos; solo se registraron los primeros.' : '');
    return exito_({ nuevos: cuenta.nuevos, actualizados: cuenta.actualizados, inactivados: cuenta.inactivados, truncado: listado.truncado }, msg);
  }));
}

/* ------------------------------ Descarga ------------------------------ */

/** payload { idArchivo }. Verifica sesión (ya hecha), archivo activo y acceso; devuelve el contenido en base64. */
function accionDescargarArchivo_(payload, sesion) {
  var id = idDe_(payload.idArchivo);
  if (!id) { return respuestaError_('Archivo no válido.', 'VALIDACION'); }
  // Los permisos se leen siempre al día: quitar un acceso o desactivar un archivo se aplica de inmediato, no al expirar la copia.
  MODO_LECTURA_ = 'fresco';
  var a = leerFilas_('ARCHIVOS').filter(function (f) { return String(f.ID_ARCHIVO) === id; })[0];
  if (!a || String(a.ESTATUS) !== 'ACTIVO') { return respuestaError_('El archivo no está disponible.', 'NO_ENCONTRADO'); }
  if (sesion.rol !== 'ADMIN' && !accesosVigentesDe_(sesion.usuario)[id]) {
    auditar_(sesion.usuario, 'DESCARGA_DENEGADA', 'ARCHIVOS', id, textoSeguroCelda_(String(a.NOMBRE)));
    return respuestaError_('No tienes permiso para descargar este archivo.', 'FORBIDDEN');
  }

  var maxMb = parseInt(leerConfig_('TAMANO_MAX_MB'), 10);
  if (!(maxMb >= 1 && maxMb <= 40)) { maxMb = TAMANO_MAX_MB_DEFECTO; }
  var maxBytes = maxMb * 1048576;
  var demasiado = function () { return respuestaError_('El archivo pesa más de ' + maxMb + ' MB y no se puede descargar desde aquí. Avisa al administrador.', 'ARCHIVO_MUY_GRANDE'); };

  var archivo;
  try {
    archivo = DriveApp.getFileById(String(a.DRIVE_ID));
    if (archivo.isTrashed()) { throw new Error('en la papelera'); }
  } catch (err) {
    auditar_(sesion.usuario, 'DESCARGA_FALLIDA', 'ARCHIVOS', id, 'No está en Drive');
    return respuestaError_('El archivo ya no está en Drive. Avisa al administrador.', 'ARCHIVO_NO_DISPONIBLE');
  }
  var nativo = /^application\/vnd\.google-apps\./.test(String(archivo.getMimeType()));
  if (!nativo && Number(archivo.getSize()) > maxBytes) { return demasiado(); }

  var blob = nativo ? archivo.getAs('application/pdf') : archivo.getBlob();
  var bytes = blob.getBytes();
  if (bytes.length > maxBytes) { return demasiado(); }

  var nombre = String(a.NOMBRE);
  if (nativo && !/\.pdf$/i.test(nombre)) { nombre += '.pdf'; }
  auditar_(sesion.usuario, 'ARCHIVO_DESCARGADO', 'ARCHIVOS', id, textoSeguroCelda_(nombre));
  return respuestaOk_({
    idArchivo: id, nombre: nombre, mime: String(blob.getContentType() || 'application/octet-stream'), tamano: bytes.length,
    base64: Utilities.base64Encode(bytes)
  }, 'Archivo listo');
}
