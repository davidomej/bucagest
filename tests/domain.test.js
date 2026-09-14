import test from 'node:test';
import assert from 'node:assert/strict';
import { applyCommand, emptyTeam, elapsed, playerSeconds } from '../server/domain.js';

function fixture(){
  let state=emptyTeam('Test FC');
  for(let n=1;n<=9;n++)state=applyCommand(state,{type:'player.save',payload:{name:`Jugador ${n}`,number:n,position:n===1?'POR':'MED'}});
  state=applyCommand(state,{type:'fixture.save',payload:{opponent:'Rival',date:'2026-09-20T18:00:00Z',venue:'Municipal',home:true,round:1,season:'2026/27'}});
  const id=state.matches[0].id;
  const command=(type,payload={},now=0)=>{state=applyCommand(state,{type,payload:{matchId:id,...payload}},now);return state;};
  command('match.lineup',{playerIds:state.players.slice(0,7).map(p=>p.id)});
  return {get state(){return state;},get match(){return state.matches[0];},get ids(){return state.players.map(p=>p.id);},command};
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
  f.command('settings',{...f.state.settings,allowReentry:false});f.command('match.start');f.command('match.substitute',{outId:f.ids[1],inId:f.ids[7]},600000);
  assert.throws(()=>f.command('match.substitute',{outId:f.ids[7],inId:f.ids[1]},900000),/reentradas/);
});
test('impide dorsal duplicado y más de un partido activo por equipo',()=>{
  const f=fixture();assert.throws(()=>f.command('player.save',{name:'Otro',number:1,position:'DEF'}),/dorsal/);f.command('match.start');
  f.command('fixture.save',{opponent:'Segundo rival',date:'2026-09-27T18:00:00Z',home:false,round:2,season:'2026/27'});
  const id=f.state.matches[1].id;f.command('match.lineup',{matchId:id,playerIds:[f.ids[0]]});assert.throws(()=>f.command('match.start',{matchId:id}),/otro partido/);
});
