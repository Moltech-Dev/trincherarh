// Pruebas del dominio: sincronización de la carpeta de Drive, usuarios con archivos asignados y descargas con permisos.
// Cada prueba corre con los tres órdenes de carga de archivos.
const assert = require('assert');
const { crearMundo, ENLACE_CARPETA } = require('./mundo');
const ORDENES = require('./ordenes-de-carga');
const raiz = process.argv[2] || require('path').resolve(__dirname, '..');
let total = 0;

const decodificar = (b64) => Buffer.from(b64, 'base64').toString('utf8');

for (let io = 0; io < ORDENES.length; io++) {
  const orden = ORDENES[io];
  console.log('\n== Orden de carga ' + (io + 1) + ': ' + orden.slice(0, 4).join(', ') + ', …');
  const t = (nombre, fn) => { fn(); total++; console.log('  ok -', nombre); };
  /** Mundo con Drive sembrado y la carpeta ya sincronizada. */
  const mundo = (sincronizado) => { const w = crearMundo(raiz, orden); w.sembrarDrive(); if (sincronizado !== false) w.sincronizar(); return w; };

  t('sincronizar: registra solo lo descargable, con categoría por subcarpeta, y guarda la carpeta', () => {
    const w = mundo(false);
    const r = w.sincronizar();
    assert.deepStrictEqual([r.nuevos, r.actualizados, r.inactivados, r.truncado], [4, 0, 0, false]);
    const lista = w.ok(w.llamar('admin', 'archivos')).archivos;
    assert.deepStrictEqual(lista.map((a) => a.nombre).sort(), ['Contrato.pdf', 'Politica', 'Recibo.xlsx', 'Reglamento.pdf']);
    assert.strictEqual(lista.filter((a) => a.nombre === 'Recibo.xlsx')[0].categoria, 'Nomina');
    assert.strictEqual(lista.filter((a) => a.nombre === 'Contrato.pdf')[0].categoria, 'General');
    assert.ok(!lista.some((a) => /Borrado|Encuesta/.test(a.nombre)), 'ni papelera ni formularios');
    assert.strictEqual(w.ok(w.llamar('admin', 'archivos')).carpetaConfigurada, true);
    const cfg = w.hojas.CONFIGURACION._f.filter((f) => f[0] === 'CARPETA_DRIVE_ID')[0];
    assert.strictEqual(cfg[1], 'CARPETARAIZ01');
    assert.ok(w.llamar('admin', 'sincronizarArchivos', {}).success, 'sin enlace usa la carpeta guardada');
  });

  t('sincronizar: con el servicio avanzado de Drive (1 llamada por carpeta) y sin él (DriveApp) da el mismo catálogo', () => {
    const catalogo = (avanzado) => {
      const w = crearMundo(raiz, orden);
      w.sembrarDrive();
      if (!avanzado) delete w.ctx.Drive;
      w.estado.llamadasDrive = 0;
      const r = w.sincronizar();
      assert.strictEqual(r.nuevos, 4);
      return { lista: w.ok(w.llamar('admin', 'archivos')).archivos.map((a) => [a.nombre, a.categoria, a.mime, a.tamano]).sort(), llamadas: w.estado.llamadasDrive };
    };
    const rapido = catalogo(true), lento = catalogo(false);
    assert.deepStrictEqual(rapido.lista, lento.lista);
    assert.strictEqual(rapido.llamadas, 2, 'raíz + subcarpeta Nomina: una llamada por carpeta, sin importar cuántos archivos tengan');
    assert.strictEqual(lento.llamadas, 0);
  });

  t('sincronizar: una carpeta a la que no se tiene acceso no inactiva el catálogo (el servicio avanzado devolvería lista vacía)', () => {
    const w = mundo();
    delete w.drive.carpetas.CARPETARAIZ01;                      // la compartición se retiró
    assert.strictEqual(w.llamar('admin', 'sincronizarArchivos', {}).code, 'DRIVE_NO_DISPONIBLE');
    assert.strictEqual(w.ok(w.llamar('admin', 'archivos')).archivos.filter((a) => a.estatus === 'ACTIVO').length, 4, 'todo sigue activo');
  });

  t('sincronizar: muchos archivos se escriben en una sola operación y un archivo con dos padres no se duplica', () => {
    const w = mundo(false);
    for (let i = 0; i < 120; i++) {
      const id = 'DRV-MASIVO-' + String(i).padStart(4, '0');
      w.drive.archivos[id] = { id, name: 'Curso ' + i + '.pdf', mime: 'application/pdf', bytes: Buffer.from('x') };
      w.drive.carpetas.CARPETARAIZ01.files.push(id);
    }
    w.drive.carpetas['CARPETA-NOMINA-1'].files.push('DRV-CONTRATO-01');   // mismo archivo en dos carpetas
    let escrituras = 0;
    const original = w.hojas.ARCHIVOS.getRange.bind(w.hojas.ARCHIVOS);
    w.hojas.ARCHIVOS.getRange = (...args) => { const r = original(...args); const sv = r.setValues; r.setValues = function (v) { escrituras++; return sv.call(this, v); }; return r; };
    const r = w.sincronizar();
    assert.strictEqual(r.nuevos, 124);
    assert.strictEqual(w.hojas.ARCHIVOS._f.length - 1, 124);
    assert.strictEqual(escrituras, 1, 'una sola escritura para todas las filas nuevas');
  });

  t('sincronizar: es repetible (sin cambios no escribe), detecta renombres, bajas y regresos', () => {
    const w = mundo();
    const filas = w.hojas.ARCHIVOS._f.length;
    const r0 = w.ok(w.llamar('admin', 'sincronizarArchivos', {}));
    assert.deepStrictEqual([r0.nuevos, r0.actualizados, r0.inactivados], [0, 0, 0]);
    assert.strictEqual(w.hojas.ARCHIVOS._f.length, filas);

    w.drive.archivos['DRV-CONTRATO-01'].name = 'Contrato 2026.pdf';
    w.drive.carpetas.CARPETARAIZ01.files = w.drive.carpetas.CARPETARAIZ01.files.filter((id) => id !== 'DRV-REGLAMENTO-1');
    const r1 = w.ok(w.llamar('admin', 'sincronizarArchivos', {}));
    assert.deepStrictEqual([r1.nuevos, r1.actualizados, r1.inactivados], [0, 1, 1]);
    const idReglamento = w.idDe('Reglamento.pdf');
    assert.strictEqual(w.ok(w.llamar('ana', 'archivos')).total, 0, 'nada asignado');
    const inactivo = w.ok(w.llamar('admin', 'archivos')).archivos.filter((a) => a.idArchivo === idReglamento)[0];
    assert.strictEqual(inactivo.estatus, 'INACTIVO', 'no se borra: queda inactivo');

    w.drive.carpetas.CARPETARAIZ01.files.push('DRV-REGLAMENTO-1');
    const r2 = w.ok(w.llamar('admin', 'sincronizarArchivos', {}));
    assert.deepStrictEqual([r2.nuevos, r2.actualizados, r2.inactivados], [0, 1, 0]);
    assert.strictEqual(w.idDe('Reglamento.pdf'), idReglamento, 'vuelve con el mismo ID interno (sus accesos siguen valiendo)');
  });

  t('sincronizar: valida el enlace, la carpeta inexistente y Drive caído', () => {
    const w = mundo(false);
    assert.strictEqual(w.llamar('admin', 'sincronizarArchivos', {}).code, 'VALIDACION', 'sin carpeta guardada ni enlace');
    const mal = w.llamar('admin', 'sincronizarArchivos', { carpeta: 'esto no es un enlace' });
    assert.strictEqual(mal.code, 'VALIDACION');
    assert.ok(mal.campos.carpeta);
    const noExiste = w.llamar('admin', 'sincronizarArchivos', { carpeta: 'https://drive.google.com/drive/folders/NoExisteEstaCarpeta1' });
    assert.strictEqual(noExiste.code, 'DRIVE_NO_DISPONIBLE');
    w.drive.caido = true;
    assert.strictEqual(w.llamar('admin', 'sincronizarArchivos', { carpeta: ENLACE_CARPETA }).code, 'DRIVE_NO_DISPONIBLE');
    assert.strictEqual(w.hojas.ARCHIVOS._f.length, 1, 'un fallo no deja filas a medias');
    assert.strictEqual(w.hojas.CONFIGURACION._f.filter((f) => f[0] === 'CARPETA_DRIVE_ID')[0][1], '', 'ni guarda una carpeta que no abrió');
  });

  t('sincronizar: nombres con fórmulas se guardan como texto; mismo requestId no repite', () => {
    const w = mundo(false);
    w.drive.archivos['DRV-FORMULA-0001'] = { id: 'DRV-FORMULA-0001', name: '=HYPERLINK("http://x")', mime: 'application/pdf', bytes: Buffer.from('x') };
    w.drive.carpetas.CARPETARAIZ01.files.push('DRV-FORMULA-0001');
    const id = w.rid();
    const a = w.llamar('admin', 'sincronizarArchivos', { carpeta: ENLACE_CARPETA }, id);
    const b = w.llamar('admin', 'sincronizarArchivos', { carpeta: ENLACE_CARPETA }, id);
    assert.ok(a.success && b.success && b.data.repetida === true);
    assert.strictEqual(w.hojas.ARCHIVOS._f.length - 1, 5, 'una sola vez');
    const fila = w.hojas.ARCHIVOS._f.filter((f) => /HYPERLINK/.test(f[2]))[0];
    assert.ok(fila[2].indexOf("'=") === 0, fila[2]);
  });

  t('crearUsuario: valida cada campo y rechaza duplicados y archivos inexistentes', () => {
    const w = mundo();
    const mal = w.llamar('admin', 'crearUsuario', { usuario: 'A b', nombre: '', password: 'corta', rol: 'JEFE', archivos: 'no-lista' });
    assert.strictEqual(mal.code, 'VALIDACION');
    ['usuario', 'nombre', 'password', 'rol', 'archivos'].forEach((c) => assert.ok(mal.campos[c], 'falta error en ' + c));
    w.crearUsuario({ usuario: 'carla' });
    assert.strictEqual(w.llamar('admin', 'crearUsuario', { usuario: 'CARLA', nombre: 'Otra', password: 'Contraseña-segura-1' }).code, 'DUPLICADO');
    const fantasma = w.llamar('admin', 'crearUsuario', { usuario: 'dario', nombre: 'Darío', password: 'Contraseña-segura-1', archivos: ['ARC-fantasma-1'] });
    assert.strictEqual(fantasma.code, 'VALIDACION');
    assert.strictEqual(w.hojas.USUARIOS._f.filter((f) => f[1] === 'dario').length, 0, 'no queda a medias');
  });

  t('crearUsuario: queda con los archivos elegidos, entra con su contraseña y solo ve y baja lo suyo', () => {
    const w = mundo();
    const contrato = w.idDe('Contrato.pdf');
    const c = w.crearUsuario({ usuario: 'elena', nombre: 'Elena', archivos: [contrato, contrato] });   // repetidos se ignoran
    assert.deepStrictEqual(c.usuario.archivos, [contrato]);
    assert.ok(/^pbkdf2-sha256\$100000\$/.test(w.hojas.USUARIOS._f.filter((f) => f[1] === 'elena')[0][2]), 'contraseña hasheada, nunca en claro');
    assert.strictEqual(w.hojas.ACCESOS._f.length - 1, 1);

    const login = w.post({ action: 'login', payload: { usuario: 'elena', password: 'Contraseña-segura-1' } });
    assert.ok(login.success && login.data.usuario.rol === 'USUARIO');
    const token = login.data.token;
    const lista = w.post({ action: 'archivos', payload: {}, token });
    assert.deepStrictEqual(lista.data.archivos.map((a) => a.nombre), ['Contrato.pdf']);
    assert.strictEqual(lista.data.carpetaConfigurada, undefined, 'un USUARIO no ve datos de configuración');
    const d = w.post({ action: 'descargarArchivo', payload: { idArchivo: contrato }, token });
    assert.ok(d.success);
    assert.strictEqual(decodificar(d.data.base64), 'contenido-del-contrato');
    assert.deepStrictEqual([d.data.nombre, d.data.mime, d.data.tamano], ['Contrato.pdf', 'application/pdf', 22]);
    const otro = w.post({ action: 'descargarArchivo', payload: { idArchivo: w.idDe('Reglamento.pdf') }, token });
    assert.strictEqual(otro.code, 'FORBIDDEN');
  });

  t('descargar: ADMIN baja todo; archivo inactivo o inventado no existe; búsqueda por nombre', () => {
    const w = mundo();
    const d = w.ok(w.llamar('admin', 'descargarArchivo', { idArchivo: w.idDe('Recibo.xlsx') }));
    assert.strictEqual(decodificar(d.base64), 'contenido-del-recibo');
    assert.strictEqual(w.llamar('admin', 'descargarArchivo', { idArchivo: 'ARC-no-existe' }).code, 'NO_ENCONTRADO');
    assert.strictEqual(w.llamar('admin', 'descargarArchivo', { idArchivo: '../etc' }).code, 'VALIDACION');
    assert.strictEqual(w.llamar('admin', 'descargarArchivo', { idArchivo: 'DRV-CONTRATO-01' }).code, 'NO_ENCONTRADO', 'un ID de Drive no sirve: solo los internos del catálogo');
    assert.strictEqual(w.ok(w.llamar('admin', 'archivos', { q: 'nomina' })).total, 2, 'busca también por categoría');
    assert.strictEqual(w.ok(w.llamar('admin', 'archivos', { q: 'recibo' })).total, 1);
  });

  t('descargar: un Google Doc sale como PDF; archivo muy grande y Drive caído dan error claro', () => {
    const w = mundo();
    const doc = w.ok(w.llamar('admin', 'descargarArchivo', { idArchivo: w.idDe('Politica') }));
    assert.strictEqual(doc.nombre, 'Politica.pdf');
    assert.strictEqual(doc.mime, 'application/pdf');
    assert.strictEqual(decodificar(doc.base64), 'PDF-de-Politica');

    w.hojas.CONFIGURACION._f.filter((f) => f[0] === 'TAMANO_MAX_MB')[0][1] = '1';
    w.llamar('admin', 'archivos', { fresco: true });
    w.drive.archivos['DRV-CONTRATO-01'].bytes = Buffer.alloc(1048576 + 1);
    const grande = w.llamar('admin', 'descargarArchivo', { idArchivo: w.idDe('Contrato.pdf') });
    assert.strictEqual(grande.code, 'ARCHIVO_MUY_GRANDE');
    assert.ok(/1 MB/.test(grande.message));

    w.drive.caido = true;
    assert.strictEqual(w.llamar('admin', 'descargarArchivo', { idArchivo: w.idDe('Reglamento.pdf') }).code, 'ARCHIVO_NO_DISPONIBLE');
    w.drive.caido = false;
    w.drive.archivos['DRV-REGLAMENTO-1'].trashed = true;
    assert.strictEqual(w.llamar('admin', 'descargarArchivo', { idArchivo: w.idDe('Reglamento.pdf') }).code, 'ARCHIVO_NO_DISPONIBLE', 'si se mandó a la papelera tras la sincronización');
  });

  t('editarUsuario: quitar un acceso se aplica al instante aunque haya copias; volver a darlo reutiliza la fila', () => {
    const w = mundo();
    const contrato = w.idDe('Contrato.pdf'), recibo = w.idDe('Recibo.xlsx');
    w.crearUsuario({ usuario: 'felipe', archivos: [contrato, recibo] });
    w.USERS.felipe = ['felipe', 'USUARIO'];
    assert.strictEqual(w.ok(w.llamar('felipe', 'archivos')).total, 2);          // calienta las copias
    assert.ok(w.llamar('felipe', 'descargarArchivo', { idArchivo: recibo }).success);

    const r = w.ok(w.llamar('admin', 'editarUsuario', { usuario: 'felipe', archivos: [contrato] }));
    assert.ok(r.cambios.some((c) => /\/-1/.test(c)));
    assert.deepStrictEqual(w.ok(w.llamar('felipe', 'archivos')).archivos.map((a) => a.nombre), ['Contrato.pdf']);
    const negada = w.llamar('felipe', 'descargarArchivo', { idArchivo: recibo });
    assert.strictEqual(negada.code, 'FORBIDDEN');
    assert.ok(/DESCARGA_DENEGADA/.test(JSON.stringify(w.hojas.AUDITORIA._f)));

    const filas = w.hojas.ACCESOS._f.length;
    w.ok(w.llamar('admin', 'editarUsuario', { usuario: 'felipe', archivos: [contrato, recibo] }));
    assert.strictEqual(w.hojas.ACCESOS._f.length, filas, 'misma fila reactivada, sin duplicar');
    assert.ok(w.llamar('felipe', 'descargarArchivo', { idArchivo: recibo }).success);
    assert.deepStrictEqual(w.ok(w.llamar('admin', 'editarUsuario', { usuario: 'felipe', archivos: [contrato, recibo] })).cambios, [], 'sin cambios reales no escribe');
  });

  t('editarUsuario: los accesos a un archivo dado de baja se conservan para cuando vuelva', () => {
    const w = mundo();
    const reglamento = w.idDe('Reglamento.pdf'), contrato = w.idDe('Contrato.pdf');
    w.crearUsuario({ usuario: 'gina', archivos: [reglamento, contrato] });
    w.USERS.gina = ['gina', 'USUARIO'];
    w.drive.carpetas.CARPETARAIZ01.files = w.drive.carpetas.CARPETARAIZ01.files.filter((id) => id !== 'DRV-REGLAMENTO-1');
    w.ok(w.llamar('admin', 'sincronizarArchivos', {}));
    assert.deepStrictEqual(w.ok(w.llamar('gina', 'archivos')).archivos.map((a) => a.nombre), ['Contrato.pdf']);
    const u = w.ok(w.llamar('admin', 'usuarios')).usuarios.filter((x) => x.usuario === 'gina')[0];
    assert.deepStrictEqual(u.archivos, [contrato], 'el formulario solo ofrece archivos activos');
    w.ok(w.llamar('admin', 'editarUsuario', { usuario: 'gina', archivos: [contrato] }));   // guardar el formulario no toca el inactivo
    w.drive.carpetas.CARPETARAIZ01.files.push('DRV-REGLAMENTO-1');
    w.ok(w.llamar('admin', 'sincronizarArchivos', {}));
    assert.deepStrictEqual(w.ok(w.llamar('gina', 'archivos')).archivos.map((a) => a.nombre).sort(), ['Contrato.pdf', 'Reglamento.pdf']);
  });

  t('editarUsuario: restablecer contraseña o desactivar cierra sus sesiones y le corta el login', () => {
    const w = mundo();
    w.crearUsuario({ usuario: 'hugo', nombre: 'Hugo' });
    const login = (pw) => w.post({ action: 'login', payload: { usuario: 'hugo', password: pw } });
    const viejo = login('Contraseña-segura-1').data.token;
    assert.ok(w.post({ action: 'archivos', payload: {}, token: viejo }).success);

    w.estado.ahora += 1000;   // la marca de invalidación solo afecta a sesiones creadas ANTES
    assert.strictEqual(w.llamar('admin', 'editarUsuario', { usuario: 'hugo', password: 'corta' }).code, 'VALIDACION');
    w.ok(w.llamar('admin', 'editarUsuario', { usuario: 'hugo', password: 'Nueva-contraseña-9' }));
    assert.strictEqual(w.post({ action: 'archivos', payload: {}, token: viejo }).code, 'AUTH_REQUIRED');
    assert.strictEqual(login('Contraseña-segura-1').code, 'CREDENCIALES_INVALIDAS');
    const nuevo = login('Nueva-contraseña-9');
    assert.ok(nuevo.success);

    w.estado.ahora += 1000;
    w.ok(w.llamar('admin', 'editarUsuario', { usuario: 'hugo', activo: false }));
    assert.strictEqual(w.post({ action: 'archivos', payload: {}, token: nuevo.data.token }).code, 'AUTH_REQUIRED');
    assert.strictEqual(login('Nueva-contraseña-9').code, 'CREDENCIALES_INVALIDAS', 'desactivado no entra');
    w.estado.ahora += 1000;
    w.ok(w.llamar('admin', 'editarUsuario', { usuario: 'hugo', activo: true, nombre: 'Hugo R.' }));
    assert.ok(login('Nueva-contraseña-9').success);
  });

  t('editarUsuario: un ADMIN no se quita el rol ni se desactiva; usuario inexistente; rol ADMIN sin accesos propios', () => {
    const w = mundo();
    assert.strictEqual(w.llamar('admin', 'editarUsuario', { usuario: 'admin1', activo: false }).code, 'ESTADO_INVALIDO');
    assert.strictEqual(w.llamar('admin', 'editarUsuario', { usuario: 'admin1', rol: 'USUARIO' }).code, 'ESTADO_INVALIDO');
    const miToken = w.tk('admin');
    w.estado.ahora += 1000;
    assert.ok(w.post({ action: 'editarUsuario', payload: { usuario: 'admin1', nombre: 'Jefa', password: 'Mi-nueva-clave-77' }, token: miToken, requestId: w.rid() }).success, 'sí puede cambiar su nombre y su contraseña');
    assert.ok(w.post({ action: 'usuarios', payload: {}, token: miToken }).success, 'y su sesión sigue abierta');
    assert.strictEqual(w.llamar('admin', 'editarUsuario', { usuario: 'nadie' }).code, 'NO_ENCONTRADO');
    assert.strictEqual(w.llamar('admin', 'editarUsuario', { usuario: 'ana', rol: 'JEFE' }).code, 'VALIDACION');
    const otroAdmin = w.crearUsuario({ usuario: 'ivan', rol: 'ADMIN', archivos: [w.idDe('Contrato.pdf')] });
    assert.deepStrictEqual(otroAdmin.usuario.archivos, [], 'un ADMIN ya descarga todo: no se le guardan accesos');
    assert.strictEqual(w.hojas.ACCESOS._f.length, 1);
  });

  t('idempotencia: reintentar crearUsuario con el mismo requestId no duplica', () => {
    const w = mundo();
    const id = w.rid();
    const datos = { usuario: 'julia', nombre: 'Julia', password: 'Contraseña-segura-1' };
    const a = w.llamar('admin', 'crearUsuario', datos, id);
    const b = w.llamar('admin', 'crearUsuario', datos, id);
    assert.ok(a.success && b.success && b.data.repetida === true);
    assert.strictEqual(w.hojas.USUARIOS._f.filter((f) => f[1] === 'julia').length, 1);
    assert.strictEqual(w.llamar('admin', 'crearUsuario', datos, 'corto').code, 'SOLICITUD_INVALIDA');
    assert.ok(!/Contraseña-segura|password/i.test(JSON.stringify(w.hojas.AUDITORIA._f)), 'la auditoría nunca guarda contraseñas');
  });

  t('resumen del panel: conteos y últimas descargas (las denegadas no cuentan como descarga)', () => {
    const w = mundo();
    const contrato = w.idDe('Contrato.pdf');
    w.crearUsuario({ usuario: 'karla', archivos: [contrato] });
    w.USERS.karla = ['karla', 'USUARIO'];
    w.ok(w.llamar('karla', 'descargarArchivo', { idArchivo: contrato }));
    w.llamar('karla', 'descargarArchivo', { idArchivo: w.idDe('Recibo.xlsx') });
    w.ok(w.llamar('admin', 'descargarArchivo', { idArchivo: contrato }));
    const r = w.ok(w.llamar('admin', 'resumen'));
    assert.deepStrictEqual([r.archivosActivos, r.archivosInactivos, r.usuariosActivos, r.usuariosTotal], [4, 0, 4, 4]);
    assert.deepStrictEqual([r.descargasHoy, r.descargas7Dias, r.denegadas7Dias], [2, 2, 1]);
    assert.strictEqual(r.recientes.length, 2);
    assert.strictEqual(r.recientes[0].usuario, 'admin1', 'la más reciente primero');
    assert.strictEqual(r.recientes[0].archivo, 'Contrato.pdf');
    assert.strictEqual(r.carpetaConfigurada, true);
    assert.ok(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(r.ultimaSincronizacion));
  });

  t('métricas: descargas y usuarios por día y por mes, altas y archivos más descargados', () => {
    const w = mundo();
    w.estado.ahora = Date.UTC(2026, 9, 14, 18, 0);               // 14-oct-2026 12:00 hora de México
    const A = w.idDe('Contrato.pdf'), B = w.idDe('Reglamento.pdf');
    w.hojas.AUDITORIA._f.length = 1;
    let n = 0;
    const evento = (diasAtras, usuario, accion, id, detalle) => w.hojas.AUDITORIA._f.push(['E' + (++n), new Date(Date.UTC(2026, 9, 14, 18, 0) - diasAtras * 86400000), usuario, accion, 'X', id, detalle || '']);
    evento(0, 'ana', 'ARCHIVO_DESCARGADO', A, 'Contrato.pdf');
    evento(0, 'ana', 'ARCHIVO_DESCARGADO', A, 'Contrato.pdf');     // misma persona dos veces: 2 descargas, 1 usuario
    evento(0, 'beto', 'ARCHIVO_DESCARGADO', A, 'Contrato.pdf');
    evento(1, 'ana', 'ARCHIVO_DESCARGADO', B, 'Reglamento.pdf');
    evento(40, 'beto', 'ARCHIVO_DESCARGADO', B, 'Reglamento.pdf'); // fuera de 30 días, dentro del mes anterior
    evento(0, 'admin1', 'USUARIO_CREADO', 'nuevo1');
    evento(2, 'admin1', 'USUARIO_CREADO', 'nuevo2');
    evento(0, 'SETUP', 'USUARIO_CREADO', 'admin');                  // el administrador inicial no cuenta como alta
    evento(0, 'ana', 'DESCARGA_DENEGADA', B, 'Reglamento.pdf');     // no es descarga
    const m = w.ok(w.llamar('admin', 'metricas'));
    assert.strictEqual(m.porDia.length, 30);
    assert.strictEqual(m.porMes.length, 12);
    const hoy = m.porDia[29], ayer = m.porDia[28], anteayer = m.porDia[27];
    assert.strictEqual(hoy.fecha, '2026-10-14');
    assert.deepStrictEqual([hoy.descargas, hoy.usuarios, hoy.nuevos], [3, 2, 1]);
    assert.deepStrictEqual([ayer.descargas, ayer.usuarios, ayer.nuevos], [1, 1, 0]);
    assert.deepStrictEqual([anteayer.descargas, anteayer.nuevos], [0, 1]);
    const oct = m.porMes[11], sep = m.porMes[10];
    assert.deepStrictEqual([oct.mes, oct.descargas, oct.usuarios, oct.nuevos], ['2026-10', 4, 2, 2]);
    assert.deepStrictEqual([sep.mes, sep.descargas, sep.usuarios], ['2026-09', 1, 1]);
    assert.strictEqual(m.porMes[0].mes, '2025-11');
    assert.strictEqual(m.totalDescargas, 5);
    assert.deepStrictEqual(m.topArchivos.map((a) => [a.nombre, a.descargas, a.usuarios, a.ultimos30]), [['Contrato.pdf', 3, 2, 3], ['Reglamento.pdf', 2, 2, 1]]);
    assert.strictEqual(m.parcial, false);
  });

  t('métricas: sin actividad devuelve ceros (no falla con la auditoría vacía)', () => {
    const w = crearMundo(raiz, orden);
    const m = w.ok(w.llamar('admin', 'metricas'));
    assert.deepStrictEqual([m.totalDescargas, m.topArchivos.length, m.porDia.length, m.porMes.length], [0, 0, 30, 12]);
  });
}

console.log('\n' + total + ' pruebas OK');
