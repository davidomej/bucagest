import {randomUUID} from 'node:crypto';
import {AppError} from './domain.js';

const escape = value => value.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function createMailer(env=process.env,send=fetch){
  const configured=Boolean(env.RESEND_API_KEY&&env.AUTH_EMAIL_FROM);
  return {configured,async sendLink({email,token,kind,origin,teamName}){
    if(!configured)throw new AppError('El envío de correos no está configurado. Contacta con el administrador.',503);
    const link=`${origin}/#auth=${kind}&token=${encodeURIComponent(token)}`;
    const title=kind==='invite'?'Tu equipo te invita':kind==='reset'?'Restablece tu contraseña':'Confirma tu correo';
    const duration=kind==='invite'?'72 horas':'30 minutos';
    const description=kind==='invite'?`Has recibido una invitación de ${teamName} para consultar tus minutos, partidos y competiciones. Abre el enlace para verificar tu correo y crear tu contraseña. Si ya tienes cuenta, utiliza tu contraseña actual.`:'Verifica tu correo y elige una contraseña para acceder a tu equipo.';
    const text=`${title} en BucaGest. ${description} Enlace: ${link}\nCaduca en ${duration} y solo puede utilizarse una vez. Si no has solicitado este correo, puedes ignorarlo.`;
    const response=await send('https://api.resend.com/emails',{method:'POST',signal:AbortSignal.timeout(15000),headers:{Authorization:`Bearer ${env.RESEND_API_KEY}`,'Content-Type':'application/json','Idempotency-Key':randomUUID()},body:JSON.stringify({from:env.AUTH_EMAIL_FROM,to:[email],subject:`${title} · BucaGest`,text,html:`<div style="font-family:Arial,sans-serif;background:#f4f7f9;padding:32px"><div style="max-width:480px;margin:auto;background:white;padding:32px;border-radius:16px"><h1 style="color:#14242e">BucaGest<span style="color:#79bfe8">.</span></h1><h2>${title}</h2><p>${escape(description)}</p><p style="margin:32px 0"><a style="background:#8ac9eb;color:#14242e;padding:16px 24px;border-radius:8px;text-decoration:none;font-weight:bold" href="${escape(link)}">${title}</a></p><p>Este enlace caduca en ${duration} y solo puede utilizarse una vez.</p><p>Si no lo has solicitado, ignora este mensaje.</p></div></div>`})});
    if(!response.ok)throw new AppError('No se ha podido enviar el correo. Inténtalo de nuevo más tarde.',503);
  }};
}
