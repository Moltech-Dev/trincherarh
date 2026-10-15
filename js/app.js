/**
 * app.js — Shell de la aplicación: menú por rol, enrutado por hash y vistas.
 *
 * Cada módulo se registra en window.Vistas[ruta] desde su propio archivo y recibe { sesion, parametro }.
 * Ocultar opciones por rol es solo ergonomía; la autorización real se valida en el backend en cada operación.
 *
 * AL AGREGAR UN MÓDULO: (1) crea js/<modulo>.js con window.Vistas['<ruta>'] = function (ctx) { return nodo; };
 * (2) añade su <script> en index.html; (3) añádelo a MODULOS (o RUTAS_EXTRA si recibe un parámetro: #/ruta/ID).
 */
(function () {
  'use strict';

  const TODOS = ['ADMIN', 'USUARIO'];
  const SOLO_ADMIN = ['ADMIN'];

  // Módulos del menú lateral (ruta, título, icono de Font Awesome, roles que lo ven).
  const MODULOS = [
    { ruta: 'inicio', titulo: 'Panel', icono: 'fa-gauge', roles: SOLO_ADMIN },
    { ruta: 'archivos', titulo: 'Archivos', icono: 'fa-folder-open', roles: TODOS },
    { ruta: 'usuarios', titulo: 'Usuarios', icono: 'fa-users', roles: SOLO_ADMIN }
  ];
  // Rutas que no están en el menú (reciben un parámetro) y la opción del menú que resaltan.
  const RUTAS_EXTRA = [];
  // Pantalla de arranque según el rol: el administrador entra al panel; el usuario, directo a sus archivos.
  function inicio() { return sesion.rol === 'ADMIN' ? 'inicio' : 'archivos'; }

  const sesionInicial = window.Auth.leer();
  if (!sesionInicial) {
    window.Auth.irALogin('requerida');
    return;
  }
  let sesion = sesionInicial;

  const menu = document.getElementById('menu');
  const sidebar = document.getElementById('sidebar');
  const fondo = document.getElementById('sidebar-fondo');
  const botonMenu = document.getElementById('btn-menu');
  const vista = document.getElementById('vista');
  const titulo = document.getElementById('titulo-vista');
  const contenido = document.getElementById('contenido');
  const avisoGlobal = document.getElementById('aviso-global');
  const esMovil = window.matchMedia('(max-width: 900px)');
  const el = window.Utils.el;

  function modulosPermitidos() {
    return MODULOS.filter(function (m) { return m.roles.indexOf(sesion.rol) !== -1; });
  }

  /* --------------------------------- menú lateral --------------------------------- */

  function pintarUsuario() {
    document.getElementById('usuario-nombre').textContent = sesion.nombre;
    document.getElementById('usuario-rol').textContent = sesion.rol;
  }

  function pintarMenu() {
    menu.replaceChildren();
    modulosPermitidos().forEach(function (m) {
      const hijos = [el('i', { clase: 'fa-solid ' + m.icono, 'aria-hidden': 'true' }), el('span', { clase: 'nav-texto', texto: m.titulo })];
      menu.append(el('li', {}, [el('a', { clase: 'nav-item', href: '#/' + m.ruta, 'data-ruta': m.ruta }, hijos)]));
    });
  }

  function marcarActivo(ruta) {
    document.querySelectorAll('.sidebar [data-ruta]').forEach(function (a) {
      if (a.getAttribute('data-ruta') === ruta) a.setAttribute('aria-current', 'page');
      else a.removeAttribute('aria-current');
    });
  }

  function abrirMenu(abrir) {
    document.body.classList.toggle('menu-abierto', abrir);
    botonMenu.setAttribute('aria-expanded', String(abrir));
    botonMenu.setAttribute('aria-label', abrir ? 'Cerrar menú' : 'Abrir menú');
    fondo.hidden = !abrir;
    sincronizarInerte();
    if (abrir) {
      const primero = sidebar.querySelector('a, button');
      if (primero) primero.focus();
    }
  }

  // En móvil, el panel cerrado no debe ser alcanzable con el teclado.
  function sincronizarInerte() {
    sidebar.inert = esMovil.matches && !document.body.classList.contains('menu-abierto');
  }

  botonMenu.addEventListener('click', function () { abrirMenu(!document.body.classList.contains('menu-abierto')); });
  fondo.addEventListener('click', function () { abrirMenu(false); botonMenu.focus(); });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && document.body.classList.contains('menu-abierto')) { abrirMenu(false); botonMenu.focus(); }
  });
  esMovil.addEventListener('change', function () { abrirMenu(false); });
  sidebar.addEventListener('click', function (e) { if (e.target.closest('a[data-ruta]') && esMovil.matches) abrirMenu(false); });
  document.getElementById('btn-salir').addEventListener('click', function () { window.Auth.logout(); });

  // Si una consulta no pudo actualizarse y se muestra lo último guardado, se avisa con su antigüedad.
  window.addEventListener('app:sin-actualizar', function (e) {
    const min = Math.max(1, Math.round(((e.detail && e.detail.edadMs) || 0) / 60000));
    avisoGlobal.textContent = 'No se pudo actualizar. Se muestran datos guardados hace ' + min + ' min.';
    avisoGlobal.hidden = false;
  });
  window.addEventListener('app:actualizado', function () { avisoGlobal.hidden = true; });

  /* --------------------------------- vistas base --------------------------------- */

  function vistaSinAcceso() {
    return el('section', { clase: 'tarjeta' }, [el('h2', { texto: 'Sin acceso' }), el('p', { texto: 'Tu rol no tiene permiso para esta pantalla.' })]);
  }

  /* ---------------------------------- enrutador ---------------------------------- */

  /** "#/item/ITM-123" → { ruta: 'item', parametro: 'ITM-123' }. */
  function rutaActual() {
    const m = /^#\/([a-z-]+)(?:\/([A-Za-z0-9._-]+))?/.exec(window.location.hash);
    return m ? { ruta: m[1], parametro: m[2] || '' } : { ruta: inicio(), parametro: '' };
  }

  function mostrarVista() {
    const actual = rutaActual();
    const modulo = MODULOS.concat(RUTAS_EXTRA).find(function (m) { return m.ruta === actual.ruta; });
    if (!modulo || (modulo.activa && !actual.parametro)) { window.location.replace('#/' + inicio()); return; }
    const fabrica = window.Vistas && window.Vistas[modulo.ruta];
    let nodo;
    if (modulo.roles.indexOf(sesion.rol) === -1) nodo = vistaSinAcceso();
    else if (fabrica) nodo = fabrica({ sesion: sesion, parametro: actual.parametro });
    else nodo = el('section', { clase: 'tarjeta' }, [el('h2', { texto: modulo.titulo }), el('p', { texto: 'Este módulo aún no está disponible.' })]);
    vista.replaceChildren(nodo);
    titulo.textContent = modulo.titulo;
    document.title = modulo.titulo + ' · Trinchera RH';
    marcarActivo(modulo.activa || modulo.ruta);
    contenido.focus({ preventScroll: true });
    window.scrollTo(0, 0);
  }

  window.addEventListener('hashchange', mostrarVista);

  /* ----------------------------------- arranque ----------------------------------- */

  function iniciar() {
    pintarUsuario();
    pintarMenu();
    sincronizarInerte();
    mostrarVista();
  }
  iniciar();

  // Confirma con el servidor que la sesión sigue vigente y obtiene nombre/rol. Va a la cola de segundo plano para no
  // competir con la pantalla. Si no responde no se molesta a nadie: cada operación revalida la sesión de todos modos.
  window.Auth.verificar(true).then(function (r) {
    if (!r || !r.success) return;
    const previa = sesion;
    sesion = window.Auth.leer();
    if (sesion.rol !== previa.rol || sesion.nombre !== previa.nombre) iniciar();
  });
})();
