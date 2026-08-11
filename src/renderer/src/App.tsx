import { useCallback, useEffect, useState } from 'react'
import type { DocumentListItem, User } from '@shared/types'
import { api } from './api'
import { ErrorNote } from './components/ErrorNote'
import { ServerAddressField } from './components/ServerAddressField'
import { EditorPane } from './components/EditorPane'
import { LoginScreen } from './screens/LoginScreen'
import { DocumentsScreen } from './screens/DocumentsScreen'
import { ShareScreen } from './screens/ShareScreen'

/** Dört durum için router kütüphanesi yok — düz bir ayrık birleşim yetiyor. */
type Screen =
  | { name: 'login' }
  | { name: 'documents' }
  | { name: 'share'; doc: DocumentListItem }
  /**
   * `user` burada BİLEREK tekrarlanıyor.
   *
   * Aşağıdaki bindirme katmanı editörü oturum ölmüşken de mount tutuyor, yani
   * o anda App'in `user` state'i null. Editörün presence kimliği ise durmak
   * zorunda: kimliksiz kalırsak imleç etiketi kaybolur, kimliği efektin
   * bağımlılığı yaparsak Y.Doc yeniden kurulur ve yazılanlar gider. Ekranın
   * kendi durumunda taşımak ikisini de çözüyor.
   */
  | { name: 'editor'; doc: DocumentListItem; user: User }

