import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes,randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { PGlite } from '@electric-sql/pglite';
import { createStore } from '../server/store.js';
import { createApp,errorHandler } from '../server/app.js';
import { dataCipher } from '../server/encryption.js';
import { applyCommand } from '../server/domain.js';
import { privacyNotice } from '../server/privacy.js';

const password='Privacy-test-password-2026';
async function database(t){
  const db=new PGlite();let tail=Promise.resolve();
  const pool={query:(sql,args)=>!args&&sql.includes('CREATE TABLE')?db.exec(sql).then(()=>({rows:[]})):db.query(sql,args),
    async connect(){let release;const next=new Promise(r=>{release=r;});const previous=tail;tail=next;await previous;return {query:(sql,args)=>db.query(sql,args),release};},end:()=>db.close()};
  t.after(()=>db.close());return pool;
}
async function user(store,email='privacy@example.test'){
  await store.register({email,name:'Manager',teamName:'Equipo Privado'});
  const link=await store.emailToken(email,'verify');
  return store.completeEmail({...link,kind:'verify',password});
}
async function harness(t){
  const pool=await database(t),key=randomBytes(32).toString('hex');
  const store=await createStore({pool,encryptionKey:key});
  const a=await user(store),b=await user(store,'another@example.test');
  const cookie=`minuto_session=${await store.createSession(a.id)}`,other=`minuto_session=${await store.createSession(b.id)}`;
  const app=createApp(store,{origin:'http://localhost:3000',mailer:{configured:false},providers:{}});app.use(errorHandler);
  const server=app.listen(0,'127.0.0.1');await once(server,'listening');t.after(()=>new Promise(r=>server.close(r)));
  const base=`http://127.0.0.1:${server.address().port}`;
  async function req(path,{body,cookie:session=cookie,origin}={}){
    const r=await fetch(base+'/api/'+path,{method:body?'POST':'GET',headers:{...(body?{'Content-Type':'application/json'}:{}),...(session?{Cookie:session}:{}),...(origin?{Origin:origin}:{})},body:body?JSON.stringify(body):undefined});
    return {status:r.status,headers:r.headers,data:r.headers.get('content-type')?.includes('json')?await r.json():Buffer.from(await r.arrayBuffer())};
  }
  async function command(type,payload){const w=await store.workspace(a.id);return store.command(a.id,{type,payload,workspaceId:w.id,teamId:w.teams[0].id,revision:w.revision,operationId:randomUUID()});}
  return {pool,key,store,a,b,cookie,other,req,command};
}

test('cifrado autenticado: aleatorio, ligado a cada cuenta y detecta alteraciones',()=>{
  const key=randomBytes(32).toString('hex'),cipher=dataCipher(key),bytes=Buffer.from('dato personal');
  const a=cipher.encrypt(bytes,'workspace:a'),b=cipher.encrypt(bytes,'workspace:a');
  assert.notDeepEqual(a,b);assert.deepEqual(cipher.decrypt(a,'workspace:a'),bytes);
  assert.throws(()=>cipher.decrypt(a,'workspace:b'));
  a[a.length-1]^=1;assert.throws(()=>cipher.decrypt(a,'workspace:a'));
  assert.throws(()=>dataCipher('short'));assert.throws(()=>dataCipher().decrypt(b,'workspace:a'));
});

