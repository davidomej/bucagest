import {createHash, randomBytes, randomUUID} from 'node:crypto';
import {AppError, normalizeWorkspace, playerSeconds} from './domain.js';

const hash = value => createHash('sha256').update(value).digest('hex');
export const playerAccessSchema = `
ALTER TABLE minuto_users ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'manager' CHECK (role IN ('manager','player'));
CREATE TABLE IF NOT EXISTS minuto_player_access (
  owner_id UUID NOT NULL REFERENCES minuto_users(id) ON DELETE CASCADE,
  team_id UUID NOT NULL, player_id UUID NOT NULL, email_cipher BYTEA NOT NULL,
  user_id UUID REFERENCES minuto_users(id) ON DELETE CASCADE,
  token_hash TEXT UNIQUE, expires_at TIMESTAMPTZ, sent_at TIMESTAMPTZ,
  accepted_at TIMESTAMPTZ, PRIMARY KEY(owner_id,team_id,player_id)
);
CREATE INDEX IF NOT EXISTS minuto_player_access_user ON minuto_player_access(user_id);
CREATE TABLE IF NOT EXISTS minuto_official_competitions (
  owner_id UUID NOT NULL REFERENCES minuto_users(id) ON DELETE CASCADE,
  league_id UUID NOT NULL, season TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('league','cup')),
  source_url TEXT, updated_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY(owner_id,league_id,season)
);
CREATE TABLE IF NOT EXISTS minuto_official_results (
  owner_id UUID NOT NULL, league_id UUID NOT NULL, season TEXT NOT NULL,
  external_id TEXT NOT NULL, match_date TIMESTAMPTZ, round TEXT NOT NULL DEFAULT '',
  home_team TEXT NOT NULL, away_team TEXT NOT NULL,
  home_score INTEGER CHECK(home_score>=0), away_score INTEGER CHECK(away_score>=0),
  status TEXT NOT NULL CHECK(status IN ('scheduled','finished','postponed')),
  PRIMARY KEY(owner_id,league_id,season,external_id),
  FOREIGN KEY(owner_id,league_id,season) REFERENCES minuto_official_competitions ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS minuto_official_standings (
  owner_id UUID NOT NULL, league_id UUID NOT NULL, season TEXT NOT NULL,
  group_name TEXT NOT NULL DEFAULT '', position INTEGER NOT NULL CHECK(position>0), team_name TEXT NOT NULL,
  played INTEGER NOT NULL CHECK(played>=0), won INTEGER NOT NULL CHECK(won>=0),
  drawn INTEGER NOT NULL CHECK(drawn>=0), lost INTEGER NOT NULL CHECK(lost>=0),
  goals_for INTEGER NOT NULL CHECK(goals_for>=0), goals_against INTEGER NOT NULL CHECK(goals_against>=0), points INTEGER NOT NULL,
  PRIMARY KEY(owner_id,league_id,season,group_name,position),
  FOREIGN KEY(owner_id,league_id,season) REFERENCES minuto_official_competitions ON DELETE CASCADE
);`;

// Called inside the same workspace transaction: changing an address, archiving or
// erasing a player removes their access and all outstanding invitations atomically.
function sealEmail(cipher,ownerId,teamId,playerId,email) {
  return cipher.enabled?cipher.encrypt(Buffer.from(email),`player-email:${ownerId}:${teamId}:${playerId}`):Buffer.from(hash(email),'hex');
}
function matchesEmail(cipher,ownerId,teamId,playerId,email,stored) {
  if(!email)return false;
  if(!cipher.enabled)return hash(email)===Buffer.from(stored).toString('hex');
  try{return cipher.decrypt(stored,`player-email:${ownerId}:${teamId}:${playerId}`).toString('utf8')===email;}
  catch{return false;}
}

export async function syncPlayerAccess(db,ownerId,workspace,cipher) {
  const {rows}=await db.query('SELECT team_id,player_id,email_cipher FROM minuto_player_access WHERE owner_id=$1',[ownerId]);
  for(const row of rows) {
    const p=workspace.teams.find(t=>t.id===row.team_id)?.players.find(p=>p.id===row.player_id);
    if(!p||p.archived||!matchesEmail(cipher,ownerId,row.team_id,row.player_id,p.email,row.email_cipher))await db.query('DELETE FROM minuto_player_access WHERE owner_id=$1 AND team_id=$2 AND player_id=$3',[ownerId,row.team_id,row.player_id]);
  }
  await db.query('DELETE FROM minuto_official_competitions WHERE owner_id=$1 AND NOT (league_id = ANY($2::uuid[]))',[ownerId,workspace.leagues.map(l=>l.id)]);
}

