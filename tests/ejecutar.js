/**
 * Ejecuta todas las pruebas del backend sin necesidad de Google: carga los archivos .gs de appscript/ en un simulador
 * local de los servicios de Apps Script (hojas, caché, bloqueos, zona horaria) y los prueba con tres órdenes de carga
 * distintos.
 *
 * Uso:  node tests/ejecutar.js        (o: npm test)
 * Requiere solo Node.js 18+. No instala dependencias ni se despliega.
 * AL AGREGAR UN MÓDULO: crea tests/prueba-<modulo>.js (copia prueba-base.js) y añádelo a PRUEBAS.
 */
const { spawnSync } = require('child_process');
const path = require('path');

const PRUEBAS = [
  ['Criptografía (PBKDF2/HMAC/SHA-256 contra la implementación de Node)', 'prueba-cripto.js'],
  ['Base: autenticación, permisos, base preparada, lectura rápida y caché caído', 'prueba-base.js'],
  ['Archivos: sincronización de Drive, usuarios con accesos y descargas con permisos', 'prueba-archivos.js']
];

let fallos = 0;
for (const [titulo, archivo] of PRUEBAS) {
  process.stdout.write('\n▶ ' + titulo + '\n');
  const r = spawnSync(process.execPath, [path.join(__dirname, archivo)], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  const lineas = (r.stdout || '').trim().split('\n');
  const resumen = lineas.filter((l) => /pruebas OK|crypto OK/.test(l)).pop() || lineas.slice(-1)[0];
  if (r.status === 0) {
    console.log('  ✔ ' + resumen.trim());
  } else {
    fallos++;
    console.log('  ✘ FALLÓ');
    console.log((r.stdout || '').split('\n').slice(-12).join('\n'));
    console.log(((r.stderr || '').split('\n').slice(0, 25)).join('\n'));
  }
}
console.log(fallos ? '\n' + fallos + ' grupo(s) de pruebas con fallos.' : '\nTodas las pruebas pasaron.');
process.exit(fallos ? 1 : 0);
