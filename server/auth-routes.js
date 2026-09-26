import express from 'express';
import {randomBytes} from 'node:crypto';
import {z} from 'zod';
import {AppError} from './domain.js';
import {createMailer} from './mailer.js';
import {createProviders} from './oauth.js';

export function installAuth(app,store,{production,origin,registrationAllowed,limiter,mailer=createMailer(),providers=createProviders(process.env,origin)}){
  if(origin){const url=new URL(origin);if(url.origin!==origin||(!['http:','https:'].includes(url.protocol)))throw new Error('APP_ORIGIN debe ser el origen público sin ruta ni barra final.');}
  const cookies={httpOnly:true,secure:production,sameSite:'lax',path:'/',maxAge:30*86400000};
  const enabled=store.demo?[]:Object.keys(providers);
  const emailReady=Boolean(mailer.configured&&origin&&!store.demo);
  const sessionData=user=>({user,demo:store.demo,registrationAllowed,emailReady,providers:enabled});
  const emailSchema=z.email().trim().max(254).transform(s=>s.toLowerCase());
  const password=z.string().min(10).max(128);
  const tokenSchema=z.string().regex(/^[a-f0-9]{64}$/);
  const sent={ok:true,message:'Si el correo corresponde a una cuenta pendiente, recibirás un enlace. Revisa también la carpeta de spam.'};
  const requireEmail=()=>{if(!emailReady)throw new AppError('El envío de correos no está disponible. Contacta con el administrador.',503);};
  async function deliver(email,kind,browser=null){
    const issued=await store.emailToken(email,kind,browser);
    if(!issued)return false;
    try{await mailer.sendLink({...issued,kind,origin});}
    catch(error){await store.discardEmailToken(issued.token);throw error;}
    return true;
  }
  async function login(res,user){
    const token=await store.createSession(user.id);
    res.cookie('minuto_session',token,cookies);
    return sessionData({id:user.id,email:user.email,name:user.name});
  }
  app.get('/api/session',async(req,res)=>res.json(sessionData(await store.session(req.cookies.minuto_session))));
  app.post('/api/register',limiter,async(req,res)=>{
    if(store.demo||!registrationAllowed)throw new AppError('El registro no está disponible.',403);
    requireEmail();
    const body=z.object({email:emailSchema,name:z.string().trim().min(1).max(100),teamName:z.string().trim().min(1).max(100)}).parse(req.body);
    await store.register(body);await deliver(body.email,'verify');
    res.status(202).json(sent);
  });
  app.post('/api/login',limiter,async(req,res)=>{
    if(store.demo)throw new AppError('Estás en la demostración.',400);
    res.json(await login(res,await store.login(z.object({email:emailSchema,password}).parse(req.body))));
  });
  for(const [path,kind] of [['resend-verification','verify'],['forgot-password','reset']])app.post(`/api/auth/${path}`,limiter,async(req,res)=>{
    requireEmail();const {email}=z.object({email:emailSchema}).parse(req.body);await deliver(email,kind);
    res.json({ok:true,message:kind==='reset'?'Si existe una cuenta con ese correo, recibirás un enlace para elegir otra contraseña.':sent.message});
  });
  app.post('/api/auth/complete',limiter,async(req,res)=>{
    if(store.demo)throw new AppError('Estás en la demostración.',400);
    const body=z.object({token:tokenSchema,kind:z.enum(['verify','reset']),password}).parse(req.body);
    await store.completeEmail({...body,browser:req.cookies.bucagest_email_flow});
    // A link sets the password and verifies the address, but never silently switches accounts.
    await store.logout(req.cookies.minuto_session);
    res.clearCookie('minuto_session',{...cookies,maxAge:undefined}).json({ok:true,message:'Correo verificado y contraseña guardada. Ya puedes iniciar sesión.'});
  });
  app.post('/api/logout',async(req,res)=>{if(!store.demo)await store.logout(req.cookies.minuto_session);res.set('Clear-Site-Data','"cache"').clearCookie('minuto_session',{...cookies,maxAge:undefined}).json({ok:true});});
  const providerSchema=z.enum(['google','apple','facebook']);
  function providerFor(value){const id=providerSchema.parse(value);if(!enabled.includes(id))throw new AppError('Este método de acceso no está disponible.',404);return id;}
  const oauthCookies=id=>({httpOnly:true,secure:production||id==='apple',sameSite:id==='apple'?'none':'lax',path:'/api/auth',maxAge:10*60000});
  app.get('/api/auth/:provider/start',limiter,async(req,res)=>{
    const id=providerFor(req.params.provider);
    const state=randomBytes(32).toString('hex'),browser=randomBytes(32).toString('hex'),verifier=randomBytes(32).toString('base64url'),nonce=randomBytes(32).toString('hex');
    await store.beginOAuth(id,{state,browser,verifier,nonce});
    const url=await providers[id].authorize({state,verifier,nonce});
    res.cookie(`bucagest_oauth_${id}`,browser,oauthCookies(id)).redirect(303,url);
  });
  async function callback(req,res){
    let id;
    try{
      id=providerFor(req.params.provider);
      if(req.method==='POST'&&id!=='apple')throw new AppError('Respuesta no válida.',400);
      const input=req.method==='POST'?req.body:req.query;
      const state=tokenSchema.parse(input.state),browser=tokenSchema.parse(req.cookies[`bucagest_oauth_${id}`]);
      const flow=await store.consumeOAuth(id,state,browser);
      res.clearCookie(`bucagest_oauth_${id}`,{...oauthCookies(id),maxAge:undefined});
      if(input.error)throw new AppError('Has cancelado el acceso con el proveedor.',400);
      const identity=await providers[id].identity(z.string().min(1).max(4096).parse(input.code),flow);
      if(identity.provider!==id)throw new AppError('Proveedor no válido.',400);
      if(!identity.emailVerified)requireEmail();
      const user=await store.socialUser(identity,registrationAllowed);
      if(!user.email_verified_at){
        requireEmail();const browser=randomBytes(32).toString('hex');
        if(!await deliver(user.email,'verify',browser))throw new AppError('Ya se ha enviado un enlace recientemente. Usa ese correo en el mismo navegador o inténtalo más tarde.',429);
        res.cookie('bucagest_email_flow',browser,{...cookies,path:'/api/auth',maxAge:30*60000});
        return res.redirect(303,'/#auth=sent');
      }
      await login(res,user);res.redirect(303,'/');
    }catch(error){
      const message=error instanceof AppError?error.message:'No se pudo completar el acceso. Vuelve a intentarlo desde el botón del proveedor.';
      res.redirect(303,`/#auth-error=${encodeURIComponent(message)}`);
    }
  }
  app.get('/api/auth/:provider/callback',limiter,callback);
  app.post('/api/auth/apple/callback',limiter,express.urlencoded({extended:false,limit:'16kb'}),(req,res)=>{req.params.provider='apple';return callback(req,res);});
}
