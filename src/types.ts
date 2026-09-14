export type Player = { id: string; name: string; number: number; position: 'POR'|'DEF'|'MED'|'DEL'; archived: boolean };
export type MatchEvent = { id: string; kind: string; seconds: number; outId?: string; inId?: string };
export type Match = { id: string; opponent: string; date: string; venue: string; home: boolean; round: number; season: string; status: 'scheduled'|'live'|'paused'|'finished'; elapsedSeconds: number; runningSince: number|null; period: number; pauseReason?: string; homeScore: number; awayScore: number; lineup: string[]; stints: {playerId: string; inSeconds: number; outSeconds: number|null}[]; events: MatchEvent[] };
export type Settings = { name: string; league: string; season: string; playersOnField: number; matchMinutes: number; allowReentry: boolean };
export type Team = { id: string; revision: number; settings: Settings; players: Player[]; matches: Match[] };
export type Session = { user: {id: string; name: string; email: string}|null; demo: boolean; registrationAllowed: boolean };
