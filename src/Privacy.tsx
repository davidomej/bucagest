import { useEffect, useState, type FormEvent } from 'react';
import { Download, LockKeyhole, ShieldCheck, Trash2 } from 'lucide-react';
import { api } from './lib';
import { Logo, Modal } from './components';
import type { Workspace, Team } from './types';

type Notice={version:string;configured:boolean;operator:string;address:string;contact:string;hosting:string;providers:string;retention:string;transfers:string};
export function PrivacyNotice(){
  const [notice,setNotice]=useState<Notice|null>(null),[error,setError]=useState('');
  useEffect(()=>{api('privacy-notice').then(setNotice).catch(()=>setError('No se pudo cargar la información de privacidad. Recarga la página.'));},[]);
  return <article className="privacy-notice"><h2>Privacidad y protección de datos</h2>{error&&<p role="alert">{error}</p>}{!notice&&!error&&<p>Cargando información…</p>}{notice&&<>
    {!notice.configured&&<p className="auth-unavailable">La información del prestador está pendiente de completar. Esta instalación no está preparada para recoger datos reales.</p>}
    <p>Versión {notice.version}. BucaGest permite gestionar plantillas, calendarios, participación deportiva y el estado de los cobros.</p>
    <h3>Quién trata tus datos</h3><p>El prestador de este servicio es {notice.operator||'pendiente de identificar'}, con domicilio en {notice.address||'pendiente de indicar'}. Contacto de privacidad: {notice.contact?<a href={`mailto:${notice.contact}`}>{notice.contact}</a>:'pendiente de indicar'}.</p>
    <p>El club, entidad o persona que decide para qué se usan los datos de sus jugadores es responsable de ese tratamiento. El prestador aloja y procesa esos datos siguiendo sus instrucciones como encargado, conforme al contrato de encargo que deben formalizar. El prestador es responsable de los datos de las cuentas de acceso y de la seguridad de su servicio. Estos papeles dependen de la actividad real y no eliminan las obligaciones de ninguna de las partes.</p>
    <h3>Datos y finalidades</h3><p>Para crear y gestionar tu cuenta se utilizan tu nombre, correo, credenciales protegidas e identificador del proveedor de acceso si lo eliges. La base es la prestación del servicio solicitado. La prevención de accesos indebidos responde al interés legítimo de proteger el servicio y a las obligaciones de seguridad aplicables.</p>
    <p>El gestor del equipo introduce nombres o alias, dorsales, posiciones, fechas de nacimiento y fotos opcionales, participación en partidos y marcas de pagos o entrega de uniformes. Debe informar a los jugadores, elegir y documentar la base jurídica adecuada y conservar solo lo necesario. La marca de seguro únicamente indica si se ha pagado; no introduzcas diagnósticos, lesiones, documentos de identidad ni datos bancarios.</p>
    <p>Esta versión está destinada a gestores y jugadores adultos: no introduzcas datos de menores. Las fotos y fechas de nacimiento son opcionales. No se realizan decisiones automatizadas con efectos jurídicos ni publicidad basada en los datos de los jugadores.</p>
    <h3>Destinatarios y alojamiento</h3><p>{notice.hosting||'Alojamiento pendiente de documentar.'}</p><p>{notice.providers||'Proveedores pendientes de documentar.'}</p><p>{notice.transfers||'Transferencias internacionales pendientes de documentar.'}</p>
    <p>Al elegir Google, Apple o Facebook se inicia una comunicación con ese proveedor, sujeto también a su propia política. BucaGest solicita los datos de identidad y correo necesarios para el acceso. El proveedor de correo recibe la dirección y el mensaje de verificación o recuperación. No se venden los datos ni se publican las plantillas.</p>
    <h3>Conservación y eliminación</h3><p>{notice.retention||'Plazos de conservación y copias de seguridad pendientes de documentar.'}</p><p>Archivar un jugador conserva su historial. La opción de eliminar sus datos borra su ficha, foto sin otras referencias, cobros y referencias personales del historial activo. Eliminar la cuenta borra todos sus equipos y datos de la base activa. El responsable debe resolver antes cualquier obligación de conservación o bloqueo. Las copias externas requieren su propio procedimiento de caducidad y de aplicación de borrados tras una restauración.</p>
    <h3>Tus derechos</h3><p>Puedes solicitar acceso, rectificación, supresión, oposición, limitación y, cuando corresponda, portabilidad. Si un tratamiento se basa en el consentimiento, puedes retirarlo sin afectar a lo realizado lícitamente antes. Para datos deportivos, dirígete al responsable de tu equipo; para tu cuenta o dudas sobre el servicio, al contacto de privacidad anterior. No envíes tu DNI salvo que resulte necesario verificar tu identidad por un canal adecuado.</p>
    <p>La respuesta se facilita en un mes, con las prórrogas previstas legalmente cuando proceda. Puedes reclamar ante la <a href="https://www.aepd.es" target="_blank" rel="noreferrer">Agencia Española de Protección de Datos</a>. El gestor dispone de herramientas de exportación y supresión; no sustituyen la atención de otros derechos.</p>
    <h3>Cookies y seguridad</h3><p>La app utiliza cookies necesarias para la sesión (hasta 30 días en gestión o cuatro horas en modo banquillo), el acceso social (10 minutos) y la confirmación de correo social (30 minutos). No incorpora analítica ni cookies publicitarias. Las fuentes se sirven desde la propia aplicación.</p>
    <p>El acceso requiere correo verificado. Las contraseñas se almacenan mediante un resumen criptográfico y los datos deportivos e imágenes se cifran cuando la instalación dispone de su clave. El despliegue de producción exige esa clave y HTTPS. Ningún sistema puede garantizar que nunca ocurra un incidente.</p>
  </>}</article>;
}

