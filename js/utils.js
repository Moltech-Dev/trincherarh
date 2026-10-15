/**
 * utils.js — Utilidades compartidas de presentación.
 * Los textos se insertan siempre con textContent (nunca innerHTML) para evitar inyección de HTML.
 */
(function () {
  'use strict';

  /**
   * Crea un elemento. `atributos`: texto → textContent, clase → className, true → atributo booleano,
   * false/null/undefined → se omite; cualquier otro valor se asigna con setAttribute.
   */
  function el(etiqueta, atributos, hijos) {
    const nodo = document.createElement(etiqueta);
    Object.keys(atributos || {}).forEach(function (k) {
      const v = atributos[k];
      if (v === false || v === null || v === undefined) return;
      if (k === 'texto') nodo.textContent = v;
      else if (k === 'clase') nodo.className = v;
      else if (v === true) nodo.setAttribute(k, '');
      else nodo.setAttribute(k, v);
    });
    (hijos || []).forEach(function (h) { if (h) nodo.append(h); });
    return nodo;
  }

  const formatoMoneda = new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' });

  /** Importe en pesos mexicanos: 1250 → "$1,250.00". */
  function formatearMoneda(valor) {
    return formatoMoneda.format(Number(valor) || 0);
  }

  /** "2026-10-12" → "12/10/2026" por manipulación de texto (sin Date: evita desfases de zona horaria). */
  function formatearFecha(iso) {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso));
    return m ? m[3] + '/' + m[2] + '/' + m[1] : String(iso || '');
  }

  /** "2026-10-12 23:30:00" → "12/10/2026 23:30". */
  function formatearFechaHora(texto) {
    const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/.exec(String(texto));
    return m ? m[3] + '/' + m[2] + '/' + m[1] + ' ' + m[4] + ':' + m[5] : String(texto || '');
  }

  /** Etiqueta de color (chip). `clase` define el tono (ver .chip-* en styles.css). */
  function chip(texto, clase) {
    return el('span', { clase: 'chip ' + (clase || ''), texto: texto });
  }

  // Nombre visible de cada estatus del negocio y su color (clase .est-<ESTATUS> en modulos.css).
  const NOMBRES_ESTATUS = { ACTIVO: 'Activo', INACTIVO: 'Inactivo' };

  function chipEstatus(estatus) {
    return chip(NOMBRES_ESTATUS[estatus] || estatus, 'est-' + estatus);
  }

  /* ------------------------------ Tablas ------------------------------ */

  function comparar(a, b) {
    const x = a === null || a === undefined ? '' : a;
    const y = b === null || b === undefined ? '' : b;
    if (typeof x === 'number' && typeof y === 'number') return x - y;
    return String(x).localeCompare(String(y), 'es', { numeric: true, sensitivity: 'base' });
  }

  /**
   * Tabla con orden por columna y paginación en el cliente. En pantallas angostas cada fila se muestra como tarjeta
   * (las celdas llevan data-label). `columnas`: [{ clave, titulo, tipo: texto|numero|moneda|fecha, render(fila), orden(fila) }].
   * Devuelve { nodo, actualizar(filas) }.
   */
  function tabla(opciones) {
    const columnas = opciones.columnas;
    const tam = opciones.tamPagina || 25;
    let filas = opciones.filas || [];
    let orden = opciones.orden || null;       // { clave, dir: 1 | -1 }
    let pagina = 0;

    const contenedor = el('div', { clase: 'tabla-bloque' });
    const cabecera = el('thead');
    const cuerpo = el('tbody');
    const tablaEl = el('table', { clase: 'tabla-datos' + (opciones.clase ? ' ' + opciones.clase : '') }, [cabecera, cuerpo]);
    const pie = el('div', { clase: 'tabla-pie' });
    contenedor.append(el('div', { clase: 'tabla-contenedor' }, [tablaEl]), pie);

    function valorOrden(col, fila) {
      return col.orden ? col.orden(fila) : fila[col.clave];
    }

    /**
     * Clases de una columna: alineación a la derecha para números, `col-fija` (queda pegada al borde derecho al desplazar) y
     * `col-ajustable` (el texto largo se parte en varias líneas en vez de ensanchar la tabla).
     */
    function claseColumna(c) {
      return (c.tipo === 'moneda' || c.tipo === 'numero' ? 'derecha' : '') + (c.fija ? ' col-fija' : '') + (c.ajustable ? ' col-ajustable' : '');
    }

    function pintarCabecera() {
      const fila = el('tr');
      columnas.forEach(function (c) {
        const th = el('th', { scope: 'col', clase: claseColumna(c) });
        if (c.ordenable === false) {
          th.textContent = c.titulo;
        } else {
          const activo = orden && orden.clave === c.clave;
          th.setAttribute('aria-sort', activo ? (orden.dir === 1 ? 'ascending' : 'descending') : 'none');
          const boton = el('button', { type: 'button', clase: 'orden-boton', texto: c.titulo + (activo ? (orden.dir === 1 ? ' ▲' : ' ▼') : '') });
          boton.addEventListener('click', function () {
            orden = orden && orden.clave === c.clave ? { clave: c.clave, dir: -orden.dir } : { clave: c.clave, dir: 1 };
            pagina = 0;
            pintar();
          });
          th.append(boton);
        }
        fila.append(th);
      });
      cabecera.replaceChildren(fila);
    }

    function celda(c, fila) {
      let contenido;
      if (c.render) contenido = c.render(fila);
      else if (c.tipo === 'moneda') contenido = formatearMoneda(fila[c.clave]);
      else if (c.tipo === 'fecha') contenido = formatearFecha(fila[c.clave]);
      else contenido = fila[c.clave] === null || fila[c.clave] === undefined ? '' : String(fila[c.clave]);
      const td = el('td', { 'data-label': c.titulo, clase: claseColumna(c) });
      if (contenido instanceof Node) td.append(contenido);
      else td.textContent = contenido;
      return td;
    }

    function pintar() {
      let visibles = filas.slice();
      if (orden) {
        const col = columnas.find(function (c) { return c.clave === orden.clave; });
        if (col) visibles.sort(function (a, b) { return orden.dir * comparar(valorOrden(col, a), valorOrden(col, b)); });
      }
      const paginas = Math.max(1, Math.ceil(visibles.length / tam));
      if (pagina >= paginas) pagina = paginas - 1;
      const inicio = pagina * tam;
      visibles = visibles.slice(inicio, inicio + tam);

      pintarCabecera();
      cuerpo.replaceChildren();
      if (!visibles.length) {
        const td = el('td', { colspan: String(columnas.length), clase: 'tabla-vacia', texto: opciones.vacio || 'No hay registros que mostrar.' });
        cuerpo.append(el('tr', {}, [td]));
      }
      visibles.forEach(function (fila) {
        const tr = el('tr', { clase: opciones.claseFila ? opciones.claseFila(fila) : '' });
        columnas.forEach(function (c) { tr.append(celda(c, fila)); });
        cuerpo.append(tr);
      });

      const total = filas.length;
      const anterior = el('button', { type: 'button', clase: 'boton boton-secundario boton-chico', texto: 'Anterior', disabled: pagina === 0 });
      const siguiente = el('button', { type: 'button', clase: 'boton boton-secundario boton-chico', texto: 'Siguiente', disabled: pagina >= paginas - 1 });
      anterior.addEventListener('click', function () { pagina--; pintar(); });
      siguiente.addEventListener('click', function () { pagina++; pintar(); });
      pie.replaceChildren(el('span', { role: 'status', 'aria-live': 'polite', texto: total ? 'Mostrando ' + (inicio + 1) + '–' + Math.min(inicio + tam, total) + ' de ' + total : '0 registros' }));
      if (paginas > 1) pie.append(el('span', { clase: 'paginacion' }, [anterior, el('span', { texto: 'Página ' + (pagina + 1) + ' de ' + paginas }), siguiente]));
    }

    pintar();
    return {
      nodo: contenedor,
      actualizar: function (nuevas) { filas = nuevas; pagina = 0; pintar(); }
    };
  }

  /* ------------------------------ Formularios y ventanas modales ------------------------------ */

  let contadorCampos = 0;

  /**
   * Campo de formulario con etiqueta, ayuda y error accesibles. `tipo`: texto | numero | password | fecha | area | select | casilla.
   * Devuelve { nodo, control, valor(), error(mensaje), visible(bool) }.
   */
  function campo(o) {
    const id = 'campo-' + o.id + '-' + (++contadorCampos);
    let control;
    if (o.tipo === 'select') {
      control = el('select', {}, (o.opciones || []).map(function (op) { return el('option', { value: op[0], texto: op[1] }); }));
    } else if (o.tipo === 'area') {
      control = el('textarea', { rows: o.filas || '3', maxlength: o.maxlength });
    } else if (o.tipo === 'casilla') {
      control = el('input', { type: 'checkbox' });
    } else {
      const tipoHtml = { texto: 'text', numero: 'text', password: 'password', fecha: 'date' }[o.tipo || 'texto'];
      control = el('input', {
        type: tipoHtml, maxlength: o.maxlength, placeholder: o.placeholder, autocomplete: o.autocompletar || 'off',
        inputmode: o.tipo === 'numero' ? 'decimal' : o.inputmode, spellcheck: 'false', max: o.max, min: o.min
      });
    }
    control.id = id;
    control.name = o.id;
    if (o.valor !== undefined && o.valor !== null) {
      if (o.tipo === 'casilla') control.checked = !!o.valor; else control.value = String(o.valor);
    }
    if (o.soloLectura) control.readOnly = true;
    if (o.requerido) control.setAttribute('aria-required', 'true');
    const error = el('span', { clase: 'error-campo', id: id + '-e', hidden: true });
    const descripciones = [id + '-e'];
    const etiqueta = el('label', { for: id }, [document.createTextNode(o.etiqueta), o.requerido ? el('span', { clase: 'obligatorio', texto: ' *', 'aria-hidden': 'true' }) : null]);
    const hijos = o.tipo === 'casilla' ? [el('label', { clase: 'casilla', for: id }, [control, document.createTextNode(' ' + o.etiqueta)])] : [etiqueta, control];
    if (o.ayuda) {
      hijos.push(el('span', { clase: 'ayuda', id: id + '-a', texto: o.ayuda }));
      descripciones.push(id + '-a');
    }
    hijos.push(error);
    control.setAttribute('aria-describedby', descripciones.join(' '));
    const nodo = el('div', { clase: 'campo' + (o.ancho ? ' ancho-completo' : '') }, hijos);
    return {
      id: o.id,
      nodo: nodo,
      control: control,
      valor: function () { return o.tipo === 'casilla' ? control.checked : control.value.trim(); },
      error: function (mensaje) {
        if (mensaje) { error.textContent = mensaje; error.hidden = false; control.setAttribute('aria-invalid', 'true'); }
        else { error.textContent = ''; error.hidden = true; control.removeAttribute('aria-invalid'); }
      },
      visible: function (v) { nodo.hidden = !v; }
    };
  }

  /** Ventana modal accesible basada en <dialog>. Devuelve { dialogo, cuerpo, cerrar }. */
  function modal(o) {
    const dialogo = el('dialog', { clase: 'modal' + (o.ancha ? ' modal-ancha' : ''), 'aria-labelledby': 'modal-titulo' });
    const cuerpo = el('div', { clase: 'modal-cuerpo' });
    const cerrarBtn = el('button', { type: 'button', clase: 'modal-cerrar', 'aria-label': 'Cerrar', texto: '✕' });
    cerrarBtn.addEventListener('click', function () { dialogo.close(); });
    dialogo.append(el('div', { clase: 'modal-cabecera' }, [el('h2', { id: 'modal-titulo', texto: o.titulo }), cerrarBtn]), cuerpo);
    document.body.append(dialogo);
    // Se finaliza UNA sola vez, ya sea por cerrar() o por el cierre nativo (Esc / evento close).
    let finalizado = false;
    function finalizar() {
      if (finalizado) return;
      finalizado = true;
      dialogo.remove();
      if (o.alCerrar) o.alCerrar();
    }
    dialogo.addEventListener('close', finalizar);
    dialogo.addEventListener('cancel', function () { setTimeout(finalizar, 0); });
    dialogo.showModal();
    return {
      dialogo: dialogo,
      cuerpo: cuerpo,
      cerrar: function () {
        if (dialogo.open) dialogo.close();
        finalizar();
      }
    };
  }

  /** Confirmación explícita. Devuelve una promesa con true (confirmó) o false. */
  function confirmar(o) {
    return new Promise(function (resolver) {
      let respuesta = false;
      const m = modal({ titulo: o.titulo, alCerrar: function () { resolver(respuesta); } });
      const si = el('button', { type: 'button', clase: 'boton' + (o.peligro ? ' boton-peligro' : ''), texto: o.textoConfirmar || 'Confirmar' });
      const no = el('button', { type: 'button', clase: 'boton boton-secundario', texto: o.textoCancelar || 'Cancelar' });
      si.addEventListener('click', function () { respuesta = true; m.cerrar(); });
      no.addEventListener('click', function () { m.cerrar(); });
      const contenido = typeof o.mensaje === 'string' ? el('p', { texto: o.mensaje }) : o.mensaje;
      m.cuerpo.append(contenido, el('div', { clase: 'acciones' }, [si, no]));
      no.focus();
    });
  }

  /**
   * Formulario en ventana modal con el flujo estándar: validación del servidor por campo, estado de envío, y un
   * requestId estable para reintentos seguros. `o.campos`: especificaciones de campo() más `visible(valores)`.
   * `o.enviar(valores, requestId)` devuelve la respuesta de la API; `o.alExito(respuesta)` se llama al terminar bien.
   */
  function formularioModal(o) {
    const m = modal({ titulo: o.titulo, ancha: o.ancha });
    const requestId = window.Api.nuevoIdSolicitud();
    const campos = o.campos.map(function (c) { return Object.assign({ campo: campo(c) }, { visibleSi: c.visible }); });
    const caja = el('div', { clase: 'mensaje error', role: 'alert', hidden: true });
    const boton = el('button', { type: 'submit', clase: 'boton' + (o.peligro ? ' boton-peligro' : ''), texto: o.textoEnviar || 'Guardar' });
    const cancelar = el('button', { type: 'button', clase: 'boton boton-secundario', texto: 'Cancelar' });
    cancelar.addEventListener('click', function () { m.cerrar(); });
    const form = el('form', { novalidate: true }, [
      o.intro ? (typeof o.intro === 'string' ? el('p', { texto: o.intro }) : o.intro) : null,
      caja,
      el('div', { clase: 'rejilla' }, campos.map(function (c) { return c.campo.nodo; })),
      el('div', { clase: 'acciones' }, [boton, cancelar])
    ]);
    m.cuerpo.append(form);

    function valores() {
      const v = {};
      campos.forEach(function (c) { v[c.campo.id] = c.campo.valor(); });
      return v;
    }
    function actualizarVisibilidad() {
      const v = valores();
      campos.forEach(function (c) { if (c.visibleSi) c.campo.visible(!!c.visibleSi(v)); });
    }
    form.addEventListener('input', actualizarVisibilidad);
    form.addEventListener('change', actualizarVisibilidad);
    actualizarVisibilidad();

    form.addEventListener('submit', async function (e) {
      e.preventDefault();
      caja.hidden = true;
      campos.forEach(function (c) { c.campo.error(null); });
      const v = valores();
      const visibles = {};
      campos.forEach(function (c) { if (!c.visibleSi || c.visibleSi(v)) visibles[c.campo.id] = v[c.campo.id]; });
      if (o.validar) {
        const errores = o.validar(visibles) || {};
        const claves = Object.keys(errores);
        if (claves.length) {
          campos.forEach(function (c) { if (errores[c.campo.id]) c.campo.error(errores[c.campo.id]); });
          const primero = campos.find(function (c) { return errores[c.campo.id]; });
          if (primero) primero.campo.control.focus();
          return;
        }
      }
      boton.disabled = true;
      const textoOriginal = boton.textContent;
      boton.textContent = 'Guardando…';
      try {
        const r = await o.enviar(visibles, requestId);
        if (r.success) {
          m.cerrar();
          if (o.alExito) o.alExito(r);
          return;
        }
        caja.textContent = r.message;
        caja.hidden = false;
        let primero = null;
        Object.keys(r.campos || {}).forEach(function (k) {
          const c = campos.find(function (x) { return x.campo.id === k; });
          if (c) { c.campo.error(r.campos[k]); if (!primero) primero = c; }
        });
        if (primero) primero.campo.control.focus();
        if (o.alError) o.alError(r);
      } catch (err) {
        caja.textContent = (err.message || 'No se pudo completar la operación.') + ' Si ya se envió, vuelve a pulsar el botón: no se duplicará.';
        caja.hidden = false;
      }
      boton.disabled = false;
      boton.textContent = textoOriginal;
    });

    const primero = campos.find(function (c) { return !c.campo.control.readOnly; });
    if (primero) primero.campo.control.focus();
    return m;
  }

  /* ------------------------------ Exportación CSV ------------------------------ */

  /** Neutraliza fórmulas (=, +, -, @) y escapa comillas, comas y saltos de línea. */
  function celdaCSV(valor) {
    if (valor === null || valor === undefined) return '';
    if (typeof valor === 'number') return String(valor);
    let s = String(valor);
    if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
    return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }

  /** Descarga un CSV (UTF-8 con BOM, para que Excel respete los acentos). */
  function descargarCSV(nombre, columnas, filas) {
    const lineas = [columnas.map(function (c) { return celdaCSV(c.titulo); }).join(',')];
    filas.forEach(function (f) { lineas.push(columnas.map(function (c) { return celdaCSV(f[c.clave]); }).join(',')); });
    const blob = new Blob(['﻿' + lineas.join('\r\n')], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = el('a', { href: url, download: nombre });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 2000);
  }

  /** 1536 → "1.5 KB". */
  function formatearTamano(bytes) {
    const b = Number(bytes) || 0;
    if (b <= 0) return '—';
    if (b < 1024) return b + ' B';
    if (b < 1048576) return (b / 1024).toFixed(1).replace(/\.0$/, '') + ' KB';
    return (b / 1048576).toFixed(1).replace(/\.0$/, '') + ' MB';
  }

  /** Guarda en el equipo un archivo recibido en base64 (la descarga ocurre en el navegador; nada se sube a ningún lado). */
  function guardarArchivoBase64(nombre, mime, base64) {
    const binario = window.atob(base64);
    const bytes = new Uint8Array(binario.length);
    for (let i = 0; i < binario.length; i++) bytes[i] = binario.charCodeAt(i);
    const url = URL.createObjectURL(new Blob([bytes], { type: mime || 'application/octet-stream' }));
    const a = el('a', { href: url, download: String(nombre).replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_') });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
  }

  /**
   * Reemplaza el contenido de un nodo ignorando los hijos vacíos (null, undefined, false). Es necesario porque
   * replaceChildren / append convierten null en el texto "null".
   */
  function llenar(nodo) {
    const hijos = Array.prototype.slice.call(arguments, 1).filter(function (h) { return h !== null && h !== undefined && h !== false; });
    nodo.replaceChildren.apply(nodo, hijos);
    return nodo;
  }

  /** Mensaje de carga / error / reintento para vistas que cargan datos. */
  function bloqueEstado(titulo, texto, esError, reintentar) {
    const hijos = [el('h2', { texto: titulo }), el('div', { clase: 'mensaje ' + (esError ? 'error' : 'aviso'), role: esError ? 'alert' : 'status', texto: texto })];
    if (reintentar) {
      const b = el('button', { type: 'button', clase: 'boton', texto: 'Reintentar' });
      b.addEventListener('click', reintentar);
      hijos.push(b);
    }
    return el('section', { clase: 'tarjeta' }, hijos);
  }

  function tarjetaDato(rotulo, valor, clase) {
    return el('div', { clase: 'kpi ' + (clase || '') }, [el('span', { clase: 'kpi-rotulo', texto: rotulo }), el('span', { clase: 'kpi-valor', texto: valor })]);
  }

  window.Utils = Object.freeze({
    el: el, formatearMoneda: formatearMoneda, formatearFecha: formatearFecha, formatearFechaHora: formatearFechaHora,
    chip: chip, chipEstatus: chipEstatus, tabla: tabla, campo: campo, modal: modal, confirmar: confirmar,
    formularioModal: formularioModal, descargarCSV: descargarCSV, bloqueEstado: bloqueEstado, tarjetaDato: tarjetaDato, llenar: llenar,
    formatearTamano: formatearTamano, guardarArchivoBase64: guardarArchivoBase64,
    NOMBRES_ESTATUS: NOMBRES_ESTATUS
  });
})();
