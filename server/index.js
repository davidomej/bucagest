import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createStore } from './store.js';
import { createApp, errorHandler } from './app.js';
import { privacyNotice } from './privacy.js';
try { process.loadEnvFile(); } catch(error) { if(error.code !== 'ENOENT') throw error; }
const production=process.env.NODE_ENV==='production';
const demo=process.env.DEMO_MODE==='true';
if(production && demo) throw new Error('DEMO_MODE no está permitido en producción. Configura DATABASE_URL.');
if(production && (!process.env.APP_ORIGIN || !process.env.APP_ORIGIN.startsWith('https://'))) throw new Error('APP_ORIGIN debe ser la URL pública HTTPS, sin barra final.');
if(production && !process.env.DATA_ENCRYPTION_KEY) throw new Error('Configura DATA_ENCRYPTION_KEY antes de desplegar. Consulta PRIVACY_SETUP.md.');
if(production && !privacyNotice().configured) throw new Error('Completa las variables PRIVACY_* del aviso de privacidad. Consulta PRIVACY_SETUP.md.');
const store=await createStore({demo});
let cleaning=false;
async function cleanup(){
  if(cleaning||!store.pruneTemporaryData)return;
  cleaning=true;
  try{await store.pruneTemporaryData();}catch{console.error('No se pudo completar la limpieza de datos temporales.');}
  finally{cleaning=false;}
}
await cleanup();
const cleanupTimer=setInterval(cleanup,60*60*1000);cleanupTimer.unref();
const app=createApp(store,{production});
if(production) {
  const dist=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../dist');
  app.use(express.static(dist,{maxAge:'1h'}));
  app.get('/{*path}',(req,res)=>res.sendFile(path.join(dist,'index.html')));
} else {
  const {createServer}=await import('vite');
  const vite=await createServer({server:{middlewareMode:true},appType:'spa'});
  app.use(vite.middlewares);
}
app.use(errorHandler);
const port=Number(process.env.PORT||3000);
const server=app.listen(port,'0.0.0.0',()=>console.log(`Minuto disponible en http://localhost:${port}${demo?' (demo temporal)':''}`));
async function shutdown(){clearInterval(cleanupTimer);server.close(async()=>{await store.close(); process.exit(0);}); setTimeout(()=>process.exit(1),10000).unref();}
process.on('SIGTERM',shutdown);process.on('SIGINT',shutdown);
