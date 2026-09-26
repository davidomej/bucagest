import { z } from 'zod';
import { AppError } from './domain.js';

export function benchData(workspace,user) {
  const team=workspace.teams.find(t=>t.id===user.benchTeamId),match=team?.matches.find(m=>m.id===user.benchMatchId);
  if(!team||!match) throw new AppError('Este partido ya no está disponible. Pide al gestor que prepare la tablet.',404);
  return {
    workspaceId:workspace.id,revision:workspace.revision,teamId:team.id,teamName:team.settings.name,colors:team.settings.colors,allowReentry:team.settings.allowReentry,
    players:team.players.filter(p=>!p.archived).map(p=>({id:p.id,name:p.name,number:p.number,position:p.position,archived:false,birthdate:null,photoId:null})),
    match:{id:match.id,opponent:match.opponent,status:match.status,elapsedSeconds:match.elapsedSeconds,runningSince:match.runningSince,stints:match.stints},
    serverNow:Date.now(),
  };
}

export function installBench(app,store,{production}) {
  app.post('/api/bench/start',async(req,res)=>{
    if(store.demo) throw new AppError('El modo banquillo requiere una cuenta real.',400);
    const {teamId,matchId}=z.object({teamId:z.uuid(),matchId:z.uuid()}).parse(req.body);
    const workspace=await store.workspace(req.user.id);
    const match=workspace.teams.find(t=>t.id===teamId)?.matches.find(m=>m.id===matchId);
    if(!match||!['live','paused'].includes(match.status)) throw new AppError('Inicia un partido antes de preparar el modo banquillo.');
    const token=await store.createSession(req.user.id,{teamId,matchId});
    await store.logout(req.cookies.minuto_session);
    res.set('Clear-Site-Data','"cache"').cookie('minuto_session',token,{httpOnly:true,secure:production,sameSite:'lax',path:'/',maxAge:4*60*60*1000}).json({ok:true});
  });
  app.get('/api/bench',async(req,res)=>{
    if(req.user.scope!=='bench') throw new AppError('Primero activa el modo banquillo.',403);
    res.json(benchData(await store.workspace(req.user.id),req.user));
  });
  app.post('/api/bench/substitution',async(req,res)=>{
    if(req.user.scope!=='bench') throw new AppError('Primero activa el modo banquillo.',403);
    const body=z.object({workspaceId:z.uuid(),revision:z.number().int().nonnegative(),operationId:z.uuid(),outId:z.uuid(),inId:z.uuid()}).strict().parse(req.body);
    const workspace=await store.command(req.user.id,{...body,type:'match.substitute',teamId:req.user.benchTeamId,payload:{matchId:req.user.benchMatchId,outId:body.outId,inId:body.inId}});
    res.json(benchData(workspace,req.user));
  });
}
