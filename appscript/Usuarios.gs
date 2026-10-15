/**
 * Usuarios.gs — Administración de usuarios (solo ADMIN): alta, edición, activar/desactivar, restablecer contraseña y
 * elegir qué archivos puede descargar cada uno. También el resumen del panel.
 *
 * Nadie se borra: un usuario se DESACTIVA (y sus sesiones abiertas se invalidan). Quitar un acceso lo deja ACTIVO = FALSE
 * en ACCESOS. La contraseña la teclea el ADMIN al crear o restablecer; se hashea de inmediato y nunca se audita ni se guarda.
 */

var USUARIO_NOMBRE_MAX = 60;
var MAX_ARCHIVOS_POR_USUARIO = 500;
var COL_USUARIOS_ = { PASSWORD: 3, NOMBRE: 4, ROL: 5, ACTIVO: 6 };

/** Todos los usuarios de la hoja USUARIOS (esta hoja nunca se copia: siempre se lee real). */
function listarUsuarios_() {
  var hoja = hojaBase_('USUARIOS');
  var ultima = hoja.getLastRow();
  if (ultima < 2) { return []; }
  return hoja.getRange(2, 1, ultima - 1, ESQUEMA.USUARIOS.length).getValues().map(function (f) {
    return { usuario: String(f[1]), nombre: String(f[3]), rol: String(f[4]), activo: esActivo_(f[5]) };
  });
}

/** Lista de IDs recibida del cliente → arreglo limpio, sin repetidos. Devuelve null si no es una lista válida. */
function leerListaIds_(valor) {
  if (valor === undefined || valor === null) { return []; }
  if (!Array.isArray(valor) || valor.length > MAX_ARCHIVOS_POR_USUARIO) { return null; }
  var vistos = {};
  var lista = [];
  for (var i = 0; i < valor.length; i++) {
    var id = idDe_(valor[i]);
    if (!id) { return null; }
    if (!vistos[id]) { vistos[id] = true; lista.push(id); }
  }
  return lista;
}

/** IDs de los archivos ACTIVOS del catálogo (hoja real, para usar bajo bloqueo). */
function idsArchivosActivos_() {
  var mapa = {};
  leerFilas_('ARCHIVOS').forEach(function (a) { if (String(a.ESTATUS) === 'ACTIVO') { mapa[String(a.ID_ARCHIVO)] = true; } });
  return mapa;
}

/**
 * Deja los accesos de `usuario` sobre los archivos ACTIVOS exactamente en `deseados` (lista de IDs). Los accesos a archivos
 * inactivos no se tocan. Devuelve { agregados, quitados }. Se llama bajo bloqueo.
 */
function aplicarAccesos_(usuario, deseados, otorgadoPor, ahora) {
  var activos = idsArchivosActivos_();
  var quiere = {};
  deseados.forEach(function (id) { quiere[id] = true; });
  var filas = {};
  leerFilas_('ACCESOS').forEach(function (f) { if (String(f.USUARIO).toLowerCase() === usuario) { filas[String(f.ID_ARCHIVO)] = f; } });
  var cuenta = { agregados: 0, quitados: 0 };

  Object.keys(activos).forEach(function (id) {
    var fila = filas[id];
    var vigente = !!fila && esActivo_(fila.ACTIVO);
    if (quiere[id] && !vigente) {
      if (fila) {
        fila.ACTIVO = true; fila.OTORGADO_POR = otorgadoPor; fila.FECHA = ahora.completo;
        guardarFila_('ACCESOS', fila);
      } else {
        insertarFila_('ACCESOS', { USUARIO: usuario, ID_ARCHIVO: id, ACTIVO: true, OTORGADO_POR: otorgadoPor, FECHA: ahora.completo });
      }
      cuenta.agregados++;
    } else if (!quiere[id] && vigente) {
      fila.ACTIVO = false;
      guardarFila_('ACCESOS', fila);
      cuenta.quitados++;
    }
  });
  return cuenta;
}

