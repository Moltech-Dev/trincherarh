/**
 * Crypto.gs — SHA-256, HMAC-SHA256 y PBKDF2 en JavaScript puro.
 *
 * Por qué no Utilities.computeHmacSha256Signature: cada llamada a un servicio de Apps Script
 * tiene latencia; 10 000 iteraciones de PBKDF2 serían inaceptablemente lentas. En JS puro
 * (V8) el costo es de decenas de milisegundos.
 * La implementación se verifica contra crypto.pbkdf2Sync de Node (vectores RFC 6070/7914 y
 * comparaciones aleatorias) antes de cada publicación.
 *
 * Los bytes se representan como arreglos de enteros 0-255.
 */

var SHA256_K = [
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
];

function rotr_(x, n) {
  return (x >>> n) | (x << (32 - n));
}

function sha256_(bytes) {
  var h = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
  var largo = bytes.length;
  var p = bytes.slice();
  p.push(0x80);
  while (p.length % 64 !== 56) {
    p.push(0);
  }
  var bitsAlto = Math.floor((largo * 8) / 0x100000000);
  var bitsBajo = (largo * 8) >>> 0;
  p.push((bitsAlto >>> 24) & 255, (bitsAlto >>> 16) & 255, (bitsAlto >>> 8) & 255, bitsAlto & 255);
  p.push((bitsBajo >>> 24) & 255, (bitsBajo >>> 16) & 255, (bitsBajo >>> 8) & 255, bitsBajo & 255);

  var w = new Array(64);
  for (var off = 0; off < p.length; off += 64) {
    var i;
    for (i = 0; i < 16; i++) {
      var j = off + i * 4;
      w[i] = ((p[j] << 24) | (p[j + 1] << 16) | (p[j + 2] << 8) | p[j + 3]) | 0;
    }
    for (i = 16; i < 64; i++) {
      var s0 = rotr_(w[i - 15], 7) ^ rotr_(w[i - 15], 18) ^ (w[i - 15] >>> 3);
      var s1 = rotr_(w[i - 2], 17) ^ rotr_(w[i - 2], 19) ^ (w[i - 2] >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) | 0;
    }
    var a = h[0], b = h[1], c = h[2], d = h[3], e = h[4], f = h[5], g = h[6], hh = h[7];
    for (i = 0; i < 64; i++) {
      var S1 = rotr_(e, 6) ^ rotr_(e, 11) ^ rotr_(e, 25);
      var ch = (e & f) ^ (~e & g);
      var t1 = (hh + S1 + ch + SHA256_K[i] + w[i]) | 0;
      var S0 = rotr_(a, 2) ^ rotr_(a, 13) ^ rotr_(a, 22);
      var maj = (a & b) ^ (a & c) ^ (b & c);
      var t2 = (S0 + maj) | 0;
      hh = g; g = f; f = e; e = (d + t1) | 0;
      d = c; c = b; b = a; a = (t1 + t2) | 0;
    }
    h[0] = (h[0] + a) | 0; h[1] = (h[1] + b) | 0; h[2] = (h[2] + c) | 0; h[3] = (h[3] + d) | 0;
    h[4] = (h[4] + e) | 0; h[5] = (h[5] + f) | 0; h[6] = (h[6] + g) | 0; h[7] = (h[7] + hh) | 0;
  }

  var salida = [];
  for (var k = 0; k < 8; k++) {
    salida.push((h[k] >>> 24) & 255, (h[k] >>> 16) & 255, (h[k] >>> 8) & 255, h[k] & 255);
  }
  return salida;
}

function hmacSha256_(clave, mensaje) {
  if (clave.length > 64) {
    clave = sha256_(clave);
  }
  var interior = [];
  var exterior = [];
  for (var i = 0; i < 64; i++) {
    var kb = i < clave.length ? clave[i] : 0;
    interior.push(kb ^ 0x36);
    exterior.push(kb ^ 0x5c);
  }
  return sha256_(exterior.concat(sha256_(interior.concat(mensaje))));
}

/**
 * Función de compresión de SHA-256. `h`: Int32Array(8) (se actualiza); `w`: Int32Array(64) con w[0..15]
 * cargado; `K`: constantes como Int32Array local (evita búsquedas de variables globales en el bucle caliente).
 * Las rotaciones están expandidas en línea por la misma razón.
 */
function comprimir_(h, w, K) {
  var i, x, y;
  for (i = 16; i < 64; i++) {
    x = w[i - 15];
    y = w[i - 2];
    w[i] = (w[i - 16] +
      (((x >>> 7) | (x << 25)) ^ ((x >>> 18) | (x << 14)) ^ (x >>> 3)) +
      w[i - 7] +
      (((y >>> 17) | (y << 15)) ^ ((y >>> 19) | (y << 13)) ^ (y >>> 10))) | 0;
  }
  var a = h[0], b = h[1], c = h[2], d = h[3], e = h[4], f = h[5], g = h[6], hh = h[7];
  for (i = 0; i < 64; i++) {
    var t1 = (hh +
      (((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7))) +
      ((e & f) ^ (~e & g)) + K[i] + w[i]) | 0;
    var t2 = ((((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10))) +
      ((a & b) ^ (a & c) ^ (b & c))) | 0;
    hh = g; g = f; f = e; e = (d + t1) | 0;
    d = c; c = b; b = a; a = (t1 + t2) | 0;
  }
  h[0] = (h[0] + a) | 0; h[1] = (h[1] + b) | 0; h[2] = (h[2] + c) | 0; h[3] = (h[3] + d) | 0;
  h[4] = (h[4] + e) | 0; h[5] = (h[5] + f) | 0; h[6] = (h[6] + g) | 0; h[7] = (h[7] + hh) | 0;
}

