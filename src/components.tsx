import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ArrowRight, Shield, X } from 'lucide-react';
import type { Match, Player, Team } from './types';
import { dateLabel, timeLabel, initials } from './lib';
export function Logo({small=false}:{small?:boolean}) { return <div className={`brand ${small?'small':''}`}><span className="brand-mark">m<span>′</span></span>{!small&&<span>minuto<span className="brand-dot">.</span></span>}</div>; }
export function Crest({name,opponent=false,large=false}:{name:string;opponent?:boolean;large?:boolean}) {return <div className={`crest ${opponent?'opponent':''} ${large?'large':''}`} aria-label={name}><Shield strokeWidth={1.2}/><span>{initials(name)}</span><i>FC</i></div>;}
export function Avatar({player}:{player:Player}) {return <div className={`avatar pos-${player.position}`}><span>{player.number.toString().padStart(2,'0')}</span></div>;}
export function Modal({title,children,onClose,wide=false}:{title:string;children:ReactNode;onClose:()=>void;wide?:boolean}) {
  const ref=useRef<HTMLDialogElement>(null);
  const [error,setError]=useState('');
  const closeRef=useRef(onClose); closeRef.current=onClose;
  useEffect(()=>{const dialog=ref.current; dialog?.showModal(); const handle=(e:Event)=>{e.preventDefault();closeRef.current();};dialog?.addEventListener('cancel',handle); return()=>{dialog?.removeEventListener('cancel',handle);dialog?.close();};},[]);
  useEffect(()=>{const handle=(event:Event)=>setError((event as CustomEvent<string>).detail);window.addEventListener('minuto:error',handle);return()=>window.removeEventListener('minuto:error',handle);},[]);
  return <dialog ref={ref} aria-label={title} className={`modal ${wide?'wide':''}`} onClick={e=>{if(e.target===e.currentTarget) onClose();}}><div className="modal-head"><h2>{title}</h2><button className="icon-button" onClick={onClose} aria-label="Cerrar"><X size={22}/></button></div>{error&&<div className="error-text" role="alert">{error}</div>}{children}</dialog>;
}
export function Empty({title,detail,action}:{title:string;detail:string;action?:ReactNode}) {return <div className="empty"><div className="empty-icon"><Shield size={32}/></div><h3>{title}</h3><p>{detail}</p>{action}</div>;}
export function FixtureRow({match,team,onClick}:{match:Match;team:Team;onClick:()=>void}) {return <button className="fixture-row" onClick={onClick}><div className="fixture-date"><strong>{new Date(match.date).getDate()}</strong><span>{dateLabel(match.date,{month:'short'}).replace('.','').toUpperCase()}</span></div><div className="fixture-team"><strong>{match.opponent}</strong><span>Jornada {match.round} <b>·</b> {match.home?'Local':'Visitante'}</span></div>{match.status==='finished'?<span className="score-pill">{match.home?match.homeScore:match.awayScore} – {match.home?match.awayScore:match.homeScore}</span>:<span className="fixture-time">{timeLabel(match.date)}</span>}<ArrowRight size={17}/></button>;}
export function Pitch({players,compact=false}:{players:Player[];compact?:boolean}) {
  const groups=[players.filter(p=>p.position==='DEL'),players.filter(p=>p.position==='MED'),players.filter(p=>p.position==='DEF'),players.filter(p=>p.position==='POR')];
  return <div className={`pitch ${compact?'compact':''}`}><div className="pitch-lines"><div className="pitch-center"/><div className="pitch-box top"/><div className="pitch-box bottom"/></div><div className="pitch-players">{groups.map((group,i)=><div className="pitch-line" key={i}>{group.map(p=><div className="pitch-player" key={p.id}><span>{p.number}</span>{!compact&&<small>{p.name.split(' ')[0]}</small>}</div>)}</div>)}</div></div>;
}
