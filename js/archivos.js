/**
 * archivos.js — Pantalla #/archivos: lista de archivos que la persona puede descargar y botón de descarga.
 * El ADMIN además ve todo el catálogo (con los inactivos) y puede sincronizar la carpeta de Drive.
 * El servidor decide qué archivos aparecen y si la descarga procede; aquí solo se pinta.
 */
(function () {
  'use strict';

  const U = window.Utils;
  const el = U.el;

  /** "application/pdf" → "PDF"; los demás por la extensión del nombre. */
  function tipoLegible(a) {
    if (/^application\/vnd\.google-apps\./.test(a.mime)) return 'Google → PDF';
    const ext = /\.([A-Za-z0-9]{1,5})$/.exec(a.nombre);
    return ext ? ext[1].toUpperCase() : (a.mime.split('/')[1] || 'Archivo').toUpperCase().slice(0, 8);
  }

  window.Vistas = window.Vistas || {};
  window.Vistas.archivos = function (ctx) {
    const esAdmin = ctx.sesion.rol === 'ADMIN';
    const raiz = el('div');
    const resultado = el('div');
    const aviso = el('div', { clase: 'mensaje', role: 'status', hidden: true });
    const buscar = U.campo({ id: 'q', etiqueta: 'Buscar', placeholder: 'Nombre o categoría…' });
    let temporizador = null;
    let hayDatos = false;

    function mostrar(texto, esError) {
      aviso.textContent = texto;
      aviso.className = 'mensaje ' + (esError ? 'error' : 'exito');
      aviso.hidden = false;
    }

    async function descargar(archivo, boton) {
      boton.disabled = true;
      const textoOriginal = boton.textContent;
      boton.textContent = 'Preparando…';
      aviso.hidden = true;
      try {
        const r = await window.Auth.llamar('descargarArchivo', { idArchivo: archivo.idArchivo });
        if (r.success) {
          U.guardarArchivoBase64(r.data.nombre, r.data.mime, r.data.base64);
          mostrar('Descarga lista: ' + r.data.nombre + ' (' + U.formatearTamano(r.data.tamano) + ').', false);
        } else {
          mostrar(r.message, true);
        }
      } catch (err) {
        mostrar((err.message || 'No se pudo descargar.') + ' Puedes volver a intentarlo.', true);
      }
      boton.disabled = false;
      boton.textContent = textoOriginal;
    }

    function pintar(d) {
      const columnas = [
        { clave: 'nombre', titulo: 'Archivo', ajustable: true },
        { clave: 'categoria', titulo: 'Categoría' },
        { clave: 'tipo', titulo: 'Tipo', orden: tipoLegible, render: tipoLegible },
        { clave: 'tamano', titulo: 'Tamaño', tipo: 'numero', render: function (a) { return U.formatearTamano(a.tamano); } }
      ];
      if (esAdmin) columnas.push({ clave: 'estatus', titulo: 'Estatus', render: function (a) { return U.chipEstatus(a.estatus); } });
      columnas.push({ clave: 'acc', titulo: '', ordenable: false, fija: true, render: function (a) {
        if (a.estatus !== 'ACTIVO') return '';
        const b = el('button', { type: 'button', clase: 'boton boton-chico', texto: 'Descargar' });
        b.addEventListener('click', function () { descargar(a, b); });
        return b;
      } });
      const vacio = esAdmin
        ? (d.carpetaConfigurada ? 'No hay archivos que coincidan.' : 'Aún no hay archivos: pega arriba el enlace de la carpeta de Drive y pulsa Sincronizar.')
        : 'Todavía no tienes archivos asignados. Pídele al administrador que te asigne los que necesites.';
      const tabla = U.tabla({
        columnas: columnas, filas: d.archivos, vacio: vacio,
        claseFila: function (a) { return a.estatus === 'INACTIVO' ? 'fila-inactiva' : ''; }
      });
      U.llenar(resultado, el('section', { clase: 'tarjeta' }, [el('p', { clase: 'nota-chica', texto: d.total + ' archivo(s)' }), tabla.nodo]));
    }

    function cargar(fresco) {
      if (!hayDatos) resultado.replaceChildren(U.bloqueEstado('Archivos', 'Consultando…', false));
      window.Auth.consultar('archivos', { q: buscar.valor() }, function (r) {
        if (!r.success) { hayDatos = false; resultado.replaceChildren(U.bloqueEstado('No se pudo cargar', r.message, true, function () { cargar(true); })); return; }
        hayDatos = true;
        pintar(r.data);
      }, { fresco: fresco === true, vivo: function () { return raiz.isConnected; } }).catch(function (err) {
        if (!hayDatos) resultado.replaceChildren(U.bloqueEstado('No se pudo cargar', err.message || 'Error de conexión.', true, function () { cargar(true); }));
      });
    }

    function tarjetaSincronizar() {
      const carpeta = U.campo({ id: 'carpeta', etiqueta: 'Carpeta de Drive', placeholder: 'Pega el enlace de la carpeta (vacío = la ya guardada)', ancho: true, maxlength: 300,
        ayuda: 'La carpeta debe estar en el Drive de la cuenta que publicó el sistema o compartida con ella (como lector basta). Las subcarpetas se leen como categorías.' });
      const boton = el('button', { type: 'submit', clase: 'boton', texto: 'Sincronizar' });
      const form = el('form', { novalidate: true, clase: 'sincronizar-caja' }, [carpeta.nodo, el('div', { clase: 'acciones' }, [boton])]);
      let requestId = window.Api.nuevoIdSolicitud();   // estable por intento: un reintento no repite el trabajo
      form.addEventListener('submit', async function (e) {
        e.preventDefault();
        boton.disabled = true;
        boton.textContent = 'Sincronizando…';
        aviso.hidden = true;
        carpeta.error(null);
        try {
          const r = await window.Auth.llamar('sincronizarArchivos', { carpeta: carpeta.valor() }, requestId);
          if (r.success) {
            requestId = window.Api.nuevoIdSolicitud();
            carpeta.control.value = '';
            mostrar(r.message, false);
            cargar(true);
          } else {
            mostrar(r.message, true);
            if (r.campos && r.campos.carpeta) carpeta.error(r.campos.carpeta);
          }
        } catch (err) {
          mostrar((err.message || 'Error de conexión.') + ' Puedes reintentar: no se repetirá.', true);
        }
        boton.disabled = false;
        boton.textContent = 'Sincronizar';
      });
      return el('section', { clase: 'tarjeta' }, [el('h2', { texto: 'Sincronizar con Drive' }), form]);
    }

    buscar.nodo.addEventListener('input', function () { clearTimeout(temporizador); temporizador = setTimeout(function () { cargar(false); }, 450); });
    raiz.append(aviso, esAdmin ? tarjetaSincronizar() : '', el('section', { clase: 'tarjeta tarjeta-filtros' }, [buscar.nodo]), resultado);
    cargar(false);
    return raiz;
  };
})();
