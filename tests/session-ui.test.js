import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {build} from 'esbuild';
import {JSDOM} from 'jsdom';
import {act,createElement} from 'react';
import {createRoot} from 'react-dom/client';
import {applyCommand,emptyWorkspace} from '../server/domain.js';
import {benchData} from '../server/bench.js';

const compiled=await build({entryPoints:['src/App.tsx'],bundle:true,packages:'external',format:'esm',platform:'node',write:false,jsx:'automatic'});
const dir=await mkdtemp(new URL('./.session-ui-',import.meta.url));
let App;
try{await writeFile(`${dir}/app.mjs`,compiled.outputFiles[0].text);App=(await import(pathToFileURL(`${dir}/app.mjs`))).default;}
finally{await rm(dir,{recursive:true,force:true});}
const account={user:{id:'account-a',name:'Gestor A',email:'a@example.test'},demo:false,registrationAllowed:true,emailReady:true,providers:[]};
const workspace=emptyWorkspace('Equipo privado A');
const deferred=()=>{let resolve;const promise=new Promise(r=>{resolve=r;});return {promise,resolve};};

async function mount(t,{hash='',handle,broadcast=true}={}){
  const dom=new JSDOM('<div id="root"></div>',{url:`http://localhost/${hash}`,pretendToBeVisual:true});
  dom.window.scrollTo=()=>{};
  dom.window.HTMLDialogElement.prototype.showModal=function(){this.open=true;};
  dom.window.HTMLDialogElement.prototype.close=function(){this.open=false;};
  const saved=new Map();
  function global(name,value){saved.set(name,Object.getOwnPropertyDescriptor(globalThis,name));Object.defineProperty(globalThis,name,{value,configurable:true,writable:true});}
  for(const name of ['window','document','location','history','navigator','FormData','CustomEvent','localStorage'])global(name,dom.window[name]);
  global('IS_REACT_ACT_ENVIRONMENT',true);
  const channels=[];
  global('BroadcastChannel',broadcast?class {constructor(){channels.push(this);}messages=[];postMessage(message){this.messages.push(message);for(const channel of channels)if(channel!==this&&!channel.closed)queueMicrotask(()=>{if(!channel.closed)channel.onmessage?.({data:message});});}closed=false;close(){this.closed=true;}onmessage=null;}:undefined);
  const calls=[];
  global('fetch',async(url,options)=>{
    const path=url.replace('/api/','');calls.push(path);
    const data=await handle?.(path,options)??(path==='session'?account:path==='team'?{workspace,userId:account.user.id,serverNow:Date.now()}:{ok:true});
    return {ok:true,json:async()=>data};
  });
  const root=createRoot(document.getElementById('root'));
  t.after(async()=>{await act(()=>root.unmount());dom.window.close();for(const [name,descriptor] of saved)if(descriptor)Object.defineProperty(globalThis,name,descriptor);else delete globalThis[name];});
  await act(async()=>{root.render(createElement(App));});
  return {calls,channels,dom};
}

test('abrir un enlace de verificación con sesión previa la cierra sin cargar su equipo',async t=>{
  const h=await mount(t,{hash:'#auth=verify&token='+'a'.repeat(64)});
  assert.ok(h.calls.includes('logout'),'debe revocar la sesión anterior al abrir el enlace');
  assert.ok(!h.calls.includes('team'),'no debe cargar datos del equipo anterior detrás del formulario');
  assert.match(document.body.textContent,/Confirma tu correo/);
  assert.doesNotMatch(document.body.textContent,/Equipo privado A/);
});

test('un cambio de sesión en otra pestaña retira los datos y descarta respuestas antiguas',async t=>{
  const pending=deferred();let sessions=0;
  const h=await mount(t,{handle:path=>path==='session'&&++sessions>1?pending.promise:undefined});
  assert.match(document.body.textContent,/Equipo privado A/);
  assert.ok(h.channels.length,'debe escuchar los cambios de sesión del navegador');
  await act(async()=>{h.channels[0].onmessage({data:{type:'changed',source:'other-tab'}});});
  assert.doesNotMatch(document.body.textContent,/Equipo privado A/);
  await act(async()=>{pending.resolve({...account,user:null});});
  assert.match(document.body.textContent,/Tu equipo te espera/);
  assert.doesNotMatch(document.body.textContent,/Equipo privado A/);
});

