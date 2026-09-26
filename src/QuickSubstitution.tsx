import { useRef, useState } from 'react';
import { ArrowUp, Search } from 'lucide-react';
import { Avatar, Modal } from './components';
import type { Player, TeamColors } from './types';

export function QuickSubstitution({outgoing, available, colors, busy, onSelect, onClose}: {
  outgoing: Player | undefined;
  available: Player[];
  colors: TeamColors;
  busy: boolean;
  onSelect: (inId: string) => Promise<void>;
  onClose: () => void;
}) {
  const [search, setSearch] = useState('');
  const [saving, setSaving] = useState(false);
  const pending = useRef(false);
  const blocked = busy || saving;
  const visible = available.filter(p => `${p.name} ${p.number}`.toLowerCase().includes(search.trim().toLowerCase()));

  async function select(inId: string) {
    if (blocked || pending.current || !outgoing) return;
    pending.current = true;
    setSaving(true);
    try { await onSelect(inId); }
    finally { pending.current = false; setSaving(false); }
  }

  return <Modal title="¿Quién entró por ti?" onClose={() => { if (!pending.current) onClose(); }}>
    {outgoing ? <>
      <div className="quick-sub-outgoing"><Avatar player={outgoing} colors={colors}/><div><span>Sales del campo</span><strong>{outgoing.name} · #{outgoing.number}</strong></div></div>
      <p className="form-note">Toca a tu compañero para guardar el cambio con el minuto actual.</p>
      {available.length > 0 ? <>
        <label className="search quick-sub-search"><Search size={18}/><input aria-label="Buscar compañero que entró" placeholder="Nombre o dorsal…" value={search} onChange={e => setSearch(e.target.value)}/></label>
        <div className="quick-sub-list" aria-busy={saving}>
          {visible.map(player => <button key={player.id} type="button" className="quick-sub-player" disabled={blocked} aria-label={`Entró ${player.name}, dorsal ${player.number}`} onClick={() => void select(player.id)}>
            <Avatar player={player} colors={colors}/><span><strong>{player.name}</strong><small>Dorsal {player.number}</small></span><ArrowUp size={20}/>
          </button>)}
        </div>
        {!visible.length && <p className="form-note">No encontramos ese compañero. Prueba con otro nombre o dorsal.</p>}
      </> : <p className="quick-sub-empty" role="status">No hay compañeros disponibles para entrar. Revisa el banquillo y si la competición permite reentradas.</p>}
    </> : <p className="form-note" role="status">Este jugador ya no está en el campo. Cierra esta ventana y revisa la lista actualizada.</p>}
    <div className="form-actions"><span role="status">{saving ? 'Guardando cambio…' : ''}</span><button className="button secondary" disabled={saving} onClick={onClose}>Cancelar</button></div>
  </Modal>;
}
