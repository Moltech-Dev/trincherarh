/**
 * servidor-local.js — Prueba el sistema COMPLETO en tu computadora, sin Google, sin Vercel y sin internet.
 *
 *   npm run local        →  abre http://127.0.0.1:8080/login.html
 *
 * Usa el mismo backend (appscript/*.gs) ejecutado en el simulador local, con datos de ejemplo que viven solo en la memoria
 * de este programa: al cerrarlo (Ctrl+C) se borran. NO toca tus hojas de Google.
 *
 * Usuarios de PRUEBA (solo existen aquí; nada que ver con los reales):
 *   admin      / Prueba-Admin-2026   (ADMIN: puede todo)
 *   maria      / Prueba-Maria-2026   (USUARIO: solo descarga Contrato y Reglamento)
 *   pedro      / Prueba-Pedro-2026   (USUARIO: sin archivos asignados todavía)
 * Drive también es simulado: una carpeta con archivos ficticios (nada sale a internet ni toca tu Drive).
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const raiz = path.resolve(__dirname, '..');
const PUERTO = Number(process.env.PUERTO) || 8080;   // cambia con: PUERTO=9000 npm run local (usa PUERTO+1 y PUERTO+2 para la API simulada)
const P1 = PUERTO + 1;
const P2 = PUERTO + 2;
const { crearEntorno } = require('./simulador-apps-script');
const E = crearEntorno(raiz, require('./ordenes-de-carga').TODOS);
const ctx = E.ctx;

ctx.inicializarBase();
E.props.PWD_admin = 'Prueba-Admin-2026';
ctx.crearUsuariosIniciales();
E.estado.ahora = Date.now();
ctx.ahoraMs_ = () => Date.now();

/* ---------- Drive simulado: una carpeta con archivos ficticios ---------- */
(function sembrarDrive() {
  const f = (id, name, mime, texto) => (E.drive.archivos[id] = { id, name, mime, bytes: Buffer.from(texto) });
  f('DRV-CONTRATO-01', 'Contrato de ejemplo.pdf', 'application/pdf', '%PDF-1.4 (archivo ficticio de prueba: contrato)\n');
  f('DRV-REGLAMENTO-1', 'Reglamento interno.pdf', 'application/pdf', '%PDF-1.4 (archivo ficticio de prueba: reglamento)\n');
  f('DRV-RECIBO-0001', 'Recibo de nomina.csv', 'text/csv', 'concepto,monto\nsueldo,1000\n');
  f('DRV-POLITICA-001', 'Politica de vacaciones', 'application/vnd.google-apps.document', '');
  E.drive.carpetas.CARPETADEMO001 = { id: 'CARPETADEMO001', name: 'Trinchera RH', files: ['DRV-CONTRATO-01', 'DRV-REGLAMENTO-1'], folders: ['CARPETA-NOMINA-1'] };
  E.drive.carpetas['CARPETA-NOMINA-1'] = { id: 'CARPETA-NOMINA-1', name: 'Nomina', files: ['DRV-RECIBO-0001', 'DRV-POLITICA-001'], folders: [] };
})();

/* ---------- Datos de ejemplo (mismas acciones que usaría la pantalla, con una sesión de administrador) ---------- */
(function sembrar() {
  const token = ctx.crearSesion_({ usuario: 'admin', nombre: 'Administrador', rol: 'ADMIN' });
  let n = 0;
  const llamar = (accion, payload) => {
    const r = JSON.parse(ctx.doPost({ postData: { contents: JSON.stringify({ action: accion, payload: payload, token: token, requestId: 'semilla-' + (++n) + '-' + crypto.randomBytes(5).toString('hex') + '00000' }) } }).getContent());
    if (!r.success) throw new Error(accion + ': ' + r.message);
    return r.data;
  };
  llamar('sincronizarArchivos', { carpeta: 'https://drive.google.com/drive/folders/CARPETADEMO001' });
  const ids = llamar('archivos', {}).archivos.filter((a) => /Contrato|Reglamento/.test(a.nombre)).map((a) => a.idArchivo);
  llamar('crearUsuario', { usuario: 'maria', nombre: 'María López', password: 'Prueba-Maria-2026', rol: 'USUARIO', archivos: ids });
  llamar('crearUsuario', { usuario: 'pedro', nombre: 'Pedro Ramírez', password: 'Prueba-Pedro-2026', rol: 'USUARIO', archivos: [] });

  // Historial FICTICIO de casi un año para que las gráficas del panel tengan algo que mostrar (solo existe en este servidor local).
  const catalogo = llamar('archivos', {}).archivos;
  const pesos = [5, 3, 2, 1];                       // el primer archivo es el "más vendido"
  let semilla = 11;
  const azar = () => (semilla = (semilla * 9301 + 49297) % 233280) / 233280;
  const aud = E.hojas.AUDITORIA._f;
  const personas = ['maria', 'pedro', 'lucia', 'jorge', 'sofia', 'luis', 'carmen', 'diego'];
  for (let d = 330; d >= 1; d--) {
    const crecimiento = 1 + (330 - d) / 150;
    const n = Math.floor(azar() * 4 * crecimiento);
    for (let k = 0; k < n; k++) {
      let r = azar() * pesos.reduce((a, b) => a + b, 0), i = 0;
      while (i < pesos.length - 1 && (r -= pesos[i]) > 0) i++;
      const a = catalogo[i % catalogo.length];
      aud.push([crypto.randomUUID(), new Date(Date.now() - d * 86400000 - azar() * 36000000), personas[Math.floor(azar() * personas.length)], 'ARCHIVO_DESCARGADO', 'ARCHIVOS', a.idArchivo, a.nombre]);
    }
    if (azar() < 0.12) aud.push([crypto.randomUUID(), new Date(Date.now() - d * 86400000), 'admin', 'USUARIO_CREADO', 'USUARIOS', 'demo' + d, 'USUARIO; 1 archivo(s)']);
  }
})();

