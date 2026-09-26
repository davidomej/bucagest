import { createHash, randomBytes, randomUUID, scrypt as scryptCb, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { Pool } from 'pg';
import { AppError, applyCommand, normalizeWorkspace } from './domain.js';
import { demoWorkspace } from './seed.js';
import { authSchema, authStore } from './auth-store.js';
import { dataCipher, migrateEncryption } from './encryption.js';
import { privacyStore } from './privacy-store.js';
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
ALTER TABLE minuto_sessions ADD COLUMN IF NOT EXISTS bench_team_id UUID;
ALTER TABLE minuto_sessions ADD COLUMN IF NOT EXISTS bench_match_id UUID;
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
ALTER TABLE minuto_assets ADD COLUMN IF NOT EXISTS encrypted BOOLEAN NOT NULL DEFAULT FALSE;
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
) WHERE data ? 'settings';
${authSchema}`;

export async function createStore({ demo = false, pool: providedPool, encryptionKey = process.env.DATA_ENCRYPTION_KEY } = {}) {
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
  const cipher = dataCipher(encryptionKey);
  await migrateEncryption(pool,cipher);
  return { demo:false,
    ...authStore(pool,hashPassword,cipher.encode),
    ...privacyStore(pool,cipher),
    health:async()=>{await pool.query('SELECT 1'); return true;}, close:()=>pool.end(),
    async login({email,password}) {
      const {rows} = await pool.query('SELECT id,email,name,password_hash,email_verified_at FROM minuto_users WHERE email=$1',[email]);
      // Perform a password derivation even for unknown accounts to reduce timing differences.
      const stored = rows[0]?.password_hash ?? '00000000000000000000000000000000:'+ '00'.repeat(64);
      const valid = await verifyPassword(password,stored);
      if(!rows[0] || !valid) throw new AppError('Correo o contraseña incorrectos.',401);
      if(!rows[0].email_verified_at) throw new AppError('Confirma tu correo antes de entrar. Utiliza «Reenviar confirmación».',403);
      return {id:rows[0].id,email:rows[0].email,name:rows[0].name};
    },
    async createSession(userId,bench=null) {
      const token = randomBytes(32).toString('hex');
      await pool.query("DELETE FROM minuto_sessions WHERE expires_at < NOW()");
      const created=await pool.query("INSERT INTO minuto_sessions(token_hash,user_id,expires_at,bench_team_id,bench_match_id) SELECT $1,id,NOW()+($3 * INTERVAL '1 hour'),$4,$5 FROM minuto_users WHERE id=$2 AND email_verified_at IS NOT NULL RETURNING user_id",[tokenHash(token),userId,bench?4:720,bench?.teamId??null,bench?.matchId??null]);
      if(!created.rows.length)throw new AppError('Debes verificar tu correo antes de entrar.',403);
      return token;
    },
    async session(token) {
      if(!token) return null;
      const {rows} = await pool.query('SELECT u.id,u.email,u.name,s.bench_team_id,s.bench_match_id FROM minuto_sessions s JOIN minuto_users u ON u.id=s.user_id WHERE s.token_hash=$1 AND s.expires_at>NOW() AND u.email_verified_at IS NOT NULL',[tokenHash(token)]);
      const user=rows[0];
      if(!user)return null;
      return user.bench_team_id?{id:user.id,name:'Banquillo',email:'',scope:'bench',benchTeamId:user.bench_team_id,benchMatchId:user.bench_match_id}:{id:user.id,email:user.email,name:user.name};
    },
    async logout(token) { if(token) await pool.query('DELETE FROM minuto_sessions WHERE token_hash=$1',[tokenHash(token)]); },
    async workspace(userId) { const {rows} = await pool.query('SELECT data FROM minuto_teams WHERE user_id=$1',[userId]); if(!rows[0]) throw new AppError('No se encuentra el equipo.',404); return normalizeWorkspace(cipher.decode(rows[0].data,userId)); },
    async command(userId,body) {
      const db = await pool.connect();
      try {
        await db.query('BEGIN');
        const {rows} = await db.query('SELECT data FROM minuto_teams WHERE user_id=$1 FOR UPDATE',[userId]);
        if(!rows[0]) throw new AppError('No se encuentra el equipo.',404);
        const workspace = normalizeWorkspace(cipher.decode(rows[0].data,userId));
        if(body.workspaceId !== workspace.id) throw new AppError('El equipo activo ha cambiado. Recarga la página.',409);
        const seen = await db.query('SELECT 1 FROM minuto_commands WHERE user_id=$1 AND operation_id=$2',[userId,body.operationId]);
        if(seen.rows.length) { await db.query('COMMIT'); return workspace; }
        if(body.revision!==workspace.revision) throw new AppError('Otro dispositivo ha actualizado el equipo. Revisa los datos e inténtalo de nuevo.',409);
        const state = applyCommand(workspace,body);
        await db.query('UPDATE minuto_teams SET data=$2 WHERE user_id=$1',[userId,JSON.stringify(cipher.encode(state,userId))]);
        // Remove images that lost their last reference; keep newly uploaded, not-yet-saved images.
        const refs = w => new Set(w.teams.flatMap(t=>[t.settings.crestId,...t.players.map(p=>p.photoId)]).filter(Boolean));
        const before = refs(workspace), after = refs(state);
        for(const id of before) if(!after.has(id)) await db.query('DELETE FROM minuto_assets WHERE id=$1 AND user_id=$2',[id,userId]);
        await db.query('INSERT INTO minuto_commands(user_id,operation_id) VALUES ($1,$2)',[userId,body.operationId]);
        await db.query('COMMIT'); return state;
      } catch(error) { await db.query('ROLLBACK'); throw error; } finally { db.release(); }
    },
    async putAsset(userId, mime, buffer) {
      const id = randomUUID();
      await pool.query('INSERT INTO minuto_assets(id,user_id,mime,bytes,encrypted) VALUES ($1,$2,$3,$4,$5)',[id,userId,mime,cipher.enabled?cipher.encrypt(buffer,`asset:${userId}:${id}`):buffer,cipher.enabled]);
      return id;
    },
    async getAsset(userId, assetId) {
      const {rows} = await pool.query('SELECT mime,bytes,encrypted FROM minuto_assets WHERE id=$1 AND user_id=$2',[assetId,userId]);
      return rows[0] ? { mime: rows[0].mime, bytes: rows[0].encrypted?cipher.decrypt(rows[0].bytes,`asset:${userId}:${assetId}`):rows[0].bytes } : null;
    },
    async deleteAsset(userId, assetId) {
      await pool.query('DELETE FROM minuto_assets WHERE id=$1 AND user_id=$2',[assetId,userId]);
    }
  };
}
