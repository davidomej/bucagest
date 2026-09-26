import {createHash,randomBytes,randomUUID} from 'node:crypto';
import {AppError,emptyWorkspace} from './domain.js';

const hash = value => createHash('sha256').update(value).digest('hex');
export const authSchema = `
ALTER TABLE minuto_users ADD COLUMN IF NOT EXISTS email_verified_at TIMESTAMPTZ;
ALTER TABLE minuto_users ALTER COLUMN password_hash DROP NOT NULL;
CREATE TABLE IF NOT EXISTS minuto_email_tokens (
  token_hash TEXT PRIMARY KEY, user_id UUID NOT NULL REFERENCES minuto_users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('verify','reset')), expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS minuto_email_tokens_user ON minuto_email_tokens(user_id);
ALTER TABLE minuto_email_tokens ADD COLUMN IF NOT EXISTS browser_hash TEXT;
CREATE TABLE IF NOT EXISTS minuto_identities (
  provider TEXT NOT NULL, subject TEXT NOT NULL, user_id UUID NOT NULL REFERENCES minuto_users(id) ON DELETE CASCADE,
  PRIMARY KEY(provider,subject), UNIQUE(user_id,provider)
);
CREATE TABLE IF NOT EXISTS minuto_oauth_requests (
  state_hash TEXT PRIMARY KEY, browser_hash TEXT NOT NULL, provider TEXT NOT NULL,
  verifier TEXT NOT NULL, nonce TEXT NOT NULL, expires_at TIMESTAMPTZ NOT NULL
);`;