test('una respuesta de equipo pendiente no reaparece después del cierre de sesión',async t=>{
  const pending=deferred();let signedOut=false;
  const h=await mount(t,{handle:path=>path==='team'?pending.promise:path==='session'&&signedOut?{...account,user:null}:undefined});
  assert.ok(h.calls.includes('team'));
  signedOut=true;
  await act(async()=>{h.channels[0].onmessage({data:{type:'changed',source:'other-tab'}});});
  await act(async()=>{pending.resolve({workspace,userId:account.user.id,serverNow:Date.now()});});
  assert.match(document.body.textContent,/Tu equipo te espera/);
  assert.doesNotMatch(document.body.textContent,/Equipo privado A/);
});

test('una consulta de sesión antigua no restaura la cuenta anterior',async t=>{
  const pending=deferred();let sessions=0;
  const h=await mount(t,{handle:path=>path==='session'?(++sessions===1?pending.promise:{...account,user:null}):undefined});
  await act(async()=>{h.channels[0].onmessage({data:{type:'changed',source:'other-tab'}});});
  await act(async()=>{pending.resolve(account);});
  assert.match(document.body.textContent,/Tu equipo te espera/);
  assert.ok(!h.calls.includes('team'));
});

test('la cuenta nueva carga aunque siga pendiente la petición de equipo anterior',async t=>{
  const pending=deferred(),other={...account,user:{...account.user,id:'account-b',email:'b@example.test'}};
  const otherWorkspace=emptyWorkspace('Equipo nuevo B');let switched=false;
  const h=await mount(t,{handle:path=>path==='session'?switched?other:account:path==='team'?switched?{workspace:otherWorkspace,userId:other.user.id,serverNow:Date.now()}:pending.promise:undefined});
  switched=true;
  await act(async()=>{h.channels[0].onmessage({data:{type:'changed',source:'other-tab'}});});
  assert.match(document.body.textContent,/Equipo nuevo B/);
  await act(async()=>{pending.resolve({workspace,userId:account.user.id,serverNow:Date.now()});});
  assert.match(document.body.textContent,/Equipo nuevo B/);
  assert.doesNotMatch(document.body.textContent,/Equipo privado A/);
});

test('abrir un enlace en una pestaña ya cargada retira el equipo y avisa a las demás',async t=>{
  const h=await mount(t);
  await act(async()=>{
    history.replaceState(null,'','#auth=reset&token='+'b'.repeat(64));
    window.dispatchEvent(new h.dom.window.HashChangeEvent('hashchange'));
  });
  assert.match(document.body.textContent,/Una nueva contraseña/);
  assert.doesNotMatch(document.body.textContent,/Equipo privado A/);
  assert.equal(h.calls.filter(path=>path==='team').length,1);
  assert.ok(h.channels.some(channel=>channel.messages.some(message=>message.type==='changed')));
});

test('si falla el cierre de sesión, no permite continuar hasta reintentarlo',async t=>{
  let failed=true;
  const h=await mount(t,{hash:'#auth=verify&token='+'a'.repeat(64),handle:path=>{if(path==='logout'&&failed)throw new Error('Sin conexión');}});
  assert.ok(!h.calls.includes('team'));
  assert.match(document.body.textContent,/No se puede conectar/);
  assert.equal(document.querySelector('input[type=password]'),null);
  failed=false;
  await act(async()=>{document.querySelector('button').click();});
  assert.match(document.body.textContent,/Confirma tu correo/);
  assert.ok(!h.calls.includes('team'));
});

