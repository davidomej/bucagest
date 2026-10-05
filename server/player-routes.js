import {z} from 'zod';
import {AppError} from './domain.js';

export function installPlayerInvitations(app,store,{mailer,origin,production,limiter}) {
  const token=z.string().regex(/^[a-f0-9]{64}$/);
  app.post('/api/player-invitations/info',limiter,async(req,res)=>{
    if(store.demo)throw new AppError('Las invitaciones no están disponibles en la demo.',400);
    res.json(await store.invitationInfo(token.parse(req.body.token)));
  });
  app.post('/api/player-invitations/accept',limiter,async(req,res)=>{
    if(store.demo)throw new AppError('Las invitaciones no están disponibles en la demo.',400);
    const body=z.object({token,password:z.string().min(10).max(128)}).parse(req.body);
    await store.acceptInvitation(body.token,body.password);
    await store.logout(req.cookies.minuto_session);
    res.clearCookie('minuto_session',{httpOnly:true,secure:production,sameSite:'lax',path:'/'}).json({ok:true,message:'Invitación aceptada y correo verificado. Ya puedes iniciar sesión.'});
  });
  return async function sendInvitation(ownerId,teamId,playerId) {
    if(store.demo||!origin||!mailer.configured)throw new AppError('El envío de invitaciones no está disponible. Configura el correo para poder enviarlas.',503);
    const invitation=await store.invitePlayer(ownerId,teamId,playerId);
    if(!invitation)return {message:'Este jugador ya tiene acceso.'};
    try {await mailer.sendLink({...invitation,origin});}
    catch(error){await store.discardPlayerInvitation(invitation.token);throw error;}
    return {message:'Invitación enviada. El enlace caduca en 72 horas.'};
  };
}

export function installPlayerManagement(app,store,{sendInvitation,limiter,production}) {
  const target=z.object({teamId:z.uuid(),playerId:z.uuid()});
  app.get('/api/player-access/:teamId',async(req,res)=>{
    if(store.demo)return res.json({access:[]});
    res.json({access:await store.playerAccess(req.user.id,z.uuid().parse(req.params.teamId))});
  });
  app.post('/api/player-access/invite',limiter,async(req,res)=>{
    const {teamId,playerId}=target.parse(req.body);
    res.json(await sendInvitation(req.user.id,teamId,playerId));
  });
  app.post('/api/player-access/revoke',limiter,async(req,res)=>{
    if(store.demo)throw new AppError('Esta operación no está disponible en la demo.',400);
    const {teamId,playerId}=target.parse(req.body);
    await store.revokePlayerAccess(req.user.id,teamId,playerId);res.json({ok:true});
  });
  app.post('/api/player-data/export',limiter,async(req,res)=>{
    if(req.user.role!=='player')throw new AppError('Esta opción está disponible en el área de jugador.',403);
    const {password}=z.object({password:z.string().min(10).max(128)}).parse(req.body);
    await store.login({email:req.user.email,password});
    const portal=await store.playerPortal(req.user.id);
    res.set('Content-Disposition','attachment; filename="bucagest-datos-jugador.json"').json({exportedAt:new Date().toISOString(),account:{email:req.user.email},teams:portal.teams});
  });
  app.post('/api/player-data/delete-account',limiter,async(req,res)=>{
    if(req.user.role!=='player')throw new AppError('Esta opción está disponible en el área de jugador.',403);
    const {password}=z.object({password:z.string().min(10).max(128),confirmation:z.literal('ELIMINAR MI CUENTA')}).parse(req.body);
    await store.login({email:req.user.email,password});await store.deleteAccount(req.user.id);
    res.set('Clear-Site-Data','"cache"').clearCookie('minuto_session',{httpOnly:true,secure:production,sameSite:'lax',path:'/'}).json({ok:true});
  });
}
