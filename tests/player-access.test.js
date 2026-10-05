import test from 'node:test';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {randomBytes,randomUUID} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';
import {createStore} from '../server/store.js';
import {createApp,errorHandler} from '../server/app.js';

const password='Player-password-2026';
async function harness(t) {
  const db=new PGlite();let tail=Promise.resolve();
  const pool={query:(sql,args)=>!args&&sql.includes('CREATE TABLE')?db.exec(sql).then(()=>({rows:[]})):db.query(sql,args),async connect(){let release;const next=new Promise(r=>{release=r;});const previous=tail;tail=next;await previous;return {query:(sql,args)=>db.query(sql,args),release};},end:()=>db.close()};
  const store=await createStore({pool,encryptionKey:randomBytes(32).toString('hex')});
  const emails=[];const mailer={configured:true,fail:false,sendLink:async msg=>{if(mailer.fail)throw Error('Mail provider unavailable');emails.push(msg);}};
  async function manager(email){await store.register({email,name:'Gestor',teamName:'Equipo privado'});const token=await store.emailToken(email,'verify');return store.completeEmail({...token,kind:'verify',password});}
  const owner=await manager('owner@example.test'),other=await manager('other@example.test');
  const cookie=`minuto_session=${await store.createSession(owner.id)}`,otherCookie=`minuto_session=${await store.createSession(other.id)}`;
  const app=createApp(store,{origin:'http://localhost:3000',mailer,providers:{},registrationAllowed:false});app.use(errorHandler);
  const server=app.listen(0,'127.0.0.1');await once(server,'listening');
  t.after(async()=>{await new Promise(r=>server.close(r));await store.close();});
  async function req(path,body,session=cookie){const r=await fetch(`http://127.0.0.1:${server.address().port}/api/${path}`,{method:body?'POST':'GET',headers:{...(body?{'Content-Type':'application/json'}:{}),...(session?{Cookie:session}:{})},body:body?JSON.stringify(body):undefined});return {status:r.status,data:await r.json(),cookie:r.headers.getSetCookie().find(c=>c.startsWith('minuto_session='))?.split(';')[0]};}
  async function command(type,payload){const w=await store.workspace(owner.id);return store.command(owner.id,{type,payload,workspaceId:w.id,teamId:w.activeTeamId,revision:w.revision,operationId:randomUUID()});}
  async function save(email='player@example.test',extra={}) {const w=await store.workspace(owner.id);return req('command',{type:'player.save',payload:{name:'Jugador',number:7,position:'MED',email,...extra},workspaceId:w.id,teamId:w.activeTeamId,revision:w.revision,operationId:randomUUID()});}
  async function accept(token=emails.at(-1).token,email='player@example.test'){const accepted=await req('player-invitations/accept',{token,password},null);assert.equal(accepted.status,200);const login=await req('login',{email,password},null);assert.equal(login.status,200);return login;}
  return {pool,store,emails,mailer,owner,other,cookie,otherCookie,req,command,save,accept};
}

