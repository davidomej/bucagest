import test from 'node:test';
import assert from 'node:assert/strict';
import { applyCommand, emptyWorkspace, elapsed, playerSeconds, FORMATIONS } from '../server/domain.js';

function fixture(){
  let state=emptyWorkspace('Test FC');
  const teamId=state.teams[0].id;
  const team=()=>state.teams.find(t=>t.id===teamId);
  const apply=(type,payload={},now=0)=>{state=applyCommand(state,{type,teamId,payload},now);return state;};
  for(let n=1;n<=9;n++)apply('player.save',{name:`Jugador ${n}`,number:n,position:n===1?'POR':'MED'});
  apply('fixture.save',{opponent:'Rival',date:'2026-09-20T18:00:00Z',venue:'Municipal',home:true,round:1,season:'2026/27'});
  const id=team().matches[0].id;
  const command=(type,payload={},now=0)=>{state=applyCommand(state,{type,teamId,payload:{matchId:id,...payload}},now);return state;};
  command('match.lineup',{playerIds:team().players.slice(0,7).map(p=>p.id)});
  return {get state(){return state;},get match(){return team().matches[0];},get matches(){return team().matches;},get ids(){return team().players.map(p=>p.id);},get settings(){return team().settings;},command};
}
test('el reloj se reconstruye tras recargar y descuenta el descanso',()=>{
  const f=fixture();f.command('match.start',{},1000);assert.equal(elapsed(structuredClone(f.match),601000),600);
  f.command('match.pause',{halftime:true},601000);assert.equal(elapsed(f.match,1201000),600);
  f.command('match.resume',{},1201000);f.command('match.finish',{},1801000);
  assert.equal(f.match.elapsedSeconds,1200);assert.equal(f.match.period,2);assert.equal(playerSeconds(f.match,f.ids[0]),1200);
});
test('cambio simultáneo usa un instante exacto y conserva los segundos',()=>{
  const f=fixture();f.command('match.start');f.command('match.substitute',{outId:f.ids[1],inId:f.ids[7]},600500);
  assert.equal(f.match.stints.find(s=>s.playerId===f.ids[1]).outSeconds,600.5);
  assert.equal(f.match.stints.find(s=>s.playerId===f.ids[7]).inSeconds,600.5);
  f.command('match.finish',{},1200000);assert.equal(playerSeconds(f.match,f.ids[1]),600.5);assert.equal(playerSeconds(f.match,f.ids[7]),599.5);
  assert.equal(f.ids.reduce((n,id)=>n+playerSeconds(f.match,id),0),7*1200);
});
test('una reentrada suma intervalos sin sobrescribir el primer tramo',()=>{
  const f=fixture();f.command('match.start');f.command('match.substitute',{outId:f.ids[1],inId:f.ids[7]},600000);f.command('match.substitute',{outId:f.ids[7],inId:f.ids[1]},900000);f.command('match.finish',{},1200000);
  assert.equal(playerSeconds(f.match,f.ids[1]),900);assert.equal(playerSeconds(f.match,f.ids[7]),300);
});
test('entradas y salidas durante el descanso no suman el tiempo de pausa',()=>{
  const f=fixture();f.command('match.start');f.command('match.pause',{halftime:true},600000);f.command('match.substitute',{outId:f.ids[1],inId:f.ids[7]},900000);assert.equal(f.match.stints.at(-1).inSeconds,600);
  f.command('match.resume',{},1200000);f.command('match.finish',{},1800000);assert.equal(playerSeconds(f.match,f.ids[7]),600);
});
test('salida individual libera plaza; entrada en campo completo se rechaza',()=>{
  const f=fixture();f.command('match.start');assert.throws(()=>f.command('match.substitute',{inId:f.ids[7]},100000),/completo/);
  f.command('match.substitute',{outId:f.ids[1]},100000);f.command('match.substitute',{inId:f.ids[7]},120000);assert.equal(f.match.stints.at(-1).inSeconds,120);
});
test('cambio inválido es atómico y no altera el original',()=>{
  const f=fixture();f.command('match.start');const before=structuredClone(f.state);
  assert.throws(()=>f.command('match.substitute',{outId:f.ids[1],inId:f.ids[0]},600000),/ya está/);assert.deepEqual(f.state,before);
  assert.throws(()=>f.command('match.substitute',{outId:f.ids[8]},600000),/fuera/);
});
test('deshacer restaura el intervalo original sin sumar dobles minutos',()=>{
  const f=fixture();f.command('match.start');f.command('match.substitute',{outId:f.ids[1],inId:f.ids[7]},600000);f.command('match.undo',{},660000);f.command('match.finish',{},1200000);
  assert.equal(playerSeconds(f.match,f.ids[1]),1200);assert.equal(playerSeconds(f.match,f.ids[7]),0);
});
test('no se devuelve al campo a un jugador archivado al deshacer',()=>{
  const f=fixture();f.command('match.start');f.command('match.substitute',{outId:f.ids[1],inId:f.ids[7]},600000);f.command('player.archive',{id:f.ids[1]},600000);
  assert.throws(()=>f.command('match.undo',{},700000),/archivado/);
});
test('el tiempo aceptado no retrocede si el reloj del servidor cambia',()=>{
  const f=fixture();f.command('match.start');f.command('match.substitute',{outId:f.ids[1],inId:f.ids[7]},600000);f.command('match.finish',{},500000);
  assert.equal(f.match.elapsedSeconds,600);assert.ok(f.match.stints.every(s=>s.outSeconds>=s.inSeconds));
  assert.ok(f.ids.every(id=>playerSeconds(f.match,id)<=f.match.elapsedSeconds));
});
test('finalizar es idempotente y un partido cerrado no puede reanudarse',()=>{
  const f=fixture();f.command('match.start');f.command('match.finish',{},600000);const before=structuredClone(f.state);f.command('match.finish',{},1200000);assert.deepEqual(f.state,before);
  assert.ok(f.match.stints.every(s=>s.outSeconds!==null));assert.throws(()=>f.command('match.resume',{},1300000),/pausado/);
});
test('se aplican los límites de titulares y las reglas de reentrada',()=>{
  const f=fixture();assert.throws(()=>f.command('match.lineup',{playerIds:f.ids}),/Too big/);
  f.command('settings',{...f.settings,allowReentry:false});f.command('match.start');f.command('match.substitute',{outId:f.ids[1],inId:f.ids[7]},600000);
  assert.throws(()=>f.command('match.substitute',{outId:f.ids[7],inId:f.ids[1]},900000),/reentradas/);
});
test('impide dorsal duplicado y más de un partido activo por equipo',()=>{
  const f=fixture();assert.throws(()=>f.command('player.save',{name:'Otro',number:1,position:'DEF'}),/dorsal/);f.command('match.start');
  f.command('fixture.save',{opponent:'Segundo rival',date:'2026-09-27T18:00:00Z',home:false,round:2,season:'2026/27'});
  const id=f.matches[1].id;f.command('match.lineup',{matchId:id,playerIds:[f.ids[0]]});assert.throws(()=>f.command('match.start',{matchId:id}),/otro partido/);
});
test('un entrenador puede crear y cambiar entre varios equipos, cada uno con su propia plantilla',()=>{
  let state=emptyWorkspace('Equipo A');const firstId=state.teams[0].id;
  state=applyCommand(state,{type:'team.create',payload:{name:'Equipo B'}});
  assert.equal(state.teams.length,2);assert.equal(state.activeTeamId,state.teams[1].id);
  const secondId=state.teams[1].id;
  state=applyCommand(state,{type:'player.save',teamId:secondId,payload:{name:'Solo en B',number:9,position:'DEL'}});
  assert.equal(state.teams.find(t=>t.id===firstId).players.length,0);
  assert.equal(state.teams.find(t=>t.id===secondId).players.length,1);
  state=applyCommand(state,{type:'player.save',teamId:firstId,payload:{name:'Mismo dorsal en A',number:9,position:'DEL'}});
  assert.equal(state.teams.find(t=>t.id===firstId).players.length,1);
  state=applyCommand(state,{type:'team.select',payload:{id:firstId}});assert.equal(state.activeTeamId,firstId);
  state=applyCommand(state,{type:'team.delete',payload:{id:secondId}});assert.equal(state.teams.length,1);
  assert.throws(()=>applyCommand(state,{type:'team.delete',payload:{id:firstId}}),/único equipo/);
});
test('las ligas se crean una vez y se comparten entre equipos del mismo entrenador',()=>{
  let state=emptyWorkspace('Equipo A');const firstId=state.teams[0].id;
  state=applyCommand(state,{type:'team.create',payload:{name:'Equipo B'}});const secondId=state.activeTeamId;
  state=applyCommand(state,{type:'league.save',payload:{name:'Liga Municipal',season:'2026/27',color:'#8ac9eb'}});
  const leagueId=state.leagues[0].id;
  state=applyCommand(state,{type:'settings',teamId:firstId,payload:{...state.teams.find(t=>t.id===firstId).settings,leagueIds:[leagueId]}});
  state=applyCommand(state,{type:'settings',teamId:secondId,payload:{...state.teams.find(t=>t.id===secondId).settings,leagueIds:[leagueId]}});
  assert.equal(state.teams.find(t=>t.id===firstId).settings.leagueIds[0],leagueId);
  assert.equal(state.teams.find(t=>t.id===secondId).settings.leagueIds[0],leagueId);
  state=applyCommand(state,{type:'league.delete',payload:{id:leagueId}});
  assert.equal(state.leagues.length,0);
  assert.deepEqual(state.teams.find(t=>t.id===firstId).settings.leagueIds,[]);
});
test('se puede asignar una formación de fútbol 7 con una posición por jugador',()=>{
  const f=fixture();const ids=f.ids;
  const slots=FORMATIONS['1-2-3-1'];
  const positions=Object.fromEntries(ids.slice(0,7).map((id,i)=>[id,slots[i]]));
  f.command('match.lineup',{playerIds:ids.slice(0,7),formation:'1-2-3-1',positions});
  assert.equal(f.match.formation,'1-2-3-1');
  assert.equal(f.match.positions[ids[0]],'POR');
  assert.throws(()=>f.command('match.lineup',{playerIds:ids.slice(0,7),formation:'1-2-3-1',positions:{[ids[0]]:'POR',[ids[1]]:'POR'}}),/misma posición/);
  assert.throws(()=>f.command('match.lineup',{playerIds:ids.slice(0,7),formation:'1-2-3-1',positions:{[ids[0]]:'ALA'}}),/no válida/);
});
test('un jugador de campo puede sustituir al portero lesionado y hereda su posición',()=>{
  const f=fixture();const ids=f.ids;
  const slots=FORMATIONS['1-2-3-1'];
  const positions=Object.fromEntries(ids.slice(0,7).map((id,i)=>[id,slots[i]]));
  f.command('match.lineup',{playerIds:ids.slice(0,7),formation:'1-2-3-1',positions});
  f.command('match.start');
  // El portero (ids[0]) sale lesionado; el jugador de banquillo ids[7] entra en su lugar.
  f.command('match.substitute',{outId:ids[0],inId:ids[7]},100000);
  assert.equal(f.match.positions[ids[7]],'POR');
  assert.equal(f.match.positions[ids[0]],undefined);
  // Deshacer restaura al portero original en su posición y quita al suplente.
  f.command('match.undo',{},120000);
  assert.equal(f.match.positions[ids[0]],'POR');
  assert.equal(f.match.positions[ids[7]],undefined);
});
test('una sustitución puede colocar al jugador entrante en una posición distinta a la del saliente',()=>{
  const f=fixture();const ids=f.ids;
  const slots=FORMATIONS['1-2-3-1'];
  const positions=Object.fromEntries(ids.slice(0,7).map((id,i)=>[id,slots[i]]));
  f.command('match.lineup',{playerIds:ids.slice(0,7),formation:'1-2-3-1',positions});
  f.command('match.start');
  f.command('match.substitute',{outId:ids[1],inId:ids[7],slot:'DEF1'},100000);
  assert.equal(f.match.positions[ids[7]],'DEF1');
  assert.throws(()=>f.command('match.substitute',{outId:ids[2],inId:ids[8],slot:'DEF1'},150000),/ocupada/);
});
test('las formaciones solo están disponibles en fútbol 7',()=>{
  const f=fixture();
  f.command('settings',{...f.settings,playersOnField:5});
  assert.throws(()=>f.command('match.lineup',{playerIds:f.ids.slice(0,5),formation:'1-2-3-1'}),/fútbol 7/);
});
test('un partido pendiente se puede aplazar y no se puede iniciar mientras está aplazado',()=>{
  const f=fixture();
  f.command('match.postpone');
  assert.equal(f.match.status,'postponed');
  assert.throws(()=>f.command('match.start'),/aplazado/);
  assert.throws(()=>f.command('match.lineup',{playerIds:f.ids.slice(0,7)}),/aplazado/);
});
test('no se puede aplazar un partido que ya está en curso o finalizado',()=>{
  const f=fixture();
  f.command('match.start');
  assert.throws(()=>f.command('match.postpone'),/pendientes/);
  f.command('match.finish');
  assert.throws(()=>f.command('match.postpone'),/pendientes/);
});
test('reprogramar un partido aplazado con una nueva fecha lo deja pendiente de nuevo',()=>{
  const f=fixture();
  f.command('match.postpone');
  f.command('fixture.save',{id:f.match.id,opponent:'Rival',date:'2026-10-05T18:00:00Z',venue:'Municipal',home:true,round:1,season:'2026/27'});
  assert.equal(f.match.status,'scheduled');
  assert.equal(f.match.date,'2026-10-05T18:00:00Z');
});
test('se puede borrar un partido aplazado igual que uno pendiente',()=>{
  const f=fixture();
  f.command('match.postpone');
  const before=f.matches.length;
  f.command('fixture.delete',{id:f.match.id});
  assert.equal(f.matches.length,before-1);
});
