import { randomUUID } from 'node:crypto';
import { z } from 'zod';

export class AppError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}
const text = z.string().trim().min(1).max(100);
const playerSchema = z.object({ name: text, number: z.number().int().min(0).max(99), position: z.enum(['POR', 'DEF', 'MED', 'DEL']) });
const fixtureSchema = z.object({ opponent: text, date: z.iso.datetime({ offset: true }), venue: z.string().trim().max(120).default(''), home: z.boolean(), round: z.number().int().min(1).max(100), season: text });
const settingsSchema = z.object({ name: text, league: text, season: text, playersOnField: z.union([z.literal(5), z.literal(7), z.literal(8), z.literal(11)]), matchMinutes: z.number().int().min(10).max(180), allowReentry: z.boolean() });
export function elapsed(match, now = Date.now()) {
  return match.elapsedSeconds + (match.runningSince === null ? 0 : Math.max(0, now - match.runningSince) / 1000);
}
export function playerSeconds(match, playerId, now = Date.now()) {
  const end = elapsed(match, now);
  return match.stints.filter(s => s.playerId === playerId).reduce((sum, s) => sum + Math.max(0, (s.outSeconds ?? end) - s.inSeconds), 0);
}
export function emptyTeam(name) {
  return { id: randomUUID(), revision: 0, settings: { name, league: 'Liga local', season: '2026/27', playersOnField: 7, matchMinutes: 60, allowReentry: true }, players: [], matches: [] };
}
const requireThat = (value, message) => { if (!value) throw new AppError(message); };
function event(match, kind, seconds, data = {}) { match.events.unshift({ id: randomUUID(), kind, seconds, ...data }); }
export function applyCommand(original, command, now = Date.now()) {
  const state = structuredClone(original);
  const { type, payload = {} } = command;
  if (type === 'settings') {
    const settings = settingsSchema.parse(payload);
    if (state.matches.some(m => ['live', 'paused'].includes(m.status))) {
      requireThat(settings.playersOnField === state.settings.playersOnField && settings.allowReentry === state.settings.allowReentry, 'Termina el partido antes de cambiar las reglas de juego.');
    }
    state.settings = settings;
  } else if (type === 'player.save') {
    const value = playerSchema.parse(payload);
    requireThat(!state.players.some(p => p.id !== payload.id && !p.archived && p.number === value.number), 'Ese dorsal ya pertenece a otro jugador.');
    if (payload.id) {
      const player = state.players.find(p => p.id === payload.id && !p.archived);
      requireThat(player, 'No se encuentra el jugador.'); Object.assign(player, value);
    } else state.players.push({ id: randomUUID(), ...value, archived: false });
  } else if (type === 'player.archive') {
    const player = state.players.find(p => p.id === payload.id);
    requireThat(player, 'No se encuentra el jugador.');
    requireThat(!state.matches.some(m => ['live', 'paused'].includes(m.status) && m.stints.some(s => s.playerId === player.id && s.outSeconds === null)), 'El jugador está en el campo. Registra su salida primero.');
    player.archived = true;
  } else if (type === 'fixture.save' || type === 'fixture.import') {
    const fixtures = type === 'fixture.import' ? z.array(fixtureSchema).min(1).max(100).parse(payload.fixtures) : [fixtureSchema.parse(payload)];
    for (const data of fixtures) {
      if (type === 'fixture.save' && payload.id) {
        const match = state.matches.find(m => m.id === payload.id);
        requireThat(match?.status === 'scheduled', 'Solo puedes editar partidos pendientes.');
        Object.assign(match, data);
      } else state.matches.push({ ...data, id: randomUUID(), status: 'scheduled', elapsedSeconds: 0, runningSince: null, period: 1, homeScore: 0, awayScore: 0, lineup: [], stints: [], events: [] });
    }
  } else if (type === 'fixture.delete') {
    const match = state.matches.find(m => m.id === payload.id);
    requireThat(match?.status === 'scheduled', 'Solo puedes borrar partidos pendientes.');
    state.matches = state.matches.filter(m => m.id !== payload.id);
  } else {
    const match = state.matches.find(m => m.id === payload.matchId);
    requireThat(match, 'No se encuentra el partido.');
    const t = elapsed(match, now);
    // Checkpoint the accepted server time on each match command.
    match.elapsedSeconds = t;
    if (match.runningSince !== null) match.runningSince = now;
    const activeIds = () => match.stints.filter(s => s.outSeconds === null).map(s => s.playerId);
    if (type === 'match.lineup') {
      requireThat(match.status === 'scheduled', 'El partido ya ha comenzado.');
      const ids = z.array(z.string()).max(state.settings.playersOnField).parse(payload.playerIds);
      requireThat(new Set(ids).size === ids.length && ids.every(id => state.players.some(p => p.id === id && !p.archived)), 'La alineación no es válida.');
      match.lineup = ids;
    } else if (type === 'match.start') {
      requireThat(match.status === 'scheduled', 'El partido ya ha comenzado.');
      requireThat(!state.matches.some(m => ['live', 'paused'].includes(m.status)), 'Ya hay otro partido en curso.');
      requireThat(match.lineup.length > 0 && match.lineup.length <= state.settings.playersOnField, 'Selecciona los titulares antes de iniciar.');
      requireThat(match.lineup.every(id => state.players.some(p => p.id === id && !p.archived)), 'Revisa la alineación: contiene jugadores archivados.');
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
        requireThat(state.players.some(p => p.id === payload.inId && !p.archived), 'No se encuentra el jugador entrante.');
        requireThat(!onField.includes(payload.inId), 'Ese jugador ya está en el campo.');
        requireThat(onField.length - (payload.outId ? 1 : 0) < state.settings.playersOnField, 'El campo está completo. Selecciona también quién sale.');
        requireThat(state.settings.allowReentry || !match.stints.some(s => s.playerId === payload.inId), 'Esta competición no permite reentradas.');
      }
      if (payload.outId) match.stints.find(s => s.playerId === payload.outId && s.outSeconds === null).outSeconds = t;
      if (payload.inId) match.stints.push({ playerId: payload.inId, inSeconds: t, outSeconds: null });
      event(match, 'substitution', t, { outId: payload.outId || null, inId: payload.inId || null });
    } else if (type === 'match.undo') {
      requireThat(['live', 'paused'].includes(match.status), 'El partido no está en curso.');
      const last = match.events[0];
      requireThat(last?.kind === 'substitution', 'Solo puedes deshacer la última acción si fue una sustitución.');
      if (last.outId) requireThat(state.players.some(p => p.id === last.outId && !p.archived), 'No puedes devolver al campo a un jugador archivado.');
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
  state.revision += 1;
  return state;
}
