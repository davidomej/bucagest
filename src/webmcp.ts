import { secondsFor } from './lib';
import type { Team } from './types';
type Context = { registerTool:(tool:{name:string;title:string;description:string;inputSchema:object;annotations:{readOnlyHint:boolean;untrustedContentHint:boolean};execute:(input:unknown)=>unknown},options:{signal:AbortSignal})=>void|Promise<void> };
export function registerMinutesTool(getTeam:()=>Team|null){
  const context=(document as Document & {modelContext?:Context}).modelContext;
  if(!context?.registerTool)return;
  const lifecycle=new AbortController();
  try{void Promise.resolve(context.registerTool({name:'get_team_minutes',title:'Consultar minutos de la temporada',description:'Consulta el resumen de minutos de los jugadores del equipo conectado. Solo incluye partidos finalizados y no modifica datos.',inputSchema:{type:'object',properties:{season:{type:'string',description:'Temporada exacta; por defecto la temporada activa.'}},additionalProperties:false},annotations:{readOnlyHint:true,untrustedContentHint:true},execute(input){
    if(!input||typeof input!=='object'||Array.isArray(input))throw new Error('Se requiere un objeto.');
    const data=input as Record<string,unknown>;if(Object.keys(data).some(k=>k!=='season')||(data.season!==undefined&&(typeof data.season!=='string'||data.season.length>100)))throw new Error('Temporada no válida.');
    const team=getTeam();if(!team)throw new Error('Inicia sesión para consultar el equipo.');
    const season=data.season??team.settings.season,matches=team.matches.filter(m=>m.season===season&&m.status==='finished');
    return {team:team.settings.name,season,finishedMatches:matches.length,players:team.players.map(p=>({name:p.name,number:p.number,seconds:Math.floor(matches.reduce((n,m)=>n+secondsFor(m,p.id,0),0))}))};
  }},{signal:lifecycle.signal})).catch(()=>{/* Optional browser capability. */});}catch{/* Unsupported browser implementation. */}
  return()=>lifecycle.abort();
}
