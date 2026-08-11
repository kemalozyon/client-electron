import type { Role } from '@shared/types'
import type { ConnectionStatus } from '../collab/useCollab'
import { LanguagePicker } from './LanguagePicker'
import { RoleBadge } from './RoleBadge'
import type { LanguageId } from './languages'

type Props = {
  title: string
  role: Role
  status: ConnectionStatus
  language: LanguageId
  onLanguageChange: (id: LanguageId) => void
  onBack: () => void
  /** Soketi yeniden kurar; doküman ve yazılanlar KORUNUR. */
  onReload: () => void
  /** Nihai kapanışta (4401/4404/4410) yeniden bağlanmak yasak. */
  reloadEnabled: boolean
}

const STATUS_LABEL: Record<ConnectionStatus, string> = {
  connecting: 'connecting',
  connected: 'connected',
  disconnected: 'disconnected'
}

const STATUS_DOT: Record<ConnectionStatus, string> = {
  connecting: 'bg-state-pending',
  connected: 'bg-state-ok',
  disconnected: 'bg-state-down'
}

/**
 * Editörün üst çubuğu: doküman başlığı, rol rozeti, dil seçici, bağlantı
 * noktası (SPEC_FRONT §7.4).
 *
 * Rozet şimdilik yalnızca GÖSTERİM. Viewer için salt-okunurluk adım 6'da,
 * ikinci bir CodeMirror Compartment'ıyla geliyor — ve o da bir zorlama değil,
 * sadece arayüzü sadeleştirme; zorlama sunucunun işi.
 */
export function PaneHeader({
  title,
  role,
  status,
  language,
  onLanguageChange,
  onBack,
  onReload,
  reloadEnabled
}: Props): React.JSX.Element {
  // Bağlanırken de kapalı: art arda basmak her seferinde soketi kapatıp
  // açardı. (useCollab'daki nesil sayacı sızıntıyı ayrıca engelliyor; bu
  // yalnızca gürültüyü kesiyor.)
  const reloadKapali = !reloadEnabled || status === 'connecting'

  return (
    <header className="flex shrink-0 items-center gap-3 border-b border-border-subtle bg-surface-raised px-3 py-2 shadow-sm">
      <button
        onClick={onBack}
        title="Dokümanlar listesine dön (bu oturumu kapatır)"
        className="shrink-0 rounded-lg border border-border-subtle px-2 py-1 text-xs text-ink-muted transition-colors hover:border-ink-faint hover:text-ink"
      >
        ←
      </button>
      <span className="truncate text-sm font-semibold text-ink">{title}</span>
      <RoleBadge role={role} />

      <div className="ml-auto flex shrink-0 items-center gap-3">
        <LanguagePicker value={language} onChange={onLanguageChange} />
        <button
          onClick={onReload}
          disabled={reloadKapali}
          title={
            reloadEnabled
              ? 'Yeniden bağlan (Cmd/Ctrl+R) — yazdıklarınız korunur, bağlantı yenilenir'
              : 'Bu bağlantı kapandı; yeniden bağlanmak sonuç vermez. Listeye dönün.'
          }
          className="shrink-0 rounded-lg border border-border-subtle px-2 py-1 text-xs text-ink-muted transition-colors hover:border-ink-faint hover:text-ink disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:border-border-subtle disabled:hover:text-ink-muted"
        >
          <span className={status === 'connecting' ? 'inline-block animate-spin' : undefined}>
            ⟳
          </span>
        </button>
        <span className="flex items-center gap-1.5 text-xs text-ink-muted">
          <span
            className={`h-2 w-2 rounded-full ${STATUS_DOT[status]} ${status === 'connecting' ? 'animate-pulse' : ''}`}
            aria-hidden
          />
          {STATUS_LABEL[status]}
        </span>
      </div>
    </header>
  )
}