/* ---------- Servidor: archivos estáticos + API simulada ---------- */
const csp = JSON.parse(fs.readFileSync(path.join(raiz, 'vercel.json'), 'utf8')).headers[0].headers;
const respuestas = {};
const TIPOS = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.json': 'application/json' };

// La API real responde con una redirección 302 (Apps Script → script.googleusercontent.com); se imita para probar el mismo
// camino del navegador, incluido que NO se acepte el preflight OPTIONS.
http.createServer((req, res) => {
  if (req.method === 'OPTIONS') { res.writeHead(405); return res.end(); }
  let cuerpo = '';
  req.on('data', (d) => { cuerpo += d; });
  req.on('end', () => {
    const u = new URL(req.url, 'http://x');
    const salida = req.method === 'POST'
      ? ctx.doPost({ postData: { contents: cuerpo } })
      : ctx.doGet({ parameter: Object.fromEntries(u.searchParams) });
    const id = crypto.randomUUID();
    respuestas[id] = salida.getContent();
    res.writeHead(302, { 'Access-Control-Allow-Origin': '*', Location: 'http://127.0.0.1:' + P2 + '/echo/' + id });
    res.end();
  });
}).listen(P1);

http.createServer((req, res) => {
  if (req.method === 'OPTIONS') { res.writeHead(405); return res.end(); }
  res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
  res.end(respuestas[req.url.split('/').pop()] || '{}');
}).listen(P2);

http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p === '/') p = '/login.html';
  const f = path.join(raiz, p);
  if (!f.startsWith(raiz) || !fs.existsSync(f) || fs.statSync(f).isDirectory() || /^\/(appscript|docs|tests|\.)|package/.test(p)) { res.writeHead(404); return res.end('No encontrado'); }
  const h = { 'Content-Type': TIPOS[path.extname(f)] || 'application/octet-stream', 'Cache-Control': 'no-store' };
  // La misma CSP que Vercel, solo ampliando connect-src a los puertos locales de la API simulada.
  csp.forEach((x) => { h[x.key] = x.key === 'Content-Security-Policy' ? x.value.replace("connect-src 'self'", "connect-src 'self' http://127.0.0.1:" + P1 + ' http://127.0.0.1:' + P2) : x.value; });
  if (p === '/js/config.js') {
    res.writeHead(200, h);
    return res.end("window.APP_CONFIG=Object.freeze({API_URL:'https://script.google.com/macros/s/LOCAL/exec',API_TIMEOUT_MS:20000});const __f=window.fetch.bind(window);window.fetch=(u,o)=>__f(String(u).replace('https://script.google.com/macros/s/LOCAL/exec','http://127.0.0.1:" + P1 + "/exec'),o);");
  }
  res.writeHead(200, h);
  fs.createReadStream(f).pipe(res);
}).listen(PUERTO, () => {
  console.log('\nListo. Abre en tu navegador:  http://127.0.0.1:' + PUERTO + '/login.html');
  console.log('Usuario de prueba: admin  (contraseña al inicio de tests/servidor-local.js)');
  console.log('Datos de ejemplo en memoria; Ctrl+C para cerrar y borrarlos.\n');
});
