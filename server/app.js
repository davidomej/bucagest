import express from 'express';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import { rateLimit } from 'express-rate-limit';
import { z } from 'zod';
import { AppError } from './domain.js';

export function createApp(store, { production = false, origin = process.env.APP_ORIGIN, registrationAllowed = process.env.ALLOW_REGISTRATION !== 'false' } = {}) {
  const app = express(); app.disable('x-powered-by'); app.set('trust proxy',1);
  app.use(helmet({contentSecurityPolicy:production ? {directives:{'script-src':["'self'"],'style-src':["'self'","'unsafe-inline'"],'img-src':["'self'",'data:'],'connect-src':["'self'"],'font-src':["'self'"],'upgrade-insecure-requests':null}} : false}));
  app.use(express.json({limit:'128kb'})); app.use(cookieParser());
  const cookieOptions = { httpOnly:true, secure:production, sameSite:'lax', path:'/', maxAge:30*86400000 };
  const limiter = rateLimit({windowMs:15*60000,limit:15,standardHeaders:'draft-8',legacyHeaders:false, message:{error:'Demasiados intentos. Vuelve a intentarlo en unos minutos.'}});
  app.get('/api/health',async(req,res)=>{try {await store.health(); res.json({status:'ok'});} catch {res.status(503).json({status:'unavailable'});}});
  app.use('/api',(req,res,next)=>{
    res.set('Cache-Control','no-store');
    if(!['GET','HEAD','OPTIONS'].includes(req.method)) {
      const expected = origin || `${req.protocol}://${req.get('host')}`;
      if(req.get('origin') && req.get('origin')!==expected) return next(new AppError('Origen de solicitud no permitido.',403));
      if(!req.is('application/json')) return next(new AppError('Se requiere una solicitud JSON.',415));
    } next();
  });
  app.get('/api/session',async(req,res)=>res.json({user:await store.session(req.cookies.minuto_session),demo:store.demo,registrationAllowed}));
  const authSchema = z.object({email:z.email().max(254).transform(s=>s.toLowerCase()),password:z.string().min(10).max(128)});
  app.post('/api/register',limiter,async(req,res)=>{
    if(store.demo || !registrationAllowed) throw new AppError('El registro no está disponible.',403);
    const body = authSchema.extend({name:z.string().trim().min(1).max(100),teamName:z.string().trim().min(1).max(100)}).parse(req.body);
    const user = await store.register(body), token = await store.createSession(user.id);
    res.cookie('minuto_session',token,cookieOptions).status(201).json({user,demo:false,registrationAllowed});
  });
  app.post('/api/login',limiter,async(req,res)=>{
    if(store.demo) throw new AppError('Estás en la demostración.',400);
    const user = await store.login(authSchema.parse(req.body)), token = await store.createSession(user.id);
    res.cookie('minuto_session',token,cookieOptions).json({user,demo:false,registrationAllowed});
  });
  app.post('/api/logout',async(req,res)=>{ if(!store.demo) await store.logout(req.cookies.minuto_session); res.clearCookie('minuto_session',{...cookieOptions,maxAge:undefined}).json({ok:true}); });
  app.use('/api',async(req,res,next)=>{const user=await store.session(req.cookies.minuto_session); if(!user) throw new AppError('Inicia sesión para acceder a tu equipo.',401); req.user=user; next();});
  app.get('/api/team',async(req,res)=>res.json({team:await store.team(req.user.id),userId:req.user.id,serverNow:Date.now()}));
  app.post('/api/command',async(req,res)=>{
    const body=z.object({type:z.string().max(60),teamId:z.uuid(),revision:z.number().int().nonnegative(),operationId:z.uuid(),payload:z.record(z.string(),z.unknown()).default({})}).parse(req.body);
    res.json({team:await store.command(req.user.id,body),userId:req.user.id,serverNow:Date.now()});
  });
  app.use('/api',(req,res)=>res.status(404).json({error:'Ruta no encontrada.'}));
  return app;
}
export function errorHandler(error,req,res,next) {
  if(res.headersSent) return next(error);
  if(error instanceof z.ZodError) return res.status(400).json({error:'Revisa los campos del formulario. El formato o algún valor no es válido.'});
  if(error instanceof SyntaxError && error.status===400) return res.status(400).json({error:'Solicitud no válida.'});
  if(error.status && error.status<500) return res.status(error.status).json({error:error.message});
  console.error('Error en la solicitud:',error.name,error.code || 'internal');
  res.status(500).json({error:'No se pudo guardar. Comprueba la conexión y vuelve a intentarlo.'});
}
