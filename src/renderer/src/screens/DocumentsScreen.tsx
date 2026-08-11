import { useCallback, useEffect, useState } from 'react'
import type { DocumentListItem, User } from '@shared/types'
import { api } from '../api'
import { ErrorNote } from '../components/ErrorNote'
import { RoleBadge } from '../components/RoleBadge'
import { LANGUAGES, DEFAULT_LANGUAGE, type LanguageId } from '../components/languages'

type Props = {
  user: User
  onOpen: (doc: DocumentListItem) => void
  onShare: (doc: DocumentListItem) => void
  onSignOut: () => void
}

function tarih(iso: string): string {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString('tr-TR')
}

export function DocumentsScreen({ user, onOpen, onShare, onSignOut }: Props): React.JSX.Element {
  const [dokumanlar, setDokumanlar] = useState<DocumentListItem[] | null>(null)
  const [hata, setHata] = useState<string | null>(null)
  const [baslik, setBaslik] = useState('')
  const [dil, setDil] = useState<LanguageId>(DEFAULT_LANGUAGE)
  const [calisiyor, setCalisiyor] = useState(false)
  const [adDegistirilen, setAdDegistirilen] = useState<{ id: string; baslik: string } | null>(null)

  // Not: state'e YALNIZCA await'ten sonra dokunuyoruz. Efektin gövdesinde
  // senkron setState çağırmak cascading render demek (react-hooks kuralı) —
  // ve burada zaten gereksiz, çünkü gösterecek yeni bir şey yok.
  const yenile = useCallback(async () => {
    try {
      // Sunucu zaten updated_at DESC sıralı gönderiyor. YENİDEN SIRALAMAYIN
      // (SPEC_FRONT §7.2) — kendi sıralamamız sunucununkiyle sessizce ayrışır.
      const liste = await api.documents.list()
      setDokumanlar(liste)
      setHata(null)
    } catch (err) {
      setHata(err instanceof Error ? err.message : String(err))
    }
  }, [])

  // Kural burada bilerek kapalı: `yenile` state'e yalnızca await'ten SONRA
  // dokunuyor, ama kural async sınırını göremediği için setState'i senkron
  // sanıyor. Açılışta veri çekip sonucu state'e yazmak, kuralın kendi
  // "harici bir sistemden güncelleme al" istisnası.
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
      setHata(err instanceof Error ? err.message : String(err))
    } finally {
      setCalisiyor(false)
    }
  }

  async function olustur(event: React.FormEvent): Promise<void> {
    event.preventDefault()
    const t = baslik.trim()
    if (!t) return
    await calistir(async () => {
      await api.documents.create({ title: t, language: dil })
      setBaslik('')
    })
  }

  async function sil(doc: DocumentListItem): Promise<void> {
    // Yıkıcı ve GERİ ALINAMAZ: sunucu silmeden önce o dokümandaki HER sokete
    // permission_revoked yollayıp 4410 ile kapatıyor. O an yazan varsa
    // ortasından kesiliyor. (SPEC_FRONT §3.2, §7.2)
    const onay = window.confirm(
      `"${doc.title}" kalıcı olarak silinecek.\n\n` +
        'Bu dokümanı o anda açık tutan HERKESİN bağlantısı kesilir ve içerik geri alınamaz.\n\n' +
        'Devam edilsin mi?'
    )
    if (!onay) return
    await calistir(() => api.documents.delete(doc.id))
  }

  async function adKaydet(): Promise<void> {
    if (!adDegistirilen) return
    const t = adDegistirilen.baslik.trim()
    if (!t) return
    const id = adDegistirilen.id
    await calistir(async () => {
      await api.documents.update(id, { title: t })
      setAdDegistirilen(null)
    })
  }

  return (
    <div className="flex h-full flex-col bg-surface">
      <header className="flex shrink-0 items-center gap-3 border-b border-border-subtle bg-surface-raised px-4 py-2.5 shadow-sm">
        <h1 className="text-sm font-semibold text-ink">Dokümanlar</h1>
        <span className="ml-auto text-xs text-ink-muted">{user.email}</span>
        <button
          onClick={onSignOut}
          className="rounded-lg border border-border-subtle px-2 py-1 text-xs text-ink-muted transition-colors hover:border-ink-faint hover:text-ink"
        >
          Çıkış
        </button>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        <div className="mx-auto flex max-w-3xl flex-col gap-4">
          <form
            onSubmit={olustur}
            className="flex items-end gap-2 rounded-xl border border-border-subtle bg-surface-raised p-3 shadow-sm"
          >
            <label className="flex flex-1 flex-col gap-1 text-xs text-ink-muted">
              Yeni doküman
              <input
                value={baslik}
                onChange={(e) => setBaslik(e.target.value)}
                placeholder="Başlık"
                className="rounded-lg border border-border-subtle bg-surface-sunken px-2 py-1.5 text-sm text-ink outline-none transition-colors focus:border-accent focus:ring-2 focus:ring-accent/30"
              />
            </label>
            <select
              value={dil}
              onChange={(e) => setDil(e.target.value as LanguageId)}
              className="cursor-pointer rounded-lg border border-border-subtle bg-surface-sunken px-2 py-1.5 text-sm text-ink outline-none transition-colors focus:border-accent focus:ring-2 focus:ring-accent/30"
            >
              {LANGUAGES.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.label}
                </option>
              ))}
            </select>
            <button
              type="submit"
              disabled={calisiyor || baslik.trim().length === 0}
              className="rounded-lg bg-accent px-3 py-1.5 text-sm font-medium text-surface shadow-glow transition-all hover:shadow-glow-lg active:scale-[0.98] disabled:opacity-50 disabled:shadow-none"
            >
              Oluştur
            </button>
          </form>

          {hata && (
            <div className="flex flex-col gap-1">
              <ErrorNote>{hata}</ErrorNote>
              {/*
                Sunucu ayarını BU ekrana da koymuyoruz, bilerek: oturumu yok eden
                bir kontrolün üçüncü kopyası olurdu. Bunun yerine kaçış yolunu
                söylüyoruz — tünel adresi dönmüşse çıkış yapıp giriş ekranından
                düzeltiliyor.
              */}
              <p className="text-[11px] text-ink-faint">
                Sunucu adresi değişmiş olabilir (tünel yeniden başladıysa alan adı da değişir).
                Düzeltmek için Çıkış yapıp giriş ekranındaki “Sunucu” ayarını kullanın.
              </p>
            </div>
          )}

          {dokumanlar === null && <p className="text-sm text-ink-faint">yükleniyor…</p>}

          {dokumanlar?.length === 0 && (
            <p className="text-sm text-ink-faint">
              Henüz erişebildiğiniz bir doküman yok. Yukarıdan bir tane oluşturun.
            </p>
          )}

          <ul className="flex flex-col gap-2">
            {dokumanlar?.map((doc) => {
              const sahip = doc.role === 'owner'
              const duzenleniyor = adDegistirilen?.id === doc.id
              return (
                <li
                  key={doc.id}
                  className="flex items-center gap-3 rounded-xl border border-border-subtle bg-surface-raised px-3 py-2 shadow-sm transition-shadow hover:border-ink-faint hover:shadow-md"
                >
                  <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                    {duzenleniyor ? (
                      <input
                        autoFocus
                        value={adDegistirilen.baslik}
                        onChange={(e) => setAdDegistirilen({ id: doc.id, baslik: e.target.value })}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') void adKaydet()
                          if (e.key === 'Escape') setAdDegistirilen(null)
                        }}
                        onBlur={() => void adKaydet()}
                        className="rounded-lg border border-accent bg-surface-sunken px-1.5 py-0.5 text-sm text-ink outline-none focus:ring-2 focus:ring-accent/30"
                      />
                    ) : (
                      <span className="truncate text-sm text-ink">{doc.title}</span>
                    )}
                    <span className="truncate font-mono text-[11px] text-ink-faint">
                      {doc.language} · {tarih(doc.updated_at)}
                    </span>
                  </div>

                  <RoleBadge role={doc.role} />

                  {/*
                    Sahibe özel eylemleri GÖSTERMİYORUZ, hata almalarını
                    beklemiyoruz. Sunucu 403 ile zaten zorluyor — güvence orada.
                    İstemcinin işi, yapılamayacak bir şeyi hiç önermemek.
                    (SPEC_FRONT §7.2)
                  */}
                  <button
                    onClick={() => onOpen(doc)}
                    className="rounded-lg border border-border-subtle px-2 py-1 text-xs text-ink transition-colors hover:border-accent hover:text-accent"
                  >
                    Aç
                  </button>
                  {sahip && (
                    <>
                      <button
                        onClick={() => onShare(doc)}
                        className="rounded-lg border border-border-subtle px-2 py-1 text-xs text-ink-muted transition-colors hover:border-ink-faint hover:text-ink"
                      >
                        Paylaş
                      </button>
                      <button
                        onClick={() => setAdDegistirilen({ id: doc.id, baslik: doc.title })}
                        className="rounded-lg border border-border-subtle px-2 py-1 text-xs text-ink-muted transition-colors hover:border-ink-faint hover:text-ink"
                      >
                        Yeniden adlandır
                      </button>
                      <button
                        onClick={() => void sil(doc)}
                        className="rounded-lg border border-border-subtle px-2 py-1 text-xs text-state-down transition-colors hover:border-state-down"
                      >
                        Sil
                      </button>
                    </>
                  )}
                </li>
              )
            })}
          </ul>
        </div>
      </div>
    </div>
  )
}
