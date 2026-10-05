import {useEffect,useState,type FormEvent} from 'react';
import {Logo} from './components';
import {api} from './lib';

export default function Invitation({entry,onDone}:{entry:string;onDone:()=>void}) {
  const [token]=useState(()=>new URLSearchParams(entry.replace(/^#/,'')).get('token')||'');
  const [info,setInfo]=useState<{email:string;teamName:string;playerName:string;existingAccount:boolean}|null>(null);
  const [error,setError]=useState(''),[busy,setBusy]=useState(false),[done,setDone]=useState(false);
  useEffect(()=>{
    history.replaceState(null,'',location.pathname+location.search);
    let cancelled=false;
    api('player-invitations/info',{token}).then(data=>{if(!cancelled)setInfo(data);}).catch(e=>{if(!cancelled)setError(e.message);});
    return()=>{cancelled=true;};
  },[token]);
  async function submit(e:FormEvent<HTMLFormElement>) {
    e.preventDefault();if(busy)return;
    const data=new FormData(e.currentTarget);
    if(!info?.existingAccount&&data.get('password')!==data.get('confirm')){setError('Las contraseñas no coinciden.');return;}
    setBusy(true);setError('');
    try {await api('player-invitations/accept',{token,password:data.get('password')});setDone(true);}
    catch(e){setError((e as Error).message);}finally{setBusy(false);}
  }
  return <main className="invitation-page"><div className="panel invitation-card"><Logo/><span className="eyebrow">TU SITIO EN EL EQUIPO</span><h1>{done?'Ya formas parte del equipo.':'Tu equipo te invita.'}</h1>
    {done?<><p>Correo verificado. Inicia sesión para consultar tus minutos, partidos y competiciones.</p><button className="button dark" onClick={onDone}>Ir al inicio de sesión</button></>:<>
      {info&&<><p><strong>{info.teamName}</strong> te invita como <strong>{info.playerName}</strong>.</p><p>{info.email}</p><p>{info.existingAccount?'Ya tienes cuenta. Introduce tu contraseña actual para aceptar la invitación. Tu contraseña no cambiará.':'Elige una contraseña. Al aceptar la invitación quedará verificado tu correo.'}</p><form onSubmit={submit}>
        <label className="field"><span>{info.existingAccount?'Contraseña actual':'Crear contraseña'}</span><input name="password" type="password" autoComplete={info.existingAccount?'current-password':'new-password'} minLength={10} maxLength={128} required/></label>
        {!info.existingAccount&&<label className="field"><span>Repite la contraseña</span><input name="confirm" type="password" autoComplete="new-password" minLength={10} maxLength={128} required/></label>}
        <p className="form-note">Consulta la <a href="/privacy" target="_blank" rel="noreferrer">información de privacidad</a>. Servicio para equipos y jugadores adultos.</p>
        <button className="button dark" disabled={busy}>{busy?'Guardando…':'Aceptar invitación'}</button>
      </form></>}
      {!info&&!error&&<p role="status">Comprobando invitación…</p>}
      {error&&<p className="error-text" role="alert">{error}</p>}
      <button className="text-button" disabled={busy} onClick={onDone}>Ir al inicio de sesión o recuperar contraseña</button>
    </>}
  </div></main>;
}