test('invitación: correo obligatorio, token de un uso, rol de lectura y datos propios',async t=>{
  const h=await harness(t);
  assert.equal((await h.save(undefined,{email:undefined})).status,400);
  const saved=await h.save('player@example.test',{position:'DEF'});assert.equal(saved.status,200);assert.match(saved.data.invitationMessage,/enviada/);
  const w=saved.data.workspace,team=w.teams[0],player=team.players[0],invite=h.emails[0];
  assert.equal(invite.kind,'invite');assert.equal(invite.teamName,team.settings.name);
  const stored=(await h.pool.query('SELECT token_hash,email_cipher,expires_at FROM minuto_player_access')).rows[0];
  assert.notEqual(stored.token_hash,invite.token);assert.ok(new Date(stored.expires_at)>Date.now()+71*3600000);
  assert.notDeepEqual(Buffer.from(stored.email_cipher),Buffer.from(invite.email));
  assert.equal((await h.req('player-portal',undefined,null)).status,401);
  assert.equal((await h.req('player-invitations/info',{token:invite.token},null)).data.existingAccount,false);
  assert.equal((await h.req('login',{email:invite.email,password},null)).status,401);
  await h.command('player.save',{name:'Compañero privado',number:8,position:'DEF',email:'private@example.test',birthdate:'1990-01-01'});
  await h.command('fixture.save',{opponent:'Rival',date:'2026-10-01T18:00:00Z',venue:'Campo',home:true,round:1,season:team.settings.season});
  let state=await h.store.workspace(h.owner.id),match=state.teams[0].matches[0];
  const teammate=team.players.find(p=>p.id!==player.id);
  await h.command('match.lineup',{matchId:match.id,playerIds:[player.id,teammate.id]});
  await h.command('match.start',{matchId:match.id});
  await h.command('match.goal',{matchId:match.id,scorerId:player.id,assistId:teammate.id});
  await h.command('match.goal',{matchId:match.id,scorerId:teammate.id,assistId:player.id});
  await h.command('match.finish',{matchId:match.id});
  const login=await h.accept();assert.equal(login.data.user.role,'player');
  assert.equal((await h.req('session',undefined,login.cookie)).data.user.role,'player');
  assert.equal((await h.pool.query('SELECT * FROM minuto_teams WHERE user_id=$1',[login.data.user.id])).rows.length,0);
  assert.equal((await h.req('player-invitations/accept',{token:invite.token,password},null)).status,400);
  const portal=await h.req('player-portal',undefined,login.cookie);assert.equal(portal.status,200);
  assert.equal(portal.data.teams[0].matches[0].played,true);
  assert.equal(portal.data.teams[0].player.name,'Jugador');
  assert.equal(portal.data.teams[0].player.id,player.id);
  assert.equal(portal.data.teams[0].matches[0].goals.filter(g=>g.scorerId===player.id).length,1);
  assert.equal(portal.data.teams[0].matches[0].goals.filter(g=>g.assistId===player.id).length,1);
  assert.equal(portal.data.teams[0].matches[0].cleanSheet,true);
  assert.ok(!JSON.stringify(portal.data).includes('private@example.test'));
  assert.ok(!JSON.stringify(portal.data).includes('Compañero privado'));
  assert.equal(portal.data.teams[0].players,undefined);assert.equal(portal.data.teams[0].payments,undefined);
  assert.equal((await h.req('player-portal',undefined,h.otherCookie)).data.teams.length,0);
  for(const [path,body] of [['team'],['command',{type:'team.create'}],['assets/'+randomUUID()],['privacy/export',{password}],['privacy/delete-account',{password,confirmation:'ELIMINAR MI CUENTA'}],['privacy/revoke-sessions',{password}],['privacy/erase-player',{confirmation:'ELIMINAR'}],['bench/start',{teamId:team.id,matchId:match.id}],['bench/substitution',{}],['player-access/invite',{teamId:team.id,playerId:player.id}]])assert.equal((await h.req(path,body,login.cookie)).status,403,path);
});

test('una cuenta existente acepta con su contraseña sin cambiarla ni perder el rol de gestor',async t=>{
  const h=await harness(t);await h.save('other@example.test');const invite=h.emails[0];
  assert.equal((await h.req('player-invitations/info',{token:invite.token},null)).data.existingAccount,true);
  assert.equal((await h.req('player-invitations/accept',{token:invite.token,password:'Different-password'},null)).status,401);
  assert.equal((await h.req('player-invitations/accept',{token:invite.token,password},null)).status,200);
  const login=await h.req('login',{email:'other@example.test',password},null);assert.equal(login.data.user.role,'manager');
  assert.equal((await h.req('team',undefined,login.cookie)).status,200);
  assert.equal((await h.req('player-portal',undefined,login.cookie)).data.teams.length,1);
  assert.equal((await h.req('player-portal',undefined,h.cookie)).data.teams.length,0);
  assert.equal((await h.req('session',undefined,h.otherCookie)).data.user.id,h.other.id);
});

