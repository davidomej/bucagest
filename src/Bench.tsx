import { useCallback, useEffect, useRef, useState } from 'react';
import { LockKeyhole, Search } from 'lucide-react';
import { Logo, Avatar } from './components';
import { QuickSubstitution } from './QuickSubstitution';
import { api,clock } from './lib';
import type { Player, TeamColors } from './types';

type BenchData={workspaceId:string;revision:number;teamId:string;teamName:string;colors:TeamColors;allowReentry:boolean;players:Player[];match:{id:string;opponent:string;status:string;elapsedSeconds:number;runningSince:number|null;stints:{playerId:string;inSeconds:number;outSeconds:number|null}[]};serverNow:number};
export default function Bench({onSignedOut}:{onSignedOut:()=>void}){
  const [data,setData]=useState<BenchData|null>(null),[error,setError]=useState(''),[online,setOnline]=useState(true),[search,setSearch]=useState(''),[outId,setOutId]=useState<string|null>(null),[busy,setBusy]=useState(false),[now,setNow]=useState(Date.now());
  const latest=useRef<BenchData|null>(null),pending=useRef(false),clockRef=useRef({server:Date.now(),local:performance.now()});
  const accept=useCallback((next:BenchData)=>{if(latest.current&&next.revision<latest.current.revision)return;latest.current=next;setData(next);clockRef.current={server:next.serverNow,local:performance.now()};setNow(next.serverNow);setOnline(true);},[]);
  const refresh=useCallback(async()=>{try{accept(await api('bench'));setError('');}catch(e){if((e as {status?:number}).status===401){onSignedOut();return;}setOnline(false);setError((e as Error).message);}},[accept,onSignedOut]);
  useEffect(()=>{void refresh();const timer=setInterval(()=>{if(!document.hidden&&!pending.current)void refresh();},3000);return()=>clearInterval(timer);},[refresh]);
  useEffect(()=>{const timer=setInterval(()=>setNow(clockRef.current.server+performance.now()-clockRef.current.local),500);return()=>clearInterval(timer);},[]);
  async function substitute(inId:string){
    const current=latest.current;if(!current||!outId||pending.current)return;pending.current=true;setBusy(true);setError('');
    const body={workspaceId:current.workspaceId,revision:current.revision,operationId:crypto.randomUUID(),outId,inId};
    try{let result;try{result=await api('bench/substitution',body);}catch(e){if(e instanceof TypeError&&navigator.onLine)result=await api('bench/substitution',body);else throw e;}accept(result);setOutId(null);}
    catch(e){setError((e as Error).message);setOutId(null);void refresh();}
    finally{pending.current=false;setBusy(false);}
  }
  const onField=new Set(data?.match.stints.filter(s=>s.outSeconds===null).map(s=>s.playerId));
  const playing=data?.players.filter(p=>onField.has(p.id))??[];
  const available=data?.players.filter(p=>!onField.has(p.id)&&(data.allowReentry||!data.match.stints.some(s=>s.playerId===p.id)))??[];
  const outgoing=playing.find(p=>p.id===outId),active=data&&['live','paused'].includes(data.match.status);
  const seconds=data?data.match.elapsedSeconds+(data.match.runningSince===null?0:Math.max(0,now-data.match.runningSince)/1000):0;
  return <main className="bench-page"><header><Logo/><span><LockKeyhole size={16}/> Modo banquillo</span></header><div className="bench-content"><div className="page-heading"><div><div className="eyebrow">{data?.teamName||'TU EQUIPO'}</div><h1>¿Sales del campo?</h1><p>Búscate, pulsa Sustituir y elige quién entró por ti.</p></div><strong className="bench-clock">{clock(seconds)}</strong></div>
    {error&&<p className="error-text" role="alert">{error}</p>}{!online&&<button className="button secondary" onClick={()=>void refresh()}>Reconectar</button>}
    {data&&<p className="bench-status">{data.match.opponent} · {data.match.status==='live'?'En juego':data.match.status==='paused'?'Cronómetro pausado':'Partido cerrado'}</p>}
    <label className="search quick-sub-search"><Search size={18}/><input aria-label="Buscarme en el campo" placeholder="Tu nombre o dorsal…" value={search} onChange={e=>setSearch(e.target.value)}/></label>
    <div className="bench-players">{playing.filter(p=>`${p.name} ${p.number}`.toLowerCase().includes(search.toLowerCase())).map(p=><article key={p.id}><Avatar player={p} colors={data?.colors}/><strong>{p.name}<small>Dorsal {p.number}</small></strong><button className="button" disabled={!active||busy||!online} onClick={()=>setOutId(p.id)}>Sustituir</button></article>)}</div>
    {!active&&data&&<p className="form-note">El partido está cerrado. El gestor puede preparar la tablet para otro partido iniciando sesión.</p>}
    <footer><p>Esta tablet solo permite sustituciones. Los cobros y las fichas completas están protegidos.</p><button className="text-button" disabled={busy} onClick={async()=>{try{await api('logout',{});onSignedOut();}catch(e){setError((e as Error).message);}}}>Salir e iniciar sesión como gestor</button></footer>
    {outId&&data&&<QuickSubstitution outgoing={outgoing} available={available} colors={data.colors} busy={busy||!online||!active} onSelect={substitute} onClose={()=>setOutId(null)}/>}
  </div></main>;
}
