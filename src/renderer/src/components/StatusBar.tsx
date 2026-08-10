import type { Peer } from '../collab/useCollab'
import type { CursorPosition } from './CodeMirrorSurface'
import { RoomSwitcher } from './RoomSwitcher'

type Props = {
  peers: Peer[]
  synced: boolean
  cursor: CursorPosition
  room: string
  onRoomChange: (room: string) => void
}

export function StatusBar({ peers, synced, cursor, room, onRoomChange }: Props): React.JSX.Element {
  return (
    <footer className="flex shrink-0 items-center gap-3 border-t border-border-subtle bg-surface-raised px-3 py-1.5 text-xs text-ink-muted">
      {/* peers UZAK eşleri sayar; useCollab yerel istemciyi zaten çıkardı.
          Python istemcisi (write.py) hiç awareness yayınlamaz, dolayısıyla
          bağlıyken bile burada görünmez — bu bir hata değil, editor.py'de
          awareness kodu yok. (SPEC §7.3) */}
      <span className="tabular-nums">
        {peers.length} {peers.length === 1 ? 'peer' : 'peers'}
      </span>

      {peers.length > 0 && (
        <span className="flex items-center gap-2">
          {peers.map((peer) => (
            <span key={peer.clientId} className="flex items-center gap-1">
              <span
                className="h-2 w-2 rounded-full"
                style={{ backgroundColor: peer.color }}
                aria-hidden
              />
              {peer.name}
            </span>
          ))}
        </span>
      )}

      <span className="text-ink-faint">·</span>
      <span className="tabular-nums">
        Ln {cursor.line}, Col {cursor.column}
      </span>

      <span className="text-ink-faint">·</span>
      {/* 'synced' bağlantıdan AYRI bir olay: soket açık olup doküman henüz
          senkronlanmamış olabilir. (SPEC §7.2) */}
      <span className={synced ? 'text-state-ok' : 'text-state-pending'}>
        {synced ? 'synced' : 'syncing…'}
      </span>

      <div className="ml-auto">
        {/* key={room}: oda değişince RoomSwitcher'ın taslak state'i sıfırlansın */}
        <RoomSwitcher key={room} room={room} onRoomChange={onRoomChange} />
      </div>
    </footer>
  )
}
