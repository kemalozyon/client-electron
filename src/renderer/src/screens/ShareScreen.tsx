import { useCallback, useEffect, useState } from 'react'
import type { Collaborator, DocumentListItem, GrantableRole, User } from '@shared/types'
import { api } from '../api'
import { ErrorNote } from '../components/ErrorNote'
import { RoleBadge } from '../components/RoleBadge'

type Props = {
  doc: DocumentListItem
  user: User
  onBack: () => void
}

/**
 * İşbirlikçi yönetimi — YALNIZCA SAHİBE açık.
 *
 * Bu ekrana giden yol doküman listesinde zaten sahip olmayanlara gösterilmiyor;
 * sunucu da dört rol rotasının hepsinde önce sahiplik kontrolü yapıyor.
 * (SPEC_FRONT §7.3)
 */
export function ShareScreen({ doc, user, onBack }: Props): React.JSX.Element {
  const [liste, setListe] = useState<Collaborator[] | null>(null)
  const [hata, setHata] = useState<string | null>(null)
  const [email, setEmail] = useState('')
  const [rol, setRol] = useState<GrantableRole>('editor')
  const [calisiyor, setCalisiyor] = useState(false)

  // state'e yalnızca await'ten sonra dokunuyoruz (bkz. DocumentsScreen).
  const yenile = useCallback(async () => {
    try {
      const k = await api.roles.list(doc.id)
      setListe(k)
      setHata(null)
    } catch (err) {
      setHata(err instanceof Error ? err.message : String(err))
    }
  }, [doc.id])

  // Bkz. DocumentsScreen: state'e yalnızca await'ten sonra dokunuluyor.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void yenile()
  }, [yenile])

  async function calistir(is: () => Promise<unknown>): Promise<void> {
    setCalisiyor(true)
    setHata(null)
    try {
      await is()
      await yenile()
    } catch (err) {
      // Sunucunun metni AYNEN görünsün. "Bu e-posta ile kayıtlı kullanıcı yok."
      // bilinçli bir e-posta-varlık oracle'ı: sahibin yazım hatasını anlaması
      // için var. Daha yumuşak bir kopya yazmak, olan biteni gizler.
      // (SPEC_FRONT §3.2, §7.3)
      setHata(err instanceof Error ? err.message : String(err))
    } finally {
      setCalisiyor(false)
    }
  }

  async function ver(event: React.FormEvent): Promise<void> {
    event.preventDefault()
    const e = email.trim()
    if (!e) return
    // Yetki E-POSTA ile veriliyor: istemcinin elinde kullanıcı UUID'si yok.
    await calistir(async () => {
      await api.roles.grantByEmail(doc.id, { email: e, role: rol })
      setEmail('')
    })
  }

  async function iptalEt(k: Collaborator): Promise<void> {
    const onay = window.confirm(
      `${k.email} erişimi kaldırılacak.\n\n` +
        'Doküman o kişide açıksa bağlantısı hemen kesilir (4410).\n\nDevam edilsin mi?'
    )
    if (!onay) return
    // İptal ise user_id ile — UUID'yi bu listeden alıyoruz.
    await calistir(() => api.roles.revoke(doc.id, k.user_id))
  }

  return (
    <div className="flex h-full flex-col bg-surface">
      <header className="flex shrink-0 items-center gap-3 border-b border-border-subtle bg-surface-raised px-4 py-2.5 shadow-sm">
        <button
          onClick={onBack}
          className="rounded-lg border border-border-subtle px-2 py-1 text-xs text-ink-muted transition-colors hover:border-ink-faint hover:text-ink"
        >
          ← Dokümanlar
        </button>
        <h1 className="truncate text-sm font-semibold text-ink">{doc.title}</h1>
        <span className="text-xs text-ink-muted">paylaşım</span>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        <div className="mx-auto flex max-w-2xl flex-col gap-4">
          <form
            onSubmit={ver}
            className="flex items-end gap-2 rounded-xl border border-border-subtle bg-surface-raised p-3 shadow-sm"
          >
            <label className="flex flex-1 flex-col gap-1 text-xs text-ink-muted">
              Kişi ekle (e-posta ile)
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="ornek@site.com"
                className="rounded-lg border border-border-subtle bg-surface-sunken px-2 py-1.5 text-sm text-ink outline-none transition-colors focus:border-accent focus:ring-2 focus:ring-accent/30"
              />
            </label>
            <select
              value={rol}
              onChange={(e) => setRol(e.target.value as GrantableRole)}
              className="cursor-pointer rounded-lg border border-border-subtle bg-surface-sunken px-2 py-1.5 text-sm text-ink outline-none transition-colors focus:border-accent focus:ring-2 focus:ring-accent/30"
            >
              <option value="editor">Editör (yazabilir)</option>
              <option value="viewer">İzleyici (salt okunur)</option>
            </select>
            <button
              type="submit"
              disabled={calisiyor || email.trim().length === 0}
              className="rounded-lg bg-accent px-3 py-1.5 text-sm font-medium text-surface shadow-glow transition-all hover:shadow-glow-lg active:scale-[0.98] disabled:opacity-50 disabled:shadow-none"
            >
              Ver
            </button>
          </form>

          {hata && <ErrorNote>{hata}</ErrorNote>}

          <ul className="flex flex-col gap-2">
            {/*
              Sahip bu listede YOK — sahiplik documents.owner_id sütununda
              yaşıyor, document_roles tablosunda değil. Ayrıca çiziyoruz.
              (SPEC_FRONT §7.3)
            */}
            <li className="flex items-center gap-3 rounded-xl border border-border-subtle bg-surface-raised px-3 py-2 shadow-sm">
              <span className="min-w-0 flex-1 truncate text-sm text-ink">{user.email}</span>
              <RoleBadge role="owner" />
              <span className="text-xs text-ink-faint">siz</span>
            </li>

            {liste === null && <p className="text-sm text-ink-faint">yükleniyor…</p>}

            {liste?.length === 0 && (
              <p className="text-sm text-ink-faint">Bu dokümanı henüz kimseyle paylaşmadınız.</p>
            )}

            {liste?.map((k) => (
              <li
                key={k.user_id}
                className="flex items-center gap-3 rounded-xl border border-border-subtle bg-surface-raised px-3 py-2 shadow-sm transition-shadow hover:border-ink-faint hover:shadow-md"
              >
                {/* UUID değil E-POSTA gösteriyoruz; alan tam da bunun için var. */}
                <span className="min-w-0 flex-1 truncate text-sm text-ink">{k.email}</span>
                <RoleBadge role={k.role} />
                <button
                  onClick={() => void iptalEt(k)}
                  disabled={calisiyor}
                  className="rounded-lg border border-border-subtle px-2 py-1 text-xs text-state-down transition-colors hover:border-state-down disabled:opacity-50"
                >
                  Erişimi kaldır
                </button>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  )
}
