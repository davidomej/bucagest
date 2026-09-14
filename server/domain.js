import { randomUUID } from 'node:crypto';
import { z } from 'zod';

export class AppError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}
const text = z.string().trim().min(1).max(100);
const hexColor = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Color no válido.');
const assetId = z.uuid().nullable().optional().transform(v => v ?? null);
const isoDateOrNull = z.iso.date().nullable().optional().transform(v => v ?? null);
const playerSchema = z.object({ name: text, number: z.number().int().min(0).max(99), position: z.enum(['POR', 'DEF', 'MED', 'DEL']), birthdate: isoDateOrNull, photoId: assetId });
const fixtureSchema = z.object({ opponent: text, date: z.iso.datetime({ offset: true }), venue: z.string().trim().max(120).default(''), home: z.boolean(), round: z.number().int().min(1).max(100), season: text, leagueId: assetId });
const colorsSchema = z.object({ primary: hexColor, secondary: hexColor });
const settingsSchema = z.object({ name: text, leagueIds: z.array(z.uuid()).max(10).default([]), season: text, playersOnField: z.union([z.literal(5), z.literal(7), z.literal(8), z.literal(11)]), matchMinutes: z.number().int().min(10).max(180), allowReentry: z.boolean(), crestId: assetId, colors: colorsSchema.default({ primary: '#8ac9eb', secondary: '#243944' }) });
const leagueSchema = z.object({ name: text, season: text, color: hexColor });
export function elapsed(match, now = Date.now()) {
  return match.elapsedSeconds + (match.runningSince === null ? 0 : Math.max(0, now - match.runningSince) / 1000);
}
export function playerSeconds(match, playerId, now = Date.now()) {
  const end = elapsed(match, now);
  return match.stints.filter(s => s.playerId === playerId).reduce((sum, s) => sum + Math.max(0, (s.outSeconds ?? end) - s.inSeconds), 0);
}
function emptyTeamRecord(name) {
  return { id: randomUUID(), settings: { name, leagueIds: [], season: '2026/27', playersOnField: 7, matchMinutes: 60, allowReentry: true, crestId: null, colors: { primary: '#8ac9eb', secondary: '#243944' } }, players: [], matches: [] };
}
export function emptyTeam(name) {
  return emptyTeamRecord(name);
}
export function emptyWorkspace(name) {
  const team = emptyTeamRecord(name);
  return { id: randomUUID(), revision: 0, activeTeamId: team.id, leagues: [], teams: [team] };
}
const requireThat = (value, message) => { if (!value) throw new AppError(message); };
function event(match, kind, seconds, data = {}) { match.events.unshift({ id: randomUUID(), kind, seconds, ...data }); }
function findTeam(state, teamId) {
  const team = state.teams.find(t => t.id === teamId);
  requireThat(team, 'No se encuentra el equipo.');
  return team;
}
export function applyCommand(original, command, now = Date.now()) {
  const state = structuredClone(original);
  const { type, payload = {} } = command;
  if (type === 'team.create') {
    const { name } = z.object({ name: text }).parse(payload);
    const team = emptyTeamRecord(name);
    state.teams.push(team); state.activeTeamId = team.id;
  } else if (type === 'team.select') {
    const { id } = z.object({ id: z.uuid() }).parse(payload);
    findTeam(state, id); state.activeTeamId = id;
  } else if (type === 'team.delete') {
    const { id } = z.object({ id: z.uuid() }).parse(payload);
    findTeam(state, id);
    requireThat(state.teams.length > 1, 'No puedes eliminar tu único equipo.');
    state.teams = state.teams.filter(t => t.id !== id);
    if (state.activeTeamId === id) state.activeTeamId = state.teams[0].id;
  } else if (type === 'league.save') {
    const value = leagueSchema.parse(payload);
    if (payload.id) {
      const league = state.leagues.find(l => l.id === payload.id);
      requireThat(league, 'No se encuentra la liga.'); Object.assign(league, value);
    } else state.leagues.push({ id: randomUUID(), ...value, archived: false });
  } else if (type === 'league.delete') {
    const { id } = z.object({ id: z.uuid() }).parse(payload);
    requireThat(state.leagues.some(l => l.id === id), 'No se encuentra la liga.');
    state.leagues = state.leagues.filter(l => l.id !== id);
    for (const team of state.teams) {
      team.settings.leagueIds = team.settings.leagueIds.filter(lid => lid !== id);
      for (const match of team.matches) if (match.leagueId === id) match.leagueId = null;
    }
  } else {
    const team = findTeam(state, command.teamId);
    if (type === 'settings') {
      const settings = settingsSchema.parse(payload);
      if (team.matches.some(m => ['live', 'paused'].includes(m.status))) {
        requireThat(settings.playersOnField === team.settings.playersOnField && settings.allowReentry === team.settings.allowReentry, 'Termina el partido antes de cambiar las reglas de juego.');
      }
      requireThat(settings.leagueIds.every(id => state.leagues.some(l => l.id === id)), 'Selecciona una competición válida.');
      team.settings = settings;
    } else if (type === 'player.save') {
      const value = playerSchema.parse(payload);
      requireThat(!team.players.some(p => p.id !== payload.id && !p.archived && p.number === value.number), 'Ese dorsal ya pertenece a otro jugador.');
      if (payload.id) {
        const player = team.players.find(p => p.id === payload.id && !p.archived);
        requireThat(player, 'No se encuentra el jugador.'); Object.assign(player, value);
      } else team.players.push({ id: randomUUID(), ...value, archived: false });
    } else if (type === 'player.archive') {
      const player = team.players.find(p => p.id === payload.id);
      requireThat(player, 'No se encuentra el jugador.');
      requireThat(!team.matches.some(m => ['live', 'paused'].includes(m.status) && m.stints.some(s => s.playerId === player.id && s.outSeconds === null)), 'El jugador está en el campo. Registra su salida primero.');
      player.archived = true;
    } else if (type === 'fixture.save' || type === 'fixture.import') {
      const fixtures = type === 'fixture.import' ? z.array(fixtureSchema).min(1).max(100).parse(payload.fixtures) : [fixtureSchema.parse(payload)];
      for (const data of fixtures) {
        requireThat(!data.leagueId || state.leagues.some(l => l.id === data.leagueId), 'Selecciona una competición válida.');
        if (type === 'fixture.save' && payload.id) {
          const match = team.matches.find(m => m.id === payload.id);
          requireThat(match?.status === 'scheduled', 'Solo puedes editar partidos pendientes.');
          Object.assign(match, data);
        } else team.matches.push({ ...data, id: randomUUID(), status: 'scheduled', elapsedSeconds: 0, runningSince: null, period: 1, homeScore: 0, awayScore: 0, lineup: [], stints: [], events: [] });
      }
    } else if (type === 'fixture.delete') {
      const match = team.matches.find(m => m.id === payload.id);
      requireThat(match?.status === 'scheduled', 'Solo puedes borrar partidos pendientes.');
      team.matches = team.matches.filter(m => m.id !== payload.id);
    } else {
      const match = team.matches.find(m => m.id === payload.matchId);
      requireThat(match, 'No se encuentra el partido.');
      const t = elapsed(match, now);
      // Checkpoint the accepted server time on each match command.
      match.elapsedSeconds = t;
      if (match.runningSince !== null) match.runningSince = now;
      const activeIds = () => match.stints.filter(s => s.outSeconds === null).map(s => s.playerId);
      if (type === 'match.lineup') {
        requireThat(match.status === 'scheduled', 'El partido ya ha comenzado.');
        const ids = z.array(z.string()).max(team.settings.playersOnField).parse(payload.playerIds);
        requireThat(new Set(ids).size === ids.length && ids.every(id => team.players.some(p => p.id === id && !p.archived)), 'La alineación no es válida.');
        match.lineup = ids;
      } else if (type === 'match.start') {
        requireThat(match.status === 'scheduled', 'El partido ya ha comenzado.');
        requireThat(!team.matches.some(m => ['live', 'paused'].includes(m.status)), 'Ya hay otro partido en curso.');
        requireThat(match.lineup.length > 0 && match.lineup.length <= team.settings.playersOnField, 'Selecciona los titulares antes de iniciar.');
        requireThat(match.lineup.every(id => team.players.some(p => p.id === id && !p.archived)), 'Revisa la alineación: contiene jugadores archivados.');
        match.status = 'live'; match.runningSince = now; match.startedAt = new Date(now).toISOString();
        match.stints = match.lineup.map(playerId => ({ playerId, inSeconds: 0, outSeconds: null }));
        event(match, 'start', 0);
      } else if (type === 'match.pause') {
        requireThat(match.status === 'live', 'El cronómetro no está en marcha.');
        match.elapsedSeconds = t; match.runningSince = null; match.status = 'paused';
        match.pauseReason = payload.halftime ? 'halftime' : 'manual'; event(match, payload.halftime ? 'halftime' : 'pause', t);
      } else if (type === 'match.resume') {
        requireThat(match.status === 'paused', 'El partido no está pausado.');
        if (match.pauseReason === 'halftime') match.period += 1;
        match.runningSince = now; match.status = 'live'; event(match, 'resume', t); match.pauseReason = null;
      } else if (type === 'match.substitute') {
        requireThat(['live', 'paused'].includes(match.status), 'El partido no está en curso.');
        requireThat(payload.outId || payload.inId, 'Selecciona un jugador.');
        const onField = activeIds();
        if (payload.outId) requireThat(onField.includes(payload.outId), 'El jugador ya está fuera del campo.');
        if (payload.inId) {
          requireThat(team.players.some(p => p.id === payload.inId && !p.archived), 'No se encuentra el jugador entrante.');
          requireThat(!onField.includes(payload.inId), 'Ese jugador ya está en el campo.');
          requireThat(onField.length - (payload.outId ? 1 : 0) < team.settings.playersOnField, 'El campo está completo. Selecciona también quién sale.');
          requireThat(team.settings.allowReentry || !match.stints.some(s => s.playerId === payload.inId), 'Esta competición no permite reentradas.');
        }
        if (payload.outId) match.stints.find(s => s.playerId === payload.outId && s.outSeconds === null).outSeconds = t;
        if (payload.inId) match.stints.push({ playerId: payload.inId, inSeconds: t, outSeconds: null });
        event(match, 'substitution', t, { outId: payload.outId || null, inId: payload.inId || null });
      } else if (type === 'match.undo') {
        requireThat(['live', 'paused'].includes(match.status), 'El partido no está en curso.');
        const last = match.events[0];
        requireThat(last?.kind === 'substitution', 'Solo puedes deshacer la última acción si fue una sustitución.');
        if (last.outId) requireThat(team.players.some(p => p.id === last.outId && !p.archived), 'No puedes devolver al campo a un jugador archivado.');
        if (last.inId) { const i = match.stints.findLastIndex(s => s.playerId === last.inId && s.outSeconds === null); requireThat(i >= 0, 'El estado ha cambiado.'); match.stints.splice(i, 1); }
        if (last.outId) { const stint = match.stints.findLast(s => s.playerId === last.outId && s.outSeconds === last.seconds); requireThat(stint, 'El estado ha cambiado.'); stint.outSeconds = null; }
        match.events.shift();
      } else if (type === 'match.score') {
        requireThat(['live', 'paused'].includes(match.status), 'El partido no está en curso.');
        Object.assign(match, z.object({ homeScore: z.number().int().min(0).max(99), awayScore: z.number().int().min(0).max(99) }).parse(payload));
      } else if (type === 'match.finish') {
        if (match.status === 'finished') return original;
        requireThat(['live', 'paused'].includes(match.status), 'El partido no ha comenzado.');
        match.stints.filter(s => s.outSeconds === null).forEach(s => { s.outSeconds = t; });
        match.elapsedSeconds = t; match.runningSince = null; match.status = 'finished'; match.finishedAt = new Date(now).toISOString(); event(match, 'finish', t);
      } else throw new AppError('Acción desconocida.');
    }
  }
  state.revision += 1;
  return state;
}
