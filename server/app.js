import express from 'express';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import { rateLimit } from 'express-rate-limit';
import { z } from 'zod';
import { AppError } from './domain.js';
import { installAuth } from './auth-routes.js';
import { installPrivacy, privacyNotice } from './privacy.js';
import { installBench } from './bench.js';

export function createApp(store, { production = false, origin = process.env.APP_ORIGIN, registrationAllowed = process.env.ALLOW_REGISTRATION !== 'false', mailer, providers } = {}) {
  const app = express(); app.disable('x-powered-by'); app.set('trust proxy',1);
  app.use(helmet({contentSecurityPolicy:production ? {directives:{'script-src':["'self'"],'style-src':["'self'","'unsafe-inline'"],'img-src':["'self'",'data:'],'connect-src':["'self'"],'font-src':["'self'"],'upgrade-insecure-requests':null}} : false}));
  const jsonParser = express.json({limit:'128kb'});
  app.use((req,res,next)=>{ if(req.path==='/api/assets' && req.method==='POST') return next(); jsonParser(req,res,next); }); app.use(cookieParser());
  const limiter = rateLimit({windowMs:15*60000,limit:15,standardHeaders:'draft-8',legacyHeaders:false, message:{error:'Demasiados intentos. Vuelve a intentarlo en unos minutos.'}});
  const assetTypes = { 'image/webp':'webp', 'image/jpeg':'jpg', 'image/png':'png' };
  const magicBytes = { webp: b=>b.length>12 && b.toString('ascii',0,4)==='RIFF' && b.toString('ascii',8,12)==='WEBP', jpg: b=>b.length>3 && b[0]===0xFF && b[1]===0xD8, png: b=>b.length>8 && b.toString('hex',0,8)==='89504e470d0a1a0a' };
  app.get('/api/health',async(req,res)=>{try {await store.health(); res.json({status:'ok'});} catch {res.status(503).json({status:'unavailable'});}});
  app.use('/api',(req,res,next)=>{
    res.set('Cache-Control','no-store');
    if(!['GET','HEAD','OPTIONS'].includes(req.method) && req.path!=='/auth/apple/callback') {
      const expected = origin || `${req.protocol}://${req.get('host')}`;
      if(req.get('origin') && req.get('origin')!==expected) return next(new AppError('Origen de solicitud no permitido.',403));
      if(req.path==='/assets') { if(!req.is(Object.keys(assetTypes))) return next(new AppError('Formato de imagen no admitido.',415)); }
      else if(!req.is('application/json')) return next(new AppError('Se requiere una solicitud JSON.',415));
    } next();
  });
  app.get('/api/privacy-notice',(req,res)=>res.json(privacyNotice()));
  installAuth(app,store,{production,origin,registrationAllowed,limiter,mailer,providers});
  app.use('/api',async(req,res,next)=>{const user=await store.session(req.cookies.minuto_session); if(!user) throw new AppError('Inicia sesión para acceder a tu equipo.',401); req.user=user; next();});
  app.use('/api',(req,res,next)=>{
    if(req.user.scope==='bench'&&!((req.method==='GET'&&req.path==='/bench')||(req.method==='POST'&&req.path==='/bench/substitution'))) throw new AppError('La tablet está limitada a las sustituciones de este partido. Inicia sesión como gestor para acceder.',403);
    next();
  });
  installBench(app,store,{production});
  const privacyLimiter=rateLimit({windowMs:15*60000,limit:10,standardHeaders:'draft-8',legacyHeaders:false,message:{error:'Demasiados intentos. Vuelve a intentarlo en unos minutos.'}});
  installPrivacy(app,store,{production,limiter:privacyLimiter});
  app.get('/api/team',async(req,res)=>res.json({workspace:await store.workspace(req.user.id),userId:req.user.id,serverNow:Date.now()}));
  app.post('/api/command',async(req,res)=>{
    const body=z.object({type:z.string().max(60),workspaceId:z.uuid(),teamId:z.uuid().optional(),revision:z.number().int().nonnegative(),operationId:z.uuid(),payload:z.record(z.string(),z.unknown()).default({})}).parse(req.body);
    if(body.type==='player.erase') throw new AppError('Elimina los datos desde Privacidad, confirmando tu contraseña.',403);
    res.json({workspace:await store.command(req.user.id,body),userId:req.user.id,serverNow:Date.now()});
  });
  app.post('/api/assets',express.raw({type:Object.keys(assetTypes),limit:'400kb'}),async(req,res)=>{
    const ext = assetTypes[req.get('content-type')?.split(';')[0]];
    if(!ext || !Buffer.isBuffer(req.body) || !req.body.length || !magicBytes[ext](req.body)) throw new AppError('Imagen no válida.',400);
    const id = await store.putAsset(req.user.id, req.get('content-type').split(';')[0], req.body);
    res.status(201).json({id});
  });
  app.get('/api/assets/:id',async(req,res)=>{
    const {id} = z.object({id:z.uuid()}).parse(req.params);
    const asset = await store.getAsset(req.user.id, id);
    if(!asset) return res.status(404).json({error:'Imagen no encontrada.'});
    res.set('Cache-Control','no-store').type(asset.mime).send(asset.bytes);
  });
  app.delete('/api/assets/:id',async(req,res)=>{
    const {id} = z.object({id:z.uuid()}).parse(req.params);
    await store.deleteAsset(req.user.id, id); res.json({ok:true});
  });
  app.use('/api',(req,res)=>res.status(404).json({error:'Ruta no encontrada.'}));
  return app;
}
export function errorHandler(error,req,res,next) {
  if(res.headersSent) return next(error);
  if(error instanceof z.ZodError) return res.status(400).json({error:'Revisa los campos del formulario. El formato o algún valor no es válido.'});
  if(error instanceof SyntaxError && error.status===400) return res.status(400).json({error:'Solicitud no válida.'});
  if(error instanceof AppError && error.status===503) return res.status(503).json({error:error.message});
  if(error.status && error.status<500) return res.status(error.status).json({error:error.message});
  console.error('Error en la solicitud:',error.name,error.code || 'internal');
  res.status(500).json({error:'No se pudo guardar. Comprueba la conexión y vuelve a intentarlo.'});
}
