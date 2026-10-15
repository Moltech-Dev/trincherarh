const vm=require('vm'),fs=require('fs'),crypto=require('crypto'),assert=require('assert');
const ctx={Utilities:{getUuid:()=>crypto.randomUUID()}};vm.createContext(ctx);
vm.runInContext(fs.readFileSync((process.argv[2] || require('path').resolve(__dirname, '..'))+'/appscript/Crypto.gs','utf8'),ctx);
const B=(b)=>Buffer.from(b);
// SHA-256 aleatorio, todas las longitudes de padding
for(let n=0;n<=200;n++){const m=crypto.randomBytes(n);assert.strictEqual(ctx.aHex_(ctx.sha256_([...m])),crypto.createHash('sha256').update(m).digest('hex'),'sha n='+n);}
// vectores conocidos
assert.strictEqual(ctx.aHex_(ctx.sha256_(ctx.utf8_('abc'))),'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
// HMAC (claves cortas y largas)
for(const kl of [0,1,32,64,65,200]){const k=crypto.randomBytes(kl),m=crypto.randomBytes(77);assert.strictEqual(ctx.aHex_(ctx.hmacSha256_([...k],[...m])),crypto.createHmac('sha256',k).update(m).digest('hex'),'hmac k='+kl);}
// PBKDF2: vector RFC 7914 (P="passwd", S="salt", c=1, 64 bytes -> primeros 32)
assert.strictEqual(ctx.aHex_(ctx.pbkdf2Sha256_(ctx.utf8_('passwd'),ctx.utf8_('salt'),1)),crypto.pbkdf2Sync('passwd','salt',1,32,'sha256').toString('hex'));
for(const it of [1,2,3,100,10000,50000]){const p=crypto.randomBytes(40),s=crypto.randomBytes(16);assert.strictEqual(ctx.aHex_(ctx.pbkdf2Sha256_([...p],[...s],it)),crypto.pbkdf2Sync(p,s,it,32,'sha256').toString('hex'),'pbkdf2 it='+it);}
// UTF-8 vs Buffer
for(const t of ['Contraseña-ñ','日本語','😀 emoji','','a'.repeat(300)])assert.strictEqual(ctx.aHex_(ctx.utf8_(t)),Buffer.from(t,'utf8').toString('hex'),t);
assert.ok(ctx.igualesConstante_('abc','abc'));assert.ok(!ctx.igualesConstante_('abc','abd'));assert.ok(!ctx.igualesConstante_('abc','abcd'));
assert.deepStrictEqual([...ctx.deHex_('00ff10')],[0,255,16]);
let t0=Date.now();ctx.pbkdf2Sha256_(ctx.utf8_('x'),ctx.utf8_('y'),10000);console.log('PBKDF2 10000 it:',Date.now()-t0,'ms (Node/V8)');
console.log('crypto OK');
