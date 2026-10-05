import {useEffect,useState} from 'react';
import {api} from './lib';

export default function PlayerAccess({teamId,playerId,email,initialStatus}:{teamId:string;playerId:string;email?:string|null;initialStatus:string}) {
  const [status,setStatus]=useState(''),[message,setMessage]=useState(''),[busy,setBusy]=useState(false),[confirm,setConfirm]=useState(false);
  useEffect(()=>{setStatus(initialStatus);},[initialStatus,email]);
  async function act(action:'invite'|'revoke') {
    if(busy)return;setBusy(true);setMessage('');
    try {const data=await api(`player-access/${action}`,{teamId,playerId});setStatus(action==='revoke'?'not-sent':'pending');setMessage(data.message||'Acceso revocado.');setConfirm(false);}
    catch(e){setMessage((e as Error).message);}finally{setBusy(false);}
  }
  const labels:Record<string,string>={active:'Acceso activo',pending:'Invitación pendiente',expired:'Invitación caducada','not-sent':'Sin invitación',unknown:'No se pudo comprobar el acceso'};
  return <div className="player-access"><small>{email||'Añade un correo para invitar al jugador'}</small>{email&&<><span>{labels[status]||'Consultando acceso…'}</span><div className="button-group">{status!=='active'&&<button className="text-button" disabled={busy||!status} onClick={()=>act('invite')}>Enviar invitación</button>}{['active','pending'].includes(status)&&<button className="text-button" disabled={busy} onClick={()=>setConfirm(true)}>Revocar acceso</button>}</div>{confirm&&<div><p>Se retirará el acceso a este equipo y se anulará la invitación pendiente.</p><button className="button danger small" disabled={busy} onClick={()=>act('revoke')}>Confirmar revocación</button> <button className="text-button" onClick={()=>setConfirm(false)}>Cancelar</button></div>}</>}{message&&<p role="status">{message}</p>}</div>;
}
