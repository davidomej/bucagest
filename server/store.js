import { createHash, randomBytes, randomUUID, scrypt as scryptCb, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { Pool } from 'pg';
import { AppError, applyCommand, emptyWorkspace, normalizeWorkspace } from './domain.js';
import { demoWorkspace } from './seed.js';
const scrypt = promisify(scryptCb);
const tokenHash = value => createHash('sha256').update(value).digest('hex');
export async function hashPassword(password) {
  const salt = randomBytes(16).toString('hex');
  const key = await scrypt(password, salt, 64);
  return `${salt}:${key.toString('hex')}`;
}
async function verifyPassword(password, stored) {
  const [salt, expected] = stored.split(':');
  const key = await scrypt(password, salt, 64);
  return timingSafeEqual(key, Buffer.from(expected, 'hex'));
}
export const schema = `
CREATE TABLE IF NOT EXISTS minuto_users (
  id UUID PRIMARY KEY, email TEXT UNIQUE NOT NULL, password_hash TEXT NOT NULL,
  name TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS minuto_teams (
  user_id UUID PRIMARY KEY REFERENCES minuto_users(id) ON DELETE CASCADE,
  data JSONB NOT NULL
);
CREATE TABLE IF NOT EXISTS minuto_sessions (
  token_hash TEXT PRIMARY KEY, user_id UUID NOT NULL REFERENCES minuto_users(id) ON DELETE CASCADE,
  expires_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS minuto_sessions_expiry ON minuto_sessions(expires_at);
CREATE TABLE IF NOT EXISTS minuto_commands (
  user_id UUID NOT NULL REFERENCES minuto_users(id) ON DELETE CASCADE,
  operation_id UUID NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY(user_id, operation_id)
);
CREATE TABLE IF NOT EXISTS minuto_assets (
  id UUID PRIMARY KEY, user_id UUID NOT NULL REFERENCES minuto_users(id) ON DELETE CASCADE,
  mime TEXT NOT NULL, bytes BYTEA NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS minuto_assets_user ON minuto_assets(user_id);
-- Migrate a pre-multiteam single-team blob (settings/players/matches at the top level) into a workspace.
UPDATE minuto_teams SET data = jsonb_build_object(
  'id', data->'id', 'revision', data->'revision', 'activeTeamId', data->'id',
  'leagues', '[]'::jsonb,
  'teams', jsonb_build_array(
    (data - 'revision')
    || jsonb_build_object('settings', (data->'settings') || jsonb_build_object(
        'leagueIds', '[]'::jsonb, 'crestId', 'null'::jsonb,
        'colors', jsonb_build_object('primary','#8ac9eb','secondary','#243944')
      ))
  )
) WHERE data ? 'settings';`;

export async function createStore({ demo = false, pool: providedPool } = {}) {
  if (demo) {
    let workspace = normalizeWorkspace(demoWorkspace()); const seen = new Set(); const assets = new Map();
    return { demo: true, health: async()=>true, close: async()=>{},
      session: async()=>({ id:'demo', name:'Entrenador', email:'demo@minuto.local' }),
      workspace: async()=>structuredClone(workspace),
      command: async(_id, body)=>{
        if(body.workspaceId !== workspace.id) throw new AppError('El equipo activo ha cambiado. Recarga la página.',409);
        if (seen.has(body.operationId)) return structuredClone(workspace);
        if (body.revision !== workspace.revision) throw new AppError('Otro dispositivo ha actualizado el equipo. Revisa los datos e inténtalo de nuevo.',409);
        workspace = applyCommand(workspace,body); seen.add(body.operationId); return structuredClone(workspace);
      },
      putAsset: async(_id, mime, buffer)=>{ const id=randomUUID(); assets.set(id,{mime,bytes:buffer}); return id; },
      getAsset: async(_id, assetId)=> assets.get(assetId) ?? null,
      deleteAsset: async(_id, assetId)=>{ assets.delete(assetId); }
    };
  }
  if (!providedPool && !process.env.DATABASE_URL) throw new Error('Falta DATABASE_URL. Configura PostgreSQL o usa DEMO_MODE=true solo en desarrollo.');
  const pool = providedPool ?? new Pool({ connectionString:process.env.DATABASE_URL, max:10, connectionTimeoutMillis:10000,
    ...(process.env.DATABASE_SSL_CA ? {ssl:{ca:process.env.DATABASE_SSL_CA.replaceAll('\\n','\n'),rejectUnauthorized:true}} : {}) });
  if (pool.on) pool.on('error', ()=>console.error('La conexión inactiva con PostgreSQL se ha interrumpido.'));
  await pool.query(schema);
  return { demo:false,
    health:async()=>{await pool.query('SELECT 1'); return true;}, close:()=>pool.end(),
    async register({email,password,name,teamName}) {
      const hash = await hashPassword(password), id = randomUUID(); const db = await pool.connect();
      try {
        await db.query('BEGIN');
        await db.query('INSERT INTO minuto_users(id,email,password_hash,name) VALUES ($1,$2,$3,$4)',[id,email,hash,name]);
        await db.query('INSERT INTO minuto_teams(user_id,data) VALUES ($1,$2)',[id,JSON.stringify(emptyWorkspace(teamName))]);
        await db.query('COMMIT'); return {id,email,name};
      } catch(error) { await db.query('ROLLBACK'); if(error.code==='23505') throw new AppError('No se puede crear una cuenta con ese correo.',409); throw error; }
      finally { db.release(); }
    },
    async login({email,password}) {
      const {rows} = await pool.query('SELECT id,email,name,password_hash FROM minuto_users WHERE email=$1',[email]);
      // Perform a password derivation even for unknown accounts to reduce timing differences.
      const stored = rows[0]?.password_hash ?? '00000000000000000000000000000000:'+ '00'.repeat(64);
      const valid = await verifyPassword(password,stored);
      if(!rows[0] || !valid) throw new AppError('Correo o contraseña incorrectos.',401);
      return {id:rows[0].id,email:rows[0].email,name:rows[0].name};
    },
    async createSession(userId) {
      const token = randomBytes(32).toString('hex');
      await pool.query("DELETE FROM minuto_sessions WHERE expires_at < NOW()");
      await pool.query("INSERT INTO minuto_sessions(token_hash,user_id,expires_at) VALUES ($1,$2,NOW()+INTERVAL '30 days')",[tokenHash(token),userId]);
      return token;
    },
    async session(token) {
      if(!token) return null;
      const {rows} = await pool.query('SELECT u.id,u.email,u.name FROM minuto_sessions s JOIN minuto_users u ON u.id=s.user_id WHERE s.token_hash=$1 AND s.expires_at>NOW()',[tokenHash(token)]);
      return rows[0] ?? null;
    },
    async logout(token) { if(token) await pool.query('DELETE FROM minuto_sessions WHERE token_hash=$1',[tokenHash(token)]); },
    async workspace(userId) { const {rows} = await pool.query('SELECT data FROM minuto_teams WHERE user_id=$1',[userId]); if(!rows[0]) throw new AppError('No se encuentra el equipo.',404); return normalizeWorkspace(rows[0].data); },
    async command(userId,body) {
      const db = await pool.connect();
      try {
        await db.query('BEGIN');
        const {rows} = await db.query('SELECT data FROM minuto_teams WHERE user_id=$1 FOR UPDATE',[userId]);
        if(!rows[0]) throw new AppError('No se encuentra el equipo.',404);
        const workspace = normalizeWorkspace(rows[0].data);
        if(body.workspaceId !== workspace.id) throw new AppError('El equipo activo ha cambiado. Recarga la página.',409);
        const seen = await db.query('SELECT 1 FROM minuto_commands WHERE user_id=$1 AND operation_id=$2',[userId,body.operationId]);
        if(seen.rows.length) { await db.query('COMMIT'); return workspace; }
        if(body.revision!==workspace.revision) throw new AppError('Otro dispositivo ha actualizado el equipo. Revisa los datos e inténtalo de nuevo.',409);
        const state = applyCommand(workspace,body);
        await db.query('UPDATE minuto_teams SET data=$2 WHERE user_id=$1',[userId,JSON.stringify(state)]);
        await db.query('INSERT INTO minuto_commands(user_id,operation_id) VALUES ($1,$2)',[userId,body.operationId]);
        await db.query('COMMIT'); return state;
      } catch(error) { await db.query('ROLLBACK'); throw error; } finally { db.release(); }
    },
    async putAsset(userId, mime, buffer) {
      const id = randomUUID();
      await pool.query('INSERT INTO minuto_assets(id,user_id,mime,bytes) VALUES ($1,$2,$3,$4)',[id,userId,mime,buffer]);
      return id;
    },
    async getAsset(userId, assetId) {
      const {rows} = await pool.query('SELECT mime,bytes FROM minuto_assets WHERE id=$1 AND user_id=$2',[assetId,userId]);
      return rows[0] ? { mime: rows[0].mime, bytes: rows[0].bytes } : null;
    },
    async deleteAsset(userId, assetId) {
      await pool.query('DELETE FROM minuto_assets WHERE id=$1 AND user_id=$2',[assetId,userId]);
    }
  };
}
