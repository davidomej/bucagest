import { z } from 'zod';
import { AppError } from './domain.js';
import { playerExport } from './privacy-store.js';

export function privacyNotice(env = process.env) {
  const fields = {
    operator:env.PRIVACY_OPERATOR||'', address:env.PRIVACY_ADDRESS||'', contact:env.PRIVACY_EMAIL||'',
    hosting:env.PRIVACY_HOSTING||'', providers:env.PRIVACY_PROVIDERS||'',
    retention:env.PRIVACY_RETENTION||'', transfers:env.PRIVACY_TRANSFERS||'',
  };
  return {version:'2026-09-26',configured:Object.values(fields).every(v=>v.trim())&&z.email().safeParse(fields.contact).success,...fields};
}

export function installPrivacy(app,store,{production,limiter}) {
  const password=z.string().min(10).max(128);
  const clear = res => res.set('Clear-Site-Data','"cache"').clearCookie('minuto_session',{path:'/',httpOnly:true,secure:production,sameSite:'lax'});
  async function reauthenticate(req) {
    if(store.demo) throw new AppError('Esta operación no está disponible en la demo.',400);
    const body=z.object({password}).parse(req.body);
    await store.login({email:req.user.email,password:body.password});
  }
  app.post('/api/privacy/export',limiter,async(req,res)=>{
    await reauthenticate(req);
    const {teamId,playerId}=z.object({teamId:z.uuid().optional(),playerId:z.uuid().optional()}).parse(req.body);
    if(Boolean(teamId)!==Boolean(playerId)) throw new AppError('Selecciona el equipo y el jugador.');
    const data=await store.exportAccount(req.user.id);
    const result=playerId?playerExport(data,teamId,playerId):data;
    if(!result) throw new AppError('No se encuentra el jugador.',404);
    res.set('Content-Disposition','attachment; filename="bucagest-datos.json"').json(result);
  });
  app.post('/api/privacy/erase-player',limiter,async(req,res)=>{
    await reauthenticate(req);
    const body=z.object({workspaceId:z.uuid(),teamId:z.uuid(),revision:z.number().int().nonnegative(),operationId:z.uuid(),playerId:z.uuid(),confirmation:z.literal('ELIMINAR')}).parse(req.body);
    const workspace=await store.command(req.user.id,{...body,type:'player.erase',payload:{id:body.playerId}});
    res.json({workspace,userId:req.user.id,serverNow:Date.now()});
  });
  app.post('/api/privacy/revoke-sessions',limiter,async(req,res)=>{
    await reauthenticate(req);await store.revokeSessions(req.user.id);clear(res).json({ok:true});
  });
  app.post('/api/privacy/delete-account',limiter,async(req,res)=>{
    z.object({confirmation:z.literal('ELIMINAR MI CUENTA')}).parse(req.body);
    await reauthenticate(req);await store.deleteAccount(req.user.id);clear(res).json({ok:true});
  });
}
