import assert from 'node:assert/strict';
const base='http://127.0.0.1:3000';
assert.notEqual(process.getuid(),0,'El contenedor debe ejecutar sin privilegios root.');
const health=await fetch(`${base}/api/health`);assert.equal(health.status,200);
const htmlResponse=await fetch(base);assert.equal(htmlResponse.status,200);const html=await htmlResponse.text();assert.match(html,/BucaGest/);
assert.match(htmlResponse.headers.get('content-security-policy'),/script-src 'self'/);
for(const [,asset] of html.matchAll(/(?:src|href)="(\/assets\/[^"]+)"/g)){const r=await fetch(base+asset);assert.equal(r.status,200,asset);}
const session=await fetch(`${base}/api/session`);assert.equal(session.status,200);
const data=await session.json();assert.equal(data.user,null);assert.equal(data.demo,false);assert.ok(Array.isArray(data.providers));
assert.equal((await fetch(`${base}/api/team`)).status,401);
const invalid=await fetch(`${base}/api/auth/complete`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token:'0'.repeat(64),kind:'verify',password:'Docker-smoke-test-2026'})});
assert.equal(invalid.status,400);assert.equal(invalid.headers.get('set-cookie'),null);
console.log('Docker OK: usuario sin privilegios, salud, recursos compilados, CSP y acceso privado sin verificar bloqueado.');