test('un mismo jugador consulta varios equipos vinculados y ve los datos correctos en cada uno',async t=>{
  const h=await harness(t);let first=await h.save('shared@example.test');const firstTeam=first.data.workspace.teams[0],firstPlayer=firstTeam.players[0];
  const firstLogin=await h.accept(h.emails[0].token,'shared@example.test');
  const otherTeam=await h.store.workspace(h.other.id);
  const created=await h.store.command(h.other.id,{type:'player.save',workspaceId:otherTeam.id,teamId:otherTeam.activeTeamId,revision:otherTeam.revision,operationId:randomUUID(),payload:{name:'Otra camiseta',number:11,position:'DEL',email:'shared@example.test'}});
  const secondTeam=created.teams[0],secondPlayer=secondTeam.players[0];
  const secondInvite=await h.store.invitePlayer(h.other.id,secondTeam.id,secondPlayer.id);h.emails.push(secondInvite);
  assert.equal((await h.req('player-invitations/info',{token:secondInvite.token},null)).data.existingAccount,true);
  assert.equal((await h.req('player-invitations/accept',{token:secondInvite.token,password},null)).status,200);
  const portal=(await h.req('player-portal',undefined,firstLogin.cookie)).data;
  assert.deepEqual(new Set(portal.teams.map(team=>team.id)),new Set([firstTeam.id,secondTeam.id]));
  assert.ok(portal.teams.some(team=>team.player.name==='Jugador'&&team.player.number===firstPlayer.number));
  assert.ok(portal.teams.some(team=>team.player.name==='Otra camiseta'&&team.player.number===secondPlayer.number));
  assert.ok(!JSON.stringify(portal).includes(h.otherCookie));
});

test('el jugador exporta solo su vista personal y puede borrar su acceso con su contraseña',async t=>{
  const h=await harness(t);await h.save('player@example.test');await h.command('player.save',{name:'Otra persona',number:8,position:'DEF',email:'private@example.test'});
  const login=await h.accept();
  assert.equal((await h.req('player-data/export',{password:'Wrong-password-2026'},login.cookie)).status,401);
  const exported=await h.req('player-data/export',{password},login.cookie);
  assert.equal(exported.status,200);assert.equal(exported.data.teams.length,1);assert.equal(exported.data.teams[0].player.name,'Jugador');
  assert.ok(!JSON.stringify(exported.data).includes('Otra persona'));assert.ok(!JSON.stringify(exported.data).includes('private@example.test'));
  assert.equal((await h.req('player-data/delete-account',{password,confirmation:'BORRAR'},login.cookie)).status,400);
  assert.equal((await h.req('player-data/delete-account',{password:'Wrong-password-2026',confirmation:'ELIMINAR MI CUENTA'},login.cookie)).status,401);
  const deleted=await h.req('player-data/delete-account',{password,confirmation:'ELIMINAR MI CUENTA'},login.cookie);
  assert.equal(deleted.status,200);assert.equal(deleted.cookie,'minuto_session=');
  assert.equal((await h.req('player-portal',undefined,login.cookie)).status,401);
  assert.equal((await h.pool.query('SELECT * FROM minuto_users WHERE email=$1',[login.data.user.email])).rows.length,0);
  assert.equal((await h.store.workspace(h.owner.id)).teams[0].players[0].email,'player@example.test');
  assert.equal((await h.pool.query('SELECT * FROM minuto_player_access')).rows.length,0);
});

