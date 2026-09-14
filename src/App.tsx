import { useCallback, useEffect, useRef, useState } from 'react';
import { CalendarDays, ChartNoAxesColumnIncreasing, CheckCircle2, LayoutDashboard, LoaderCircle, LogOut, Radio, RefreshCw, Settings2, Users, WifiOff, X } from 'lucide-react';
import Dashboard from './Dashboard';
import Auth from './Auth';
import MatchPage from './MatchPage';
import { CalendarPage, PlayersPage, StatsPage } from './pages';
import { FixtureForm, ImportFixtures, PlayerForm, SettingsPage, TeamSwitcherModal } from './forms';
import { Crest, Logo, Modal } from './components';
import { api, initials } from './lib';
import type { Match, Player, Session, Workspace } from './types';
import { registerMinutesTool } from './webmcp';
type Dialog = {kind:'player';player?:Player}|{kind:'fixture';match?:Match}|{kind:'import'}|{kind:'archive';player:Player}|{kind:'delete';match:Match}|{kind:'teams'}|null;
export default function App(){
  const [session,setSession]=useState<Session|null>(null),[workspace,setWorkspace]=useState<Workspace|null>(null),[bootError,setBootError]=useState(''),[view,setView]=useState('dashboard');
  const [matchId,setMatchId]=useState<string|null>(null),[dialog,setDialog]=useState<Dialog>(null),[busy,setBusy]=useState(false),[online,setOnline]=useState(true),[now,setNow]=useState(Date.now());
  const [toast,setToast]=useState<{message:string;error:boolean}|null>(null);
  const workspaceRef=useRef<Workspace|null>(null),busyRef=useRef(false),clockRef=useRef({server:Date.now(),local:performance.now()}),toastTimer=useRef<ReturnType<typeof setTimeout>|undefined>(undefined);
  const sessionRef=useRef<Session|null>(null),epoch=useRef(0),refreshToken=useRef<symbol|null>(null),lastSample=useRef(0);
  const acceptSession=useCallback((next:Session)=>{if(sessionRef.current?.user?.id!==next.user?.id){epoch.current++;workspaceRef.current=null;setWorkspace(null);lastSample.current=0;setDialog(null);setMatchId(null);setView('dashboard');}sessionRef.current=next;setSession(next);},[]);
  const notify=useCallback((message:string,error=false)=>{setToast({message,error});clearTimeout(toastTimer.current);toastTimer.current=setTimeout(()=>setToast(null),error?9000:4000);if(error)window.dispatchEvent(new CustomEvent('minuto:error',{detail:message}));},[]);
  const receive=useCallback((data:{workspace:Workspace;userId:string;serverNow:number})=>{
    if(data.userId!==sessionRef.current?.user?.id){if(sessionRef.current)acceptSession({...sessionRef.current,user:null});return;}
    const previous=workspaceRef.current;
    if(previous?.id===data.workspace.id&&(data.workspace.revision<previous.revision||(data.workspace.revision===previous.revision&&data.serverNow<lastSample.current)))return;
    workspaceRef.current=data.workspace;setWorkspace(data.workspace);lastSample.current=data.serverNow;clockRef.current={server:data.serverNow,local:performance.now()};setNow(data.serverNow);setOnline(true);setBootError('');
  },[acceptSession]);
  const refresh=useCallback(async()=>{
    if(refreshToken.current)return;
    const token=Symbol(),generation=epoch.current;refreshToken.current=token;
    try{const data=await api('team');if(generation===epoch.current)receive(data);}
    catch(e){if(generation!==epoch.current)return;if((e as {status?:number}).status===401){if(sessionRef.current)acceptSession({...sessionRef.current,user:null});}else{setOnline(false);if(!workspaceRef.current)setBootError('No se puede cargar el equipo. Comprueba la conexión y vuelve a intentarlo.');}}
    finally{if(refreshToken.current===token)refreshToken.current=null;}
  },[receive,acceptSession]);
  const bootstrap=useCallback(async()=>{setBootError('');try{acceptSession(await api('session'));}catch{setBootError('No se puede conectar con la app. Vuelve a intentarlo.');}},[acceptSession]);
  useEffect(()=>{void bootstrap();},[bootstrap]);
  useEffect(()=>{if(!session?.user)return;void refresh();const interval=setInterval(()=>{if(!document.hidden&&!busyRef.current)void refresh();},5000);const visible=()=>{if(!document.hidden)void refresh();};const offline=()=>setOnline(false);document.addEventListener('visibilitychange',visible);window.addEventListener('online',visible);window.addEventListener('offline',offline);return()=>{clearInterval(interval);document.removeEventListener('visibilitychange',visible);window.removeEventListener('online',visible);window.removeEventListener('offline',offline);};},[session?.user?.email,refresh]);
  useEffect(()=>{const id=setInterval(()=>setNow(clockRef.current.server+performance.now()-clockRef.current.local),500);return()=>clearInterval(id);},[]);
  useEffect(()=>()=>clearTimeout(toastTimer.current),[]);
  useEffect(()=>registerMinutesTool(()=>{const w=workspaceRef.current;return w?w.teams.find(t=>t.id===w.activeTeamId)??null:null;}),[]);
  async function command(type:string,payload:Record<string,unknown>){
    const ws=workspaceRef.current;
    if(busyRef.current||!ws)return false;
    busyRef.current=true;setBusy(true);
    const generation=epoch.current;
    const activeTeam=ws.teams.find(t=>t.id===ws.activeTeamId);
    const body={type,payload,workspaceId:ws.id,teamId:activeTeam?.id,revision:ws.revision,operationId:crypto.randomUUID()};
    try{let data;try{data=await api('command',body);}catch(e){if(e instanceof TypeError&&navigator.onLine)data=await api('command',body);else throw e;}if(generation!==epoch.current)return false;receive(data);if(!type.startsWith('match.'))notify('Cambios guardados.');return true;}
    catch(e){const err=e as Error & {status?:number};notify(err.message||'No se pudo guardar el cambio.',true);await refresh();return false;}
    finally{busyRef.current=false;setBusy(false);}
  }
  function navigate(next:string){setView(next);window.scrollTo({top:0});}
  function openMatch(id:string){setMatchId(id);navigate('match');}
  async function logout(){if(session?.demo){notify('La demo usa datos de ejemplo. En el despliegue podrás crear tu cuenta.');return;}try{await api('logout',{});if(sessionRef.current)acceptSession({...sessionRef.current,user:null});}catch(e){notify((e as Error).message,true);}}
  if(session&&!session.user)return <Auth onSession={acceptSession} registrationAllowed={session.registrationAllowed}/>;
  if(!workspace)return <div className="loading-screen"><Logo/>{bootError?<><p role="alert">{bootError}</p><button className="button" onClick={()=>session?.user?refresh():bootstrap()}><RefreshCw size={17}/> Reintentar</button></>:<LoaderCircle className="spin"/>}</div>;
  const team=workspace.teams.find(t=>t.id===workspace.activeTeamId)??workspace.teams[0];
  const leagues=workspace.leagues.filter(l=>team.settings.leagueIds.includes(l.id));
  const nav=[['dashboard','Vista general',LayoutDashboard],['match','Día de partido',Radio],['players','Plantilla',Users],['calendar','Calendario',CalendarDays],['stats','Estadísticas',ChartNoAxesColumnIncreasing]] as const;
  const newFixture=()=>setDialog({kind:'fixture'});
  return <div className="app-shell"><aside className="sidebar"><Logo/><button className="team-switch" onClick={()=>setDialog({kind:'teams'})} aria-label="Cambiar de equipo"><Crest name={team.settings.name} crestId={team.settings.crestId} colors={team.settings.colors}/><div><strong>{team.settings.name}</strong><span>{workspace.teams.length>1?`${workspace.teams.length} equipos`:'Un equipo'}</span></div><span className="team-chevron">⌄</span></button><span className="nav-label">VESTUARIO</span><nav aria-label="Menú principal">{nav.map(([id,label,Icon])=><button key={id} className={view===id?'active':''} aria-current={view===id?'page':undefined} onClick={()=>navigate(id)}><Icon size={19}/><span>{label}</span>{id==='match'&&team.matches.some(m=>m.status==='live')&&<span className="nav-live"/>}</button>)}</nav><div className="sidebar-bottom"><div className="season-note"><span className="season-icon">↗</span><span>Una temporada para<br/><strong>hacer equipo.</strong></span></div><button onClick={()=>navigate('settings')}><Settings2 size={19}/>Configuración</button><div className="user-box"><span className="user-avatar">{initials(session?.user?.name||'Entrenador')}</span><div><strong>{session?.user?.name}</strong><span>Cuerpo técnico</span></div><button className="icon-button" onClick={logout} aria-label="Cerrar sesión"><LogOut size={17}/></button></div></div></aside><main className="main"><header className="topbar"><div className="breadcrumb">Mi club<span>/</span><strong>{nav.find(n=>n[0]===view)?.[1]||'Configuración'}</strong></div><div className="topbar-right"><span className="season-pill">Temporada {team.settings.season}</span><button className="header-shield icon-button" onClick={()=>navigate('settings')} aria-label="Configuración del equipo"><Crest name={team.settings.name} crestId={team.settings.crestId} colors={team.settings.colors}/></button></div></header>{session?.demo&&<div className="demo-banner"><span>VISTA DEMO</span>Explora un equipo de ejemplo. Los datos son temporales.</div>}{!online&&<div className="offline-banner" role="alert"><WifiOff size={16}/>Sin conexión. Los cambios requieren conexión con el equipo.<button className="text-button" onClick={()=>refresh()}>Reintentar</button></div>}<div className="page">{view==='dashboard'&&<Dashboard team={team} navigate={navigate} openMatch={openMatch} newFixture={newFixture}/>} {view==='players'&&<PlayersPage team={team} add={()=>setDialog({kind:'player'})} edit={player=>setDialog({kind:'player',player})} archive={player=>setDialog({kind:'archive',player})}/>} {view==='calendar'&&<CalendarPage team={team} leagues={leagues} add={newFixture} importCSV={()=>setDialog({kind:'import'})} open={openMatch} edit={match=>setDialog({kind:'fixture',match})} remove={match=>setDialog({kind:'delete',match})}/>} {view==='stats'&&<StatsPage team={team}/>} {view==='settings'&&<SettingsPage key={team.id} workspace={workspace} team={team} command={command} busy={busy||!online} logout={logout}/>} {view==='match'&&<MatchPage team={team} matchId={matchId} openMatch={openMatch} command={command} busy={busy||!online} now={now} newFixture={newFixture}/>}</div></main>
    {dialog?.kind==='player'&&<PlayerForm player={dialog.player} command={command} onClose={()=>setDialog(null)} busy={busy||!online}/>}
    {dialog?.kind==='fixture'&&<FixtureForm match={dialog.match} team={team} leagues={leagues} command={command} onClose={()=>setDialog(null)} busy={busy||!online}/>}
    {dialog?.kind==='import'&&<ImportFixtures team={team} command={command} onClose={()=>setDialog(null)} busy={busy||!online}/>}
    {dialog?.kind==='teams'&&<TeamSwitcherModal workspace={workspace} command={command} onClose={()=>setDialog(null)} busy={busy||!online}/>}
    {dialog?.kind==='archive'&&<Modal title="Archivar jugador" onClose={()=>setDialog(null)}><p className="form-note">{dialog.player.name} dejará de aparecer en la plantilla. Sus partidos y minutos anteriores se conservarán en las estadísticas.</p><div className="form-actions"><button className="button secondary" onClick={()=>setDialog(null)}>Cancelar</button><button className="button danger" disabled={busy||!online} onClick={async()=>{if(await command('player.archive',{id:dialog.player.id}))setDialog(null);}}>Archivar jugador</button></div></Modal>}
    {dialog?.kind==='delete'&&<Modal title="Eliminar partido" onClose={()=>setDialog(null)}><p className="form-note">Se eliminará el partido de la jornada {dialog.match.round} contra {dialog.match.opponent}. Podrás volver a añadirlo si lo necesitas.</p><div className="form-actions"><button className="button secondary" onClick={()=>setDialog(null)}>Cancelar</button><button className="button danger" disabled={busy||!online} onClick={async()=>{if(await command('fixture.delete',{id:dialog.match.id}))setDialog(null);}}>Eliminar partido</button></div></Modal>}
    {toast&&<div className={`toast ${toast.error?'error':''}`} role={toast.error?'alert':'status'}>{!toast.error&&<CheckCircle2 size={18}/>}<span>{toast.message}</span><button className="icon-button" onClick={()=>setToast(null)} aria-label="Cerrar aviso"><X size={16}/></button></div>}
  </div>;
}
