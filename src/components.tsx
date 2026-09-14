import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { ArrowRight, LoaderCircle, Shield, Upload, X } from 'lucide-react';
import type { Match, Player, Team, TeamColors } from './types';
import { assetUrl, dateLabel, resizeImage, timeLabel, initials, uploadAsset } from './lib';
export function Logo({small=false}:{small?:boolean}) { return <div className={`brand ${small?'small':''}`}><span className="brand-mark">B<span>′</span></span>{!small&&<span>BucaGest<span className="brand-dot">.</span></span>}</div>; }
export function Crest({name,crestId=null,colors,opponent=false,large=false}:{name:string;crestId?:string|null;colors?:TeamColors;opponent?:boolean;large?:boolean}) {
  const url=assetUrl(crestId);
  if(url) return <div className={`crest photo ${large?'large':''}`} aria-label={name}><img src={url} alt=""/></div>;
  const branded=colors&&!opponent;
  const style=branded?({'--team-primary':colors!.primary,'--team-secondary':colors!.secondary} as CSSProperties):undefined;
  return <div className={`crest ${opponent?'opponent':''} ${large?'large':''} ${branded?'branded':''}`} style={style} aria-label={name}><Shield strokeWidth={1.2}/><span>{initials(name)}</span><i>FC</i></div>;
}
export function Jersey({number,colors,size='card'}:{number:number;colors?:TeamColors;size?:'card'|'chip'|'mini'}) {
  const primary=colors?.primary??'#8ac9eb', secondary=colors?.secondary??'#223e4c';
  return <svg className={`jersey jersey-${size}`} viewBox="0 0 100 100" role="img" aria-label={`Dorsal ${number}`}>
    <path d="M30 8 L8 22 L18 40 L28 33 L28 92 L72 92 L72 33 L82 40 L92 22 L70 8 L60 14 Q50 21 40 14 Z" fill={primary} stroke={secondary} strokeWidth="3" strokeLinejoin="round" strokeLinecap="round"/>
    <text x="50" y="67" textAnchor="middle" fontFamily="'Barlow Condensed',Impact,sans-serif" fontWeight="700" fontSize="34" fill={secondary}>{number}</text>
  </svg>;
}
export function Avatar({player,colors}:{player:Player;colors?:TeamColors}) {
  const url=assetUrl(player.photoId);
  if(url) return <div className="avatar avatar-photo"><img src={url} alt=""/></div>;
  const style=colors?({'--team-primary':colors.primary,'--team-secondary':colors.secondary} as CSSProperties):undefined;
  return <div className={`avatar pos-${player.position} ${colors?'branded':''}`} style={style}><span>{player.number.toString().padStart(2,'0')}</span></div>;
}
export function ImageField({label,value,onChange,shape='square',disabled=false}:{label:string;value:string|null;onChange:(id:string|null)=>void;shape?:'square'|'circle';disabled?:boolean}) {
  const [busy,setBusy]=useState(false),[error,setError]=useState('');
  const url=assetUrl(value);
  async function handle(file:File|undefined) {
    if(!file) return; setError(''); setBusy(true);
    try {
      if(!file.type.startsWith('image/')) throw new Error('Selecciona un archivo de imagen.');
      if(file.size>8_000_000) throw new Error('La imagen debe pesar menos de 8 MB.');
      const blob=await resizeImage(file, shape==='circle'?320:256);
      onChange(await uploadAsset(blob));
    } catch(e) { setError((e as Error).message||'No se pudo subir la imagen.'); }
    finally { setBusy(false); }
  }
  return <div className={`image-field ${shape}`}>
    <div className="image-field-preview">{url?<img src={url} alt=""/>:<span>{label[0]}</span>}{busy&&<LoaderCircle className="spin" size={20}/>}</div>
    <div className="image-field-actions">
      <span>{label}</span>
      <div className="button-group">
        <label className="button secondary small"><Upload size={15}/> {value?'Cambiar':'Subir imagen'}<input type="file" accept="image/png,image/jpeg,image/webp" hidden disabled={disabled||busy} onChange={e=>{void handle(e.target.files?.[0]);e.target.value='';}}/></label>
        {value&&<button type="button" className="text-button" disabled={disabled||busy} onClick={()=>onChange(null)}>Quitar</button>}
      </div>
    </div>
    {error&&<span className="error-text small">{error}</span>}
  </div>;
}
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
