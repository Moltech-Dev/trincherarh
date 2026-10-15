// Mundo de pruebas compartido: backend cargado en el simulador de Apps Script, usuarios de prueba, una carpeta de Drive
// simulada y atajos para llamar a la API como cada rol. Cada archivo prueba-*.js crea un mundo nuevo por prueba.
const assert = require('assert');
const { crearEntorno } = require('./simulador-apps-script');

// Usuarios directos en la hoja (los hashes reales se prueban en el grupo de login).
const USERS = { admin: ['admin1', 'ADMIN'], ana: ['ana', 'USUARIO'], beto: ['beto', 'USUARIO'] };
const CARPETA = 'CARPETARAIZ01';
const ENLACE_CARPETA = 'https://drive.google.com/drive/folders/' + CARPETA + '?usp=sharing';

function crearMundo(raiz, orden, preparar) {
  const E = crearEntorno(raiz, orden);
  const { ctx, hojas, props, estado, drive } = E;
  if (preparar !== false) ctx.inicializarBase();
  const usuarios = Object.assign({}, USERS);   // copia por mundo: las pruebas agregan usuarios propios (w.USERS.felipe = …)
  if (preparar !== false) Object.keys(usuarios).forEach((k, i) => hojas.USUARIOS._f.push(['USR-T' + i, usuarios[k][0], 'x', usuarios[k][0], usuarios[k][1], true]));
  const tk = (quien) => ctx.crearSesion_({ usuario: usuarios[quien][0], nombre: usuarios[quien][0], rol: usuarios[quien][1] });
  const post = (obj) => JSON.parse(ctx.doPost({ postData: { contents: JSON.stringify(obj) } }).getContent());
  let n = 0;
  const rid = () => 'rq-' + (++n) + '-' + Math.random().toString(16).slice(2, 10) + '0000';
  const llamar = (quien, accion, payload, requestId) => post({ action: accion, payload: payload || {}, token: quien ? tk(quien) : null, requestId: requestId === undefined ? rid() : requestId });
  const ok = (r) => { assert.strictEqual(r.success, true, JSON.stringify(r)); return r.data; };

  // Drive: raíz con 2 PDF, una subcarpeta "Nomina" con un Excel y un Google Doc; además un archivo en la papelera y un formulario (no descargables).
  const sembrarDrive = () => {
    const f = (id, name, mime, texto, extra) => (drive.archivos[id] = Object.assign({ id, name, mime, bytes: Buffer.from(texto) }, extra || {}));
    f('DRV-CONTRATO-01', 'Contrato.pdf', 'application/pdf', 'contenido-del-contrato');
    f('DRV-REGLAMENTO-1', 'Reglamento.pdf', 'application/pdf', 'contenido-del-reglamento');
    f('DRV-RECIBO-0001', 'Recibo.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'contenido-del-recibo');
    f('DRV-POLITICA-001', 'Politica', 'application/vnd.google-apps.document', '');
    f('DRV-BORRADO-001', 'Borrado.pdf', 'application/pdf', 'x', { trashed: true });
    f('DRV-FORMULARIO-1', 'Encuesta', 'application/vnd.google-apps.form', '');
    drive.carpetas[CARPETA] = { id: CARPETA, name: 'Raiz', files: ['DRV-CONTRATO-01', 'DRV-REGLAMENTO-1', 'DRV-BORRADO-001', 'DRV-FORMULARIO-1'], folders: ['CARPETA-NOMINA-1'] };
    drive.carpetas['CARPETA-NOMINA-1'] = { id: 'CARPETA-NOMINA-1', name: 'Nomina', files: ['DRV-RECIBO-0001', 'DRV-POLITICA-001'], folders: [] };
  };
  const sincronizar = () => ok(llamar('admin', 'sincronizarArchivos', { carpeta: ENLACE_CARPETA }));
  /** ID interno (ID_ARCHIVO) del catálogo a partir del nombre del archivo en Drive. */
  const idDe = (nombre) => { const fila = hojas.ARCHIVOS._f.slice(1).filter((f) => String(f[2]).replace(/^'/, '') === nombre)[0]; assert.ok(fila, 'no está en el catálogo: ' + nombre); return fila[0]; };
  const crearUsuario = (extra, quien) => ok(llamar(quien || 'admin', 'crearUsuario', Object.assign({ usuario: 'u' + (++n), nombre: 'Usuario ' + n, password: 'Contraseña-segura-1', archivos: [] }, extra || {})));

  return { E, ctx, hojas, props, estado, drive, tk, post, llamar, ok, rid, sembrarDrive, sincronizar, idDe, crearUsuario, USERS: usuarios };
}

module.exports = { crearMundo, CARPETA, ENLACE_CARPETA };
