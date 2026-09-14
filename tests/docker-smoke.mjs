import assert from 'node:assert/strict';
const base='http://127.0.0.1:3000';
assert.notEqual(process.getuid(),0,'El contenedor debe ejecutar sin privilegios root.');
const health=await fetch(`${base}/api/health`);assert.equal(health.status,200);
const htmlResponse=await fetch(base);assert.equal(htmlResponse.status,200);const html=await htmlResponse.text();assert.match(html,/Minuto/);
assert.match(htmlResponse.headers.get('content-security-policy'),/script-src 'self'/);
for(const [,asset] of html.matchAll(/(?:src|href)="(\/assets\/[^\"]+)"/g)){const r=await fetch(base+asset);assert.equal(r.status,200,asset);}
const registration=await fetch(`${base}/api/register`,{method:'POST',headers:{'Content-Type':'application/json',Origin:'https://minuto.test'},body:JSON.stringify({email:`docker-${crypto.randomUUID()}@example.test`,password:'Docker-smoke-test-2026',name:'Prueba Docker',teamName:'Equipo contenedor'})});assert.equal(registration.status,201);
const setCookie=registration.headers.get('set-cookie');assert.match(setCookie,/HttpOnly/);assert.match(setCookie,/Secure/);assert.match(setCookie,/SameSite=Lax/);
const cookie=setCookie.split(';')[0];const saved=await fetch(`${base}/api/team`,{headers:{cookie}});assert.equal(saved.status,200);const data=await saved.json();assert.equal(data.team.settings.name,'Equipo contenedor');assert.equal(data.team.players.length,0);assert.equal(data.team.matches.length,0);
console.log('Docker OK: usuario sin privilegios, PostgreSQL, salud, recursos compilados, CSP, cookies seguras y registro sin datos de demo.');
