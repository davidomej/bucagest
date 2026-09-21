import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { Pool } from 'pg';
import { PGlite } from '@electric-sql/pglite';
import { createStore } from '../server/store.js';
import { createApp,errorHandler } from '../server/app.js';

async function makePool(){
  if(process.env.TEST_DATABASE_URL)return new Pool({connectionString:process.env.TEST_DATABASE_URL});
  const db=new PGlite();let tail=Promise.resolve();
  return {query:(sql,args)=>!args&&sql.includes('CREATE TABLE')?db.exec(sql).then(()=>({rows:[]})):db.query(sql,args),
    async connect(){let release;const next=new Promise(resolve=>{release=resolve;});const previous=tail;tail=next;await previous;return {query:(sql,args)=>db.query(sql,args),release};},end:()=>db.close()};
}
test('API y persistencia: autenticación, aislamiento, concurrencia y reintentos',async t=>{
  const pool=await makePool();const store=await createStore({pool});const app=createApp(store,{origin:'http://localhost:3000'});app.use(errorHandler);
  const server=app.listen(0,'127.0.0.1');await once(server,'listening');const base=`http://127.0.0.1:${server.address().port}`;const users=[];
  async function req(path,{body,cookie,origin}={}){const r=await fetch(`${base}/api/${path}`,{...(body?{method:'POST',body:JSON.stringify(body)}:{}),headers:{'Content-Type':'application/json',...(cookie?{cookie}:{}),...(origin?{origin}:{})}});return {status:r.status,data:await r.json(),cookie:r.headers.get('set-cookie')?.split(';')[0]};}
  t.after(async()=>{await new Promise(resolve=>server.close(resolve));for(const id of users)await pool.query('DELETE FROM minuto_users WHERE id=$1',[id]);await store.close();});
  let a,b;
  await t.test('salud pública y datos privados',async()=>{assert.equal((await req('health')).status,200);assert.equal((await req('team')).status,401);});
  await t.test('registra dos equipos aislados con sesión opaca',async()=>{
    a=await req('register',{body:{email:`a-${randomUUID()}@example.test`,password:'Password-test-2026',name:'Entrenador A',teamName:'Equipo A'}});
    b=await req('register',{body:{email:`b-${randomUUID()}@example.test`,password:'Password-test-2026',name:'Entrenador B',teamName:'Equipo B'}});
    assert.equal(a.status,201);assert.equal(b.status,201);users.push(a.data.user.id,b.data.user.id);
    assert.match(a.cookie,/minuto_session=[a-f0-9]{64}/);assert.notEqual(a.cookie,b.cookie);
    assert.equal((await req('team',{cookie:a.cookie})).data.workspace.teams[0].settings.name,'Equipo A');assert.equal((await req('team',{cookie:b.cookie})).data.workspace.teams[0].settings.name,'Equipo B');
  });
  await t.test('rechaza origen ajeno y entrada inválida',async()=>{
    assert.equal((await req('command',{cookie:a.cookie,origin:'https://evil.example',body:{type:'settings'}})).status,403);
    assert.equal((await req('register',{body:{email:'invalid',password:'short'}})).status,400);
  });
  await t.test('guarda, deduplica el reintento y rechaza revisiones antiguas',async()=>{
    const workspace=(await req('team',{cookie:a.cookie})).data.workspace,team=workspace.teams[0];
    const command={type:'player.save',workspaceId:workspace.id,teamId:team.id,revision:workspace.revision,operationId:randomUUID(),payload:{name:'Jugador Prueba',number:7,position:'MED'}};
    const saved=await req('command',{cookie:a.cookie,body:command});assert.equal(saved.status,200);assert.equal(saved.data.workspace.teams[0].players.length,1);
    const retry=await req('command',{cookie:a.cookie,body:command});assert.equal(retry.status,200);assert.equal(retry.data.workspace.teams[0].players.length,1);
    const stale=await req('command',{cookie:a.cookie,body:{...command,operationId:randomUUID()}});assert.equal(stale.status,409);
    assert.equal((await req('team',{cookie:b.cookie})).data.workspace.teams[0].players.length,0);
  });
  await t.test('un comando de otra pestaña no puede modificar el equipo de otra cuenta',async()=>{
    const workspace=(await req('team',{cookie:a.cookie})).data.workspace;
    const result=await req('command',{cookie:b.cookie,body:{type:'player.save',workspaceId:workspace.id,teamId:workspace.teams[0].id,revision:0,operationId:randomUUID(),payload:{name:'No debe entrar',number:8,position:'DEF'}}});assert.equal(result.status,409);
  });
  await t.test('serializa dos escrituras simultáneas con la misma revisión',async()=>{
    const workspace=await store.workspace(a.data.user.id);const base={type:'player.save',workspaceId:workspace.id,teamId:workspace.teams[0].id,revision:workspace.revision};
    const results=await Promise.allSettled([store.command(a.data.user.id,{...base,operationId:randomUUID(),payload:{name:'Jugador Dos',number:2,position:'DEF'}}),store.command(a.data.user.id,{...base,operationId:randomUUID(),payload:{name:'Jugador Tres',number:3,position:'DEF'}})]);
    assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal(results.find(r=>r.status==='rejected').reason.status,409);assert.equal((await store.workspace(a.data.user.id)).teams[0].players.length,2);
  });
  await t.test('un partido y sus intervalos sobreviven a una nueva instancia de store',async()=>{
    let workspace=await store.workspace(a.data.user.id);const teamId=workspace.teams[0].id;
    const command=async(type,payload)=>{workspace=await store.command(a.data.user.id,{type,payload,workspaceId:workspace.id,teamId,revision:workspace.revision,operationId:randomUUID()});};
    await command('fixture.save',{opponent:'Rival de prueba',date:'2026-09-20T18:00:00Z',home:true,round:1,season:'2026/27'});
    const team=()=>workspace.teams.find(t=>t.id===teamId);
    const matchId=team().matches[0].id;await command('match.lineup',{matchId,playerIds:[team().players[0].id]});await command('match.start',{matchId});
    const second=await createStore({pool});const recovered=await second.workspace(a.data.user.id);const recoveredTeam=recovered.teams.find(t=>t.id===teamId);assert.equal(recoveredTeam.matches[0].status,'live');assert.equal(recoveredTeam.matches[0].stints.length,1);assert.ok(recoveredTeam.matches[0].runningSince);
    await command('match.substitute',{matchId,outId:team().players[0].id,inId:team().players[1].id});await command('match.finish',{matchId});assert.equal(team().matches[0].status,'finished');assert.ok(team().matches[0].stints.every(s=>s.outSeconds!==null));
  });
  await t.test('cobros persisten, deduplican reintentos y separan equipos y temporadas',async()=>{
    const workspace=await store.workspace(a.data.user.id),team=workspace.teams[0];
    const body={type:'payment.set',workspaceId:workspace.id,teamId:team.id,revision:workspace.revision,operationId:randomUUID(),payload:{playerId:team.players[0].id,season:'2026/27',field:'month1',value:true,expectedValue:false}};
    const result=await req('command',{cookie:a.cookie,body});assert.equal(result.status,200);
    const retry=await req('command',{cookie:a.cookie,body});assert.equal(retry.status,200);assert.equal(retry.data.workspace.revision,result.data.workspace.revision);
    const recovered=await (await createStore({pool})).workspace(a.data.user.id);
    assert.deepEqual(recovered.teams[0].payments,[{playerId:team.players[0].id,season:'2026/27',checks:{month1:true}}]);
    assert.deepEqual((await store.workspace(b.data.user.id)).teams[0].payments,[]);
    const unmark=await req('command',{cookie:a.cookie,body:{...body,revision:recovered.revision,operationId:randomUUID(),payload:{...body.payload,value:false,expectedValue:true}}});assert.equal(unmark.status,200);
    assert.equal(unmark.data.workspace.teams[0].payments[0].checks.month1,false);
    const nextSeason=await req('command',{cookie:a.cookie,body:{...body,revision:unmark.data.workspace.revision,operationId:randomUUID(),payload:{...body.payload,season:'2027/28'}}});assert.equal(nextSeason.status,200);
    assert.equal(nextSeason.data.workspace.teams[0].payments[0].checks.month1,false);assert.equal(nextSeason.data.workspace.teams[0].payments[1].checks.month1,true);
  });
  await t.test('login valida contraseña y logout revoca la sesión',async()=>{
    assert.equal((await req('login',{body:{email:a.data.user.email,password:'wrong-password-2026'}})).status,401);
    const login=await req('login',{body:{email:a.data.user.email,password:'Password-test-2026'}});assert.equal(login.status,200);
    assert.equal((await req('logout',{cookie:login.cookie,body:{}})).status,200);assert.equal((await req('team',{cookie:login.cookie})).status,401);
  });
});