function App(): React.JSX.Element {
  const [user, setUser] = useState<User | null>(null)
  const [screen, setScreen] = useState<Screen>({ name: 'login' })
  const [aciliyor, setAciliyor] = useState(true)
  const [acilisHatasi, setAcilisHatasi] = useState<string | null>(null)
  const [yenidenGirisSebebi, setYenidenGirisSebebi] = useState<string | null>(null)

  /**
   * Açılışta önbellekteki oturumu DOĞRULA.
   *
   * Üç sonuç var ve ilk ikisini karıştırmak kolay hata (SPEC_FRONT §4.3):
   * null → giriş ekranı; hata → sunucu bozuk, kullanıcıyı çıkış yapmış gibi
   * göstermek yalan olur, hatayı söyle; kullanıcı → kimliğin tek kaynağı bu.
   */
  const acilisiCalistir = useCallback(async () => {
    try {
      const ben = await api.auth.me()
      if (ben) {
        setUser(ben)
        setScreen({ name: 'documents' })
      } else {
        setUser(null)
        setScreen({ name: 'login' })
      }
    } catch (err) {
      setAcilisHatasi(err instanceof Error ? err.message : String(err))
    } finally {
      setAciliyor(false)
    }
  }, [])

  // Bkz. DocumentsScreen: state'e yalnızca await'ten sonra dokunuluyor.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void acilisiCalistir()
  }, [acilisiCalistir])

  /**
   * Main bir 401 gördü — ya da kullanıcı sunucu adresini değiştirdi.
   *
   * REST 401 ile WS 4401 TEK bir yola çıkıyor (SPEC_FRONT §7.5) — WS yarısı
   * adım 5'te bu aynı fonksiyona bağlanacak.
   *
   * Metni MAIN söylüyor. Burada sabit bir "süresi doldu" yazmak, tetikleyen şey
   * kullanıcının kendi adres değişikliği olduğunda yalan olurdu; yayının bir
   * `onChanged` geri çağrısından önce mi sonra mı geleceği de garanti değil
   * (send ile invoke'un çözülme sırası), yani yerelden düzeltmeye güvenilemez.
   * Sebep gelmezse eski metin varsayılan kalıyor.
   */
  useEffect(
    () =>
      api.onSessionInvalidated((sebep) => {
        setUser(null)
        setYenidenGirisSebebi(
          sebep ??
            'Oturumunuzun süresi doldu. Devam etmek için tekrar giriş yapın — yazdıklarınız duruyor.'
        )
        // Editördeysek ekranı DEĞİŞTİRMİYORUZ; aşağıdaki katman devreye girer.
        setScreen((s) => (s.name === 'editor' ? s : { name: 'login' }))
      }),
    []
  )

  /**
   * Cmd/Ctrl+R editör AÇIK DEĞİLKEN.
   *
   * Main tuşu her yerde kesiyor (menü hızlandırıcısını başka türlü durdurmanın
   * yolu yok), o yüzden editör dışındaki ekranlarda tuşun eski anlamını burada
   * geri veriyoruz: dev'de gerçek bir sayfa yenilemesi. Üretimde toolkit bunu
   * zaten yutuyordu ve öyle kalıyor — kullanıcı uygulamayı yenilemez.
   *
   * Editördeyken hiçbir şey yapmıyoruz: orada EditorPane kendi abonesiyle
   * dokümanı yeniden bağlıyor. İki koşul birbirini dışlıyor.
   */
  useEffect(
    () =>
      api.onEditorReload(() => {
        if (screen.name === 'editor') return
        if (import.meta.env.DEV) location.reload()
      }),
    [screen.name]
  )

  // useCallback: LoginScreen'in otomatik-giriş efekti buna bağımlı; her
  // render'da yeni bir kimlik üretirsek efekt boşuna yeniden çalışır.
  const girisYapildi = useCallback((u: User): void => {
    setUser(u)
    setYenidenGirisSebebi(null)
    // Editöre geri dönüyorsak ekranı olduğu gibi bırak — yalnızca presence
    // kimliğini tazeliyoruz, çünkü başka bir hesapla giriş yapılmış olabilir.
    // Bu prop'u değiştirmek Y.Doc'a dokunmuyor (bkz. useCollab'daki kimlik
    // efekti); yalnızca imleç etiketi ve rengi güncelleniyor.
    setScreen((s) => (s.name === 'editor' ? { ...s, user: u } : { name: 'documents' }))
  }, [])

  async function cikisYap(): Promise<void> {
    await api.auth.logout().catch(() => undefined)
    setUser(null)
    setScreen({ name: 'login' })
  }

  if (aciliyor) {
    return (
      <div className="flex h-full items-center justify-center bg-surface text-sm text-ink-faint">
        oturum denetleniyor…
      </div>
    )
  }

  // Sunucu bozuk. Giriş ekranı göstermek "çıkış yaptınız" demek olurdu; değil.
  if (acilisHatasi) {
    return (
      <div className="flex h-full items-center justify-center bg-surface p-6">
        <div className="flex w-full max-w-lg flex-col gap-3">
          <h1 className="text-sm font-semibold text-ink">Sunucuya ulaşılamadı</h1>
          <ErrorNote>{acilisHatasi}</ErrorNote>
          {/*
            Uygulamayı ilk kez açan biri için en muhtemel sebep bir arıza değil,
            eksik yapılandırma: paketlenmiş sürüm geçici bir geliştirme adresiyle
            geliyor. Sunucunun kendi metni yukarıda AYNEN duruyor (CLAUDE.md
            kuralı); bu satır onun yerine geçmiyor, yanına bir yol gösteriyor.
          */}
          <p className="text-xs text-ink-muted">
            İlk kurulum ise bu beklenen bir durum: aşağıdan kendi sunucunuzun adresini girin.
            Kaydettiğinizde bu ekran kendini yeniden dener.
          </p>
          {/*
            Bu ekranın en muhtemel sebebi ADRESİN kendisi (tünel yeniden başladı
            ve yeni bir alan adı verdi). O yüzden ayar burada AÇIK başlıyor ve
            kaydedince panel kendini yeniden deniyor: adresi düzelt, giriş ekranı
            gelir. Özelliğin tamamı tek bir harekete iniyor.
          */}
          <ServerAddressField
            defaultOpen
            onChanged={() => {
              setAciliyor(true)
              setAcilisHatasi(null)
              void acilisiCalistir()
            }}
          />
          <button
            onClick={() => {
              setAciliyor(true)
              setAcilisHatasi(null)
              void acilisiCalistir()
            }}
            className="self-start rounded-lg bg-accent px-3 py-1.5 text-sm font-medium text-surface shadow-glow transition-all hover:shadow-glow-lg active:scale-[0.98]"
          >
            Tekrar dene
          </button>
        </div>
      </div>
    )
  }

  /**
   * Oturum EDİTÖR AÇIKKEN öldü.
   *
   * Editörü unmount ETMİYORUZ: useCollab'ın temizliği Y.Doc'u yok ederdi ve
   * kullanıcının o ana kadar yazdığı her şey sessizce giderdi. CRDT istemcide
   * yaşıyor; yeniden giriş yapılınca soket aynı dokümana açılıyor ve el
   * sıkışma, token ölüyken yapılmış düzenlemeleri sunucuya itiyor. Hiçbir şey
   * kaybolmuyor. (SPEC_FRONT §7.5, §9.10)
   */
  if (!user && screen.name === 'editor') {
    return (
      <div className="relative h-full">
        <div className="h-full" aria-hidden>
          <EditorPane
            doc={screen.doc}
            user={screen.user}
            onBack={() => setScreen({ name: 'documents' })}
          />
        </div>
        <div className="absolute inset-0 bg-surface/80 backdrop-blur-sm">
          <LoginScreen
            onSignedIn={girisYapildi}
            reason={yenidenGirisSebebi ?? undefined}
            /*
              Editör HÂLÂ MOUNT, yani arkada canlı bir Y.Doc var. Adres
              değişirse o doküman yeniden bağlanamaz (useCollab'daki
              `kurulusAdresi` gardı): aynı UUID başka bir sunucuda başka bir
              doküman. Kullanıcı bunu bastıktan sonra değil ÖNCE bilsin.
            */
            serverNote={
              <ErrorNote>
                Bu belge açık. Adresi değiştirirseniz belge yeniden bağlanamaz — yazdıklarınız
                bellekte kalır ama yeni sunucuya gönderilemez.
              </ErrorNote>
            }
          />
        </div>
      </div>
    )
  }

  if (!user) {
    return <LoginScreen onSignedIn={girisYapildi} reason={yenidenGirisSebebi ?? undefined} />
  }

  switch (screen.name) {
    case 'documents':
    case 'login':
      return (
        <DocumentsScreen
          user={user}
          onOpen={(doc) => setScreen({ name: 'editor', doc, user })}
          onShare={(doc) => setScreen({ name: 'share', doc })}
          onSignOut={() => void cikisYap()}
        />
      )
    case 'share':
      return (
        <ShareScreen doc={screen.doc} user={user} onBack={() => setScreen({ name: 'documents' })} />
      )
    case 'editor':
      // Listeye dönmek oturumu YOK EDİYOR: EditorPane unmount olunca
      // useCollab'ın temizliği Y.Doc'u kapatıyor. (SPEC_FRONT §7.4)
      return (
        <EditorPane
          doc={screen.doc}
          user={screen.user}
          onBack={() => setScreen({ name: 'documents' })}
        />
      )
  }
}

export default App
