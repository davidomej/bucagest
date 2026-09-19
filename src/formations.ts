import type { FormationKey } from './types';
// Mirrors the FORMATIONS constant in server/domain.js — keep both in sync.
export const FORMATIONS: Record<FormationKey,string[]> = {
  '1-2-3-1': ['POR','DEF1','DEF2','MED1','MED2','MED3','DEL1'],
  '1-3-2-1': ['POR','DEF1','DEF2','DEF3','MED1','MED2','DEL1'],
  '1-3-1-2': ['POR','DEF1','DEF2','DEF3','MED1','DEL1','DEL2'],
  '1-2-2-2': ['POR','DEF1','DEF2','MED1','MED2','DEL1','DEL2'],
};
type Coord = { x: number; y: number };
// Percentage coordinates on the pitch, goal at the bottom (y:92) and attack toward the top (y:18).
export const SLOT_LAYOUT: Record<FormationKey, Record<string, Coord>> = {
  '1-2-3-1': { POR:{x:50,y:90}, DEF1:{x:25,y:70}, DEF2:{x:75,y:70}, MED1:{x:18,y:44}, MED2:{x:50,y:44}, MED3:{x:82,y:44}, DEL1:{x:50,y:16} },
  '1-3-2-1': { POR:{x:50,y:90}, DEF1:{x:18,y:70}, DEF2:{x:50,y:74}, DEF3:{x:82,y:70}, MED1:{x:30,y:44}, MED2:{x:70,y:44}, DEL1:{x:50,y:16} },
  '1-3-1-2': { POR:{x:50,y:90}, DEF1:{x:18,y:70}, DEF2:{x:50,y:74}, DEF3:{x:82,y:70}, MED1:{x:50,y:47}, DEL1:{x:30,y:16}, DEL2:{x:70,y:16} },
  '1-2-2-2': { POR:{x:50,y:90}, DEF1:{x:25,y:70}, DEF2:{x:75,y:70}, MED1:{x:25,y:44}, MED2:{x:75,y:44}, DEL1:{x:30,y:16}, DEL2:{x:70,y:16} },
};
export const FORMATION_KEYS = Object.keys(FORMATIONS) as FormationKey[];
export const SLOT_LABELS: Record<string,string> = { POR:'Portero', DEF:'Defensa', MED:'Centrocampista', DEL:'Delantero' };
export const slotLine = (slot: string) => slot.replace(/\d+$/,'');
export const slotLabel = (slot: string) => {
  const line = slotLine(slot);
  const index = slot.slice(line.length);
  return index ? `${SLOT_LABELS[line]??line} ${index}` : SLOT_LABELS[line]??line;
};
// Places each lineup player into the first open slot of their natural line (fallback: any open slot).
export function autoPlace(formation: FormationKey, playerIds: string[], naturalLine: (id:string)=>string, existing: Record<string,string> = {}): Record<string,string> {
  const slots = FORMATIONS[formation];
  const positions: Record<string,string> = {};
  const taken = new Set<string>();
  for (const id of playerIds) { const slot = existing[id]; if (slot && slots.includes(slot) && !taken.has(slot)) { positions[id]=slot; taken.add(slot); } }
  for (const id of playerIds) {
    if (positions[id]) continue;
    const line = naturalLine(id);
    const preferred = slots.find(s => slotLine(s)===line && !taken.has(s));
    const any = preferred ?? slots.find(s => !taken.has(s));
    if (any) { positions[id]=any; taken.add(any); }
  }
  return positions;
}