test('migración cifra datos existentes e imágenes, persiste y rechaza claves incorrectas',async t=>{
  const pool=await database(t),plain=await createStore({pool,encryptionKey:''}),a=await user(plain);
  const bytes=Buffer.from('photo-private-bytes'),imageId=await plain.putAsset(a.id,'image/webp',bytes),before=await plain.workspace(a.id);
  const key=randomBytes(32).toString('hex'),encrypted=await createStore({pool,encryptionKey:key});
  assert.deepEqual(await encrypted.workspace(a.id),before);
  assert.deepEqual(Buffer.from((await encrypted.getAsset(a.id,imageId)).bytes),bytes);
  const stored=(await pool.query('SELECT data FROM minuto_teams WHERE user_id=$1',[a.id])).rows[0].data;
  assert.equal(stored.encrypted,'aes-256-gcm-v1');assert.ok(!JSON.stringify(stored).includes('Equipo Privado'));
  const asset=(await pool.query('SELECT bytes,encrypted FROM minuto_assets WHERE id=$1',[imageId])).rows[0];
  assert.equal(asset.encrypted,true);assert.notDeepEqual(Buffer.from(asset.bytes),bytes);
  assert.deepEqual(await (await createStore({pool,encryptionKey:key})).workspace(a.id),before);
  await assert.rejects(createStore({pool,encryptionKey:''}));
  await assert.rejects(createStore({pool,encryptionKey:randomBytes(32).toString('hex')}));
  assert.deepEqual(await encrypted.workspace(a.id),before);
  const social=await encrypted.socialUser({provider:'google',subject:'new-person',email:'social@example.test',emailVerified:true},true);
  assert.equal((await pool.query('SELECT data FROM minuto_teams WHERE user_id=$1',[social.id])).rows[0].data.encrypted,'aes-256-gcm-v1');
});

test('exportación individual, contraseña, aislamiento y cabeceras sin caché',async t=>{
  const h=await harness(t),imageId=await h.store.putAsset(h.a.id,'image/png',Buffer.from('private-image'));
  await h.command('player.save',{name:'Jugador A',number:1,position:'POR',photoId:imageId,birthdate:'1990-01-01'});
  let w=await h.command('player.save',{name:'Compañero privado',number:2,position:'DEF'});
  const team=w.teams[0],[a,b]=team.players;
  await h.command('payment.set',{playerId:b.id,season:'2026/27',field:'insurance',value:true,expectedValue:false});
  await h.command('fixture.save',{opponent:'Rival',date:'2026-09-20T18:00:00Z',home:true,round:1,season:'2026/27'});
  w=await h.store.workspace(h.a.id);const matchId=w.teams[0].matches[0].id;
  await h.command('match.lineup',{matchId,playerIds:[a.id,b.id]});await h.command('match.start',{matchId});
  await h.command('match.goal',{matchId,scorerId:a.id,assistId:b.id});await h.command('match.finish',{matchId});
  assert.equal((await h.req('privacy/export',{body:{password},cookie:''})).status,401);
  assert.equal((await h.req('privacy/export',{body:{password:'wrong-password'}})).status,401);
  assert.equal((await h.req('privacy/export',{body:{password},origin:'https://foreign.example'})).status,403);
  const personal=await h.req('privacy/export',{body:{password,teamId:team.id,playerId:a.id}});
  assert.equal(personal.status,200);assert.equal(personal.headers.get('cache-control'),'no-store');
  assert.equal(personal.data.player.name,'Jugador A');assert.equal(personal.data.images.length,1);
  assert.ok(!JSON.stringify(personal.data).includes(b.id));assert.ok(!JSON.stringify(personal.data).includes(b.name));
  assert.equal((await h.req('privacy/export',{cookie:h.other,body:{password,teamId:team.id,playerId:a.id}})).status,404);
  const all=await h.req('privacy/export',{body:{password}});
  assert.equal(all.data.account.id,h.a.id);assert.equal(all.data.workspace.teams[0].players.length,2);
  assert.equal(all.data.account.password_hash,undefined);assert.equal(all.data.sessions,undefined);
  const image=await h.req('assets/'+imageId);assert.equal(image.headers.get('cache-control'),'no-store');
  assert.equal((await h.req('assets/'+imageId,{cookie:h.other})).status,404);
});