export function playerStore(pool,cipher,hashPassword,verifyPassword) {
  async function transaction(work) {
    const db=await pool.connect();
    try {await db.query('BEGIN');const result=await work(db);await db.query('COMMIT');return result;}
    catch(error){await db.query('ROLLBACK');throw error;} finally{db.release();}
  }
  async function workspaceFor(db,ownerId,lock=false) {
    const {rows}=await db.query(`SELECT data FROM minuto_teams WHERE user_id=$1${lock?' FOR UPDATE':''}`,[ownerId]);
    if(!rows[0])throw new AppError('El equipo ya no está disponible.',404);
    return normalizeWorkspace(cipher.decode(rows[0].data,ownerId));
  }
  function roster(workspace,ownerId,teamId,playerId,emailCipher) {
    const team=workspace.teams.find(t=>t.id===teamId),player=team?.players.find(p=>p.id===playerId&&!p.archived);
    if(!player||!player.email||(emailCipher&&!matchesEmail(cipher,ownerId,teamId,playerId,player.email,emailCipher)))throw new AppError('La invitación o el acceso ya no está disponible.',400);
    return {team,player};
  }
  async function validInvitation(db,token,lock=false) {
    const found=await db.query('SELECT owner_id FROM minuto_player_access WHERE token_hash=$1 AND expires_at>NOW()',[hash(token)]);
    if(!found.rows[0])throw new AppError('La invitación ha caducado o ya se ha utilizado. Pide a tu equipo que la reenvíe.',400);
    const workspace=await workspaceFor(db,found.rows[0].owner_id,lock);
    const {rows}=await db.query(`SELECT * FROM minuto_player_access WHERE token_hash=$1 AND expires_at>NOW()${lock?' FOR UPDATE':''}`,[hash(token)]);
    if(!rows[0])throw new AppError('La invitación ya no está disponible.',400);
    const verified=roster(workspace,rows[0].owner_id,rows[0].team_id,rows[0].player_id,rows[0].email_cipher);
    return {...verified,access:rows[0]};
  }
  return {
    async playerAccess(ownerId,teamId) {
      const workspace=await workspaceFor(pool,ownerId);
      if(!workspace.teams.some(t=>t.id===teamId))throw new AppError('No se encuentra el equipo.',404);
      const {rows}=await pool.query('SELECT player_id,accepted_at,sent_at,expires_at FROM minuto_player_access WHERE owner_id=$1 AND team_id=$2',[ownerId,teamId]);
      return rows.map(r=>({playerId:r.player_id,status:r.accepted_at?'active':!r.sent_at?'not-sent':new Date(r.expires_at)>new Date()?'pending':'expired'}));
    },
    async invitePlayer(ownerId,teamId,playerId) {
      return transaction(async db=>{
        const workspace=await workspaceFor(db,ownerId,true),{team,player}=roster(workspace,ownerId,teamId,playerId);
        const {rows}=await db.query('SELECT * FROM minuto_player_access WHERE owner_id=$1 AND team_id=$2 AND player_id=$3',[ownerId,teamId,playerId]);
        if(rows[0]?.accepted_at)return null;
        if(rows[0]?.sent_at&&Date.now()-new Date(rows[0].sent_at).getTime()<60000)throw new AppError('Espera un minuto antes de reenviar la invitación.',429);
        const token=randomBytes(32).toString('hex');
        await db.query(`INSERT INTO minuto_player_access(owner_id,team_id,player_id,email_cipher,token_hash,expires_at,sent_at)
          VALUES($1,$2,$3,$4,$5,NOW()+INTERVAL '72 hours',NOW())
          ON CONFLICT(owner_id,team_id,player_id) DO UPDATE SET email_cipher=EXCLUDED.email_cipher,token_hash=EXCLUDED.token_hash,expires_at=EXCLUDED.expires_at,sent_at=EXCLUDED.sent_at`,[ownerId,teamId,playerId,sealEmail(cipher,ownerId,teamId,playerId,player.email),hash(token)]);
        return {token,email:player.email,teamName:team.settings.name,playerName:player.name,kind:'invite'};
      });
    },
    async discardPlayerInvitation(token) {
      await pool.query('UPDATE minuto_player_access SET token_hash=NULL,sent_at=NULL,expires_at=NULL WHERE token_hash=$1',[hash(token)]);
    },
    async revokePlayerAccess(ownerId,teamId,playerId) {
      return transaction(async db=>{
        const workspace=await workspaceFor(db,ownerId,true);roster(workspace,ownerId,teamId,playerId);
        await db.query('DELETE FROM minuto_player_access WHERE owner_id=$1 AND team_id=$2 AND player_id=$3',[ownerId,teamId,playerId]);
      });
    },
    async invitationInfo(token) {
      const {access,team,player}=await validInvitation(pool,token);
      const {rows}=await pool.query('SELECT email_verified_at FROM minuto_users WHERE email=$1',[player.email]);
      return {email:player.email,teamName:team.settings.name,playerName:player.name,existingAccount:Boolean(rows[0]?.email_verified_at)};
    },
    async acceptInvitation(token,password) {
      const passwordHash=await hashPassword(password);
      return transaction(async db=>{
        const {access,player}=await validInvitation(db,token,true);
        await db.query("INSERT INTO minuto_users(id,email,name,role) VALUES($1,$2,$3,'player') ON CONFLICT(email) DO NOTHING",[randomUUID(),player.email,player.name]);
        const {rows}=await db.query('SELECT id,password_hash,email_verified_at FROM minuto_users WHERE email=$1 FOR UPDATE',[player.email]);
        const user=rows[0];
        if(user.email_verified_at) {
          if(!user.password_hash||!await verifyPassword(password,user.password_hash))throw new AppError('Introduce la contraseña de tu cuenta actual. Si no la recuerdas, recupérala desde el inicio de sesión.',401);
        } else {
          await db.query('UPDATE minuto_users SET password_hash=$2,email_verified_at=NOW() WHERE id=$1',[user.id,passwordHash]);
          await db.query('DELETE FROM minuto_identities WHERE user_id=$1',[user.id]);
          await db.query('DELETE FROM minuto_email_tokens WHERE user_id=$1',[user.id]);
          await db.query('DELETE FROM minuto_sessions WHERE user_id=$1',[user.id]);
        }
        await db.query('UPDATE minuto_player_access SET user_id=$4,accepted_at=NOW(),token_hash=NULL,expires_at=NULL WHERE owner_id=$1 AND team_id=$2 AND player_id=$3',[access.owner_id,access.team_id,access.player_id,user.id]);
      });
    },
    async playerPortal(userId) {
      // Read one consistent snapshot so roster revocations and official refreshes
      // cannot produce a mix of old and new records within the response.
      return transaction(async db=>{
        await db.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
        const {rows}=await db.query('SELECT * FROM minuto_player_access WHERE user_id=$1 AND accepted_at IS NOT NULL',[userId]);
        const teams=[];
        for(const access of rows) {
          const workspace=await workspaceFor(db,access.owner_id);
          const team=workspace.teams.find(t=>t.id===access.team_id),player=team?.players.find(p=>p.id===access.player_id&&!p.archived&&matchesEmail(cipher,access.owner_id,access.team_id,access.player_id,p.email,access.email_cipher));
          if(!player)continue;
          const playerNames=new Map(team.players.map(p=>[p.id,p.name]));
          const matches=team.matches.map(m=>{
            const played=m.stints.some(s=>s.playerId===player.id),conceded=m.home?m.awayScore:m.homeScore;
            return {id:m.id,opponent:m.opponent,date:m.date,venue:m.venue,home:m.home,round:m.round,season:m.season,leagueId:m.leagueId,status:m.status,homeScore:m.homeScore,awayScore:m.awayScore,seconds:playerSeconds(m,player.id),played,
              cleanSheet:played&&m.status==='finished'&&['DEF','POR'].includes(player.position)&&conceded===0,
              goals:m.events.filter(e=>e.kind==='goal').map(e=>({seconds:e.seconds,scorerId:e.scorerId,assistId:e.assistId??null,scorer:playerNames.get(e.scorerId)??null,assist:e.assistId?playerNames.get(e.assistId)??null:null}))};
          });
          const competitions=[];
          for(const league of workspace.leagues.filter(l=>team.settings.leagueIds.includes(l.id)&&!l.archived)) {
            const key=[access.owner_id,league.id,league.season];
            const official=(await db.query('SELECT kind,source_url,updated_at FROM minuto_official_competitions WHERE owner_id=$1 AND league_id=$2 AND season=$3',key)).rows[0];
            const results=official?(await db.query('SELECT external_id,match_date,round,home_team,away_team,home_score,away_score,status FROM minuto_official_results WHERE owner_id=$1 AND league_id=$2 AND season=$3 ORDER BY match_date NULLS LAST,external_id',key)).rows:[];
            const standings=official?(await db.query('SELECT group_name,position,team_name,played,won,drawn,lost,goals_for,goals_against,points FROM minuto_official_standings WHERE owner_id=$1 AND league_id=$2 AND season=$3 ORDER BY group_name,position',key)).rows:[];
            competitions.push({id:league.id,name:league.name,season:league.season,kind:official?.kind??league.kind??'league',updatedAt:official?.updated_at??null,sourceUrl:official?.source_url??null,results,standings});
          }
          teams.push({id:team.id,name:team.settings.name,season:team.settings.season,player:{id:player.id,name:player.name,number:player.number,position:player.position},matches,competitions});
        }
        return {teams,serverNow:Date.now()};
      });
    }
  };
}