test('revocar, cambiar el correo y archivar cortan accesos e invitaciones',async t=>{
  const h=await harness(t);const saved=await h.save(),team=saved.data.workspace.teams[0],player=team.players[0],target={teamId:team.id,playerId:player.id};
  const first=h.emails[0].token;
  assert.equal((await h.req('player-access/revoke',target,h.otherCookie)).status,400);
  await h.req('player-access/revoke',target);
  assert.equal((await h.req('player-invitations/accept',{token:first,password},null)).status,400);
  await h.req('player-access/invite',target);const login=await h.accept();
  assert.equal((await h.req('player-portal',undefined,login.cookie)).data.teams.length,1);
  await h.save('replacement@example.test',{id:player.id});
  assert.equal((await h.req('player-portal',undefined,login.cookie)).data.teams.length,0);
  const replacement=h.emails.at(-1).token;
  await h.command('player.archive',{id:player.id});
  assert.equal((await h.req('player-invitations/accept',{token:replacement,password},null)).status,400);
  assert.equal((await h.pool.query('SELECT * FROM minuto_player_access')).rows.length,0);
});

test('fallos de correo conservan la ficha, permiten reintentar y los enlaces caducan',async t=>{
  const h=await harness(t);h.mailer.fail=true;
  const saved=await h.save();assert.equal(saved.status,200);assert.match(saved.data.invitationWarning,/Jugador guardado/);
  const team=saved.data.workspace.teams[0],target={teamId:team.id,playerId:team.players[0].id};
  assert.equal((await h.pool.query('SELECT token_hash FROM minuto_player_access')).rows[0].token_hash,null);
  h.mailer.fail=false;assert.equal((await h.req('player-access/invite',target)).status,200);
  assert.equal((await h.req('player-access/invite',target)).status,429);
  const old=h.emails[0].token;
  await h.pool.query("UPDATE minuto_player_access SET expires_at=NOW()-INTERVAL '1 second',sent_at=NOW()-INTERVAL '2 minutes'");
  assert.equal((await h.req('player-invitations/accept',{token:old,password},null)).status,400);
  await h.req('player-access/invite',target);
  assert.equal((await h.req('player-invitations/info',{token:old},null)).status,400);
  await h.accept();
});

test('datos oficiales por competición y temporada; solo son visibles en equipos vinculados',async t=>{
  const h=await harness(t);let w=(await h.save()).data.workspace;const team=w.teams[0];
  w=await h.command('league.save',{name:'Copa oficial',season:team.settings.season,color:'#123456',kind:'cup'});const league=w.leagues[0];
  await h.command('settings',{...team.settings,leagueIds:[league.id]});
  const login=await h.accept();let portal=(await h.req('player-portal',undefined,login.cookie)).data;
  assert.equal(portal.teams[0].competitions[0].updatedAt,null);assert.equal(portal.teams[0].competitions[0].kind,'cup');
  const key=[h.owner.id,league.id,team.settings.season];
  await h.pool.query("INSERT INTO minuto_official_competitions(owner_id,league_id,season,kind,source_url,updated_at) VALUES($1,$2,$3,'cup','https://example.test/copa',NOW())",key);
  await h.pool.query("INSERT INTO minuto_official_results(owner_id,league_id,season,external_id,round,home_team,away_team,home_score,away_score,status) VALUES($1,$2,$3,'official-1','Semifinal','Local','Visitante',2,1,'finished')",key);
  await h.pool.query("INSERT INTO minuto_official_standings(owner_id,league_id,season,position,team_name,played,won,drawn,lost,goals_for,goals_against,points) VALUES($1,$2,$3,1,'Local',1,1,0,0,2,1,3)",key);
  portal=(await h.req('player-portal',undefined,login.cookie)).data;
  assert.equal(portal.teams[0].competitions[0].results[0].home_score,2);
  assert.equal(portal.teams[0].competitions[0].standings[0].points,3);
  assert.equal((await h.req('player-portal',undefined,h.otherCookie)).data.teams.length,0);
  await h.command('league.delete',{id:league.id});
  assert.equal((await h.pool.query('SELECT * FROM minuto_official_results')).rows.length,0);
});
