/**
 * inicio.js — Panel (#/inicio, solo ADMIN): números clave, actividad por día y por mes, archivos más descargados y últimas descargas.
 * Los números salen de las acciones `resumen` y `metricas` (el servidor los calcula; aquí solo se pintan). Las gráficas son
 * barras de CSS (sin librerías externas) con una tabla de datos equivalente para lectores de pantalla.
 */
(function () {
  'use strict';

  const U = window.Utils;
  const el = U.el;

  const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
  const MEDIDAS = [
    { clave: 'descargas', titulo: 'Descargas', unidad: 'descargas' },
    { clave: 'usuarios', titulo: 'Usuarios que descargaron', unidad: 'usuarios' },
    { clave: 'nuevos', titulo: 'Usuarios nuevos', unidad: 'usuarios nuevos' }
  ];

  /** "2026-10-14" → "14 oct"; "2026-10" → "oct 26". */
  function etiquetaDia(f) { return parseInt(f.slice(8, 10), 10) + ' ' + MESES[parseInt(f.slice(5, 7), 10) - 1]; }
  function etiquetaMes(m) { return MESES[parseInt(m.slice(5, 7), 10) - 1] + ' ' + m.slice(2, 4); }

  /** Gráfica de barras: `puntos` [{ etiqueta, valor }]. Devuelve un nodo. */
  function barras(puntos, unidad, cadaN) {
    const max = Math.max.apply(null, puntos.map(function (p) { return p.valor; }).concat([1]));
    const total = puntos.reduce(function (s, p) { return s + p.valor; }, 0);
    const caja = el('div', { clase: 'barras', role: 'img', 'aria-label': total + ' ' + unidad + ' en ' + puntos.length + ' periodos' });
    puntos.forEach(function (p, i) {
      const barra = el('div', { clase: 'barra' + (p.valor === 0 ? ' barra-cero' : '') });
      barra.style.height = (p.valor === 0 ? 2 : Math.max(4, Math.round((p.valor / max) * 100))) + '%';
      barra.title = p.etiqueta + ': ' + p.valor + ' ' + unidad;
      const col = el('div', { clase: 'barra-col' }, [
        el('span', { clase: 'barra-valor', texto: p.valor > 0 ? String(p.valor) : '' }),
        el('div', { clase: 'barra-pista' }, [barra]),
        el('span', { clase: 'barra-etiqueta', texto: i % cadaN === 0 || i === puntos.length - 1 ? p.etiqueta : '' })
      ]);
      caja.append(col);
    });
    return el('div', { clase: 'barras-marco' }, [caja]);
  }

  window.Vistas = window.Vistas || {};
  window.Vistas.inicio = function () {
    const raiz = el('div');
    const cajaKpis = el('div');
    const cajaMetricas = el('div');
    const cajaRecientes = el('div');
    raiz.append(cajaKpis, cajaMetricas, cajaRecientes);
    let hayResumen = false;
    let hayMetricas = false;
    let periodo = 'dia';
    let medida = 'descargas';
    let metricas = null;

    /* ------------------------------ Números y últimas descargas ------------------------------ */

    function pintarResumen(d) {
      const kpis = el('div', { clase: 'kpis' }, [
        U.tarjetaDato('Archivos disponibles', String(d.archivosActivos), 'kpi-destacado'),
        U.tarjetaDato('Usuarios activos', d.usuariosActivos + ' de ' + d.usuariosTotal),
        U.tarjetaDato('Descargas hoy', String(d.descargasHoy)),
        U.tarjetaDato('Descargas (7 días)', String(d.descargas7Dias)),
        U.tarjetaDato('Intentos denegados (7 días)', String(d.denegadas7Dias))
      ]);
      let aviso = null;
      if (!d.carpetaConfigurada) {
        aviso = el('div', { clase: 'mensaje aviso', role: 'status' }, [
          document.createTextNode('Falta conectar la carpeta de Drive. '), el('a', { href: '#/archivos', texto: 'Ir a Archivos para sincronizarla.' })
        ]);
      } else if (d.archivosInactivos > 0) {
        aviso = el('div', { clase: 'mensaje aviso', role: 'status', texto: d.archivosInactivos + ' archivo(s) ya no están en la carpeta de Drive y quedaron inactivos.' });
      }
      U.llenar(cajaKpis, kpis, aviso);

      const tabla = U.tabla({
        columnas: [
          { clave: 'fecha', titulo: 'Fecha', render: function (r) { return U.formatearFechaHora(r.fecha); } },
          { clave: 'usuario', titulo: 'Usuario' },
          { clave: 'archivo', titulo: 'Archivo', ajustable: true }
        ],
        filas: d.recientes, vacio: 'Todavía no hay descargas.', tamPagina: 10, orden: null
      });
      const pie = el('p', { clase: 'nota-chica', texto: d.ultimaSincronizacion ? 'Última sincronización con Drive: ' + U.formatearFechaHora(d.ultimaSincronizacion) + '.' : 'Aún no se ha sincronizado la carpeta de Drive.' });
      U.llenar(cajaRecientes, el('section', { clase: 'tarjeta' }, [el('h2', { texto: 'Últimas descargas' }), tabla.nodo, pie]));
    }

    /* ------------------------------ Actividad y más descargados ------------------------------ */

    function botonesGrupo(opciones, actual, alElegir, etiquetaGrupo) {
      const grupo = el('div', { clase: 'segmentos', role: 'group', 'aria-label': etiquetaGrupo });
      opciones.forEach(function (o) {
        const b = el('button', { type: 'button', clase: 'segmento', texto: o[1], 'aria-pressed': String(o[0] === actual) });
        b.addEventListener('click', function () { alElegir(o[0]); });
        grupo.append(b);
      });
      return grupo;
    }

    function pintarMetricas() {
      const m = metricas;
      const def = MEDIDAS.filter(function (x) { return x.clave === medida; })[0];
      const lista = periodo === 'dia' ? m.porDia : m.porMes;
      const puntos = lista.map(function (x) {
        return { etiqueta: periodo === 'dia' ? etiquetaDia(x.fecha) : etiquetaMes(x.mes), valor: x[medida] };
      });
      const total = puntos.reduce(function (s, p) { return s + p.valor; }, 0);
      const maximo = puntos.reduce(function (mx, p) { return p.valor > mx.valor ? p : mx; }, { valor: 0, etiqueta: '' });

      const controles = el('div', { clase: 'controles-grafica' }, [
        botonesGrupo([['dia', 'Por día (30 días)'], ['mes', 'Por mes (12 meses)']], periodo, function (v) { periodo = v; pintarMetricas(); }, 'Periodo'),
        botonesGrupo(MEDIDAS.map(function (x) { return [x.clave, x.titulo]; }), medida, function (v) { medida = v; pintarMetricas(); }, 'Qué medir')
      ]);
      const resumen = el('p', { clase: 'nota-chica', texto: total
        ? total + ' ' + def.unidad + ' en el periodo' + (maximo.valor ? '; el pico fue ' + maximo.etiqueta + ' (' + maximo.valor + ').' : '.')
        : 'Sin ' + def.unidad + ' en este periodo.' });

      const datos = U.tabla({
        columnas: [
          { clave: 'etiqueta', titulo: periodo === 'dia' ? 'Día' : 'Mes' },
          { clave: 'valor', titulo: def.titulo, tipo: 'numero' }
        ],
        filas: puntos.slice().reverse(), vacio: 'Sin datos.', tamPagina: 40, clase: 'tabla-simple'
      });
      const detalle = el('details', { clase: 'datos-grafica' }, [el('summary', { texto: 'Ver los datos en tabla' }), datos.nodo]);

      const tarjetaActividad = el('section', { clase: 'tarjeta' }, [
        el('h2', { texto: 'Actividad' }), controles, resumen, barras(puntos, def.unidad, periodo === 'dia' ? 5 : 1), detalle
      ]);

      const maxTop = Math.max.apply(null, m.topArchivos.map(function (a) { return a.descargas; }).concat([1]));
      const top = U.tabla({
        columnas: [
          { clave: 'pos', titulo: '#', ordenable: false, render: function (a) { return String(m.topArchivos.indexOf(a) + 1); } },
          { clave: 'nombre', titulo: 'Archivo', ajustable: true },
          { clave: 'descargas', titulo: 'Descargas', tipo: 'numero', render: function (a) {
            const pista = el('div', { clase: 'mini-pista' }, [el('div', { clase: 'mini-barra' })]);
            pista.firstChild.style.width = Math.max(3, Math.round((a.descargas / maxTop) * 100)) + '%';
            return el('div', { clase: 'mini-celda' }, [el('span', { texto: String(a.descargas) }), pista]);
          } },
          { clave: 'usuarios', titulo: 'Personas', tipo: 'numero' },
          { clave: 'ultimos30', titulo: 'Últimos 30 días', tipo: 'numero' }
        ],
        filas: m.topArchivos, vacio: 'Todavía no hay descargas que contar.', tamPagina: 10, orden: null
      });
      const nota = m.parcial ? el('p', { clase: 'nota-chica', texto: 'Se revisaron las actividades más recientes del registro; los números muy antiguos pueden no aparecer.' }) : null;
      const tarjetaTop = el('section', { clase: 'tarjeta' }, [el('h2', { texto: 'Archivos más descargados' }), top.nodo, nota]);
      U.llenar(cajaMetricas, tarjetaActividad, tarjetaTop);
    }

    /* ------------------------------ Carga ------------------------------ */

    function cargar(fresco) {
      if (!hayResumen) cajaKpis.replaceChildren(U.bloqueEstado('Panel', 'Consultando…', false));
      window.Auth.consultar('resumen', {}, function (r) {
        if (!r.success) { hayResumen = false; cajaKpis.replaceChildren(U.bloqueEstado('No se pudo cargar', r.message, true, function () { cargar(true); })); return; }
        hayResumen = true;
        pintarResumen(r.data);
      }, { fresco: fresco === true, vivo: function () { return raiz.isConnected; } }).catch(function (err) {
        if (!hayResumen) cajaKpis.replaceChildren(U.bloqueEstado('No se pudo cargar', err.message || 'Error de conexión.', true, function () { cargar(true); }));
      });

      if (!hayMetricas) cajaMetricas.replaceChildren(U.bloqueEstado('Actividad', 'Calculando métricas…', false));
      window.Auth.consultar('metricas', {}, function (r) {
        if (!r.success) { hayMetricas = false; cajaMetricas.replaceChildren(U.bloqueEstado('No se pudieron calcular las métricas', r.message, true, function () { cargar(true); })); return; }
        hayMetricas = true;
        metricas = r.data;
        pintarMetricas();
      }, { fresco: fresco === true, vivo: function () { return raiz.isConnected; } }).catch(function (err) {
        if (!hayMetricas) cajaMetricas.replaceChildren(U.bloqueEstado('No se pudieron calcular las métricas', err.message || 'Error de conexión.', true, function () { cargar(true); }));
      });
    }

    cargar(false);
    return raiz;
  };
})();
