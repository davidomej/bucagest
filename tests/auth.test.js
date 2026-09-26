import test from 'node:test';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {randomBytes,randomUUID} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';
import {generateKeyPair,SignJWT} from 'jose';
import {createStore} from '../server/store.js';
import {createApp,errorHandler} from '../server/app.js';
import {createProviders,verifyIdentityToken} from '../server/oauth.js';
import {createMailer} from '../server/mailer.js';

async function harness(t,options={}){
  const db=new PGlite();let tail=Promise.resolve();
  const pool={query:(sql,args)=>!args&&sql.includes('CREATE TABLE')?db.exec(sql).then(()=>({rows:[]})):db.query(sql,args),
    async connect(){let release;const next=new Promise(r=>{release=r;});const previous=tail;tail=next;await previous;return {query:(sql,args)=>db.query(sql,args),release};},end:()=>db.close()};
  const store=await createStore({pool});const emails=[];
  const mailer={configured:true,sendLink:async msg=>emails.push(msg)};
  const app=createApp(store,{origin:'http://localhost:3000',mailer,providers:{},...options});app.use(errorHandler);
  const server=app.listen(0,'127.0.0.1');await once(server,'listening');
  const base=`http://127.0.0.1:${server.address().port}`;
  t.after(async()=>{await new Promise(r=>server.close(r));await store.close();});
  async function req(path,{body,cookie,form,origin}={}){
    const response=await fetch(base+'/api/'+path,{redirect:'manual',method:body||form?'POST':'GET',headers:{...(body?{'Content-Type':'application/json'}:{}),...(form?{'Content-Type':'application/x-www-form-urlencoded'}:{}),...(cookie?{Cookie:cookie}:{}),...(origin?{Origin:origin}:{})},body:body?JSON.stringify(body):form?new URLSearchParams(form):undefined});
    const cookies=response.headers.getSetCookie();
    return {status:response.status,data:response.headers.get('content-type')?.includes('json')?await response.json():null,location:response.headers.get('location'),cookies,cookie:cookies.find(c=>c.startsWith('minuto_session='))?.split(';')[0]};
  }
  const email='person@example.test',password='Password-test-2026';
  async function signup(){return req('register',{body:{email,name:'Entrenador',teamName:'Mi equipo'}});}
  return {store,pool,emails,req,email,password,signup};
}

