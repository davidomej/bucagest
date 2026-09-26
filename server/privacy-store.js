import { normalizeWorkspace } from './domain.js';

export function privacyStore(pool, cipher) {
  return {
    async pruneTemporaryData() {
      await pool.query('DELETE FROM minuto_sessions WHERE expires_at<NOW()');
      await pool.query("DELETE FROM minuto_email_tokens WHERE expires_at<NOW()-INTERVAL '1 day'");
      await pool.query('DELETE FROM minuto_oauth_requests WHERE expires_at<NOW()');
      // Never delete legacy accounts that have a password but still need email verification.
      await pool.query("DELETE FROM minuto_users WHERE email_verified_at IS NULL AND password_hash IS NULL AND created_at<NOW()-INTERVAL '7 days'");
      const db=await pool.connect();
      try {
        await db.query('BEGIN');
        const teams=await db.query('SELECT user_id,data FROM minuto_teams FOR UPDATE');
        for(const row of teams.rows) {
          const workspace=normalizeWorkspace(cipher.decode(row.data,row.user_id));
          const refs=new Set(workspace.teams.flatMap(t=>[t.settings.crestId,...t.players.map(p=>p.photoId)]).filter(Boolean));
          const images=await db.query("SELECT id FROM minuto_assets WHERE user_id=$1 AND created_at<NOW()-INTERVAL '1 day'",[row.user_id]);
          for(const image of images.rows) if(!refs.has(image.id)) await db.query('DELETE FROM minuto_assets WHERE id=$1 AND user_id=$2',[image.id,row.user_id]);
        }
        await db.query('COMMIT');
      } catch(error) { await db.query('ROLLBACK'); throw error; }
      finally { db.release(); }
    },
    async exportAccount(userId) {
      const db = await pool.connect();
      try {
        await db.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
        const account = await db.query('SELECT id,email,name,created_at,email_verified_at FROM minuto_users WHERE id=$1', [userId]);
        const workspace = await db.query('SELECT data FROM minuto_teams WHERE user_id=$1', [userId]);
        const identities = await db.query('SELECT provider FROM minuto_identities WHERE user_id=$1', [userId]);
        const images = await db.query('SELECT id,mime,bytes,encrypted FROM minuto_assets WHERE user_id=$1', [userId]);
        const result = {
          exportedAt: new Date().toISOString(), account: account.rows[0],
          workspace: normalizeWorkspace(cipher.decode(workspace.rows[0].data,userId)),
          signInMethods: identities.rows.map(row=>row.provider),
          images: images.rows.map(row=>({id:row.id,mime:row.mime,base64:Buffer.from(row.encrypted?cipher.decrypt(row.bytes,`asset:${userId}:${row.id}`):row.bytes).toString('base64')})),
        };
        await db.query('COMMIT'); return result;
      } catch(error) { await db.query('ROLLBACK'); throw error; }
      finally { db.release(); }
    },
    async revokeSessions(userId) { await pool.query('DELETE FROM minuto_sessions WHERE user_id=$1', [userId]); },
    async deleteAccount(userId) {
      // PostgreSQL cascades atomically to workspaces, images, identities, tokens and sessions.
      await pool.query('DELETE FROM minuto_users WHERE id=$1', [userId]);
    },
  };
}

// A player's copy must not disclose other players, their photographs or their payment records.
export function playerExport(data, teamId, playerId) {
  const team = data.workspace.teams.find(t=>t.id===teamId);
  const player = team?.players.find(p=>p.id===playerId);
  if(!player) return null;
  return {
    exportedAt:data.exportedAt, team:team.settings.name, player,
    payments:team.payments.filter(p=>p.playerId===playerId),
    matches:team.matches.filter(m=>m.lineup.includes(playerId)||m.stints.some(s=>s.playerId===playerId)||m.events.some(e=>e.scorerId===playerId||e.assistId===playerId||e.inId===playerId||e.outId===playerId)).map(m=>({
      date:m.date,opponent:m.opponent,season:m.season,status:m.status,
      started:m.lineup.includes(playerId),stints:m.stints.filter(s=>s.playerId===playerId),
      events:m.events.filter(e=>e.scorerId===playerId||e.assistId===playerId||e.inId===playerId||e.outId===playerId).map(e=>({kind:e.kind,seconds:e.seconds,scored:e.scorerId===playerId,assisted:e.assistId===playerId,entered:e.inId===playerId,left:e.outId===playerId})),
    })),
    images:data.images.filter(i=>i.id===player.photoId),
  };
}
