import type { ConnectionStatus } from '../collab/useCollab'
import { PANE_COLORS, type PaneName } from '../collab/constants'
import { LanguagePicker } from './LanguagePicker'
import type { LanguageId } from './languages'

type Props = {
  pane: PaneName
  room: string
  status: ConnectionStatus
  language: LanguageId
  onLanguageChange: (id: LanguageId) => void
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

export function PaneHeader({
  pane,
  room,
  status,
  language,
  onLanguageChange
}: Props): React.JSX.Element {
  return (
    <header className="flex shrink-0 items-center gap-3 border-b border-border-subtle bg-surface-raised px-3 py-2">
      {/* Pane'in presence rengi — uzak imleçlerde göreceğiniz renkle aynı */}
      <span
        className="h-2.5 w-2.5 shrink-0 rounded-full"
        style={{ backgroundColor: PANE_COLORS[pane].color }}
        aria-hidden
      />
      <span className="text-sm font-semibold text-ink">{pane}</span>
      <span className="text-ink-faint">·</span>
      <span className="font-mono text-sm text-ink-muted">{room}</span>

      <div className="ml-auto flex items-center gap-3">
        <LanguagePicker value={language} onChange={onLanguageChange} />
        <span className="flex items-center gap-1.5 text-xs text-ink-muted">
          <span className={`h-2 w-2 rounded-full ${STATUS_DOT[status]}`} aria-hidden />
          {STATUS_LABEL[status]}
        </span>
      </div>
    </header>
  )
}
