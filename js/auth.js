/**
 * auth.js — Sesión del lado del cliente y capa de consultas a la API.
 *
 * El token se guarda en sessionStorage (se borra al cerrar la pestaña) y se envía en el cuerpo de cada
 * POST. El cliente NUNCA decide permisos: el rol que se muestra viene del servidor y solo se usa para
 * ocultar opciones; cada operación se autoriza de nuevo en el backend.
 *
 * Rapidez y resistencia a la lentitud de Apps Script (medido contra la Web App real: ~1.2 s normalmente, pero una de
 * cada 6–10 peticiones se atora entre 9 y 60 s):
 *  - Las lecturas se muestran primero desde la última respuesta guardada y se actualizan por detrás (consultar).
 *    Esas copias también se guardan en sessionStorage de esta pestaña, así que al recargar la página no se espera a la red.
 *  - Una lectura que tarda más de unos segundos se vuelve a pedir en paralelo y gana la primera que responda
 *    (las escrituras igual, pero solo con el mismo requestId, que el servidor ya trata como idempotente).
 *  - Lo que no es urgente (números rápidos, comprobar la sesión, precargas) espera en una cola de una sola llamada a
 *    la vez y solo corre cuando no hay nada en primer plano, para no saturar al servidor al recargar.
 */
(function () {
  'use strict';

  const CLAVE = 'app.sesion';
  const CLAVE_COPIAS = 'app.copias';
  // REGISTRA AQUÍ cada acción nueva del backend:
  //  - ACCIONES_QUE_CAMBIAN_DATOS: escrituras; al tener éxito se descartan las copias y se avisa a la app (evento 'app:cambio').
  //  - LECTURAS: solo consultan; se pueden repetir sin efecto (refuerzo automático si tardan).
  //  - CATALOGOS_ESTABLES: lecturas que casi no cambian (se conservan tras otras escrituras, p. ej. tarifas) y las
  //    escrituras que sí los cambian (ACCIONES_QUE_CAMBIAN_CATALOGOS) para descartarlos.
  // descargarArchivo no está en ninguna lista a propósito: no cambia datos y no debe repetirse en paralelo (es pesada).
  const ACCIONES_QUE_CAMBIAN_DATOS = ['sincronizarArchivos', 'crearUsuario', 'editarUsuario'];
  const LECTURAS = ['sesion', 'archivos', 'usuarios', 'resumen', 'metricas'];
  const CATALOGOS_ESTABLES = [];
  const ACCIONES_QUE_CAMBIAN_CATALOGOS = [];
  const ESPERA_REFUERZO_LECTURA_MS = 4000;
  const ESPERA_REFUERZO_ESCRITURA_MS = 9000;
  let enMemoria = null; // respaldo si sessionStorage no está disponible

  function leer() {
    try {
      const crudo = window.sessionStorage.getItem(CLAVE);
      if (crudo) return JSON.parse(crudo);
    } catch (err) { /* almacenamiento no disponible: se usa memoria */ }
    return enMemoria;
  }

  function guardar(sesion) {
    enMemoria = sesion;
    try {
      window.sessionStorage.setItem(CLAVE, JSON.stringify(sesion));
    } catch (err) { /* se conserva solo en memoria */ }
  }

  function limpiar() {
    enMemoria = null;
    try {
      window.sessionStorage.removeItem(CLAVE);
      window.sessionStorage.removeItem(CLAVE_COPIAS);
    } catch (err) { /* nada */ }
  }

  function irALogin(motivo) {
    window.location.replace('login.html' + (motivo ? '?motivo=' + encodeURIComponent(motivo) : ''));
  }

  /** Inicia sesión. Devuelve el sobre de la API; si tuvo éxito, la sesión queda guardada. */
  async function login(usuario, password) {
    const r = await window.Api.post('login', { usuario: usuario, password: password });
    if (r.success && r.data && r.data.token) {
      try { window.sessionStorage.removeItem(CLAVE_COPIAS); } catch (err) { /* nada */ }   // lo guardado de otra persona no se reutiliza
      guardar({
        token: r.data.token,
        usuario: r.data.usuario.usuario,
        nombre: r.data.usuario.nombre,
        rol: r.data.usuario.rol
      });
    }
    return r;
  }

  /* ------------------------------ Peticiones con refuerzo ------------------------------ */

  /**
   * Hace la petición y, si tarda más de `esperaMs` (o falla antes), la repite una vez en paralelo; responde la primera que
   * llegue. Solo se usa con peticiones que se pueden repetir sin riesgo.
   */
  function conRefuerzo(pedir, esperaMs) {
    return new Promise(function (resolver, rechazar) {
      let vivas = 0;
      let listo = false;
      let refuerzo = false;
      let temporizador = null;
      function terminar(fn, valor) {
        if (listo) return;
        listo = true;
        clearTimeout(temporizador);
        fn(valor);
      }
      function lanzar() {
        vivas++;
        pedir().then(function (r) { terminar(resolver, r); }, function (err) {
          vivas--;
          if (listo) return;
          if (!refuerzo) { refuerzo = true; clearTimeout(temporizador); lanzar(); }   // el primero falló: se reintenta enseguida
          else if (vivas === 0) terminar(rechazar, err);
        });
      }
      temporizador = setTimeout(function () { if (!listo && !refuerzo) { refuerzo = true; lanzar(); } }, esperaMs);
      lanzar();
    });
  }

  /* ------------------------------ Cola de segundo plano ------------------------------ */

  let primerPlano = 0;          // peticiones que la persona está esperando
  let fondoActivo = false;
  const cola = [];

  /** Corre la siguiente tarea de segundo plano solo si no hay nada en primer plano y no hay otra corriendo. */
  function bombear() {
    if (fondoActivo || primerPlano > 0 || !cola.length) return;
    fondoActivo = true;
    const t = cola.shift();
    Promise.resolve().then(t.tarea).then(t.resolver, function () { t.resolver(null); }).then(function () {
      fondoActivo = false;
      bombear();
    });
  }

  /** Encola una tarea (función que devuelve una promesa). Nunca rechaza: si falla, entrega null. */
  function enSegundoPlano(tarea) {
    return new Promise(function (resolver) {
      cola.push({ tarea: tarea, resolver: resolver });
      bombear();
    });
  }

  /**
   * Llama a una acción autenticada. Si el servidor responde que la sesión no es válida,
   * limpia el estado local y redirige al login.
   */
  async function despachar(accion, payload, requestId, fondo) {
    const sesion = leer();
    if (!sesion) {
      irALogin('requerida');
      return new Promise(() => {}); // la página se está redirigiendo
    }
    if (!fondo) primerPlano++;
    try {
      let pedir;
      let espera = 0;
      if (LECTURAS.indexOf(accion) !== -1) {
        pedir = function () { return window.Api.post(accion, payload, sesion.token); };
        espera = ESPERA_REFUERZO_LECTURA_MS;
      } else if (requestId) {
        // Con el mismo requestId el servidor nunca duplica una escritura: repetirla en paralelo es seguro.
        pedir = function () { return window.Api.post(accion, payload, sesion.token, requestId); };
        espera = ESPERA_REFUERZO_ESCRITURA_MS;
      } else {
        pedir = function () { return window.Api.post(accion, payload, sesion.token, requestId); };
      }
      const r = espera ? await conRefuerzo(pedir, espera) : await pedir();
      if (!r.success && r.code === 'AUTH_REQUIRED') {
        limpiar();
        irALogin('expirada');
        return new Promise(() => {});
      }
      // Estas operaciones cambian los datos mostrados: se descartan las copias y se avisa a la app (números rápidos, precarga).
      if (r.success && ACCIONES_QUE_CAMBIAN_DATOS.indexOf(accion) !== -1) {
        descartarCopias(accion);
        window.dispatchEvent(new Event('app:cambio'));
      }
      return r;
    } finally {
      if (!fondo) {
        primerPlano--;
        bombear();
      }
    }
  }

  function llamar(accion, payload, requestId) { return despachar(accion, payload, requestId, false); }

  /** Igual que llamar, pero en la cola de segundo plano (no compite con lo que la persona está esperando). */
  function llamarEnSegundoPlano(accion, payload) {
    return enSegundoPlano(function () { return despachar(accion, payload, undefined, true); });
  }

  /* ------------------------------ Lecturas con copia ------------------------------ */

  // La última respuesta de cada lectura se guarda en memoria y en sessionStorage (solo esta pestaña; se borra al cerrarla,
  // al cerrar sesión o al entrar otra persona). Al abrir o recargar una pantalla se muestra al instante y, por detrás, se
  // pide la versión nueva, que reemplaza a la copia solo si cambió. Se descartan al registrar cualquier operación y no se
  // usan en cobros ni liquidaciones.
  const VIGENCIA_COPIA_MS = 15 * 60 * 1000;     // hasta cuándo se muestra una copia mientras llega lo nuevo
  const VIGENCIA_OBTENER_MS = 5 * 60 * 1000;    // datos que casi no cambian (tarifas): se usan sin volver a pedir
  const MAX_CARACTERES_COPIAS = 2500000;        // por debajo del límite de sessionStorage
  const copias = new Map();      // clave → { t, r }
  const enVuelo = new Map();     // clave → promesa (varias pantallas piden lo mismo: se pregunta una sola vez)
  let generacion = 0;            // sube con cada cambio: una respuesta que venía en camino ya no se guarda
  let temporizadorGuardado = null;

  function claveCopia(accion, payload) { return accion + '|' + JSON.stringify(payload || {}); }

  function guardarCopias() {
    try {
      const s = leer();
      if (!s) return;
      const lista = [];
      copias.forEach(function (v, k) { lista.push([k, v.t, v.r]); });
      const texto = JSON.stringify({ usuario: s.usuario, lista: lista });
      if (texto.length > MAX_CARACTERES_COPIAS) window.sessionStorage.removeItem(CLAVE_COPIAS);
      else window.sessionStorage.setItem(CLAVE_COPIAS, texto);
    } catch (err) {
      try { window.sessionStorage.removeItem(CLAVE_COPIAS); } catch (err2) { /* nada */ }
    }
  }

  function programarGuardado() {
    clearTimeout(temporizadorGuardado);
    temporizadorGuardado = setTimeout(guardarCopias, 400);
  }

  /** Al cargar la página: recupera las copias de esta pestaña (si son de la misma persona). */
  function restaurarCopias() {
    try {
      const s = leer();
      const crudo = window.sessionStorage.getItem(CLAVE_COPIAS);
      if (!s || !crudo) return;
      const o = JSON.parse(crudo);
      if (!o || o.usuario !== s.usuario || !Array.isArray(o.lista)) { window.sessionStorage.removeItem(CLAVE_COPIAS); return; }
      o.lista.forEach(function (e) { copias.set(e[0], { t: e[1], r: e[2] }); });
    } catch (err) {
      try { window.sessionStorage.removeItem(CLAVE_COPIAS); } catch (err2) { /* nada */ }
    }
  }

  /** Descarta las copias. Los catálogos estables se conservan salvo que la operación sea justo un cambio de catálogo. */
  function descartarCopias(accion) {
    const cambiaCatalogo = ACCIONES_QUE_CAMBIAN_CATALOGOS.indexOf(accion) !== -1;
    Array.from(copias.keys()).forEach(function (k) {
      const esEstable = CATALOGOS_ESTABLES.indexOf(k.split('|')[0]) !== -1;
      if (cambiaCatalogo || !esEstable) copias.delete(k);
    });
    generacion++;
    programarGuardado();
  }

  /** Lo que identifica una respuesta sin los campos que cambian en cada consulta (la hora del servidor). */
  function huella(r) {
    return JSON.stringify(r, function (k, v) { return k === 'ahora' || k === 'ms' ? undefined : v; });
  }

  function traer(accion, payload, fresco, fondo) {
    const k = claveCopia(accion, payload);
    if (!fresco && enVuelo.has(k)) return enVuelo.get(k);
    const gen = generacion;
    // "fresco" también le pide al servidor la hoja real (por si alguien la editó a mano) y no la copia que guarda allá.
    const cuerpo = fresco ? Object.assign({}, payload, { fresco: true }) : payload;
    const p = (fondo ? llamarEnSegundoPlano(accion, cuerpo) : llamar(accion, cuerpo)).then(function (r) {
      if (r === null) throw new Error('No se pudo consultar.');
      if (r.success && gen === generacion) {
        copias.set(k, { t: Date.now(), r: r });
        programarGuardado();
      }
      if (r.success) window.dispatchEvent(new Event('app:actualizado'));
      return r;
    }).finally(function () { if (enVuelo.get(k) === p) enVuelo.delete(k); });
    enVuelo.set(k, p);
    return p;
  }

  /**
   * Lectura "primero lo guardado, luego lo nuevo". Si hay una copia reciente se llama de inmediato a alDatos(r, true);
   * después se pide la respuesta nueva y se llama a alDatos(r, false) solo si es distinta de lo ya mostrado.
   * opciones.fresco: no usa copias (botón Actualizar). opciones.vivo(): devuelve false si la pantalla ya no está visible.
   * Devuelve la promesa de la respuesta nueva; si falla la red y ya se mostró una copia, no rechaza: se conserva lo
   * mostrado y se avisa (evento app:sin-actualizar) para que la app lo diga.
   */
  function consultar(accion, payload, alDatos, opciones) {
    const fresco = !!(opciones && opciones.fresco);
    const vivo = opciones && opciones.vivo;
    const copia = fresco ? null : copias.get(claveCopia(accion, payload));
    const mostrada = copia && Date.now() - copia.t < VIGENCIA_COPIA_MS ? copia.r : null;
    if (mostrada) alDatos(mostrada, true);
    return traer(accion, payload, fresco, false).then(function (r) {
      if (vivo && !vivo()) return r;
      if (mostrada && r.success && huella(r) === huella(mostrada)) return r;
      alDatos(r, false);
      return r;
    }, function (err) {
      if (mostrada) {
        window.dispatchEvent(new CustomEvent('app:sin-actualizar', { detail: { edadMs: Date.now() - copia.t } }));
        return null;
      }
      throw err;
    });
  }

  /**
   * Lectura que usa la copia si es reciente y, si no, la pide (una sola respuesta, sin actualización por detrás).
   * Para datos que casi no cambian y se usan dentro de formularios, como las tarifas.
   */
  function obtener(accion, payload) {
    const copia = copias.get(claveCopia(accion, payload));
    if (copia && Date.now() - copia.t < VIGENCIA_OBTENER_MS) return Promise.resolve(copia.r);
    return traer(accion, payload || {}, false, false);
  }

  /** Pide una lectura en segundo plano para que la siguiente pantalla aparezca al instante. Nunca falla ni molesta. */
  function precargar(accion, payload) {
    const k = claveCopia(accion, payload || {});
    const copia = copias.get(k);
    if (enVuelo.has(k) || (copia && Date.now() - copia.t < 60 * 1000)) return Promise.resolve(null);
    return traer(accion, payload || {}, false, true).catch(function () { /* se pedirá de nuevo al abrir la pantalla */ });
  }

  async function logout() {
    const sesion = leer();
    if (sesion) {
      try {
        await window.Api.post('logout', {}, sesion.token);
      } catch (err) { /* aunque falle la red, se cierra la sesión local */ }
    }
    copias.clear();
    limpiar();
    irALogin('cerrada');
  }

  /** Actualiza rol/nombre desde el servidor y confirma que la sesión sigue vigente. `enFondo`: sin competir con lo que se ve. */
  async function verificar(enFondo) {
    const r = enFondo ? await llamarEnSegundoPlano('sesion', {}) : await llamar('sesion', {});
    if (r && r.success) {
      const actual = leer();
      guardar(Object.assign({}, actual, { nombre: r.data.nombre, rol: r.data.rol }));
    }
    return r;
  }

  restaurarCopias();

  window.Auth = Object.freeze({ leer, login, llamar, llamarEnSegundoPlano, consultar, obtener, precargar, logout, verificar, irALogin });
})();