function estadoInicialSha256_() {
  return new Int32Array([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]);
}

/**
 * PBKDF2-HMAC-SHA256 con longitud de salida de 32 bytes (un solo bloque).
 * Optimizado: los estados intermedios de los bloques ipad/opad se calculan una vez, de modo que
 * cada iteración cuesta exactamente 2 compresiones y ninguna asignación de memoria.
 */
function pbkdf2Sha256_(clave, sal, iteraciones) {
  var claveEfectiva = clave.length > 64 ? sha256_(clave) : clave;
  var K = new Int32Array(SHA256_K);
  var w = new Int32Array(64);
  var estadoInterior = estadoInicialSha256_();
  var estadoExterior = estadoInicialSha256_();
  var i, j;

  for (i = 0; i < 16; i++) {
    var k = 0;
    for (j = 0; j < 4; j++) {
      var idx = i * 4 + j;
      k = (k << 8) | (idx < claveEfectiva.length ? claveEfectiva[idx] : 0);
    }
    w[i] = k ^ 0x36363636;
  }
  comprimir_(estadoInterior, w, K);
  for (i = 0; i < 16; i++) {
    var k2 = 0;
    for (j = 0; j < 4; j++) {
      var idx2 = i * 4 + j;
      k2 = (k2 << 8) | (idx2 < claveEfectiva.length ? claveEfectiva[idx2] : 0);
    }
    w[i] = k2 ^ 0x5c5c5c5c;
  }
  comprimir_(estadoExterior, w, K);

  // U1 = HMAC(clave, sal || INT(1)), una sola vez por la vía simple.
  var u1 = hmacSha256_(claveEfectiva, sal.concat([0, 0, 0, 1]));
  var u = new Int32Array(8);
  for (i = 0; i < 8; i++) {
    u[i] = ((u1[i * 4] << 24) | (u1[i * 4 + 1] << 16) | (u1[i * 4 + 2] << 8) | u1[i * 4 + 3]) | 0;
  }
  var t = new Int32Array(u);
  var interior = new Int32Array(8);
  var exterior = new Int32Array(8);

  for (var it = 1; it < iteraciones; it++) {
    interior.set(estadoInterior);
    for (i = 0; i < 8; i++) { w[i] = u[i]; }
    w[8] = 0x80000000;
    for (i = 9; i < 15; i++) { w[i] = 0; }
    w[15] = 768; // (64 bytes de ipad + 32 bytes de mensaje) * 8 bits
    comprimir_(interior, w, K);

    exterior.set(estadoExterior);
    for (i = 0; i < 8; i++) { w[i] = interior[i]; }
    w[8] = 0x80000000;
    for (i = 9; i < 15; i++) { w[i] = 0; }
    w[15] = 768;
    comprimir_(exterior, w, K);

    for (i = 0; i < 8; i++) {
      u[i] = exterior[i];
      t[i] ^= exterior[i];
    }
  }

  var salida = [];
  for (i = 0; i < 8; i++) {
    salida.push((t[i] >>> 24) & 255, (t[i] >>> 16) & 255, (t[i] >>> 8) & 255, t[i] & 255);
  }
  return salida;
}

/** Codifica una cadena JS a bytes UTF-8 (incluye pares sustitutos). */
function utf8_(texto) {
  var bytes = [];
  for (var i = 0; i < texto.length; i++) {
    var c = texto.charCodeAt(i);
    if (c >= 0xd800 && c <= 0xdbff && i + 1 < texto.length) {
      var siguiente = texto.charCodeAt(i + 1);
      if (siguiente >= 0xdc00 && siguiente <= 0xdfff) {
        c = 0x10000 + ((c - 0xd800) << 10) + (siguiente - 0xdc00);
        i++;
      }
    }
    if (c < 0x80) {
      bytes.push(c);
    } else if (c < 0x800) {
      bytes.push(0xc0 | (c >> 6), 0x80 | (c & 63));
    } else if (c < 0x10000) {
      bytes.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
    } else {
      bytes.push(0xf0 | (c >> 18), 0x80 | ((c >> 12) & 63), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
    }
  }
  return bytes;
}

function aHex_(bytes) {
  var s = '';
  for (var i = 0; i < bytes.length; i++) {
    s += (bytes[i] < 16 ? '0' : '') + bytes[i].toString(16);
  }
  return s;
}

function deHex_(hex) {
  var bytes = [];
  for (var i = 0; i + 1 < hex.length; i += 2) {
    bytes.push(parseInt(hex.substr(i, 2), 16));
  }
  return bytes;
}

/** Comparación en tiempo constante (respecto al contenido) de dos cadenas. */
function igualesConstante_(a, b) {
  var diferencia = a.length ^ b.length;
  var largo = Math.max(a.length, b.length);
  for (var i = 0; i < largo; i++) {
    diferencia |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  }
  return diferencia === 0;
}

/** Cadena hex aleatoria de 32 bytes (dos UUID v4 sin guiones = 64 caracteres hex). */
function aleatorioHex64_() {
  return (Utilities.getUuid() + Utilities.getUuid()).replace(/-/g, '');
}
