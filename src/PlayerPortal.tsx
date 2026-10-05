import {useEffect,useState} from 'react';
import {CalendarDays,Clock3,LogOut,RefreshCw,Trophy} from 'lucide-react';
import {Logo} from './components';
import {api,clock,dateLabel,timeLabel} from './lib';
import type {Match} from './types';
import {Modal} from './components';

type PersonalMatch=Pick<Match,'id'|'opponent'|'date'|'venue'|'home'|'round'|'season'|'leagueId'|'status'|'homeScore'|'awayScore'>&{seconds:number;played:boolean;cleanSheet:boolean;goals:{seconds:number;scorerId:string;assistId:string|null;scorer:string|null;assist:string|null}[]};
type Competition={id:string;name:string;season:string;kind:'league'|'cup';updatedAt:string|null;sourceUrl:string|null;results:{external_id:string;match_date:string|null;round:string;home_team:string;away_team:string;home_score:number|null;away_score:number|null;status:string}[];standings:{group_name:string;position:number;team_name:string;played:number;won:number;drawn:number;lost:number;goals_for:number;goals_against:number;points:number}[]};
type PersonalTeam={id:string;name:string;season:string;player:{id:string;name:string;number:number;position:string};matches:PersonalMatch[];competitions:Competition[]};
type Portal={teams:PersonalTeam[];serverNow:number};
const statuses:Record<string,string>={scheduled:'Programado',live:'En directo',paused:'En pausa',finished:'Finalizado',postponed:'Aplazado'};
const positions:Record<string,string>={POR:'Portero',DEF:'Defensa',MED:'Centrocampista',DEL:'Delantero'};

