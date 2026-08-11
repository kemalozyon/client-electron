import type { Role } from '@shared/types'

const ETIKET: Record<Role, string> = {
  owner: 'sahip',
  editor: 'editör',
  viewer: 'izleyici'
}

const RENK: Record<Role, string> = {
  owner: 'border-accent/40 bg-accent/15 text-accent',
  editor: 'border-state-ok/40 bg-state-ok/15 text-state-ok',
  viewer: 'border-ink-faint/40 bg-ink-faint/15 text-ink-muted'
}

/**
 * Etkin rol rozeti.
 *
 * Kaynağı GET /documents öğelerindeki `role` alanı — REST'te editor ile
 * viewer'ı ayıran tek yer orası. JWT rol taşımıyor, GET .../roles ise yalnızca
 * sahibe açık. (SPEC_FRONT §3.2)
 */
export function RoleBadge({ role }: { role: Role }): React.JSX.Element {
  return (
    <span
      className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-medium tracking-wide uppercase ${RENK[role]}`}
    >
      {ETIKET[role]}
    </span>
  )
}