/** Lectura (ADMIN): usuarios con sus archivos asignados + catálogo de archivos activos para los formularios. */
function accionUsuarios_() {
  var accesos = {};
  leerFilas_('ACCESOS').forEach(function (f) {
    if (!esActivo_(f.ACTIVO)) { return; }
    var u = String(f.USUARIO).toLowerCase();
    (accesos[u] = accesos[u] || []).push(String(f.ID_ARCHIVO));
  });
  var archivos = leerFilas_('ARCHIVOS').filter(function (a) { return String(a.ESTATUS) === 'ACTIVO'; }).map(archivoParaApi_);
  var activos = {};
  archivos.forEach(function (a) { activos[a.idArchivo] = true; });
  var usuarios = listarUsuarios_().map(function (u) {
    u.archivos = (accesos[u.usuario.toLowerCase()] || []).filter(function (id) { return activos[id]; });
    return u;
  });
  return respuestaOk_({ usuarios: usuarios, archivos: archivos }, 'Usuarios consultados');
}

/** Valida nombre, contraseña y lista de archivos comunes a crear/editar; acumula errores por campo. */
function validarArchivosDeUsuario_(payload, errores) {
  var ids = leerListaIds_(payload.archivos);
  if (ids === null) { errores.archivos = 'La lista de archivos no es válida.'; return []; }
  return ids;
}

/** ADMIN: payload { usuario, nombre, rol?, password, archivos?: [ID_ARCHIVO] }. */
function accionCrearUsuario_(payload, sesion, token, requestId) {
  var errores = {};
  var usuario = normalizarUsuario_(payload.usuario);
  if (!usuario) { errores.usuario = 'Usa de 3 a 40 caracteres: letras minúsculas, números, punto, guion o guion bajo.'; }
  var nombre = limpiarTexto_(payload.nombre, USUARIO_NOMBRE_MAX, errores, 'nombre', 'El nombre', true);
  var rol = leerOpcion_(payload.rol === undefined || payload.rol === '' ? 'USUARIO' : payload.rol, ROLES, errores, 'rol', 'un rol');
  var problema = validarPoliticaPassword_(payload.password);
  if (problema) { errores.password = problema; }
  var archivos = validarArchivosDeUsuario_(payload, errores);
  if (Object.keys(errores).length) {
    return respuestaError_('Revisa los datos del formulario.', 'VALIDACION', { campos: errores });
  }

  return aRespuesta_(escrituraIdempotente_(sesion, 'crearUsuario', requestId, function () {
    if (buscarUsuario_(usuario)) {
      return falla_('Ya existe un usuario con ese nombre.', 'DUPLICADO', { campos: { usuario: 'Ya existe.' } });
    }
    var activos = idsArchivosActivos_();
    if (archivos.some(function (id) { return !activos[id]; })) {
      return falla_('Alguno de los archivos elegidos ya no está disponible. Actualiza la lista.', 'VALIDACION', { campos: { archivos: 'Hay archivos que ya no existen.' } });
    }
    // Sin LockService propio: ya estamos bajo el bloqueo global (los bloqueos de Apps Script no son reentrantes).
    insertarUsuario_(usuario, nombre, rol, payload.password);
    var cuenta = rol === 'USUARIO' ? aplicarAccesos_(usuario, archivos, sesion.usuario, ahoraDePared_()) : { agregados: 0, quitados: 0 };
    auditar_(sesion.usuario, 'USUARIO_CREADO', 'USUARIOS', usuario, rol + '; ' + cuenta.agregados + ' archivo(s)');
    return exito_({ usuario: { usuario: usuario, nombre: nombre, rol: rol, activo: true, archivos: rol === 'USUARIO' ? archivos : [] } }, 'Usuario ' + usuario + ' creado');
  }));
}

