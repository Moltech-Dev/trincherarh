/**
 * Setup.gs — Inicialización del archivo de Google Sheets. Se ejecuta MANUALMENTE desde el editor de Apps Script (no está
 * expuesto por la Web App).
 *
 * inicializarBase() es idempotente: crea las hojas que falten, escribe encabezados solo en hojas vacías, AMPLÍA
 * encabezados de hojas existentes cuando el esquema agrega columnas al final (sin tocar datos) y siembra CONFIGURACION
 * con las claves que falten. Nunca borra ni sobrescribe datos existentes. Al terminar marca VERSION_FORMATOS como
 * aplicada: hasta entonces las escrituras responden CONFIGURACION_PENDIENTE.
 */
function inicializarBase() {
  var libro = abrirBase_();
  if (!libro) {
    throw new Error('No hay archivo de Sheets. Vincula el script al archivo o define la propiedad SPREADSHEET_ID.');
  }

  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    Object.keys(ESQUEMA).forEach(function (nombre) {
      var encabezados = ESQUEMA[nombre];
      var hoja = libro.getSheetByName(nombre) || libro.insertSheet(nombre);

      if (hoja.getLastRow() === 0) {
        hoja.getRange(1, 1, 1, encabezados.length).setValues([encabezados]);
        hoja.setFrozenRows(1);
        hoja.getRange(1, 1, 1, encabezados.length).setFontWeight('bold');
      } else {
        ampliarEncabezados_(hoja, nombre, encabezados);
      }
    });

    sembrarConfiguracion_(libro);
    // sembrarCatalogoX_(libro);   // aquí: datos iniciales de catálogos (tarifas, tipos...), solo si la hoja está vacía
    aplicarFormatosTexto_(libro);

    // Hoja por defecto sobrante de un archivo nuevo.
    var porDefecto = libro.getSheetByName('Hoja 1') || libro.getSheetByName('Sheet1');
    if (porDefecto && libro.getSheets().length > 1 && porDefecto.getLastRow() === 0) {
      libro.deleteSheet(porDefecto);
    }
  } finally {
    invalidarCopiasHojas_();
    lock.releaseLock();
  }

  Logger.log('Base inicializada. Estado: ' + JSON.stringify(estadoBase_()));
}

/**
 * Crea los usuarios de USUARIOS_INICIALES que aún no existan.
 *
 * Las contraseñas NO están en el código ni pasan por el chat: antes de ejecutar, agrega en
 * ⚙ Configuración del proyecto → Propiedades de la secuencia de comandos una propiedad por usuario:
 *   PWD_admin = <contraseña>      PWD_operador1 = <contraseña>
 * La función las hashea (PBKDF2 + pepper) y BORRA cada propiedad tras usarla.
 * Si una contraseña no cumple la política, esa propiedad se conserva para que la corrijas.
 */
function crearUsuariosIniciales() {
  procesarPasswordsPendientes_(true);
}

/**
 * Restablece la contraseña de usuarios YA existentes (por ejemplo, si alguien la olvidó).
 * Agrega la propiedad PWD_<usuario> con la nueva contraseña y ejecuta esta función; la propiedad se borra al usarse.
 */
function restablecerPasswords() {
  procesarPasswordsPendientes_(false);
}

