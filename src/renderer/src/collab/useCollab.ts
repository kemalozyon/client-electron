import { useCallback, useEffect, useRef, useState } from 'react'
import * as Y from 'yjs'
import { Awareness, removeAwarenessStates } from 'y-protocols/awareness'
import type { Role } from '@shared/types'
import { api } from '../api'
import { ROOT_NAME, belgeSoketUrl, renkUret } from './constants'
import {
  EnvelopeProvider,
  type ProviderError,
  type ProviderStatus,
  type Terminal
} from './EnvelopeProvider'

/** Bağlantı durumu — provider'ın 'status' olayından geliyor. */
export type ConnectionStatus = ProviderStatus

/** Status bar'da listelediğimiz uzak eş. */
export type Peer = {
  /**
   * Sunucudaki kullanıcı kimliği — eşin kendi iddiası (sunucu awareness'ı
   * doğrulamıyor). Yayınlamayan bir eş için null.
   */
  userId: string | null
  clientId: number
  name: string
  color: string
}

/** Presence'ta yayınlanan kimlik. `/auth/me`'den geliyor. */
export type PeerIdentity = { id: string; email: string }

/** Liste gerçekten değişti mi? Aşağıdaki setPeers gardı için. */
function imza(peers: Peer[]): string {
  return peers.map((p) => `${p.userId}|${p.clientId}|${p.name}|${p.color}`).join(',')
}

/**
 * Aynı kişinin iki clientID'sinden hangisi canlı?
 *
 * "Büyük clientID daha yenidir" YANLIŞ: Yjs clientID'leri rastgele, artan
 * değil. Ayırt eden şey tazelik — canlı bağlantı beş saniyede bir kendini
 * yeniden duyuruyor, hayalet susmuş durumda.
 */
function dahaYeni(awareness: Awareness, a: number, b: number): boolean {
  return (awareness.meta.get(a)?.lastUpdated ?? 0) >= (awareness.meta.get(b)?.lastUpdated ?? 0)
}

/**
 * Bir doküman için kurulan CRDT oturumu. Doküman değişince komple yenisi
 * kurulur; bu nesnenin kimliği "hangi doküman" sorusunun cevabı olduğu için
 * CodeMirror efekti de buna bakarak kendini yeniden kuruyor.
 */
export type CollabSession = {
  ytext: Y.Text
  awareness: Awareness
}

export type CollabState = {
  session: CollabSession | null
  status: ConnectionStatus
  synced: boolean
  peers: Peer[]
  /** Nihai kapanış (4401/4404/4410/normal). Yönlendirme adım 5'te. */
  terminal: Terminal | null
  /** Sunucudan gelen son error çerçevesi. Soketi kapatmaz. */
  error: ProviderError | null
  /**
   * Soketi yeniden kur — Y.Doc'a DOKUNMADAN.
   *
   * Nihai kapanışlarda (4401/4404/4410) hiçbir şey yapmıyor; oralarda yeniden
   * bağlanmak yasak. `reloadEdilebilir` bunu önceden söylüyor ki düğme de
   * kendini kapatabilsin.
   */
  yenile: () => void
  reloadEdilebilir: boolean
}

/**
 * Bir dokümanın bütün CRDT yaşam döngüsü.
 *
 * Y.Doc -> ydoc.getText('content') -> Awareness -> EnvelopeProvider zincirini
 * kurar ve doküman değişiminde her şeyi baştan kurar.
 *
 * Efekt anahtarı `documentId` — ve bu, kancadaki tek gerçekten tehlikeli
 * ayrıntı. Bir Y.Doc'u iki doküman arasında paylaşmak bir görüntü hatası
 * değil: bağlanınca sunucunun 0x00'ına `encodeStateAsUpdate(doc, sv)` ile
 * cevap veriyoruz ve o fark YEREL DOKÜMANDAKİ HER ŞEYİ taşıyor. A'nın metni
 * B'ye yazılır, B'yi açık tutan herkese yayınlanır ve sunucu tarafından
 * KALICI hâle getirilir. Backend bunu fark edemez; ona göre bir istemci
 * meşru şekilde içerik itmiştir. Bu yüzden Y.Doc efektin içinde doğuyor,
 * efektin temizliğinde ölüyor. (SPEC_FRONT §8)
 *
 * Güvenli olan hâli, kural fazla uygulanmasın diye: AYNI dokümana yeniden
 * bağlanırken doküman KORUNUR — orada önemli olan soket kimliği değil,
 * doküman kimliği.
 */