/** ADMIN: payload { usuario, nombre?, rol?, activo?, password?, archivos?: [ID_ARCHIVO] }. Solo cambia lo que viene. */
function accionEditarUsuario_(payload, sesion, token, requestId) {
  var errores = {};
  var usuario = normalizarUsuario_(payload.usuario);
  if (!usuario) { return respuestaError_('Usuario no válido.', 'VALIDACION', { campos: { usuario: 'Usuario no válido.' } }); }
  var nombre = payload.nombre === undefined ? null : limpiarTexto_(payload.nombre, USUARIO_NOMBRE_MAX, errores, 'nombre', 'El nombre', true);
  var rol = payload.rol === undefined ? null : leerOpcion_(payload.rol, ROLES, errores, 'rol', 'un rol');
  var activo = payload.activo === undefined ? null : payload.activo === true;
  if (payload.activo !== undefined && typeof payload.activo !== 'boolean') { errores.activo = 'Valor no válido.'; }
  var cambiaPassword = typeof payload.password === 'string' && payload.password.length > 0;
  if (cambiaPassword) {
    var problema = validarPoliticaPassword_(payload.password);
    if (problema) { errores.password = problema; }
  }
  var archivos = payload.archivos === undefined ? null : validarArchivosDeUsuario_(payload, errores);
  if (Object.keys(errores).length) {
    return respuestaError_('Revisa los datos del formulario.', 'VALIDACION', { campos: errores });
  }

  return aRespuesta_(escrituraIdempotente_(sesion, 'editarUsuario', requestId, function () {
    var u = buscarUsuario_(usuario);
    if (!u) { return falla_('No se encontró el usuario.', 'NO_ENCONTRADO'); }
    var esYo = usuario === String(sesion.usuario).toLowerCase();
    if (esYo && ((rol !== null && rol !== u.rol) || activo === false)) {
      return falla_('No puedes quitarte tu propio rol de administrador ni desactivarte.', 'ESTADO_INVALIDO');
    }
    if (archivos !== null) {
      var activos = idsArchivosActivos_();
      if (archivos.some(function (id) { return !activos[id]; })) {
        return falla_('Alguno de los archivos elegidos ya no está disponible. Actualiza la lista.', 'VALIDACION', { campos: { archivos: 'Hay archivos que ya no existen.' } });
      }
    }

    var hoja = hojaBase_('USUARIOS');
    var cambios = [];
    var invalidar = false;
    if (nombre !== null && nombre !== u.nombre) {
      hoja.getRange(u.fila, COL_USUARIOS_.NOMBRE).setValue(textoSeguroCelda_(nombre)); cambios.push('nombre');   // la sesión toma el nombre nuevo al revalidarse
    }
    if (rol !== null && rol !== u.rol) {
      hoja.getRange(u.fila, COL_USUARIOS_.ROL).setValue(rol); cambios.push('rol ' + u.rol + '→' + rol); invalidar = true;
    }
    if (activo !== null && activo !== u.activo) {
      hoja.getRange(u.fila, COL_USUARIOS_.ACTIVO).setValue(activo); cambios.push(activo ? 'activado' : 'desactivado'); invalidar = true;
    }
    if (cambiaPassword) {
      hoja.getRange(u.fila, COL_USUARIOS_.PASSWORD).setValue(hashPassword_(payload.password));
      desbloquearUsuario_(usuario);
      cambios.push('contraseña restablecida'); invalidar = true;
    }
    var rolFinal = rol !== null ? rol : u.rol;
    if (archivos !== null && rolFinal === 'USUARIO') {
      var cuenta = aplicarAccesos_(usuario, archivos, sesion.usuario, ahoraDePared_());
      if (cuenta.agregados || cuenta.quitados) { cambios.push('archivos +' + cuenta.agregados + '/-' + cuenta.quitados); }
    }
    // Las sesiones abiertas de ese usuario se cierran (vuelve a entrar con los datos nuevos). Quien se edita a sí mismo conserva la suya.
    if (invalidar && !esYo) { invalidarSesionesDe_(usuario); }
    if (cambios.length) { auditar_(sesion.usuario, 'USUARIO_EDITADO', 'USUARIOS', usuario, cambios.join('; ')); }
    return exito_({ cambios: cambios }, cambios.length ? 'Usuario actualizado' : 'Sin cambios');
  }));
}