test('registro: no entrega sesión ni datos; solo se entra después de confirmar el correo',async t=>{
  const h=await harness(t);const registered=await h.signup();
  assert.equal(registered.status,202);assert.equal(registered.cookie,undefined);assert.equal(registered.data.user,undefined);assert.equal(registered.data.token,undefined);
  assert.equal((await h.req('team')).status,401);
  assert.equal((await h.req('login',{body:{email:h.email,password:h.password}})).status,401);
  const user=(await h.pool.query('SELECT id FROM minuto_users WHERE email=$1',[h.email])).rows[0];
  await assert.rejects(h.store.createSession(user.id),error=>error.status===403);
  const token=h.emails[0].token;
  assert.notEqual((await h.pool.query('SELECT token_hash FROM minuto_email_tokens')).rows[0].token_hash,token);
  assert.equal((await h.req('auth/complete',{body:{token,kind:'reset',password:h.password}})).status,400);
  assert.equal((await h.req('auth/complete',{body:{token,kind:'verify',password:h.password}})).status,200);
  assert.equal((await h.req('auth/complete',{body:{token,kind:'verify',password:h.password}})).status,400);
  const login=await h.req('login',{body:{email:h.email,password:h.password}});assert.equal(login.status,200);assert.ok(login.cookie);
  assert.equal((await h.req('team',{cookie:login.cookie})).status,200);
});
test('verificar otra cuenta con una sesión abierta la revoca y mantiene los equipos separados',async t=>{
  const h=await harness(t);await h.signup();
  await h.req('auth/complete',{body:{token:h.emails[0].token,kind:'verify',password:h.password}});
  const first=await h.req('login',{body:{email:h.email,password:h.password}});
  let original=(await h.req('team',{cookie:first.cookie})).data.workspace;
  original=await h.store.command(first.data.user.id,{type:'player.save',workspaceId:original.id,teamId:original.activeTeamId,revision:original.revision,operationId:randomUUID(),payload:{name:'Jugador privado A',number:7,position:'MED'}});
  const asset=await h.store.putAsset(first.data.user.id,'image/png',Buffer.from('imagen privada de prueba'));
  const secondEmail='second@example.test';
  await h.req('register',{body:{email:secondEmail,name:'Segundo gestor',teamName:'Equipo nuevo'}});
  const completed=await h.req('auth/complete',{cookie:first.cookie,body:{token:h.emails.at(-1).token,kind:'verify',password:h.password}});
  assert.equal(completed.status,200);assert.equal(completed.cookie,'minuto_session=');
  assert.equal((await h.req('session',{cookie:first.cookie})).data.user,null);
  assert.equal((await h.req('team',{cookie:first.cookie})).status,401);
  const second=await h.req('login',{body:{email:secondEmail,password:h.password}});
  assert.equal(second.status,200);assert.notEqual(second.data.user.id,first.data.user.id);
  const fresh=(await h.req('team',{cookie:second.cookie})).data.workspace;
  assert.notEqual(fresh.id,original.id);assert.equal(fresh.teams[0].settings.name,'Equipo nuevo');
  assert.deepEqual(fresh.teams[0].players,[]);assert.equal(fresh.teams[0].settings.crestId,null);
  assert.equal((await h.req(`assets/${asset}`,{cookie:second.cookie})).status,404);
  const wrongTeam=await h.req('command',{cookie:second.cookie,body:{type:'player.save',workspaceId:original.id,teamId:original.activeTeamId,revision:original.revision,operationId:randomUUID(),payload:{name:'No permitido',number:9,position:'DEF'}}});
  assert.equal(wrongTeam.status,409);
  const firstAgain=await h.req('login',{body:{email:h.email,password:h.password}});
  assert.deepEqual((await h.req('team',{cookie:firstAgain.cookie})).data.workspace,original);
});

