import { useRef, useState } from 'react';
import { Check, Search, Wallet } from 'lucide-react';
import { Empty, Modal } from './components';
import type { Command } from './forms';
import type { PaymentField, Player, Team } from './types';

const general: {key:PaymentField; label:string}[] = [
  {key:'registration',label:'Ficha'}, {key:'insurance',label:'Seguro'},
  {key:'uniformPaid',label:'Uniforme pagado'}, {key:'uniformDelivered',label:'Uniforme entregado'},
];
const months: {key:PaymentField; label:string}[] = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'].map((label,i)=>({key:`month${i+1}` as PaymentField,label:`Cuota ${label.toLowerCase()}`}));
type Pending = {player:Player; key:PaymentField; label:string; previous:boolean; season:string};

export default function PaymentsPage({team,command,busy}:{team:Team;command:Command;busy:boolean}) {
  const [season,setSeason] = useState(team.settings.season);
  const [search,setSearch] = useState('');
  const [group,setGroup] = useState('all');
  const [archived,setArchived] = useState(false);
  const [pending,setPending] = useState<Pending|null>(null);
  const [saving,setSaving] = useState(false);
  const savingRef = useRef(false);
  const records = team.payments ?? [];
  const seasons = [...new Set([team.settings.season,...records.map(r=>r.season),...team.matches.map(m=>m.season)])].sort().reverse();
  const checks = new Map(records.filter(r=>r.season===season).map(r=>[r.playerId,r.checks]));
  const roster = team.players.filter(p=>!p.archived || (archived && checks.has(p.id))).sort((a,b)=>a.number-b.number);
  const players = roster.filter(p=>`${p.name} ${p.number}`.toLowerCase().includes(search.trim().toLowerCase()));
  const columns = group==='general'?general:group==='months'?months:[...general,...months];
  const checked = (id:string,key:PaymentField) => checks.get(id)?.[key]===true;
  const pendingChanged = !!pending && (!team.players.some(p=>p.id===pending.player.id) || checked(pending.player.id,pending.key)!==pending.previous);
  function close(){if(!savingRef.current)setPending(null);}
  async function confirm(){
    if(!pending||busy||savingRef.current||pendingChanged)return;
    savingRef.current=true;setSaving(true);
    try {
      if(await command('payment.set',{playerId:pending.player.id,season:pending.season,field:pending.key,value:!pending.previous,expectedValue:pending.previous}))setPending(null);
    } finally {savingRef.current=false;setSaving(false);}
  }
  return <>
    <div className="page-heading"><div><div className="eyebrow">LAS CUENTAS DEL EQUIPO</div><h1>Cobros y equipación.</h1><p>Una casilla por concepto. Confirma cada cambio antes de guardarlo.</p></div><Wallet size={30}/></div>
    <div className="toolbar payments-toolbar">
      <label className="search"><Search size={18}/><input aria-label="Buscar jugador en cobros" placeholder="Nombre o dorsal…" value={search} onChange={e=>setSearch(e.target.value)}/></label>
      <label className="season-select">Temporada<select aria-label="Temporada de cobros" value={season} onChange={e=>{setSeason(e.target.value);setPending(null);}}>{seasons.map(s=><option key={s}>{s}</option>)}</select></label>
    </div>
    <div className="payments-summary">{general.map(col=><div key={col.key}><span>{col.label}</span><strong>{roster.filter(p=>checked(p.id,col.key)).length}<small> / {roster.length}</small></strong></div>)}</div>
    <div className="toolbar payments-toolbar"><div className="segmented" aria-label="Conceptos de cobros">{[['all','Todo'],['general','Ficha y equipación'],['months','Cuotas mensuales']].map(([id,label])=><button key={id} className={group===id?'active':''} aria-pressed={group===id} onClick={()=>setGroup(id)}>{label}</button>)}</div><label className="payments-archived"><input type="checkbox" checked={archived} onChange={e=>setArchived(e.target.checked)}/> Ver archivados con registros</label></div>
    <section className="panel payments-panel">
      <div className="payments-legend"><span><Check size={16}/> Pagado / entregado</span><span><i/> Pendiente</span><p>Desliza la tabla para ver todos los meses. El nombre queda fijo.</p></div>
      {players.length ? <div className="payments-scroll" role="region" aria-label="Tabla de cobros por jugador" tabIndex={0}><table className="payments-table"><caption>Cobros de la temporada {season} · {players.length} jugadores</caption><thead><tr><th scope="col" className="payment-name">Jugador</th>{columns.map(col=><th key={col.key} scope="col">{col.label}</th>)}</tr></thead><tbody>{players.map(player=><tr key={player.id}><th scope="row" className="payment-name"><span className="payment-dorsal">{player.number}</span><span>{player.name}{player.archived&&<small>Archivado</small>}</span></th>{columns.map(col=>{const value=checked(player.id,col.key);return <td key={col.key}><button type="button" role="checkbox" aria-checked={value} aria-label={`${player.name} · ${col.label} · ${value?(col.key==='uniformDelivered'?'Entregado':'Pagado'):'Pendiente'}`} title={`${col.label}: ${value?'completado':'pendiente'}`} className={`payment-check ${value?'is-paid':''}`} disabled={busy||saving} onClick={()=>setPending({player,key:col.key,label:col.label,previous:value,season})}>{value?<Check size={22} strokeWidth={3}/>:<span className="payment-unchecked"/>}</button></td>;})}</tr>)}</tbody></table></div> : <Empty title={search?'No encontramos ese jugador':'Todavía no hay jugadores'} detail={search?'Prueba con otro nombre o dorsal.':'Añade jugadores en Plantilla para llevar sus cobros.'}/>}
      <p className="payments-note">Cada temporada guarda sus propios registros. Las nuevas temporadas se eligen en Configuración; las anteriores siguen disponibles aquí.</p>
    </section>
    {pending&&<Modal title={pending.previous?'¿Volver a marcar como pendiente?':pending.key==='uniformDelivered'?'¿Confirmar uniforme entregado?':'¿Confirmar pago?'} onClose={close}>
      <div className="payment-confirm"><strong>{pending.player.name} · #{pending.player.number}</strong><span>{pending.label}</span><span>Temporada {pending.season}</span></div>
      <p className="form-note">{pending.previous?'Se quitará la marca y este concepto volverá a quedar pendiente.':pending.key==='uniformDelivered'?'Confirmas que el jugador ha recibido su uniforme.':'Confirmas que has recibido el pago de este concepto.'}</p>
      {pendingChanged&&<p className="error-text" role="alert">El estado ha cambiado. Cierra esta ventana y revisa la casilla antes de volver a confirmar.</p>}
      <div className="form-actions"><button autoFocus className="button secondary" disabled={saving} onClick={close}>Cancelar</button><button className={`button ${pending.previous?'danger':''}`} disabled={busy||saving||pendingChanged} onClick={()=>void confirm()}>{saving?'Guardando…':pending.previous?'Confirmar: dejar pendiente':pending.key==='uniformDelivered'?'Confirmar entrega':'Confirmar pago'}</button></div>
    </Modal>}
  </>;
}
