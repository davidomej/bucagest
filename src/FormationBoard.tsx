import { useState, type CSSProperties } from 'react';
import { X } from 'lucide-react';
import type { FormationKey, Player, TeamColors } from './types';
import { FORMATIONS, SLOT_LAYOUT, slotLabel } from './formations';
type Selection = { type: 'slot'; slot: string } | { type: 'player'; id: string } | null;
// Tap-to-place is used instead of drag-and-drop: native HTML5 drag doesn't work reliably on
// touch/iPad Safari, which is where this screen is mostly used pitch-side.
export function FormationBoard({formation,positions,players,colors,onChange,interactive=true}:{formation:FormationKey;positions:Record<string,string>;players:Player[];colors?:TeamColors;onChange?:(next:Record<string,string>)=>void;interactive?:boolean}) {
  const [selected,setSelected]=useState<Selection>(null);
  const slots=FORMATIONS[formation];
  const layout=SLOT_LAYOUT[formation];
  const byId=(id:string)=>players.find(p=>p.id===id);
  const occupant=(slot:string)=>Object.entries(positions).find(([,s])=>s===slot)?.[0];
  const unplaced=players.filter(p=>!positions[p.id]);
  function place(id:string,slot:string){
    if(!onChange)return;
    const next={...positions};
    const displaced=occupant(slot);
    const previousSlot=next[id];
    delete next[id];
    if(displaced){ if(previousSlot)next[displaced]=previousSlot; else delete next[displaced]; }
    next[id]=slot;
    onChange(next);
  }
  function remove(id:string){ if(!onChange)return; const next={...positions}; delete next[id]; onChange(next); }
  function tapSlot(slot:string){
    if(!interactive||!onChange)return;
    if(selected?.type==='player'){ place(selected.id,slot); setSelected(null); return; }
    if(selected?.type==='slot'){
      if(selected.slot===slot){ setSelected(null); return; }
      const a=occupant(selected.slot), b=occupant(slot);
      const next={...positions};
      if(a) next[a]=slot; else if(a!==undefined) delete next[a];
      if(b) next[b]=selected.slot;
      onChange(next); setSelected(null); return;
    }
    if(occupant(slot)) setSelected({type:'slot',slot});
  }
  function tapUnplaced(id:string){
    if(!interactive||!onChange)return;
    if(selected?.type==='slot'){ place(id,selected.slot); setSelected(null); return; }
    setSelected(prev=>prev?.type==='player'&&prev.id===id?null:{type:'player',id});
  }
  const style=colors?({'--team-primary':colors.primary,'--team-secondary':colors.secondary} as CSSProperties):undefined;
  return <div className="formation-wrap">
    <div className="formation-board" style={style}>
      <div className="pitch-lines"><div className="pitch-center"/><div className="pitch-box top"/><div className="pitch-box bottom"/></div>
      {slots.map(slot=>{
        const playerId=occupant(slot),player=playerId?byId(playerId):undefined;
        const coord=layout[slot];
        const isSelected=selected?.type==='slot'&&selected.slot===slot;
        return <button type="button" key={slot} className={`formation-slot ${player?'filled':'empty'} ${isSelected?'selected':''}`} style={{left:`${coord.x}%`,top:`${coord.y}%`}} disabled={!interactive} onClick={()=>tapSlot(slot)} aria-label={player?`${player.name}, ${slotLabel(slot)}${isSelected?' (seleccionado)':''}`:`Posición vacía: ${slotLabel(slot)}`}>
          {player?<><span className="formation-slot-number">{player.number}</span><small>{player.name.split(' ')[0]}</small>{isSelected&&interactive&&<span className="formation-slot-remove" role="button" aria-label={`Quitar a ${player.name} de la alineación`} onClick={e=>{e.stopPropagation();remove(player.id);setSelected(null);}}><X size={11}/></span>}</>:<span className="formation-slot-plus">+</span>}
        </button>;
      })}
    </div>
    {interactive&&<div className="formation-bench"><span className="formation-bench-label">{unplaced.length?`${unplaced.length} sin colocar`:'Todos colocados'}</span>{unplaced.length>0&&<div className="formation-bench-list">{unplaced.map(p=><button type="button" key={p.id} className={`formation-bench-chip ${selected?.type==='player'&&selected.id===p.id?'selected':''}`} onClick={()=>tapUnplaced(p.id)}><b>{p.number}</b>{p.name.split(' ')[0]}</button>)}</div>}</div>}
  </div>;
}