test('enlaces: caducidad, reenvío sin enumeración y limitación por correo',async t=>{
  const h=await harness(t);await h.signup();
  const resend=await h.req('auth/resend-verification',{body:{email:h.email}});
  const unknown=await h.req('auth/resend-verification',{body:{email:'unknown@example.test'}});
  assert.deepEqual(resend.data,unknown.data);assert.equal(h.emails.length,1);
  await h.pool.query("UPDATE minuto_email_tokens SET expires_at=NOW()-INTERVAL '1 minute'");
  assert.equal((await h.req('auth/complete',{body:{token:h.emails[0].token,kind:'verify',password:h.password}})).status,400);
  assert.equal((await h.req('team')).status,401);
  await h.pool.query("UPDATE minuto_email_tokens SET created_at=NOW()-INTERVAL '2 minutes'");
  await h.req('auth/resend-verification',{body:{email:h.email}});assert.equal(h.emails.length,2);
  assert.equal((await h.req('auth/complete',{body:{token:h.emails[1].token,kind:'verify',password:h.password}})).status,200);
});
test('recuperación: cambia contraseña y revoca sesiones y enlaces anteriores',async t=>{
  const h=await harness(t);await h.signup();await h.store.completeEmail({token:h.emails[0].token,kind:'verify',password:h.password});
  const previous=await h.req('login',{body:{email:h.email,password:h.password}});
  const known=await h.req('auth/forgot-password',{body:{email:h.email}}),unknown=await h.req('auth/forgot-password',{body:{email:'nobody@example.test'}});assert.deepEqual(known.data,unknown.data);
  const reset=h.emails.at(-1);assert.equal(reset.kind,'reset');
  assert.equal((await h.req('auth/complete',{body:{token:reset.token,kind:'reset',password:'New-password-2026'}})).status,200);
  assert.equal((await h.req('team',{cookie:previous.cookie})).status,401);
  assert.equal((await h.req('login',{body:{email:h.email,password:h.password}})).status,401);
  assert.equal((await h.req('login',{body:{email:h.email,password:'New-password-2026'}})).status,200);
  assert.equal((await h.pool.query('SELECT * FROM minuto_email_tokens')).rows.length,0);
});
test('cuentas anteriores sin verificar pierden acceso pero conservan los datos',async t=>{
  const h=await harness(t,{registrationAllowed:false});
  await h.store.register({email:h.email,name:'Existente',teamName:'Equipo conservado'});
  const issued=await h.store.emailToken(h.email,'verify');const user=await h.store.completeEmail({...issued,kind:'verify',password:h.password});
  const token=await h.store.createSession(user.id);
  await h.pool.query('UPDATE minuto_users SET email_verified_at=NULL WHERE id=$1',[user.id]);
  assert.equal(await h.store.session(token),null);
  await assert.rejects(h.store.login({email:h.email,password:h.password}),error=>error.status===403);
  assert.equal((await h.signup()).status,403);
  assert.equal((await h.req('auth/resend-verification',{body:{email:h.email}})).status,200);
  await h.store.completeEmail({token:h.emails[0].token,kind:'verify',password:h.password});
  assert.equal((await h.store.workspace(user.id)).teams[0].settings.name,'Equipo conservado');
});
test('identidades: no vincula por coincidencia de correo y exige verificar Facebook',async t=>{
  const h=await harness(t);await h.store.register({email:h.email,name:'Local',teamName:'Privado'});
  await assert.rejects(h.store.socialUser({provider:'google',subject:'google1',email:h.email,emailVerified:true},true),error=>error.status===409);
  const user=await h.store.socialUser({provider:'facebook',subject:'fb1',email:'fb@example.test',emailVerified:false},true);
  await assert.rejects(h.store.createSession(user.id),error=>error.status===403);
  const browser='browser-proof';const link=await h.store.emailToken(user.email,'verify',browser);
  await assert.rejects(h.store.completeEmail({...link,kind:'verify',password:h.password}),/navegador/);
  await h.store.completeEmail({...link,kind:'verify',password:h.password,browser});
  const returning=await h.store.socialUser({provider:'facebook',subject:'fb1',email:null,emailVerified:false},false);
  assert.equal(returning.id,user.id);assert.ok(returning.email_verified_at);assert.ok(await h.store.createSession(user.id));
  await assert.rejects(h.store.socialUser({provider:'google',subject:'new',email:'new@example.test',emailVerified:true},false),error=>error.status===403);
});
test('recuperar un correo no verificado elimina identidades previamente adjuntadas',async t=>{
  const h=await harness(t);
  const user=await h.store.socialUser({provider:'facebook',subject:'untrusted-subject',email:h.email,emailVerified:false},true);
  const link=await h.store.emailToken(h.email,'reset');
  await h.store.completeEmail({...link,kind:'reset',password:h.password});
  assert.equal((await h.pool.query('SELECT * FROM minuto_identities WHERE user_id=$1',[user.id])).rows.length,0);
  await assert.rejects(h.store.socialUser({provider:'facebook',subject:'untrusted-subject',email:h.email,emailVerified:false},true),error=>error.status===409);
});
test('OAuth: estado ligado al navegador, de un uso; callback forjado no inicia sesión',async t=>{
  let calls=0;
  const h=await harness(t,{providers:{google:{authorize:async({state})=>`https://provider.example/authorize?state=${state}`,identity:async()=>{calls++;return {provider:'google',subject:'subject1',email:'google@example.test',emailVerified:true,name:'Google User'};}}}});
  const started=await h.req('auth/google/start');assert.equal(started.status,303);
  const state=new URL(started.location).searchParams.get('state'),cookie=started.cookies[0].split(';')[0];
  const forged=await h.req(`auth/google/callback?state=${state}&code=test`);assert.equal(forged.cookie,undefined);assert.match(forged.location,/auth-error/);assert.equal(calls,0);
  const callback=await h.req(`auth/google/callback?state=${state}&code=test`,{cookie});assert.equal(callback.location,'/');assert.ok(callback.cookie);assert.equal(calls,1);
  const replay=await h.req(`auth/google/callback?state=${state}&code=test`,{cookie});assert.equal(replay.cookie,undefined);assert.equal(calls,1);
  assert.equal((await h.req('team',{cookie:callback.cookie})).status,200);
});
test('Apple: callback form_post admite solo estado y cookie válidos',async t=>{
  const h=await harness(t,{production:true,origin:'https://bucagest.example',providers:{apple:{authorize:async({state})=>`https://appleid.apple.com/auth/authorize?state=${state}`,identity:async()=>({provider:'apple',subject:'apple1',email:'apple@example.test',emailVerified:true,name:'Apple User'})}}});
  const start=await h.req('auth/apple/start'),state=new URL(start.location).searchParams.get('state'),cookie=start.cookies[0].split(';')[0];
  assert.match(start.cookies[0],/Secure/);assert.match(start.cookies[0],/SameSite=None/);
  const result=await h.req('auth/apple/callback',{cookie,origin:'https://appleid.apple.com',form:{state,code:'apple-code'}});
  assert.equal(result.location,'/');assert.ok(result.cookie);assert.match(result.cookies.join(','),/SameSite=Lax/);
});
test('OIDC: firma, emisor, audiencia, caducidad y nonce se verifican',async()=>{
  const {publicKey,privateKey}=await generateKeyPair('RS256');
  const opts={provider:'google',clientId:'client',nonce:'nonce',keys:publicKey};
  const sign=(overrides={})=>new SignJWT({sub:'user',iss:'https://accounts.google.com',aud:'client',nonce:'nonce',iat:Math.floor(Date.now()/1000),exp:Math.floor(Date.now()/1000)+60,...overrides}).setProtectedHeader({alg:'RS256'}).sign(privateKey);
  assert.equal((await verifyIdentityToken(await sign(),opts)).sub,'user');
  for(const claims of [{nonce:'wrong'},{aud:'wrong'},{iss:'wrong'},{exp:1},{azp:'other-client'}])await assert.rejects(verifyIdentityToken(await sign(claims),opts));
  const other=await generateKeyPair('RS256');await assert.rejects(verifyIdentityToken(await sign(),{...opts,keys:other.publicKey}));
});
test('configuración: oculta proveedores incompletos y no habilita registro sin correo',async t=>{
  assert.deepEqual(createProviders({},'https://bucagest.example'),{});
  const google=createProviders({GOOGLE_CLIENT_ID:'client',GOOGLE_CLIENT_SECRET:'secret'},'https://bucagest.example');
  const url=new URL(await google.google.authorize({state:'state',nonce:'nonce',verifier:randomBytes(32).toString('base64url')}));assert.equal(url.searchParams.get('code_challenge_method'),'S256');assert.equal(url.searchParams.get('nonce'),'nonce');assert.equal(url.searchParams.has('client_secret'),false);
  const h=await harness(t,{mailer:{configured:false}});assert.equal((await h.signup()).status,503);assert.equal((await h.req('session')).data.emailReady,false);
  assert.equal((await h.pool.query('SELECT * FROM minuto_users')).rows.length,0);
});
test('correo: enlaces en fragmento, caducidad e identidad del remitente configurada',async()=>{
  let sent;
  const mailer=createMailer({RESEND_API_KEY:'test-key',AUTH_EMAIL_FROM:'BucaGest <auth@example.test>'},async(url,options)=>{sent={url,options};return {ok:true};});
  await mailer.sendLink({email:'person@example.test',token:'a'.repeat(64),kind:'verify',origin:'https://bucagest.example'});
  const body=JSON.parse(sent.options.body);assert.equal(body.from,'BucaGest <auth@example.test>');assert.match(body.text,/#auth=verify&token=/);assert.match(body.text,/30 minutos/);assert.ok(sent.options.headers['Idempotency-Key']);
});
