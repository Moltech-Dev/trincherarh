// Simulador de servicios de Apps Script compartido por las pruebas y el servidor mock.
const vm = require('vm'), fs = require('fs'), path = require('path'), crypto = require('crypto');

function crearEntorno(raiz, orden) {
  const hojas = {};
  const mk = (n) => {
    const f = [];
    return {
      _n: n, _f: f, _frozen: 0,
      getLastRow: () => f.length,
      getMaxRows: () => Math.max(1000, f.length),
      setFrozenRows(x) { this._frozen = x; },
      getRange(r, c, nr, nc) {
        nr = nr || 1; nc = nc || 1;
        return {
          setValues(v) { v.forEach((fila, i) => { f[r - 1 + i] = f[r - 1 + i] || []; fila.forEach((x, j) => (f[r - 1 + i][c - 1 + j] = x)); }); return this; },
          setValue(x) { f[r - 1] = f[r - 1] || []; f[r - 1][c - 1] = x; return this; },
          getValues() { estado.lecturas++; const o = []; for (let i = 0; i < nr; i++) { const q = []; for (let j = 0; j < nc; j++) q.push((f[r - 1 + i] || [])[c - 1 + j] ?? ''); o.push(q); } return o; },
          setFontWeight() { return this; },
          setNumberFormat() { return this; }
        };
      }
    };
  };
  const libro = { getSheetByName: (n) => hojas[n] || null, insertSheet: (n) => (hojas[n] = mk(n)), getSheets: () => Object.values(hojas), deleteSheet(h) { delete hojas[h._n]; } };
  const props = {};
  const cache = {}; // clave -> {v, exp}
  const estado = { ahora: Date.now(), bloqueosActivos: 0, maxBloqueosAnidados: 0, lecturas: 0, aperturas: 0, cacheRota: false };
  const logs = [];

  // Drive simulado: el test (o el servidor local) llena `drive.archivos` ({ id: { id, name, mime, bytes: Buffer, trashed? } })
  // y `drive.carpetas` ({ id: { id, name, files: [ids], folders: [ids] } }). `drive.caido` simula Drive sin respuesta.
  const drive = { archivos: {}, carpetas: {}, caido: false };
  const noEncontrado = () => new Error('No item with the given ID could be found, or you do not have permission to access it.');
  const iterador = (arr) => { let i = 0; return { hasNext: () => i < arr.length, next: () => arr[i++] }; };
  const envolverArchivo = (a) => ({
    getId: () => a.id, getName: () => a.name, getMimeType: () => a.mime, getSize: () => a.bytes.length, isTrashed: () => !!a.trashed,
    getBlob: () => ({ getBytes: () => Array.from(a.bytes, (b) => (b > 127 ? b - 256 : b)), getContentType: () => a.mime, getName: () => a.name }),
    getAs: (tipo) => ({ getBytes: () => Array.from(Buffer.from('PDF-de-' + a.name), (b) => b), getContentType: () => tipo, getName: () => a.name })
  });
  const envolverCarpeta = (c) => ({
    getId: () => c.id, getName: () => c.name,
    getFiles: () => iterador(c.files.map((id) => envolverArchivo(drive.archivos[id]))),
    getFolders: () => iterador(c.folders.map((id) => envolverCarpeta(drive.carpetas[id])))
  });

  const ctx = {
    console: { log() {}, error() {} }, Math, JSON, Object, Array, String, Number, parseInt, Date, Int32Array,
    Logger: { log: (m) => logs.push(m) },
    ContentService: { MimeType: { JSON: 1 }, createTextOutput: (t) => ({ t, setMimeType() { return this; }, getContent() { return this.t; } }) },
    PropertiesService: { getScriptProperties: () => ({
      getProperty: (k) => (k in props ? props[k] : null), setProperty: (k, v) => (props[k] = v),
      deleteProperty: (k) => delete props[k], getProperties: () => ({ ...props }) }) },
    SpreadsheetApp: { getActiveSpreadsheet: () => { estado.aperturas++; return libro; }, openById: () => { estado.aperturas++; return libro; } },
    CacheService: { getScriptCache: () => {
      // Límites reales de Apps Script: clave ≤ 250 caracteres, valor ≤ 100 KB, lotes acotados. `cacheRota` simula una caída del servicio para las copias de hojas.
      const dato = (k) => /^(h:|dv$)/.test(k);
      const falla = (k) => { if (estado.cacheRota && dato(k)) throw new Error('Servicio no disponible'); };
      const get = (k) => { falla(k); const e = cache[k]; if (!e) return null; if (e.exp !== null && estado.ahora > e.exp) { delete cache[k]; return null; } return e.v; };
      const put = (k, v, ttl) => { falla(k); if (String(k).length > 250) throw new Error('Argument too large: key'); if (Buffer.byteLength(String(v), 'utf8') > 100 * 1024) throw new Error('Argument too large: value'); cache[k] = { v: String(v), exp: ttl ? estado.ahora + ttl * 1000 : null }; };
      return {
        get, put,
        getAll: (ks) => { if (ks.length > 100) throw new Error('Argument too large: keys'); const o = {}; ks.forEach((k) => { const v = get(k); if (v !== null) o[k] = v; }); return o; },
        putAll: (obj, ttl) => { if (Object.keys(obj).length > 100) throw new Error('Argument too large: keys'); Object.keys(obj).forEach((k) => put(k, obj[k], ttl)); },
        remove: (k) => { falla(k); delete cache[k]; },
        removeAll: (ks) => ks.forEach((k) => delete cache[k]) };
    } },
    LockService: { getScriptLock: () => ({
      waitLock() { estado.bloqueosActivos++; estado.maxBloqueosAnidados = Math.max(estado.maxBloqueosAnidados, estado.bloqueosActivos); },
      releaseLock() { estado.bloqueosActivos--; } }) },
    // Servicio avanzado Drive v3 (Drive.Files.list): una llamada por carpeta. Los tests lo quitan con `delete ctx.Drive` para probar el respaldo con DriveApp.
    Drive: { Files: { list: (p) => {
      estado.llamadasDrive = (estado.llamadasDrive || 0) + 1;
      if (drive.caido) throw new Error('Drive no disponible');
      const padre = /'([^']+)' in parents/.exec(p.q)[1];
      const c = drive.carpetas[padre];
      if (!c) return { files: [] };   // como la API real: un padre inexistente no falla, devuelve lista vacía
      const archivos = c.files.map((id) => drive.archivos[id]).filter((a) => !a.trashed)
        .map((a) => ({ id: a.id, name: a.name, mimeType: a.mime, size: /^application\/vnd\.google-apps\./.test(a.mime) ? undefined : String(a.bytes.length) }));
      const carpetas = c.folders.map((id) => ({ id, name: drive.carpetas[id].name, mimeType: 'application/vnd.google-apps.folder' }));
      return { files: archivos.concat(carpetas) };
    } } },
    DriveApp: {
      getFolderById: (id) => { if (drive.caido || !drive.carpetas[id]) throw noEncontrado(); return envolverCarpeta(drive.carpetas[id]); },
      getFileById: (id) => { if (drive.caido || !drive.archivos[id]) throw noEncontrado(); return envolverArchivo(drive.archivos[id]); }
    },
    Utilities: {
      getUuid: () => crypto.randomUUID(),
      base64Encode: (bytes) => Buffer.from(bytes).toString('base64'),
      parseDate: (texto, tz, patron) => {
        const m = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2})$/.exec(texto);
        if (!m) throw new Error('parseDate: formato no soportado ' + texto);
        const T = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]);
        const local = (ms) => { const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).formatToParts(new Date(ms)).map((x) => [x.type, x.value])); return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute); };
        let X = T; X = T - (local(X) - X); X = T - (local(X) - X);
        return new Date(X);
      },
      formatDate: (d, tz, patron) => {
        const p = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" }).formatToParts(d).map((x) => [x.type, x.value]));
        return patron.replace("yyyy", p.year).replace("MM", p.month).replace("dd", p.day).replace("HH", p.hour).replace("mm", p.minute).replace("ss", p.second).replace(/'T'/, "T");
      }
    }
  };
  vm.createContext(ctx);
  orden.forEach((f) => vm.runInContext(fs.readFileSync(path.join(raiz, 'appscript', f), 'utf8'), ctx, { filename: f }));
  // Reloj controlable (ahoraMs_ se define en Auth.gs).
  ctx.ahoraMs_ = () => estado.ahora;
  return { ctx, hojas, props, cache, estado, logs, drive };
}

module.exports = { crearEntorno };