export function authStore(pool, hashPassword, encode = data => data) {
  async function transaction(work){
    const db=await pool.connect();
    try{await db.query('BEGIN');const result=await work(db);await db.query('COMMIT');return result;}
    catch(error){await db.query('ROLLBACK');throw error;}
    finally{db.release();}
  }
  return {
    async register({email,name,teamName}){
      return transaction(async db=>{
        const id=randomUUID();
        const inserted=await db.query('INSERT INTO minuto_users(id,email,name) VALUES ($1,$2,$3) ON CONFLICT(email) DO NOTHING RETURNING id',[id,email,name]);
        if(inserted.rows.length)await db.query('INSERT INTO minuto_teams(user_id,data) VALUES ($1,$2)',[id,JSON.stringify(encode(emptyWorkspace(teamName),id))]);
      });
    },
    async emailToken(email,kind,browser=null){
      return transaction(async db=>{
        const {rows}=await db.query('SELECT id,email,email_verified_at FROM minuto_users WHERE email=$1 FOR UPDATE',[email]);
        const user=rows[0];
        if(!user || (kind==='verify'&&user.email_verified_at))return null;
        const recent=await db.query("SELECT COUNT(*) AS count, MAX(created_at) AS last FROM minuto_email_tokens WHERE user_id=$1 AND created_at>NOW()-INTERVAL '1 hour'",[user.id]);
        if(Number(recent.rows[0].count)>=5 || (recent.rows[0].last && Date.now()-new Date(recent.rows[0].last).getTime()<60000))return null;
        const token=randomBytes(32).toString('hex');
        await db.query("DELETE FROM minuto_email_tokens WHERE expires_at<NOW()-INTERVAL '1 day'");
        await db.query("INSERT INTO minuto_email_tokens(token_hash,user_id,kind,browser_hash,expires_at) VALUES ($1,$2,$3,$4,NOW()+INTERVAL '30 minutes')",[hash(token),user.id,kind,browser?hash(browser):null]);
        return {token,email:user.email};
      });
    },
    async discardEmailToken(token){await pool.query('DELETE FROM minuto_email_tokens WHERE token_hash=$1',[hash(token)]);},
    async completeEmail({token,kind,password,browser}){
      const passwordHash=await hashPassword(password);
      return transaction(async db=>{
        // Serialize all links for this user before checking/consuming the token.
        const result=await db.query('SELECT u.id,u.email_verified_at FROM minuto_users u JOIN minuto_email_tokens t ON t.user_id=u.id WHERE t.token_hash=$1 FOR UPDATE OF u',[hash(token)]);
        if(!result.rows[0])throw new AppError('El enlace no es válido o ya se ha utilizado. Solicita uno nuevo.',400);
        const valid=await db.query('SELECT user_id,browser_hash FROM minuto_email_tokens WHERE token_hash=$1 AND kind=$2 AND expires_at>NOW()',[hash(token),kind]);
        if(!valid.rows.length)throw new AppError('El enlace ha caducado o ya se ha utilizado. Solicita uno nuevo.',400);
        const id=valid.rows[0].user_id;
        if(valid.rows[0].browser_hash && (!browser || hash(browser)!==valid.rows[0].browser_hash))throw new AppError('Abre este enlace en el navegador donde comenzaste el acceso social. También puedes solicitar recuperación por correo.',400);
        // An email-only recovery must not activate an identity attached before its mailbox was verified.
        if(!result.rows[0].email_verified_at && !valid.rows[0].browser_hash)await db.query('DELETE FROM minuto_identities WHERE user_id=$1',[id]);
        const {rows}=await db.query('UPDATE minuto_users SET password_hash=$2,email_verified_at=COALESCE(email_verified_at,NOW()) WHERE id=$1 RETURNING id,email,name',[id,passwordHash]);
        await db.query('DELETE FROM minuto_email_tokens WHERE user_id=$1',[id]);
        await db.query('DELETE FROM minuto_sessions WHERE user_id=$1',[id]);
        return rows[0];
      });
    },
    async beginOAuth(provider,{state,browser,verifier,nonce}){
      await pool.query('DELETE FROM minuto_oauth_requests WHERE expires_at<NOW()');
      await pool.query("INSERT INTO minuto_oauth_requests(state_hash,browser_hash,provider,verifier,nonce,expires_at) VALUES ($1,$2,$3,$4,$5,NOW()+INTERVAL '10 minutes')",[hash(state),hash(browser),provider,verifier,nonce]);
    },
    async consumeOAuth(provider,state,browser){
      const {rows}=await pool.query('DELETE FROM minuto_oauth_requests WHERE state_hash=$1 AND browser_hash=$2 AND provider=$3 AND expires_at>NOW() RETURNING verifier,nonce',[hash(state),hash(browser),provider]);
      if(!rows.length)throw new AppError('La solicitud de acceso ha caducado. Vuelve a intentarlo.',400);
      return rows[0];
    },
    async socialUser({provider,subject,email,name,emailVerified},registrationAllowed){
      return transaction(async db=>{
        const existing=await db.query('SELECT u.id,u.email,u.name,u.email_verified_at FROM minuto_identities i JOIN minuto_users u ON u.id=i.user_id WHERE i.provider=$1 AND i.subject=$2',[provider,subject]);
        if(existing.rows[0])return existing.rows[0];
        if(!registrationAllowed)throw new AppError('El registro no está disponible.',403);
        if(!email)throw new AppError('El proveedor no ha compartido tu correo. Regístrate con correo electrónico.',400);
        const id=randomUUID();
        const inserted=await db.query('INSERT INTO minuto_users(id,email,name,email_verified_at) VALUES ($1,$2,$3,$4) ON CONFLICT(email) DO NOTHING RETURNING id,email,name,email_verified_at',[id,email,name||'Entrenador',emailVerified?new Date():null]);
        if(!inserted.rows.length)throw new AppError('Ya existe una cuenta con este correo. Entra con tu método habitual o recupera tu contraseña.',409);
        await db.query('INSERT INTO minuto_identities(provider,subject,user_id) VALUES ($1,$2,$3)',[provider,subject,id]);
        await db.query('INSERT INTO minuto_teams(user_id,data) VALUES ($1,$2)',[id,JSON.stringify(encode(emptyWorkspace('Mi equipo'),id))]);
        return inserted.rows[0];
      });
    }
  };
}