/* ------------------------------ Resumen del panel ------------------------------ */

/** ADMIN: números del panel y las últimas descargas (de AUDITORIA, últimas 1000 filas). */
function accionResumen_() {
  var archivos = leerFilas_('ARCHIVOS');
  var activos = archivos.filter(function (a) { return String(a.ESTATUS) === 'ACTIVO'; });
  var ultimaSync = '';
  archivos.forEach(function (a) { if (String(a.FECHA_SYNC) > ultimaSync) { ultimaSync = String(a.FECHA_SYNC); } });
  var usuarios = listarUsuarios_();

  var hoja = hojaBase_('AUDITORIA');
  var ultima = hoja.getLastRow();
  var desde = Math.max(2, ultima - 999);
  var filas = ultima >= 2 ? hoja.getRange(desde, 1, ultima - desde + 1, ESQUEMA.AUDITORIA.length).getValues() : [];
  var zona = zonaHoraria_();
  var hoy = ahoraLocal_().fecha;
  var hace7 = ahoraMs_() - 7 * 86400000;
  var descargasHoy = 0, descargas7 = 0, denegadas7 = 0;
  var recientes = [];
  for (var i = filas.length - 1; i >= 0; i--) {
    var accion = String(filas[i][3]);
    if (accion !== 'ARCHIVO_DESCARGADO' && accion !== 'DESCARGA_DENEGADA') { continue; }
    var fecha = filas[i][1] instanceof Date ? filas[i][1] : new Date(filas[i][1]);
    var texto = Utilities.formatDate(fecha, zona, 'yyyy-MM-dd HH:mm:ss');
    var reciente = fecha.getTime() >= hace7;
    if (accion === 'DESCARGA_DENEGADA') { if (reciente) { denegadas7++; } continue; }
    if (texto.slice(0, 10) === hoy) { descargasHoy++; }
    if (reciente) { descargas7++; }
    if (recientes.length < 10) { recientes.push({ fecha: texto, usuario: String(filas[i][2]), archivo: String(filas[i][6]) }); }
  }
  return respuestaOk_({
    archivosActivos: activos.length, archivosInactivos: archivos.length - activos.length,
    usuariosActivos: usuarios.filter(function (u) { return u.activo; }).length, usuariosTotal: usuarios.length,
    descargasHoy: descargasHoy, descargas7Dias: descargas7, denegadas7Dias: denegadas7,
    ultimaSincronizacion: ultimaSync, carpetaConfigurada: !!leerConfig_('CARPETA_DRIVE_ID'), recientes: recientes
  }, 'Resumen consultado');
}

/* ------------------------------ Métricas del panel ------------------------------ */

var MAX_FILAS_METRICAS = 20000;   // filas de AUDITORIA que se revisan (las más recientes)
var DIAS_METRICAS = 30;
var MESES_METRICAS = 12;
var TOP_ARCHIVOS = 10;

/** Suma `meses` (negativo = atrás) a un mes 'AAAA-MM' sin pasar por Date (sin desfases de zona horaria). */
function mesDesplazado_(mes, meses) {
  var n = parseInt(mes.slice(0, 4), 10) * 12 + (parseInt(mes.slice(5, 7), 10) - 1) + meses;
  return Math.floor(n / 12) + '-' + ('0' + ((n % 12) + 1)).slice(-2);
}

/**
 * ADMIN: actividad por día (últimos 30) y por mes (últimos 12) y los archivos más descargados, calculados desde AUDITORIA:
 *  - descargas: eventos ARCHIVO_DESCARGADO; usuarios: personas distintas que descargaron en ese periodo.
 *  - nuevos: usuarios dados de alta desde el panel (USUARIO_CREADO); el administrador inicial (SETUP) no cuenta.
 */