export function useCollab(documentId: string, role: Role, identity: PeerIdentity): CollabState {
  const [session, setSession] = useState<CollabSession | null>(null)
  const [status, setStatus] = useState<ConnectionStatus>('connecting')
  const [synced, setSynced] = useState(false)
  const [peers, setPeers] = useState<Peer[]>([])
  const [terminal, setTerminal] = useState<Terminal | null>(null)
  const [error, setError] = useState<ProviderError | null>(null)
  /**
   * Aşağıdaki efektin `baglan`ı — dışarıdan çağırabilmek için.
   *
   * Neden ref: bağlantı kurma işi ydoc/awareness kapanışının içinde yaşamak
   * ZORUNDA (onları efekt yaratıyor ve yok ediyor), ama düğme efektin dışında.
   * Alternatif bir "epoch" state'ini efekt bağımlılığı yapmak olurdu — o da
   * efekti yeniden çalıştırır, yani Y.Doc'u yıkar ve gönderilmemiş her şeyi
   * çöpe atardı. Reload'ın var olma sebebinin tam tersi.
   */
  const baglanRef = useRef<(() => Promise<void>) | null>(null)

  useEffect(() => {
    const ydoc = new Y.Doc()
    const ytext = ydoc.getText(ROOT_NAME)

    const awareness = new Awareness(ydoc)
    // Yerel durumu aşağıdaki KİMLİK efekti yazıyor; burada yazmıyoruz ki
    // kimlik değişimi bu efekti (ve dolayısıyla Y.Doc'u) yeniden kurmasın.

    /**
     * Eş listesi — KİŞİ başına bir satır, bağlantı başına değil.
     *
     * Ayırt edici alan `userId`, çünkü clientID Y.Doc'a özel: yeniden
     * bağlanma yenisini üretiyor ve eski kimlik zaman aşımına düşene kadar
     * (~30 sn) listede kalıyor. Kişiye göre teklersek aynı insan iki kez
     * görünmüyor.
     */
    const onAwarenessChange = (): void => {
      const kisiler = new Map<string, Peer>()
      awareness.getStates().forEach((state, clientId) => {
        // getStates() yerel istemciyi de içerir; çıkarmazsak tek başına duran
        // bir pencere gururla "1 peer" der. (SPEC_FRONT §6.4)
        if (clientId === awareness.clientID) return
        const { user, userId } = state as {
          user?: { name?: string; color?: string }
          userId?: string
        }
        // userId yayınlamayan bir eş (ör. başka bir istemci) bağlantı bazında
        // listelenir — teklemek için elde başka bir şey yok.
        const anahtar = typeof userId === 'string' ? `u:${userId}` : `c:${clientId}`
        const eski = kisiler.get(anahtar)
        if (eski && !dahaYeni(awareness, clientId, eski.clientId)) return
        kisiler.set(anahtar, {
          userId: typeof userId === 'string' ? userId : null,
          clientId,
          name: user?.name ?? 'anonim',
          color: user?.color ?? '#7f849c'
        })
      })
      const next = [...kisiler.values()]
      // 'change' her uzak imleç hareketinde tetikleniyor — eş başına saniyede
      // ~15 kez. Gardı koymazsak bütün EditorPane o hızda yeniden render olur,
      // hem de hiçbir alanı değişmemiş bir liste için.
      setPeers((prev) => (imza(prev) === imza(next) ? prev : next))
    }
    awareness.on('change', onAwarenessChange)

    let provider: EnvelopeProvider | null = null
    let iptal = false
    /**
     * Kaçıncı bağlanma denemesindeyiz.
     *
     * baglan() token için await ediyor; düğmeye iki kez hızlı basılırsa iki
     * deneme aynı anda yolda olur ve ikisi de provider kurarsa bir soket
     * sızar (eskisinin destroy'u çağrılmadan üstüne yazılırdı). await'ten
     * sonra sayaç kaymışsa geç kalan deneme sessizce çekiliyor. `iptal`
     * unmount için ne yapıyorsa bu da yeniden bağlanma için onu yapıyor.
     */
    let nesil = 0
    /**
     * Bu Y.Doc'un HANGİ SUNUCUDA doğduğu — ilk bağlanmada damgalanıyor.
     *
     * Sunucu adresi çalışma zamanında değişebiliyor (main/config.ts), ama bu
     * efektin anahtarı yalnızca `documentId`. Yani adres değiştikten sonra
     * yeniden bağlanmak (reload düğmesi ya da adım 5'in backoff'u) AYNI Y.Doc'u
     * BAŞKA bir sunucuya bağlardı — ve el sıkışma `encodeStateAsUpdate` ile
     * yerel dokümandaki her şeyi oraya iterdi. Aynı UUID başka bir sunucuda
     * BAŞKA bir dokümandır; §8'in "başkasının işini yok eden" tuzağının tam
     * olarak kendisi, sadece yeni bir kılıkta.
     *
     * Kural burada, düğmede değil — `reloadEdilebilir` ile aynı disiplin.
     */
    let kurulusAdresi: string | null = null

    /**
     * Soketi (yeniden) kur.
     *
     * ydoc ve awareness'a DOKUNMUYOR — parametreleri değil, kapanış değişkeni
     * olarak alıyor. Aynı dokümana yeniden bağlanırken dokümanı KORUMAK
     * yalnızca güvenli değil, zorunlu: el sıkışma o ana kadar yazılmış ve
     * gönderilememiş her şeyi sunucuya itiyor. (CLAUDE.md §6, SPEC_FRONT §7.5)
     */
    const baglan = async (): Promise<void> => {
      const benimNesil = ++nesil

      // Eski soketi kapat. destroy() vedayı yolluyor, yani odadakiler bizi
      // önce "ayrıldı" sonra "geldi" olarak görüyor; kısa bir kırpışma ve
      // doğrusu bu — kapanan soketin ardında canlı görünmeye devam etmemeliyiz.
      const eski = provider
      provider = null
      eski?.destroy()

      // Eskinin bıraktığı uzak eşleri de düşürüyoruz: yeni soket kimin orada
      // olduğunu baştan öğrenecek, aradaki liste yanıltıcı olurdu. origin
      // 'reload' — yerel bir temizlik, kimseye duyurulmuyor.
      const uzaktakiler = [...awareness.getStates().keys()].filter(
        (id) => id !== awareness.clientID
      )
      if (uzaktakiler.length > 0) removeAwarenessStates(awareness, uzaktakiler, 'reload')

      /**
       * Adresi HER denemede yeniden okuyoruz.
       *
       * Neden state ya da ref değil: bir `useState` ya efektin bağımlılığı olur
       * (o zaman adres değişimi Y.Doc'u yıkar — yasak), ya da olmaz ve baglan()
       * bayat bir değeri kapanışta taşır. Ref ise, tek bir main-process `let`'i
       * okuyan memoize edilmiş bir kanalın üstüne elle yazılmış, geçersiz
       * kılınması gereken bir önbellek olurdu. Bedel bağlantı başına bir
       * structured-clone gidiş-dönüşü, tuş başına değil. Ayrıca adım 5'in
       * backoff döngüsü için kendiliğinden doğru olan tek şekil bu.
       */
      let base: string
      try {
        base = (await api.server.get()).url
      } catch (err) {
        if (iptal || benimNesil !== nesil) return
        setStatus('disconnected')
        setError({
          code: 'no_server_url',
          message: err instanceof Error ? err.message : String(err)
        })
        return
      }
      if (iptal || benimNesil !== nesil) return

      if (kurulusAdresi === null) {
        kurulusAdresi = base
      } else if (kurulusAdresi !== base) {
        setStatus('disconnected')
        setError({
          code: 'server_changed',
          message:
            'Sunucu adresi değişti. Bu dokümanı yeniden açın — aynı kimlik ' +
            'başka bir sunucuda başka bir doküman demek.'
        })
        return
      }

      let token: string
      try {
        // Token'ın renderer'a geçtiği tek yer; soket URL'sinde bulunmak
        // zorunda olduğu için (SPEC_FRONT §4.2). Her denemede YENİSİ alınıyor:
        // eskisi bu arada ölmüş olabilir.
        token = await api.auth.wsToken(documentId)
      } catch (err) {
        if (iptal || benimNesil !== nesil) return
        setStatus('disconnected')
        setError({
          code: 'no_token',
          message: err instanceof Error ? err.message : String(err)
        })
        return
      }
      if (iptal || benimNesil !== nesil) return

      provider = new EnvelopeProvider({
        wsUrl: belgeSoketUrl(base, documentId, token),
        doc: ydoc,
        awareness,
        // Zorlama DEĞİL — sunucu her gelen mesajda zaten kontrol ediyor.
        // Bu yalnızca reddedileceğini bildiğimiz bir yazmayı yollamamak için.
        canWrite: role !== 'viewer'
      })
      provider.on('status', setStatus)
      provider.on('synced', setSynced)
      provider.on('error', setError)
      provider.on('terminal', setTerminal)
      setStatus(provider.status)
    }
    baglanRef.current = baglan

    // react-hooks/set-state-in-effect burada bilerek kapalı: bu efektin işi tam
    // da kuralın "harici bir sisteme abone ol" istisnası — Y.Doc, Awareness ve
    // provider React'in dışında yaratılıyor ve React'e ancak state ile
    // duyurulabiliyor. Doküman başına bir kez çalışıyor.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSession({ ytext, awareness })

    void baglan()

    return () => {
      iptal = true
      baglanRef.current = null
      awareness.off('change', onAwarenessChange)
      // Sıra önemli: provider soketi kapatsın, sonra presence, sonra doküman.
      provider?.destroy()
      awareness.destroy()
      ydoc.destroy()
      setSession(null)
      setSynced(false)
      setTerminal(null)
      setError(null)
    }
  }, [documentId, role])

  /**
   * Yerel presence kimliği.
   *
   * AYRI bir efekt, bilerek: `identity` yukarıdaki efektin bağımlılığı OLAMAZ.
   * Token ölüp kullanıcı editör açıkken yeniden giriş yaptığında kimlik nesnesi
   * yenilenir; bağımlılık olsa efekt yeniden kurulur, temizliği Y.Doc'u yok
   * eder ve token ölüyken yazılmış her şey sessizce gider — §8'in "başkasının
   * işini yok eden" tuzağı. Kimlik yalnızca bir etiket; dokümanın ömrünü
   * belirlemesi için hiçbir sebep yok.
   *
   * Bu efekt setSession'dan sonraki commit'te, yani provider daha kurulmadan
   * (o `auth:wsToken` await'inin arkasında) çalışıyor. Dolayısıyla Awareness
   * yapıcısının koyduğu boş `{}` durumu tele hiç çıkmıyor.
   */
  useEffect(() => {
    if (!session) return
    // Alan adları y-codemirror.next'in okuduğu şeklin TAM OLARAK kendisi:
    // uzak imleç rengini user.color'dan, seçim vurgusunu user.colorLight'tan,
    // imleç etiketini user.name'den alıyor. (SPEC_FRONT §6.2)
    session.awareness.setLocalStateField('user', {
      name: identity.email,
      ...renkUret(identity.id)
    })
    // clientID bağlantıyı adlandırıyor, bu ise KİŞİYİ: eş listesinin yeniden
    // bağlanmalar arasında aynı insanı tek satırda tutmasını sağlayan alan.
    session.awareness.setLocalStateField('userId', identity.id)
  }, [session, identity.id, identity.email])

  /**
   * Nihai kapanışta yeniden bağlanmak YASAK.
   *
   * 4401 / 4404 / 4410 kararı verilmiş kapanışlar: 4401'in yolu yeniden giriş,
   * 4404 ve 4410'un yolu doküman listesi. Yeniden denemek ya boşuna ya da
   * sahibinin kararını görmezden gelmek olurdu (SPEC_FRONT §5.5). 'closed'
   * (1000/1001) bunlardan farklı — normal bir kapanış, yeniden bağlanılabilir.
   */
  const reloadEdilebilir = terminal === null || terminal.kind === 'closed'

  /**
   * Kuralın uygulandığı yer BURASI, düğme değil.
   *
   * Düğmenin kapalı görünmesi sadeleştirme; asıl kontrol burada duruyor ki
   * klavye kısayolu ya da başka bir çağıran yolu atlayamasın. (Sunucu tarafı
   * zorlamayla aynı mantık: arayüz sadeleştirir, kural kodda durur.)
   */
  const yenile = useCallback(() => {
    if (!reloadEdilebilir) return
    // Sıfırlamalar efektin İÇİNDE değil burada: baglan'ın mount yolunda ilk
    // await'ten önce state'e dokunmaması, react-hooks/set-state-in-effect için
    // ikinci bir suppression yazmamızı gerektirmiyor.
    setStatus('connecting')
    setSynced(false)
    setError(null)
    setTerminal(null)
    void baglanRef.current?.()
  }, [reloadEdilebilir])

  return { session, status, synced, peers, terminal, error, yenile, reloadEdilebilir }
}