function procesarPasswordsPendientes_(crearFaltantes) {
  if (!abrirBase_()) {
    throw new Error('No hay archivo de Sheets disponible.');
  }
  var props = PropertiesService.getScriptProperties();
  var usuarios = crearFaltantes
    ? USUARIOS_INICIALES
    : Object.keys(props.getProperties())
        .filter(function (k) { return k.indexOf(PREFIJO_PROP_PASSWORD) === 0; })
        .map(function (k) { return { usuario: k.slice(PREFIJO_PROP_PASSWORD.length) }; });

  // Sin LockService aquí: es una tarea manual de una sola persona y las funciones internas ya
  // toman su propio bloqueo (los bloqueos de Apps Script no son reentrantes).
  usuarios.forEach(function (def) {
    var nombreUsuario = normalizarUsuario_(def.usuario);
    var clave = PREFIJO_PROP_PASSWORD + def.usuario;
    var password = props.getProperty(clave);
    var existente = nombreUsuario ? buscarUsuario_(nombreUsuario) : null;

    if (!nombreUsuario) {
      Logger.log('OMITIDO ' + def.usuario + ': nombre de usuario inválido (3-40 caracteres: a-z 0-9 . _ -).');
      return;
    }
    if (!password) {
      Logger.log(existente ? 'Sin cambios: ' + nombreUsuario + ' (existe; no hay propiedad ' + clave + ').' : 'FALTA la propiedad ' + clave + ' para crear a ' + nombreUsuario + '.');
      return;
    }
    var problema = validarPoliticaPassword_(password);
    if (problema) {
      Logger.log('ERROR ' + nombreUsuario + ': ' + problema + ' La propiedad ' + clave + ' se conservó; corrígela y ejecuta de nuevo.');
      return;
    }

    if (existente) {
      establecerHashUsuario_(existente.fila, hashPassword_(password));
      invalidarSesionesDe_(nombreUsuario);
      auditar_('SETUP', 'PASSWORD_RESTABLECIDA', 'USUARIOS', existente.id, nombreUsuario);
      Logger.log('Contraseña actualizada: ' + nombreUsuario + '.');
    } else if (crearFaltantes) {
      insertarUsuario_(nombreUsuario, def.nombre, def.rol, password);
      auditar_('SETUP', 'USUARIO_CREADO', 'USUARIOS', nombreUsuario, def.rol);
      Logger.log('Usuario creado: ' + nombreUsuario + ' (' + def.rol + ').');
    }
    props.deleteProperty(clave);
  });
}

/** Aplica formato de texto plano a las columnas de COLUMNAS_TEXTO_PLANO (toda la columna, sin tocar datos existentes). */
function aplicarFormatosTexto_(libro) {
  Object.keys(COLUMNAS_TEXTO_PLANO).forEach(function (nombreHoja) {
    var hoja = libro.getSheetByName(nombreHoja);
    COLUMNAS_TEXTO_PLANO[nombreHoja].forEach(function (columna) {
      var indice = ESQUEMA[nombreHoja].indexOf(columna) + 1;
      hoja.getRange(2, indice, Math.max(hoja.getMaxRows() - 1, 1), 1).setNumberFormat('@');
    });
  });
  PropertiesService.getScriptProperties().setProperty(PROP_FORMATOS, VERSION_FORMATOS);
}

/** Agrega las claves de CONFIG_INICIAL que falten (nunca modifica valores ya existentes). */
function sembrarConfiguracion_(libro) {
  var hoja = libro.getSheetByName('CONFIGURACION');
  var ultima = hoja.getLastRow();
  var existentes = {};
  if (ultima > 1) {
    hoja.getRange(2, 1, ultima - 1, 1).getValues().forEach(function (f) { existentes[String(f[0])] = true; });
  }
  var faltantes = CONFIG_INICIAL.filter(function (c) { return !existentes[c[0]]; });
  if (faltantes.length) {
    hoja.getRange(ultima + 1, 1, faltantes.length, 3).setValues(faltantes);
  }
}

/**
 * Garantiza que los encabezados de una hoja existente coincidan con el esquema. Si la hoja tiene un PREFIJO
 * exacto del esquema y las columnas siguientes están vacías (esquema ampliado al final), agrega los encabezados
 * faltantes sin tocar datos. Cualquier otra diferencia se rechaza para no dañar información.
 */
function ampliarEncabezados_(hoja, nombre, encabezados) {
  var actuales = hoja.getRange(1, 1, 1, encabezados.length).getValues()[0];
  if (actuales.join('|') === encabezados.join('|')) {
    return;
  }
  var presentes = 0;
  while (presentes < actuales.length && String(actuales[presentes]) !== '') {
    presentes++;
  }
  var prefijoCoincide = presentes > 0 && actuales.slice(0, presentes).join('|') === encabezados.slice(0, presentes).join('|');
  var restoVacio = actuales.slice(presentes).every(function (c) { return String(c) === ''; });
  if (!prefijoCoincide || !restoVacio) {
    throw new Error('La hoja ' + nombre + ' ya tiene datos con encabezados distintos al esquema. Revísala manualmente; no se modificó.');
  }
  var faltantes = encabezados.slice(presentes);
  hoja.getRange(1, presentes + 1, 1, faltantes.length).setValues([faltantes]);
  hoja.getRange(1, presentes + 1, 1, faltantes.length).setFontWeight('bold');
  Logger.log('Hoja ' + nombre + ': se agregaron las columnas ' + faltantes.join(', ') + '.');
}
