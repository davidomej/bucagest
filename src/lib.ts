import type { Match, Player, Team } from './types';
export const positions = { POR:'Portero', DEF:'Defensa', MED:'Centrocampista', DEL:'Delantero' };
export const clock = (seconds: number) => `${String(Math.floor(seconds/60)).padStart(2,'0')}:${String(Math.floor(seconds%60)).padStart(2,'0')}`;
export const elapsed = (m: Match, now: number) => m.elapsedSeconds+(m.runningSince===null?0:Math.max(0,now-m.runningSince)/1000);
export const secondsFor = (m: Match, id: string, now: number) => m.stints.filter(s=>s.playerId===id).reduce((n,s)=>n+Math.max(0,(s.outSeconds??elapsed(m,now))-s.inSeconds),0);
export const totalFor = (team: Team, id: string) => team.matches.filter(m=>m.status==='finished' && m.season===team.settings.season).reduce((n,m)=>n+secondsFor(m,id,0),0);
export const initials = (name: string) => name.split(' ').filter(Boolean).slice(0,2).map(s=>s[0]).join('').toUpperCase();
export const shortName = (p: Player) => `${p.name.split(' ')[0][0]}. ${p.name.split(' ').slice(1).join(' ') || p.name}`;
export const dateLabel = (date: string, options?: Intl.DateTimeFormatOptions) => new Date(date).toLocaleDateString('es-ES', options??{day:'numeric',month:'short'});
export const timeLabel = (date: string) => new Date(date).toLocaleTimeString('es-ES',{hour:'2-digit',minute:'2-digit'});
export function age(birthdate: string|null, today: Date = new Date()) {
  if(!birthdate) return null;
  const [y,m,d]=birthdate.split('-').map(Number);
  let years=today.getFullYear()-y;
  if(today.getMonth()+1<m||(today.getMonth()+1===m&&today.getDate()<d)) years--;
  return years;
}
export const assetUrl = (id: string|null) => id ? `/api/assets/${id}` : null;
export async function api(path: string, body?: unknown) {
  const response=await fetch(`/api/${path}`,{credentials:'same-origin',signal:AbortSignal.timeout(15000),...(body===undefined?{}:{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)})});
  const data=await response.json();
  if(!response.ok) throw Object.assign(new Error(data.error||'No se pudo completar la operación.'),{status:response.status});
  return data;
}
export function resizeImage(file: File, size: number): Promise<Blob> {
  return new Promise((resolve,reject)=>{
    const img=new Image();
    const url=URL.createObjectURL(file);
    img.onload=()=>{
      URL.revokeObjectURL(url);
      const side=Math.min(img.naturalWidth,img.naturalHeight);
      const sx=(img.naturalWidth-side)/2, sy=(img.naturalHeight-side)/2;
      const canvas=document.createElement('canvas'); canvas.width=size; canvas.height=size;
      const ctx=canvas.getContext('2d');
      if(!ctx) return reject(new Error('No se puede procesar la imagen.'));
      ctx.drawImage(img,sx,sy,side,side,0,0,size,size);
      canvas.toBlob(blob=>blob?resolve(blob):reject(new Error('No se puede procesar la imagen.')),'image/webp',0.82);
    };
    img.onerror=()=>{URL.revokeObjectURL(url);reject(new Error('El archivo no es una imagen válida.'));};
    img.src=url;
  });
}
export async function uploadAsset(blob: Blob): Promise<string> {
  const response=await fetch('/api/assets',{method:'POST',credentials:'same-origin',signal:AbortSignal.timeout(15000),headers:{'Content-Type':blob.type},body:blob});
  const data=await response.json();
  if(!response.ok) throw Object.assign(new Error(data.error||'No se pudo subir la imagen.'),{status:response.status});
  return data.id;
}
export function downloadCSV(filename: string, rows: (string|number)[][]) {
  const csv='\uFEFF'+rows.map(row=>row.map(cell=>`"${String(cell).replace(/^[=+@\-\t\r]/,"'$&").replaceAll('"','""')}"`).join(',')).join('\r\n');
  const url=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8;'})); const link=document.createElement('a');link.href=url;link.download=filename;link.click();URL.revokeObjectURL(url);
}