test('los eventos de almacenamiento sincronizan navegadores sin BroadcastChannel',async t=>{
  let signedOut=false;
  const h=await mount(t,{broadcast:false,handle:path=>path==='session'&&signedOut?{...account,user:null}:undefined});
  signedOut=true;
  await act(async()=>{window.dispatchEvent(new h.dom.window.StorageEvent('storage',{key:'minuto-session-changed',newValue:'changed'}));});
  assert.match(document.body.textContent,/Tu equipo te espera/);
  assert.doesNotMatch(document.body.textContent,/Equipo privado A/);
});

test('verificar y entrar con la cuenta nueva nunca muestra el equipo anterior',async t=>{
  const other={...account,user:{...account.user,id:'account-b',email:'b@example.test'}};
  const otherWorkspace=emptyWorkspace('Equipo nuevo B');let current=account;
  const h=await mount(t,{hash:'#auth=verify&token='+'a'.repeat(64),handle:path=>{
    if(path==='logout'){current={...account,user:null};return {ok:true};}
    if(path==='session')return current;
    if(path==='auth/complete')return {ok:true,message:'Ya puedes iniciar sesión.'};
    if(path==='login'){current=other;return other;}
    if(path==='team')return {workspace:otherWorkspace,userId:other.user.id,serverNow:Date.now()};
  }});
  document.querySelector('[name=password]').value='Password-test-2026';
  document.querySelector('[name=confirmPassword]').value='Password-test-2026';
  await act(async()=>{document.querySelector('form').dispatchEvent(new h.dom.window.Event('submit',{bubbles:true,cancelable:true}));});
  assert.match(document.body.textContent,/Tu equipo te espera/);assert.ok(!h.calls.includes('team'));
  document.querySelector('[name=email]').value=other.user.email;
  document.querySelector('[name=password]').value='Password-test-2026';
  await act(async()=>{document.querySelector('form').dispatchEvent(new h.dom.window.Event('submit',{bubbles:true,cancelable:true}));});
  assert.match(document.body.textContent,/Equipo nuevo B/);
  assert.doesNotMatch(document.body.textContent,/Equipo privado A/);
  assert.equal(h.channels.filter(channel=>channel.messages.some(message=>message.type==='changed')).length,3);
});

test('volver a la pestaña detecta cambios de cuenta aunque se haya perdido el aviso',async t=>{
  let signedOut=false;
  await mount(t,{handle:path=>path==='session'&&signedOut?{...account,user:null}:undefined});
  signedOut=true;
  await act(async()=>{window.dispatchEvent(new window.Event('focus'));});
  assert.match(document.body.textContent,/Tu equipo te espera/);
  assert.doesNotMatch(document.body.textContent,/Equipo privado A/);
});

test('un login pendiente no restaura la cuenta si otra pestaña ha cambiado la sesión',async t=>{
  const pending=deferred();
  const h=await mount(t,{handle:path=>path==='session'?{...account,user:null}:path==='login'?pending.promise:undefined});
  document.querySelector('[name=email]').value=account.user.email;
  document.querySelector('[name=password]').value='Password-test-2026';
  await act(async()=>{document.querySelector('form').dispatchEvent(new h.dom.window.Event('submit',{bubbles:true,cancelable:true}));});
  await act(async()=>{h.channels[0].onmessage({data:{type:'changed',source:'other-tab'}});});
  await act(async()=>{pending.resolve(account);});
  assert.match(document.body.textContent,/Tu equipo te espera/);
  assert.ok(!h.calls.includes('team'));
});

function matchWorkspace(){
  let state=emptyWorkspace('Equipo banquillo');
  const command=(type,payload)=>{state=applyCommand(state,{type,teamId:state.activeTeamId,payload});};
  command('player.save',{name:'Titular',number:1,position:'POR'});
  command('player.save',{name:'Suplente',number:2,position:'DEF'});
  command('fixture.save',{opponent:'Rival',date:'2026-09-26T18:00:00Z',home:true,round:1,season:'2026/27'});
  const team=state.teams[0],matchId=team.matches[0].id;
  command('match.lineup',{matchId,playerIds:[team.players[0].id]});
  command('match.start',{matchId});
  const user={...account.user,scope:'bench',benchTeamId:team.id,benchMatchId:matchId};
  return {state,user};
}