test('supresión individual requiere confirmación y elimina foto, cobros y referencias',async t=>{
  const h=await harness(t),imageId=await h.store.putAsset(h.a.id,'image/png',Buffer.from('photo'));
  let w=await h.command('player.save',{name:'A borrar',number:1,position:'POR',photoId:imageId});
  const player=w.teams[0].players[0];
  await h.command('payment.set',{playerId:player.id,season:'2026/27',field:'month1',value:true,expectedValue:false});
  await h.command('fixture.save',{opponent:'Rival',date:'2026-09-20T18:00:00Z',home:true,round:1,season:'2026/27'});
  w=await h.store.workspace(h.a.id);const matchId=w.teams[0].matches[0].id;
  await h.command('match.lineup',{matchId,playerIds:[player.id]});await h.command('match.start',{matchId});
  w=await h.store.workspace(h.a.id);
  const body=()=>({password,confirmation:'ELIMINAR',workspaceId:w.id,teamId:w.teams[0].id,revision:w.revision,operationId:randomUUID(),playerId:player.id});
  assert.equal((await h.req('privacy/erase-player',{body:body()})).status,400);
  await h.command('match.finish',{matchId});w=await h.store.workspace(h.a.id);
  assert.equal((await h.req('command',{body:{...body(),type:'player.erase',payload:{id:player.id}}})).status,403);
  assert.equal((await h.req('privacy/erase-player',{body:{...body(),confirmation:'yes'}})).status,400);
  assert.equal((await h.req('privacy/erase-player',{body:{...body(),revision:0}})).status,409);
  const request=body(),erased=await h.req('privacy/erase-player',{body:request});
  assert.equal(erased.status,200);assert.ok(!JSON.stringify(erased.data.workspace).includes(player.id));
  assert.ok(!JSON.stringify(erased.data.workspace).includes(player.name));
  assert.equal(await h.store.getAsset(h.a.id,imageId),null);
  assert.equal((await h.req('privacy/erase-player',{body:request})).status,200);
  assert.equal((await h.store.workspace(h.b.id)).teams[0].settings.name,'Equipo Privado');
});

test('revoca todas las sesiones y borra solo la cuenta autenticada mediante cascada',async t=>{
  const h=await harness(t),second=await h.store.createSession(h.a.id);
  assert.equal((await h.req('privacy/revoke-sessions',{body:{password:'incorrect-password'}})).status,401);
  const closed=await h.req('privacy/revoke-sessions',{body:{password}});assert.equal(closed.status,200);
  assert.equal(await h.store.session(second),null);assert.equal((await h.req('team')).status,401);
  const cookie=`minuto_session=${await h.store.createSession(h.a.id)}`;
  await h.store.putAsset(h.a.id,'image/png',Buffer.from('photo'));await h.store.emailToken(h.a.email,'reset');
  assert.equal((await h.req('privacy/delete-account',{cookie,body:{password,confirmation:'wrong'}})).status,400);
  const result=await h.req('privacy/delete-account',{cookie,body:{password,confirmation:'ELIMINAR MI CUENTA',userId:h.b.id}});
  assert.equal(result.status,200);assert.equal(result.headers.get('clear-site-data'),'"cache"');
  for(const table of ['minuto_teams','minuto_assets','minuto_sessions','minuto_commands','minuto_email_tokens','minuto_identities']) assert.equal((await h.pool.query(`SELECT * FROM ${table} WHERE user_id=$1`,[h.a.id])).rows.length,0);
  assert.equal((await h.pool.query('SELECT * FROM minuto_users WHERE id=$1',[h.a.id])).rows.length,0);
  assert.equal((await h.req('team',{cookie:h.other})).status,200);
});

test('limpieza de temporales respeta cuentas anteriores e imágenes utilizadas',async t=>{
  const h=await harness(t),used=await h.store.putAsset(h.a.id,'image/png',Buffer.from('used')),orphan=await h.store.putAsset(h.a.id,'image/png',Buffer.from('orphan'));
  await h.command('player.save',{name:'Adulto',number:3,position:'DEF',photoId:used});
  await h.pool.query("UPDATE minuto_assets SET created_at=NOW()-INTERVAL '2 days'");
  await h.store.register({email:'pending@example.test',name:'Pendiente',teamName:'Sin confirmar'});
  await h.pool.query("UPDATE minuto_users SET created_at=NOW()-INTERVAL '8 days'");
  await h.pool.query('UPDATE minuto_users SET email_verified_at=NULL WHERE id=$1',[h.b.id]);
  await h.pool.query("UPDATE minuto_sessions SET expires_at=NOW()-INTERVAL '1 day'");
  await h.store.pruneTemporaryData();
  assert.equal((await h.pool.query("SELECT * FROM minuto_users WHERE email='pending@example.test'")).rows.length,0);
  assert.equal((await h.pool.query('SELECT * FROM minuto_users WHERE id=$1',[h.b.id])).rows.length,1);
  assert.ok(await h.store.getAsset(h.a.id,used));assert.equal(await h.store.getAsset(h.a.id,orphan),null);
  assert.equal((await h.pool.query('SELECT * FROM minuto_sessions')).rows.length,0);
});

