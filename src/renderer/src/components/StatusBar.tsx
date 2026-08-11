import type { Peer } from '../collab/useCollab'
import type { CursorPosition } from './CodeMirrorSurface'

type Props = {
  peers: Peer[]
  synced: boolean
  cursor: CursorPosition
}

export function StatusBar({ peers, synced, cursor }: Props): React.JSX.Element {
  return (
    <footer className="flex shrink-0 items-center gap-3 border-t border-border-subtle bg-surface-raised px-3 py-1.5 text-xs text-ink-muted shadow-[0_-1px_6px_rgba(0,0,0,0.15)]">
      {/* peers UZAK eşleri, hem de KİŞİ başına sayar; useCollab yerel istemciyi
          çıkarıyor ve aynı kişinin birden çok bağlantısını tekliyor.
          Python istemcisi (write.py) hiç awareness yayınlamaz — editor.py'de
          AWARENESS sabiti tanımlı ama hiç kullanılmıyor. Yani bağlıyken metni
          senkronlar, burada görünmez ve imleç de çizmez. Bu bir hata değil.
          (SPEC_FRONT §6.4, §9.4) */}
      <span className="tabular-nums">
        {peers.length} {peers.length === 1 ? 'peer' : 'peers'}
      </span>

      {peers.length > 0 && (
        <span className="flex items-center gap-2">
          {peers.map((peer) => (
            <span
              key={peer.userId ?? peer.clientId}
              className="flex min-w-0 items-center gap-1"
              // Ad bir e-posta, yani uzun olabiliyor: şeritte kısaltıp tamamını
              // tooltip'te veriyoruz. Kısaltmazsak imleç konumu ve senkron
              // göstergesi şeridin dışına taşıyor.
              title={peer.name}
            >
              <span
                className="h-2 w-2 shrink-0 rounded-full"
                style={{ backgroundColor: peer.color }}
                aria-hidden
              />
              <span className="max-w-[16ch] truncate">{peer.name}</span>
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
          senkronlanmamış olabilir. İkisi ayrı gösterilmeli. (SPEC_FRONT §5.4) */}
      <span className={synced ? 'text-state-ok' : 'text-state-pending'}>
        {synced ? 'synced' : 'syncing…'}
      </span>
    </footer>
  )
}
