import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {applyCommand,emptyWorkspace,normalizeWorkspace} from '../server/domain.js';

function setup(){
  let state=emptyWorkspace('Equipo cobros');
  const teamId=state.activeTeamId;
  const command=(type,payload)=>{state=applyCommand(state,{type,teamId,payload});return state;};
  command('player.save',{name:'Jugador Uno',number:7,position:'MED'});
  const playerId=state.teams[0].players[0].id;
  const set=(data={})=>command('payment.set',{playerId,season:'2026/27',field:'insurance',value:true,expectedValue:false,...data});
  return {command,set,playerId,teamId,get state(){return state;},get records(){return state.teams[0].payments;}};
}

test('cobros: temporadas independientes y uniforme pagado separado de entregado',()=>{
  const f=setup();f.set();f.set({field:'uniformPaid'});f.set({field:'month1'});f.set({field:'month12'});
  assert.equal(f.records[0].checks.uniformDelivered,undefined);
  f.set({season:'2027/28',field:'uniformDelivered'});
  assert.equal(f.records.length,2);
  assert.deepEqual(f.records[1].checks,{uniformDelivered:true});
  f.set({value:false,expectedValue:true});
  assert.equal(f.records[0].checks.insurance,false);
  assert.equal(f.records[0].checks.month1,true);
  assert.equal(f.records[0].checks.month12,true);
});
test('cobros: rechaza confirmar un estado que ha cambiado sin modificar los registros',()=>{
  const f=setup();f.set();const before=structuredClone(f.state);
  assert.throws(()=>f.set(),error=>error.status===409);
  assert.deepEqual(f.state,before);
  f.set({expectedValue:true,value:false});
  assert.throws(()=>f.set({expectedValue:true,value:false}),error=>error.status===409);
});
test('cobros: valida jugador, concepto, temporada y valores de las casillas',()=>{
  const f=setup();const before=structuredClone(f.state);
  for(const data of [{playerId:randomUUID()},{field:'month13'},{field:'__proto__'},{season:' '},{value:'true'},{expectedValue:undefined}])assert.throws(()=>f.set(data));
  assert.deepEqual(f.state,before);
  f.command('team.create',{name:'Otro equipo'});
  const other=f.state.activeTeamId;
  assert.throws(()=>applyCommand(f.state,{type:'payment.set',teamId:other,payload:{playerId:f.playerId,season:'2026/27',field:'insurance',value:true,expectedValue:false}}),/jugador/);
});
test('cobros: archivar o editar un jugador conserva su historial',()=>{
  const f=setup();f.set();
  f.command('player.save',{id:f.playerId,name:'Nuevo nombre',number:9,position:'DEF'});
  f.command('player.archive',{id:f.playerId});
  assert.equal(f.records[0].playerId,f.playerId);
  assert.equal(f.records[0].checks.insurance,true);
  f.set({value:false,expectedValue:true});
  assert.equal(f.records[0].checks.insurance,false);
});
test('cobros: equipos antiguos se normalizan sin perder los partidos',()=>{
  const f=setup();const old=structuredClone(f.state);delete old.teams[0].payments;
  const matches=structuredClone(old.teams[0].matches);
  assert.deepEqual(normalizeWorkspace(old).teams[0].payments,[]);
  assert.deepEqual(old.teams[0].matches,matches);
});