test('version para adultos y configuración legal incompleta visible como pendiente',async t=>{
  const demo=await createStore({demo:true});assert.ok((await demo.workspace()).teams[0].players.length>0);
  const h=await harness(t);const w=await h.store.workspace(h.a.id);
  const command={type:'player.save',teamId:w.teams[0].id,payload:{name:'Menor',number:1,position:'POR',birthdate:'2015-01-01'}};
  assert.throws(()=>applyCommand(w,command,Date.parse('2026-09-26')),/adultos/);
  assert.equal(privacyNotice({}).configured,false);
  assert.equal((await h.req('privacy-notice',{cookie:''})).status,200);
});

test('tablet: sesión restringida, sin cobros ni cumpleaños, cambios limitados al partido',async t=>{
  const h=await harness(t);
  await h.command('player.save',{name:'Titular',number:1,position:'POR',birthdate:'1990-01-01'});
  let w=await h.command('player.save',{name:'Suplente',number:2,position:'DEF',birthdate:'1991-02-02'});
  const [outgoing,incoming]=w.teams[0].players,teamId=w.teams[0].id;
  await h.command('payment.set',{playerId:outgoing.id,season:'2026/27',field:'month1',value:true,expectedValue:false});
  w=await h.command('fixture.save',{opponent:'Rival',date:'2026-09-26T18:00:00Z',home:true,round:1,season:'2026/27'});
  const matchId=w.teams[0].matches[0].id;
  assert.equal((await h.req('bench/start',{body:{teamId,matchId}})).status,400);
  await h.command('match.lineup',{matchId,playerIds:[outgoing.id]});await h.command('match.start',{matchId});
  const otherDevice=await h.store.createSession(h.a.id);
  assert.equal((await h.req('bench/start',{cookie:h.other,body:{teamId,matchId}})).status,400);
  const start=await h.req('bench/start',{body:{teamId,matchId}});assert.equal(start.status,200);
  const cookie=start.headers.get('set-cookie').split(';')[0];
  assert.equal((await h.req('team')).status,401); // Previous management session invalidated.
  assert.ok(await h.store.session(otherDevice));
  const session=await h.req('session',{cookie});assert.equal(session.data.user.scope,'bench');assert.equal(session.data.user.email,'');
  const bench=await h.req('bench',{cookie});assert.equal(bench.status,200);
  assert.equal(bench.data.players.length,2);assert.equal(bench.data.players[0].birthdate,null);
  assert.equal(bench.data.payments,undefined);assert.equal(bench.data.workspace,undefined);assert.equal(bench.data.match.events,undefined);
  assert.ok(!JSON.stringify(bench.data).includes('1990-01-01'));
  for(const path of ['team','assets/'+randomUUID()])assert.equal((await h.req(path,{cookie})).status,403);
  for(const path of ['command','privacy/export','privacy/delete-account','bench/start'])assert.equal((await h.req(path,{cookie,body:{password}})).status,403);
  const body={workspaceId:bench.data.workspaceId,revision:bench.data.revision,operationId:randomUUID(),outId:outgoing.id,inId:incoming.id};
  assert.equal((await h.req('bench/substitution',{cookie,body:{...body,teamId:h.b.id}})).status,400);
  const change=await h.req('bench/substitution',{cookie,body});assert.equal(change.status,200);
  assert.equal(change.data.match.stints.find(s=>s.playerId===incoming.id).outSeconds,null);
  assert.equal(change.data.players[1].birthdate,null);assert.equal(change.data.payments,undefined);
  assert.equal((await h.req('bench/substitution',{cookie,body})).status,200);
  await h.store.revokeSessions(h.a.id);assert.equal((await h.req('bench',{cookie})).status,401);
});
