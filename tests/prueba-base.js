// Pruebas base: sesión y permisos, login real, bloqueo de escrituras sin base preparada (VERSION_FORMATOS), lectura rápida
// (copias de hojas) y resistencia a un CacheService caído. Cada prueba corre con tres órdenes de carga de archivos.
// Las pruebas del dominio (archivos, usuarios, descargas) viven en prueba-archivos.js.
const assert = require('assert');
const { crearMundo } = require('./mundo');
const ORDENES = require('./ordenes-de-carga');
const raiz = process.argv[2] || require('path').resolve(__dirname, '..');
let total = 0;

for (let io = 0; io < ORDENES.length; io++) {
  const orden = ORDENES[io];
  console.log('\n== Orden de carga ' + (io + 1) + ': ' + orden.slice(0, 4).join(', ') + ', …');
  const t = (nombre, fn) => { fn(); total++; console.log('  ok -', nombre); };
  const mundo = (preparar) => crearMundo(raiz, orden, preparar);

  t('ping público: versión y base; eco con acentos y zona horaria', () => {
    const w = mundo();
    const p = w.post({ action: 'ping', payload: {} });
    assert.ok(p.success && p.data.hojasCompletas === true && p.data.baseConectada === true);
    const e = w.ok(w.llamar(null, 'eco', { texto: 'camión ñandú' }));
    assert.strictEqual(e.texto, 'camión ñandú');
    assert.ok(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(e.servidor.local));
  });

  t('sin sesión o con token falso: AUTH_REQUIRED; acción o método desconocido', () => {
    const w = mundo();
    assert.strictEqual(w.llamar(null, 'archivos').code, 'AUTH_REQUIRED');
    assert.strictEqual(w.post({ action: 'archivos', payload: {}, token: 'x'.repeat(64) }).code, 'AUTH_REQUIRED');
    assert.strictEqual(w.llamar('ana', 'noExiste').code, 'ACCION_DESCONOCIDA');
    assert.strictEqual(JSON.parse(w.ctx.doGet({ parameter: { action: 'archivos' } }).getContent()).code, 'METODO_NO_PERMITIDO');
    assert.strictEqual(JSON.parse(w.ctx.doPost({ postData: { contents: '{no json' } }).getContent()).code, 'SOLICITUD_INVALIDA');
  });

  t('login real: hash PBKDF2, sesión, contraseña incorrecta y bloqueo a los 5 intentos', () => {
    const w = mundo();
    w.ctx.insertarUsuario_('maria', 'María', 'USUARIO', 'Contraseña-segura-1');
    const bien = w.post({ action: 'login', payload: { usuario: 'maria', password: 'Contraseña-segura-1' } });
    assert.ok(bien.success && bien.data.token.length === 64 && bien.data.usuario.rol === 'USUARIO');
    assert.ok(/^pbkdf2-sha256\$100000\$/.test(w.hojas.USUARIOS._f.filter((f) => f[1] === 'maria')[0][2]));
    for (let i = 0; i < 4; i++) assert.strictEqual(w.post({ action: 'login', payload: { usuario: 'maria', password: 'mala' + i } }).code, 'CREDENCIALES_INVALIDAS');
    assert.strictEqual(w.post({ action: 'login', payload: { usuario: 'maria', password: 'mala5' } }).code, 'BLOQUEADO');
    assert.strictEqual(w.post({ action: 'login', payload: { usuario: 'maria', password: 'Contraseña-segura-1' } }).code, 'BLOQUEADO', 'bloqueada aunque ahora acierte');
    const raro = w.post({ action: 'login', payload: { usuario: 'noexiste', password: 'x' } });
    assert.strictEqual(raro.message, 'Usuario o contraseña incorrectos.', 'mismo mensaje para usuario inexistente (no enumera usuarios)');
  });

  t('matriz de permisos: USUARIO solo consulta y descarga; solo ADMIN administra', () => {
    const w = mundo();
    const soloAdmin = [['sincronizarArchivos', {}], ['resumen', {}], ['metricas', {}], ['usuarios', {}], ['crearUsuario', { usuario: 'zzz', nombre: 'Z', password: 'Contraseña-segura-1' }], ['editarUsuario', { usuario: 'ana', nombre: 'Ana' }]];
    soloAdmin.forEach(([accion, payload]) => {
      assert.strictEqual(w.llamar('ana', accion, payload).code, 'FORBIDDEN', accion + ' debe ser solo ADMIN');
      assert.notStrictEqual(w.llamar('admin', accion, payload).code, 'FORBIDDEN', accion + ' lo debe poder usar ADMIN');
    });
    ['archivos', 'sesion'].forEach((a) => assert.ok(w.llamar('ana', a).success, a));
    assert.notStrictEqual(w.llamar('ana', 'descargarArchivo', { idArchivo: 'ARC-no-existe' }).code, 'FORBIDDEN', 'USUARIO puede intentar descargar (el acceso se decide por archivo)');
    // Todas las acciones del catálogo deben estar cubiertas por esta prueba o por otra.
    const cubiertas = ['ping', 'eco', 'login', 'logout', 'sesion', 'cambiarPassword', 'archivos', 'descargarArchivo', 'sincronizarArchivos', 'resumen', 'metricas', 'usuarios', 'crearUsuario', 'editarUsuario'];
    const catalogo = Object.keys(w.ctx.catalogoAcciones_());
    assert.deepStrictEqual(catalogo.filter((a) => cubiertas.indexOf(a) === -1), [], 'acción nueva sin prueba de permisos: agrégala a esta lista y cúbrela');
  });

  t('cambiar contraseña propia: exige la actual, aplica la política y cierra el camino a la anterior', () => {
    const w = mundo();
    w.ctx.insertarUsuario_('maria', 'María', 'USUARIO', 'Contraseña-segura-1');
    const token = w.post({ action: 'login', payload: { usuario: 'maria', password: 'Contraseña-segura-1' } }).data.token;
    const cambiar = (actual, nueva) => w.post({ action: 'cambiarPassword', payload: { actual, nueva }, token });
    assert.strictEqual(cambiar('Contraseña-segura-1', 'corta').code, 'PASSWORD_DEBIL');
    assert.strictEqual(cambiar('incorrecta-123', 'Otra-contraseña-2').code, 'CREDENCIALES_INVALIDAS');
    assert.ok(cambiar('Contraseña-segura-1', 'Otra-contraseña-2').success);
    assert.strictEqual(w.post({ action: 'login', payload: { usuario: 'maria', password: 'Contraseña-segura-1' } }).code, 'CREDENCIALES_INVALIDAS');
    assert.ok(w.post({ action: 'login', payload: { usuario: 'maria', password: 'Otra-contraseña-2' } }).success);
  });

  t('sin base preparada (VERSION_FORMATOS) toda escritura responde CONFIGURACION_PENDIENTE', () => {
    const w = mundo();
    Object.keys(w.props).forEach((k) => { if (k === 'FORMATOS_APLICADOS') w.props[k] = '0'; });
    const r = w.llamar('admin', 'crearUsuario', { usuario: 'nuevo1', nombre: 'Nuevo', password: 'Contraseña-segura-1' });
    assert.strictEqual(r.code, 'CONFIGURACION_PENDIENTE');
    assert.strictEqual(w.llamar('admin', 'sincronizarArchivos', { carpeta: 'CARPETARAIZ01' }).code, 'CONFIGURACION_PENDIENTE');
    assert.ok(w.llamar('ana', 'archivos').success, 'las lecturas siguen funcionando');
  });

  t('sesión revalidada: un usuario desactivado a mano en la hoja pierde la sesión pasada la ventana de revalidación', () => {
    const w = mundo();
    const token = w.tk('ana');
    assert.ok(w.post({ action: 'archivos', payload: {}, token }).success);
    w.hojas.USUARIOS._f.filter((f) => f[1] === 'ana')[0][5] = false;
    assert.ok(w.post({ action: 'archivos', payload: {}, token }).success, 'dentro de la ventana todavía vale');
    w.estado.ahora += 31 * 60 * 1000;
    w.ctx.ahoraMs_ = () => w.estado.ahora;
    assert.strictEqual(w.post({ action: 'archivos', payload: {}, token }).code, 'AUTH_REQUIRED');
  });

  t('lectura rápida: con copia vigente leer no abre el archivo ni lee hojas; escribir invalida la copia', () => {
    const w = mundo();
    w.sembrarDrive(); w.sincronizar();
    w.llamar('admin', 'archivos');                    // calienta la copia
    w.estado.lecturas = 0; w.estado.aperturas = 0;
    const r = w.ok(w.llamar('admin', 'archivos'));
    assert.strictEqual(r.total, 4);
    assert.strictEqual(w.estado.lecturas, 0, 'sin lecturas de hoja con copia vigente');
    assert.strictEqual(w.estado.aperturas, 0, 'sin abrir el archivo');
    w.drive.archivos['DRV-NUEVO-000001'] = { id: 'DRV-NUEVO-000001', name: 'Nuevo.pdf', mime: 'application/pdf', bytes: Buffer.from('n') };
    w.drive.carpetas.CARPETARAIZ01.files.push('DRV-NUEVO-000001');
    w.sincronizar();                                  // la escritura cambia la versión de las copias
    assert.strictEqual(w.ok(w.llamar('admin', 'archivos')).total, 5, 'se ve lo recién sincronizado');
  });

  t('CacheService caído: todo sigue funcionando leyendo la hoja', () => {
    const w = mundo();
    w.sembrarDrive(); w.sincronizar();
    w.estado.cacheRota = true;
    assert.strictEqual(w.ok(w.llamar('admin', 'archivos')).total, 4);
    w.estado.cacheRota = false;
  });
}

console.log('\n' + total + ' pruebas OK');