export function PublicPrivacy(){return <main className="public-privacy"><Logo/><a className="text-button" href="/">Volver a BucaGest</a><PrivacyNotice/></main>;}

type Action='export'|'player-export'|'erase'|'sessions'|'account'|'bench';
export default function PrivacyPage({workspace,team,demo,onUpdated,onSignedOut}:{workspace:Workspace;team:Team;demo:boolean;onUpdated:(data:{workspace:Workspace;userId:string;serverNow:number})=>void;onSignedOut:()=>void}){
  const [action,setAction]=useState<Action|null>(null),[playerId,setPlayerId]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState(''),[message,setMessage]=useState('');
  const player=team.players.find(p=>p.id===playerId);
  const destructive=action==='erase'||action==='account';
  const phrase=action==='account'?'ELIMINAR MI CUENTA':'ELIMINAR';
  const activeMatch=team.matches.find(m=>['live','paused'].includes(m.status));
  const titles:Record<Action,string>={export:'Descargar todos mis datos','player-export':'Descargar datos del jugador',erase:'Eliminar datos del jugador',sessions:'Cerrar todas las sesiones',account:'Eliminar mi cuenta',bench:'Activar modo banquillo'};
  function open(next:Action){setError('');setMessage('');setAction(next);}
  async function submit(e:FormEvent<HTMLFormElement>){
    e.preventDefault();if(busy||!action)return;setBusy(true);setError('');
    const values=Object.fromEntries(new FormData(e.currentTarget));
    try {
      if(action==='bench'){
        await api('bench/start',{teamId:team.id,matchId:activeMatch?.id});location.replace('/');return;
      }else if(action==='export'||action==='player-export'){
        const result=await api('privacy/export',{password:values.password,...(action==='player-export'?{teamId:team.id,playerId}:{})});
        const url=URL.createObjectURL(new Blob([JSON.stringify(result,null,2)],{type:'application/json'}));
        const link=document.createElement('a');link.href=url;link.download=action==='export'?'bucagest-mis-datos.json':'bucagest-datos-jugador.json';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
        setMessage('Descarga preparada. El archivo contiene datos personales: guárdalo en un lugar privado.');
      }else if(action==='erase'){
        const result=await api('privacy/erase-player',{...values,workspaceId:workspace.id,teamId:team.id,revision:workspace.revision,operationId:crypto.randomUUID(),playerId});
        onUpdated(result);setPlayerId('');setMessage('Datos del jugador eliminados de la base activa.');
      }else {await api(action==='sessions'?'privacy/revoke-sessions':'privacy/delete-account',values);onSignedOut();}
      setAction(null);
    }catch(e){setError((e as Error).message);}finally{setBusy(false);}
  }
  return <><div className="page-heading"><div><div className="eyebrow">EL CONTROL DE TUS DATOS</div><h1>Privacidad.</h1><p>Gestiona la información de tu cuenta y de tu plantilla.</p></div><ShieldCheck size={36}/></div>
    <section className="panel privacy-card bench-setup"><h2>La tablet, solo para sustituciones</h2><p>Activa el modo banquillo antes de dejar la tablet a los jugadores. Solo podrán ver los nombres y dorsales de este equipo y registrar cambios del partido activo. La sesión de gestión de esta tablet se cerrará; para volver a gestionar tendrás que iniciar sesión de nuevo. Caduca a las cuatro horas.</p><button className="button dark" disabled={demo||!activeMatch} onClick={()=>open('bench')}><LockKeyhole size={17}/> Activar modo banquillo</button>{!activeMatch&&<p>Inicia el partido y vuelve aquí para preparar la tablet.</p>}</section>
    <div className="privacy-grid"><section className="panel privacy-card"><h2>Tu cuenta</h2><p>Descarga una copia con tus equipos, imágenes y datos de acceso, sin contraseñas ni claves.</p><button className="button secondary" disabled={demo} onClick={()=>open('export')}><Download size={17}/> Descargar mis datos</button><p>Si dejaste la sesión abierta en otra tablet, puedes cerrar todas las sesiones, incluida esta.</p><button className="button secondary" disabled={demo} onClick={()=>open('sessions')}><LockKeyhole size={17}/> Cerrar todas las sesiones</button></section>
    <section className="panel privacy-card"><h2>Datos de un jugador</h2><p>Incluye jugadores archivados. La descarga individual excluye los datos de sus compañeros. Comprueba la identidad del solicitante antes de entregarla.</p><label className="field"><span>Jugador de {team.settings.name}</span><select value={playerId} onChange={e=>setPlayerId(e.target.value)}><option value="">Selecciona un jugador</option>{team.players.map(p=><option key={p.id} value={p.id}>{p.name}{p.archived?' (archivado)':''}</option>)}</select></label><div className="button-group"><button className="button secondary" disabled={demo||!player} onClick={()=>open('player-export')}><Download size={17}/> Descargar</button><button className="button danger" disabled={demo||!player} onClick={()=>open('erase')}><Trash2 size={17}/> Eliminar datos</button></div><p>Archivar no equivale a borrar. Las rectificaciones se realizan al editar la ficha. Para otras solicitudes, contacta con el responsable del equipo.</p></section>
    <section className="panel privacy-card"><h2>Antes de añadir jugadores</h2><p>Identifica al club o persona responsable, informa a los jugadores y documenta la base jurídica y el plazo de conservación. No añadas datos médicos, bancarios o documentos de identidad. Utiliza alias si son suficientes y añade fotos o fechas de nacimiento solo cuando sean necesarias y lícitas.</p><p>Esta versión está preparada para adultos: no introduzcas datos de menores. Debe existir un contrato de encargo entre el responsable y el prestador del servicio.</p></section>
    <section className="panel privacy-card"><h2>Eliminar la cuenta</h2><p>Elimina todos tus equipos, jugadores, partidos, cobros, imágenes y accesos de la base activa. No se puede deshacer desde la app. Resuelve primero las obligaciones legales de conservación y guarda lo que debas mantener de forma restringida.</p><button className="button danger" disabled={demo} onClick={()=>open('account')}><Trash2 size={17}/> Eliminar mi cuenta</button></section></div>
    {message&&<p className="auth-success" role="status">{message}</p>}<section className="panel privacy-card"><PrivacyNotice/></section>
    {action&&<Modal title={titles[action]} onClose={()=>{if(!busy)setAction(null);}}><form onSubmit={submit}>
      {action==='erase'&&<p className="form-note">Vas a eliminar a <strong>{player?.name}</strong>: ficha, foto sin otras referencias, cobros y referencias personales en los partidos de este equipo. Cambiarán sus estadísticas. Otros equipos y copias externas se gestionan por separado. Finaliza cualquier partido en curso antes de continuar.</p>}
      {action==='account'&&<p className="form-note">Se borrarán todos tus equipos y datos de la base activa. Comprueba que tienes autorización y que no existe una obligación pendiente de conservación.</p>}
      {action==='sessions'&&<p className="form-note">Tendrás que iniciar sesión de nuevo en todos tus dispositivos.</p>}
      {action==='bench'?<p className="form-note">Esta tablet quedará limitada a sustituciones contra <strong>{activeMatch?.opponent}</strong>. Los datos de gestión se retirarán de la pantalla y no serán accesibles con esta sesión. Podrás seguir gestionando el partido desde otro dispositivo.</p>:<><label className="field"><span>Confirma tu contraseña</span><input autoFocus name="password" type="password" autoComplete="current-password" required minLength={10} maxLength={128}/></label><p className="form-note">Si entras con Google, Apple o Facebook y no tienes contraseña, usa «He olvidado mi contraseña» en la pantalla de acceso para establecerla con tu correo verificado.</p></>}
      {destructive&&<label className="field"><span>Escribe {phrase} para confirmar</span><input name="confirmation" required autoComplete="off" pattern={phrase} placeholder={phrase}/></label>}
      {error&&<p className="error-text" role="alert">{error}</p>}<div className="form-actions"><button type="button" className="button secondary" disabled={busy} onClick={()=>setAction(null)}>Cancelar</button><button className={`button ${destructive?'danger':'dark'}`} disabled={busy}>{busy?'Procesando…':titles[action]}</button></div>
    </form></Modal>}
  </>;
}
