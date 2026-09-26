import { useEffect, useState, type FormEvent } from 'react';
import { ArrowRight, CheckCircle2, LoaderCircle, Mail, ShieldCheck } from 'lucide-react';
import { Logo } from './components';
import { api } from './lib';
import type { Session } from './types';

type Mode='login'|'register'|'verify'|'reset'|'forgot'|'resend'|'sent';
export default function Auth({onSession,session,entry=''}:{onSession:(s:Session)=>void;session:Session;entry?:string}) {
  const [link]=useState(()=>new URLSearchParams(entry.replace(/^#/,'')));
  const initial=link.get('auth');
  const [mode,setMode]=useState<Mode>(initial==='verify'||initial==='reset'||initial==='sent'?initial:'login');
  const [token,setToken]=useState(link.get('token')||'');
  const [busy,setBusy]=useState(false),[error,setError]=useState(link.get('auth-error')||''),[message,setMessage]=useState(''),[email,setEmail]=useState('');
  useEffect(()=>{if(entry)history.replaceState(null,'',location.pathname+location.search);},[entry]);
  const register=mode==='register',complete=mode==='verify'||mode==='reset',request=mode==='forgot'||mode==='resend';
  const title={login:'Tu equipo te espera.',register:'Aquí empieza tu equipo.',verify:'Confirma tu correo.',reset:'Una nueva contraseña.',forgot:'Recupera tu acceso.',resend:'Verifica tu correo.',sent:'Revisa tu bandeja.'}[mode];
  const subtitle={login:'Accede de forma segura para preparar la próxima jornada.',register:'Te enviaremos un enlace para verificar tu correo y elegir tu contraseña.',verify:'Elige tu contraseña para confirmar el correo y activar tu acceso.',reset:'Elige una contraseña nueva para volver a tu equipo.',forgot:'Te enviaremos un enlace para elegir otra contraseña.',resend:'Solicita un nuevo enlace para activar tu cuenta.',sent:'Si tu cuenta está pendiente, recibirás un enlace que caduca en 30 minutos. Revisa también spam.'}[mode];
  function change(next:Mode){setMode(next);setError('');setMessage('');}
  async function submit(e:FormEvent<HTMLFormElement>){
    e.preventDefault();if(busy)return;setBusy(true);setError('');setMessage('');
    const data=Object.fromEntries(new FormData(e.currentTarget));
    try{
      if(complete){
        if(data.password!==data.confirmPassword)throw new Error('Las contraseñas no coinciden.');
        const result=await api('auth/complete',{token,kind:mode,password:data.password});
        setToken('');setMode('login');setMessage(result.message);
      }else if(mode==='login')onSession(await api('login',data));
      else if(register){await api('register',data);setMode('sent');}
      else {const result=await api(mode==='forgot'?'auth/forgot-password':'auth/resend-verification',data);setMessage(result.message);}
    }catch(e){setError((e as Error).message);}finally{setBusy(false);}
  }
  const showProviders=(mode==='login'||register)&&session.providers?.length>0;
  const needsMail=register||request;
  return <div className="auth-page"><aside className="auth-story"><Logo/><div><span className="eyebrow">TU EQUIPO. CADA MINUTO.</span><h1>El fútbol<br/>se juega<br/><em>en equipo.</em></h1><p>Tu plantilla, tus partidos y las cuentas de tu equipo, en un mismo lugar.</p></div><span className="auth-bottom">HECHO PARA VIVIRLO DESDE LA BANDA <b>↗</b></span></aside><main className="auth-main"><div className="auth-form">
    <div className="auth-mark"><Logo small/></div><span className="auth-security"><ShieldCheck size={16}/> ACCESO SEGURO</span><h2>{title}</h2><p>{subtitle}</p>
    <p className="auth-privacy">Servicio para gestores adultos de equipos de adultos. Consulta cómo se tratan tus datos en la <a href="/privacy" target="_blank" rel="noreferrer">información de privacidad</a> antes de crear una cuenta o elegir un proveedor.</p>
    {showProviders&&<><div className="auth-providers">{session.providers.map(provider=><a key={provider} className={`auth-provider ${provider}`} href={`/api/auth/${provider}/start`}><span aria-hidden="true">{provider==='google'?'G':provider==='apple'?'●':'f'}</span>Continuar con {provider==='google'?'Google':provider==='apple'?'Apple':'Facebook'}</a>)}</div><div className="auth-divider"><span>o con tu correo</span></div></>}
    {error&&<div className="error-text" role="alert">{error}</div>}{message&&<div className="auth-success" role="status"><CheckCircle2 size={18}/><span>{message}</span></div>}
    {mode==='sent'?<div className="auth-sent"><Mail size={34}/><strong>{email||'Comprueba el correo de tu cuenta'}</strong><p>Al abrir el enlace podrás elegir tu contraseña. Después, vuelve a iniciar sesión.</p><button className="button secondary full-width" onClick={()=>change('resend')}>Reenviar confirmación</button></div>:<form onSubmit={submit}>
      {register&&<><label className="field"><span>Tu nombre</span><input name="name" autoComplete="name" required maxLength={100} placeholder="Nombre del entrenador"/></label><label className="field"><span>Nombre de tu equipo</span><input name="teamName" required maxLength={100} placeholder="Ej. Mi equipo"/></label></>}
      {!complete&&<label className="field"><span>Correo electrónico</span><input name="email" type="email" autoComplete="email" required maxLength={254} value={email} onChange={e=>setEmail(e.target.value)} placeholder="tu@equipo.com"/></label>}
      {(mode==='login'||complete)&&<label className="field"><span>{complete?'Nueva contraseña':'Contraseña'}</span><input name="password" type="password" autoComplete={complete?'new-password':'current-password'} required minLength={10} maxLength={128} placeholder={complete?'Al menos 10 caracteres':'Tu contraseña'}/></label>}
      {complete&&<label className="field"><span>Repite la contraseña</span><input name="confirmPassword" type="password" autoComplete="new-password" required minLength={10} maxLength={128} placeholder="Repite tu nueva contraseña"/></label>}
      {needsMail&&!session.emailReady&&<p className="auth-unavailable">El envío de correos no está disponible en este momento. Contacta con el administrador.</p>}
      <button className="button dark full-width" disabled={busy||(needsMail&&!session.emailReady)||(complete&&!token)}>{busy?<LoaderCircle size={18} className="spin"/>:null}{register?'Enviar enlace de confirmación':complete?'Guardar contraseña':request?'Enviar enlace':'Iniciar sesión'}<ArrowRight size={18}/></button>
    </form>}
    {mode==='login'&&<div className="auth-help"><button className="text-button" onClick={()=>change('forgot')}>He olvidado mi contraseña</button><button className="text-button" onClick={()=>change('resend')}>Reenviar confirmación</button></div>}
    <div className="auth-toggle">{mode==='login'?(session.registrationAllowed?<><span>¿Todavía no tienes cuenta?</span><button className="text-button" onClick={()=>change('register')}>Crear una cuenta</button></>:<span>El registro de nuevas cuentas está cerrado.</span>):<button className="text-button" disabled={busy} onClick={()=>change('login')}>Volver a iniciar sesión</button>}</div>
    {complete&&<div className="auth-toggle"><button className="text-button" disabled={busy} onClick={()=>change(mode==='reset'?'forgot':'resend')}>Solicitar un nuevo enlace</button></div>}
    </div><footer>BucaGest. <span>Cada minuto importa.</span></footer></main></div>;
}