export default function PlayerPortal({onSignedOut,onBack}:{onSignedOut:()=>void;onBack?:()=>void}) {
  const [data,setData]=useState<Portal|null>(null),[error,setError]=useState(''),[selected,setSelected]=useState(''),[season,setSeason]=useState(''),[tab,setTab]=useState('minutes'),[refresh,setRefresh]=useState(0),[privacy,setPrivacy]=useState(false);
  useEffect(()=>{
    let active=true,pending=false;
    async function load(){if(pending)return;pending=true;try{const next=await api('player-portal');if(active){setData(next);setError('');}}catch(e){if(active){setData(null);setError((e as Error).message);if((e as {status?:number}).status===401)onSignedOut();}}finally{pending=false;}}
    void load();const timer=setInterval(()=>{if(!document.hidden)void load();},30000);
    const visible=()=>{if(!document.hidden)void load();};window.addEventListener('focus',visible);
    return()=>{active=false;clearInterval(timer);window.removeEventListener('focus',visible);};
  },[refresh,onSignedOut]);
  async function logout(){try{await api('logout',{});onSignedOut();}catch(e){setError((e as Error).message);}}
  const team=data?.teams.find(t=>t.id===selected)??data?.teams[0];
  const seasons=team?Array.from(new Set([team.season,...team.matches.map(m=>m.season),...team.competitions.map(c=>c.season)])):[];
  const activeSeason=seasons.includes(season)?season:team?.season;
  const matches=team?.matches.filter(m=>m.season===activeSeason)??[];
  const played=matches.filter(m=>m.played&&m.status==='finished').sort((a,b)=>b.date.localeCompare(a.date));
  const total=played.reduce((sum,m)=>sum+m.seconds,0);
  const playerId=team?.player.id;
  const goals=played.reduce((sum,m)=>sum+m.goals.filter(g=>g.scorerId===playerId).length,0);
  const assists=played.reduce((sum,m)=>sum+m.goals.filter(g=>g.assistId===playerId).length,0);
  const cleanSheets=played.filter(m=>m.cleanSheet).length;
  return <div className="player-portal"><header className="portal-header"><Logo/><div className="button-group">{onBack&&<button className="button secondary small" onClick={onBack}>Volver a gestión</button>}<button className="button secondary small" onClick={logout}><LogOut size={16}/>Cerrar sesión</button></div></header><main className="portal-main">
    <div className="page-heading"><div><span className="eyebrow">MI ÁREA DE JUGADOR</span><h1>{team?`Hola, ${team.player.name}.`:'Tu equipo te espera.'}</h1><p>Tu temporada, partido a partido.</p></div><button className="icon-button" aria-label="Actualizar mis datos" onClick={()=>setRefresh(n=>n+1)}><RefreshCw size={20}/></button></div>
    {error&&<div role="alert" className="error-text">{error}</div>}{!data&&!error&&<p role="status">Cargando tus datos…</p>}
    {data&&!team&&<div className="panel portal-empty"><h2>No tienes equipos vinculados.</h2><p>Para entrar a un equipo necesitas aceptar la invitación que te envíe su gestor. Si antes tenías acceso, consulta con él.</p></div>}
    {team&&<><div className="portal-selectors"><label className="field"><span>Equipo</span><select value={team.id} onChange={e=>{setSelected(e.target.value);setSeason('');}}>{data?.teams.map(t=><option key={t.id} value={t.id}>{t.name} · #{t.player.number}</option>)}</select></label><label className="field"><span>Temporada</span><select value={activeSeason} onChange={e=>setSeason(e.target.value)}>{seasons.map(s=><option key={s}>{s}</option>)}</select></label></div>
      <div className="portal-metrics"><article className="panel"><Clock3/><strong>{Math.floor(total/60)}</strong><span>Minutos jugados</span></article><article className="panel"><CalendarDays/><strong>{played.length}</strong><span>Partidos jugados</span></article><article className="panel"><Trophy/><strong>{goals}</strong><span>Goles</span></article><article className="panel"><Trophy/><strong>{assists}</strong><span>Asistencias</span></article>{['DEF','POR'].includes(team.player.position)&&<article className="panel"><Trophy/><strong>{cleanSheets}</strong><span>Porterías imbatidas</span></article>}<article className="panel"><strong>#{team.player.number}</strong><span>{positions[team.player.position]??team.player.position} · {team.name}</span></article></div>
      <nav className="segmented portal-tabs" aria-label="Área del jugador">{[['minutes','Mis minutos'],['calendar','Calendario'],['official','Liga y copa oficiales']].map(([id,label])=><button key={id} aria-current={tab===id?'page':undefined} className={tab===id?'active':''} onClick={()=>setTab(id)}>{label}</button>)}</nav>
      {tab==='minutes'&&<section><h2>Mis partidos</h2><p className="form-note">Minutos y resultados registrados por tu equipo. Los datos oficiales se muestran en «Liga y copa oficiales».</p>{played.length?<MatchList matches={played} name={team.name} competitions={team.competitions} minutes/>:<div className="panel portal-empty">Todavía no tienes minutos en partidos finalizados de esta temporada.</div>}{matches.filter(m=>m.played&&['live','paused'].includes(m.status)).map(m=><article className="panel portal-live" key={m.id}><strong>{statuses[m.status]} · {m.opponent}</strong><span>{clock(m.seconds)} jugados · Actualización cada 30 segundos</span></article>)}</section>}
      {tab==='calendar'&&<section><h2>Calendario del equipo</h2>{matches.length?<MatchList matches={[...matches].sort((a,b)=>a.date.localeCompare(b.date))} name={team.name} competitions={team.competitions}/>:<div className="panel portal-empty">Tu equipo todavía no ha añadido partidos para esta temporada.</div>}</section>}
      {tab==='official'&&<section><h2>Liga y copa oficiales</h2>{team.competitions.filter(c=>c.season===activeSeason).length?team.competitions.filter(c=>c.season===activeSeason).map(c=><OfficialCompetition key={c.id} competition={c}/>):<div className="panel portal-empty">Tu equipo aún no tiene competiciones asignadas para esta temporada.</div>}</section>}
    </>}
    <footer className="portal-footer"><div><a href="/privacy" target="_blank" rel="noreferrer">Información de privacidad</a> · <button className="text-button" onClick={()=>setPrivacy(true)}>Exportar o eliminar mis datos</button></div><span>Acceso personal · BucaGest</span></footer>
    {privacy&&<PlayerPrivacyForm onClose={()=>setPrivacy(false)} onDeleted={onSignedOut}/>}
  </main></div>;
}
function PlayerPrivacyForm({onClose,onDeleted}:{onClose:()=>void;onDeleted:()=>void}) {
  const [password,setPassword]=useState(''),[confirmation,setConfirmation]=useState(''),[message,setMessage]=useState(''),[busy,setBusy]=useState(false);
  async function exportData(){setBusy(true);setMessage('');try{const data=await api('player-data/export',{password}),url=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json'})),link=document.createElement('a');link.href=url;link.download='bucagest-datos-jugador.json';link.click();URL.revokeObjectURL(url);setMessage('Tu copia personal se ha descargado.');}catch(e){setMessage((e as Error).message);}finally{setBusy(false);}}
  async function deleteAccount(){setBusy(true);setMessage('');try{await api('player-data/delete-account',{password,confirmation});onDeleted();}catch(e){setMessage((e as Error).message);}finally{setBusy(false);}}
  return <Modal title="Tus datos y tu cuenta" onClose={onClose}><p className="form-note">Confirma tu contraseña para descargar tus datos o eliminar tu cuenta. El borrado revoca tus accesos en todos los equipos. Los datos de plantilla y partido que conserve cada equipo siguen bajo la gestión de su responsable.</p><label className="field"><span>Tu contraseña</span><input autoComplete="current-password" type="password" required minLength={10} maxLength={128} value={password} onChange={e=>setPassword(e.target.value)}/></label><button className="button secondary" disabled={busy||password.length<10} onClick={exportData}>Descargar copia de mis datos</button><hr/><label className="field"><span>Para borrar la cuenta, escribe ELIMINAR MI CUENTA</span><input value={confirmation} onChange={e=>setConfirmation(e.target.value)} autoComplete="off"/></label>{message&&<p role="status" className="form-note">{message}</p>}<div className="form-actions"><button className="button secondary" onClick={onClose}>Cerrar</button><button className="button danger" disabled={busy||password.length<10||confirmation!=='ELIMINAR MI CUENTA'} onClick={deleteAccount}>Eliminar mi cuenta</button></div></Modal>;
}
function MatchList({matches,name,competitions,minutes=false}:{matches:PersonalMatch[];name:string;competitions:Competition[];minutes?:boolean}) {
  return <div className="portal-match-list">{matches.map(m=>{const competition=competitions.find(c=>c.id===m.leagueId),ourGoals=m.home?m.homeScore:m.awayScore;return <article className="panel portal-match" key={m.id}><div><small>Jornada {m.round} · {dateLabel(m.date)} · {timeLabel(m.date)}</small><h3>{m.home?name:m.opponent} <span>{['scheduled','postponed'].includes(m.status)?'vs':`${m.homeScore} – ${m.awayScore}`}</span> {m.home?m.opponent:name}</h3><p>{m.venue||'Campo por confirmar'} · {statuses[m.status]}</p><span className="portal-competition-label">{competition?`${competition.kind==='cup'?'Copa':'Liga'} · ${competition.name}`:'Sin competición asignada'}</span>{m.status==='finished'&&<details className="portal-goal-details"><summary>Ver goles y asistencias</summary>{m.goals.length?<ol>{m.goals.map((g,i)=><li key={`${g.seconds}-${i}`}><strong>{clock(g.seconds)}</strong> · {g.scorer??'Goleador sin atribuir'}{g.assist&&<> · asistencia de {g.assist}</>}</li>)}</ol>:ourGoals>0?<p>No se registraron los goleadores ni las asistencias de este partido.</p>:<p>No se registraron goles del equipo en este partido.</p>}</details>}</div>{minutes&&<div className="portal-minutes"><strong>{clock(m.seconds)}</strong><span>minutos : segundos</span></div>}</article>;})}</div>;
}
function OfficialCompetition({competition:c}:{competition:Competition}) {
  const safeSource=c.sourceUrl&&/^https?:\/\//i.test(c.sourceUrl)?c.sourceUrl:null;
  return <article className="panel official-competition"><span className="eyebrow">{c.kind==='cup'?'COPA':'LIGA'} · {c.season}</span><h3>{c.name}</h3>{!c.updatedAt?<p>Datos oficiales pendientes de actualización.</p>:<>
    <p className="form-note">Última actualización: {new Date(c.updatedAt).toLocaleString('es-ES')}{safeSource&&<> · <a href={safeSource} target="_blank" rel="noreferrer">Fuente oficial</a></>}</p>
    <h4>{c.kind==='cup'?'Clasificación por grupos':'Clasificación'}</h4>{c.standings.length?<div className="portal-table-scroll"><table><thead><tr><th>Pos.</th><th>Equipo</th><th>PJ</th><th>G</th><th>E</th><th>P</th><th>GF</th><th>GC</th><th>Pts.</th></tr></thead><tbody>{c.standings.map(s=><tr key={`${s.group_name}-${s.position}`}><td>{s.position}</td><th scope="row">{s.team_name}{s.group_name&&<small> · {s.group_name}</small>}</th><td>{s.played}</td><td>{s.won}</td><td>{s.drawn}</td><td>{s.lost}</td><td>{s.goals_for}</td><td>{s.goals_against}</td><td><strong>{s.points}</strong></td></tr>)}</tbody></table></div>:<p>{c.kind==='cup'?'Sin clasificación por grupos publicada. Consulta las eliminatorias en los resultados.':'Todavía no hay clasificación publicada.'}</p>}
    <h4>Resultados y próximos encuentros oficiales</h4>{c.results.length?<div className="official-results">{c.results.map(r=><div key={r.external_id}><small>{r.round}{r.match_date?` · ${dateLabel(r.match_date)} · ${timeLabel(r.match_date)}`:''} · {statuses[r.status]}</small><p>{r.home_team} <strong>{r.home_score!==null&&r.away_score!==null?`${r.home_score} – ${r.away_score}`:'vs'}</strong> {r.away_team}</p></div>)}</div>:<p>Sin encuentros oficiales publicados.</p>}
  </>}</article>;
}