function accionMetricas_() {
  var zona = zonaHoraria_();
  var hoja = hojaBase_('AUDITORIA');
  var ultima = hoja.getLastRow();
  var desde = Math.max(2, ultima - MAX_FILAS_METRICAS + 1);
  var filas = ultima >= 2 ? hoja.getRange(desde, 1, ultima - desde + 1, ESQUEMA.AUDITORIA.length).getValues() : [];

  var dias = [], meses = [], porDia = {}, porMes = {};
  var hoy = ahoraLocal_().fecha;
  for (var i = DIAS_METRICAS - 1; i >= 0; i--) {
    var f = Utilities.formatDate(new Date(ahoraMs_() - i * 86400000), zona, 'yyyy-MM-dd');
    if (!porDia[f]) { porDia[f] = { descargas: 0, quienes: {}, nuevos: 0 }; dias.push(f); }
  }
  var mesActual = hoy.slice(0, 7);
  for (var m = MESES_METRICAS - 1; m >= 0; m--) {
    var clave = mesDesplazado_(mesActual, -m);
    porMes[clave] = { descargas: 0, quienes: {}, nuevos: 0 };
    meses.push(clave);
  }

  var nombres = {};
  leerFilas_('ARCHIVOS').forEach(function (a) { nombres[String(a.ID_ARCHIVO)] = String(a.NOMBRE); });
  var archivos = {};
  var limite30 = dias[0];
  var totalDescargas = 0;

  filas.forEach(function (fila) {
    var accion = String(fila[3]);
    var descarga = accion === 'ARCHIVO_DESCARGADO';
    var alta = accion === 'USUARIO_CREADO' && String(fila[2]) !== 'SETUP';
    if (!descarga && !alta) { return; }
    var fecha = fila[1] instanceof Date ? fila[1] : new Date(fila[1]);
    var dia = Utilities.formatDate(fecha, zona, 'yyyy-MM-dd');
    var mes = dia.slice(0, 7);
    var quien = String(fila[2]).toLowerCase();
    if (alta) {
      if (porDia[dia]) { porDia[dia].nuevos++; }
      if (porMes[mes]) { porMes[mes].nuevos++; }
      return;
    }
    totalDescargas++;
    if (porDia[dia]) { porDia[dia].descargas++; porDia[dia].quienes[quien] = true; }
    if (porMes[mes]) { porMes[mes].descargas++; porMes[mes].quienes[quien] = true; }
    var id = String(fila[5]);
    var a = archivos[id] || (archivos[id] = { idArchivo: id, nombre: nombres[id] || String(fila[6]), descargas: 0, quienes: {}, ultimos30: 0 });
    a.descargas++;
    a.quienes[quien] = true;
    if (dia >= limite30) { a.ultimos30++; }
  });

  var top = Object.keys(archivos).map(function (id) {
    var a = archivos[id];
    return { idArchivo: a.idArchivo, nombre: a.nombre, descargas: a.descargas, usuarios: Object.keys(a.quienes).length, ultimos30: a.ultimos30 };
  }).sort(function (x, y) { return y.descargas - x.descargas || y.ultimos30 - x.ultimos30 || x.nombre.localeCompare(y.nombre); }).slice(0, TOP_ARCHIVOS);

  return respuestaOk_({
    porDia: dias.map(function (f) { var d = porDia[f]; return { fecha: f, descargas: d.descargas, usuarios: Object.keys(d.quienes).length, nuevos: d.nuevos }; }),
    porMes: meses.map(function (k) { var d = porMes[k]; return { mes: k, descargas: d.descargas, usuarios: Object.keys(d.quienes).length, nuevos: d.nuevos }; }),
    topArchivos: top, totalDescargas: totalDescargas, parcial: desde > 2
  }, 'Métricas consultadas');
}
