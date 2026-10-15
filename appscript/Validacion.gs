/**
 * Validacion.gs — Lectura y limpieza de datos que llegan del cliente, dinero en centavos y folios.
 *
 * Regla de oro: el cliente solo SUGIERE. Todo se vuelve a validar aquí, se limpia y se acota. Los errores se acumulan en
 * un objeto { campo: mensaje } que viaja en la respuesta (`campos`) para pintarlos junto a cada campo del formulario.
 */

function idDe_(valor) {
  var s = typeof valor === 'string' || typeof valor === 'number' ? String(valor).trim() : '';
  return /^[A-Za-z0-9._-]{3,80}$/.test(s) ? s : '';
}

function textoDe_(valor, errores, campo, etiqueta) {
  if (valor === null || valor === undefined) {
    return '';
  }
  if (typeof valor !== 'string' && typeof valor !== 'number') {
    errores[campo] = etiqueta + ' tiene un valor no válido.';
    return '';
  }
  return String(valor).replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
}

/** Texto libre: sin caracteres de control, espacios normalizados, longitud acotada. */
function limpiarTexto_(valor, max, errores, campo, etiqueta, obligatorio) {
  var s = textoDe_(valor, errores, campo, etiqueta);
  if (errores[campo]) {
    return '';
  }
  if (!s && obligatorio) {
    errores[campo] = etiqueta + ' es obligatorio.';
  } else if (s.length > max) {
    errores[campo] = etiqueta + ' no puede exceder ' + max + ' caracteres.';
  }
  return s;
}

/** Valor de una lista cerrada (p. ej. un tipo o un estado). */
function leerOpcion_(valor, opciones, errores, campo, etiqueta) {
  var s = typeof valor === 'string' ? valor.trim().toUpperCase() : '';
  if (opciones.indexOf(s) === -1) {
    errores[campo] = 'Selecciona ' + etiqueta + '.';
    return '';
  }
  return s;
}

/** Entero entre min y max (acepta número o texto numérico). Devuelve null y registra el error si es inválido. */
function leerEntero_(valor, min, max, errores, campo, etiqueta) {
  var s = typeof valor === 'number' ? String(valor) : (typeof valor === 'string' ? valor.trim() : '');
  if (!/^\d{1,9}$/.test(s) || parseInt(s, 10) < min || parseInt(s, 10) > max) {
    errores[campo] = etiqueta + ' debe ser un número entero entre ' + min + ' y ' + max + '.';
    return null;
  }
  return parseInt(s, 10);
}

/** Importe con máximo 2 decimales, sin pasar por coma flotante. Devuelve null (y registra el error) si es inválido. */
function leerImporte_(valor, errores, campo, etiqueta) {
  var s = typeof valor === 'number' ? String(valor) : (typeof valor === 'string' ? valor.trim() : '');
  if (!/^\d{1,7}(\.\d{1,2})?$/.test(s)) {
    errores[campo] = etiqueta + ' debe ser un importe válido (hasta 2 decimales).';
    return null;
  }
  var centavos = Math.round(parseFloat(s) * 100);
  if (centavos > Math.round(MONTO_MAXIMO * 100)) {
    errores[campo] = etiqueta + ' excede el máximo permitido.';
    return null;
  }
  return centavos / 100;
}

/** El dinero se calcula SIEMPRE en centavos enteros (evita errores de coma flotante) y solo al responder se pasa a pesos. */
function aCentavos_(pesos) {
  return Math.round(Number(pesos) * 100);
}

function aPesos_(centavos) {
  return centavos / 100;
}

/** Fecha y hora actuales del negocio como { fecha, hora, completo, anio } (zona de CONFIGURACION, nunca la del navegador). */
function ahoraDePared_() {
  var a = ahoraLocal_();
  return { fecha: a.fecha, hora: a.hora, completo: a.completo, anio: a.anio };
}

/**
 * Folio PREFIJO-AAAA-NNNNNN. Se llama SIEMPRE dentro del bloqueo (escrituraIdempotente_). El contador se incrementa ANTES
 * de escribir el registro: un fallo a medias deja un hueco en la numeración, nunca un duplicado.
 * Para varios consecutivos (p. ej. SRV_ y PGA_) usa pares de claves distintas en CONFIGURACION.
 */
function reservarFolio_(ahora, claveSiguiente, clavePrefijo) {
  claveSiguiente = claveSiguiente || 'SIGUIENTE_FOLIO';
  clavePrefijo = clavePrefijo || 'FOLIO_PREFIJO';
  var hoja = hojaBase_('CONFIGURACION');
  var ultima = hoja.getLastRow();
  var filas = ultima >= 2 ? hoja.getRange(2, 1, ultima - 1, 2).getValues() : [];
  var iSig = -1, iPref = -1;
  for (var i = 0; i < filas.length; i++) {
    if (String(filas[i][0]) === claveSiguiente) { iSig = i; }
    if (String(filas[i][0]) === clavePrefijo) { iPref = i; }
  }
  if (iSig === -1 || iPref === -1) {
    throw new Error('Falta ' + claveSiguiente + ' o ' + clavePrefijo + ' en CONFIGURACION.');
  }
  var prefijo = String(filas[iPref][1]).trim().toUpperCase();
  var numero = parseInt(filas[iSig][1], 10);
  if (!/^[A-Z0-9]{1,10}$/.test(prefijo) || !(numero >= 1)) {
    throw new Error('CONFIGURACION tiene un prefijo o un contador de folio inválidos.');
  }
  hoja.getRange(iSig + 2, 2).setValue(String(numero + 1));
  marcarDatosModificados_();
  return prefijo + '-' + ahora.anio + '-' + ('000000' + numero).slice(-6);
}

/**
 * Valor listo para escribir en una celda: neutraliza fórmulas en texto libre (=, +, -, @) salvo en columnas de texto plano,
 * que ya son texto en la hoja. Úsalo en TODA escritura de datos que vienen del usuario.
 */
function filaParaHoja_(hoja, o) {
  var planas = COLUMNAS_TEXTO_PLANO[hoja] || [];
  return ESQUEMA[hoja].map(function (c) {
    var v = Object.prototype.hasOwnProperty.call(o, c) && o[c] !== undefined && o[c] !== null ? o[c] : '';
    if (typeof v === 'string' && planas.indexOf(c) === -1) {
      v = textoSeguroCelda_(v.replace(/^'(?=[=+\-@\t\r])/, ''));
    }
    return v;
  });
}

/** Agrega una fila (objeto { COLUMNA: valor }) respetando el orden del ESQUEMA. Devuelve el número de fila. */
function insertarFila_(hoja, o) {
  var arreglo = filaParaHoja_(hoja, o);
  var h = hojaBase_(hoja);
  var numero = h.getLastRow() + 1;
  h.getRange(numero, 1, 1, arreglo.length).setValues([arreglo]);
  marcarDatosModificados_();
  return numero;
}

/** Reescribe una fila completa (una sola operación) a partir del objeto leído con leerFilas_ (trae _fila). */
function guardarFila_(hoja, o) {
  var arreglo = filaParaHoja_(hoja, o);
  hojaBase_(hoja).getRange(o._fila, 1, 1, arreglo.length).setValues([arreglo]);
  marcarDatosModificados_();
}