test('activar banquillo abre las sustituciones sin recargar ni pedir login y permite guardar un cambio',async t=>{
  let {state,user}=matchWorkspace(),current=account;
  const activation=deferred();let substitution;
  const h=await mount(t,{handle:async(path,options)=>{
    if(path==='session')return current;
    if(path==='team')return {workspace:state,userId:account.user.id,serverNow:Date.now()};
    if(path==='bench/start'){
      assert.deepEqual(JSON.parse(options.body),{teamId:user.benchTeamId,matchId:user.benchMatchId});
      await activation.promise;current={...account,user};return {ok:true};
    }
    if(path==='bench')return benchData(state,user);
    if(path==='bench/substitution'){
      substitution=JSON.parse(options.body);
      assert.equal(substitution.workspaceId,state.id);assert.equal(substitution.revision,state.revision);
      state=applyCommand(state,{type:'match.substitute',teamId:user.benchTeamId,payload:{matchId:user.benchMatchId,...substitution}});
      return benchData(state,user);
    }
    if(path==='logout'){current={...account,user:null};return {ok:true};}
  }});
  const click=async label=>{const button=[...document.querySelectorAll('button')].find(b=>b.textContent.trim()===label);assert.ok(button,label);assert.equal(button.disabled,false);await act(async()=>button.click());};
  await click('Privacidad');
  await click('Activar modo banquillo');
  await act(async()=>document.querySelector('dialog form').dispatchEvent(new h.dom.window.Event('submit',{bubbles:true,cancelable:true})));
  // A focus check can happen while the server is replacing the session cookie.
  await act(async()=>window.dispatchEvent(new window.Event('focus')));
  await act(async()=>activation.resolve());
  assert.match(document.body.textContent,/¿Sales del campo\?/);
  assert.equal(document.querySelector('input[type=password]'),null);
  assert.equal(document.querySelector('nav'),null);
  assert.equal(h.calls.filter(path=>path==='team').length,1);
  assert.ok(h.channels.some(channel=>channel.messages.some(message=>message.type==='changed')));
  await click('Sustituir');
  const incoming=document.querySelector('[aria-label="Entró Suplente, dorsal 2"]');assert.ok(incoming);
  await act(async()=>incoming.click());
  assert.equal(substitution.outId,state.teams[0].players[0].id);
  assert.equal(substitution.inId,state.teams[0].players[1].id);
  assert.match(document.querySelector('.bench-players').textContent,/Suplente/);
  assert.doesNotMatch(document.querySelector('.bench-players').textContent,/Titular/);
  await click('Salir e iniciar sesión como gestor');
  assert.match(document.body.textContent,/Tu equipo te espera/);
});

test('recargar una sesión de banquillo abre directamente el partido sin consultar datos de gestión',async t=>{
  const {state,user}=matchWorkspace();
  const h=await mount(t,{handle:path=>path==='session'?{...account,user}:path==='bench'?benchData(state,user):undefined});
  assert.match(document.body.textContent,/¿Sales del campo\?/);
  assert.match(document.querySelector('.bench-players').textContent,/Titular/);
  assert.ok(!h.calls.includes('team'));
});

test('otra pestaña que pasa a banquillo descarta las respuestas de gestión pendientes',async t=>{
  const {state,user}=matchWorkspace(),pending=deferred();let switched=false;
  const h=await mount(t,{handle:path=>path==='session'?switched?{...account,user}:account:path==='team'?pending.promise:path==='bench'?benchData(state,user):undefined});
  switched=true;
  await act(async()=>h.channels[0].onmessage({data:{type:'changed',source:'other-tab'}}));
  assert.match(document.body.textContent,/¿Sales del campo\?/);
  await act(async()=>pending.resolve({workspace:state,userId:account.user.id,serverNow:Date.now()}));
  assert.equal(document.querySelector('nav'),null);
  assert.match(document.body.textContent,/¿Sales del campo\?/);
  assert.equal(h.calls.filter(path=>path==='team').length,1);
});
