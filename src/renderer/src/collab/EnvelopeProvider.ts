import * as Y from 'yjs'
import {
  applyAwarenessUpdate,
  encodeAwarenessUpdate,
  removeAwarenessStates,
  type Awareness
} from 'y-protocols/awareness'

export type ProviderStatus = 'connecting' | 'connected' | 'disconnected'

export type Terminal =
  | { kind: 'revoked' } // 4410 — sahibi erişimi geri aldı
  | { kind: 'unauthorized' } // 4401 — token öldü
  | { kind: 'notFound' } // 4404 — doküman yok VEYA erişim yok
  | { kind: 'closed' } // 1000/1001 — normal kapanış

export type ProviderError = { code: string; message: string }

type OlayHaritasi = {
  status: (s: ProviderStatus) => void
  synced: (v: boolean) => void
  error: (m: ProviderError) => void
  terminal: (t: Terminal) => void
}

/** Zarf tipleri — tek baytlık ön ek, uzunluk yok, sürüm yok, base64 YOK. */
const SYNC = 0x00
const UPDATE = 0x01
const AWARENESS = 0x02

/**
 * Giden awareness kısması (ms).
 *
 * Awareness her tuşa ve her fare hareketine tepki veriyor: y-codemirror.next
 * imleç konumunu her ViewUpdate'te yeniden yazıyor. Backend'in HİÇBİR yerinde
 * hız sınırı yok, yani bir fare sürüklemesiyle saniyede yüzlerce çerçeve
 * arasında duran tek şey bu sayı. (SPEC_FRONT §6.4 50–100 ms diyor.)
 */
const PRESENCE_KISMA = 60

/** Periyodik yeniden duyuru aralığı (ms) — gerekçe aşağıda, duyuruyuYenile'de. */
const PRESENCE_ARALIK = 5000

/**
 * Kodlar karar veriyor. 44xx'ler NİHAİ: yeniden bağlanmak ya boşuna
 * (4401/4404) ya da sahibinin kararını görmezden gelmek (4410) olurdu.
 *
 * 4403 YOK ve olmayacak: backend, "yasak" ile "yok"u ayırmanın herhangi bir
 * token sahibine hangi doküman ID'lerinin var olduğunu söyleyeceği için ikisini
 * bilerek 4404'te birleştiriyor. O dalı yazmayın. (SPEC_FRONT §3.4)
 */
const NIHAI_KODLAR = new Map<number, Terminal['kind']>([
  [4401, 'unauthorized'],
  [4404, 'notFound'],
  [4410, 'revoked']
])

function cerceve(tip: number, govde: Uint8Array): Uint8Array {
  const out = new Uint8Array(govde.length + 1)
  out[0] = tip
  out.set(govde, 1)
  return out
}

/**
 * Sunucunun özel zarfını konuşan CRDT taşıyıcısı.
 *
 * Hazır hiçbir paket bu protokolü bilmiyor — y-websocket stok y-protocols
 * çerçevelemesi kullanıyor, buradaki ise tek baytlık bir ön ek. Sınıf bilerek
 * çerçeveden bağımsız: React import'u yok, useCollab uyarlıyor.
 */
export class EnvelopeProvider {
  private ws: WebSocket | null = null
  private readonly doc: Y.Doc
  private readonly awareness: Awareness
  private readonly dinleyiciler = new Map<keyof OlayHaritasi, Set<(arg: never) => void>>()
  private yokEdildi = false
  /** Kendi 0x00'ımızı yolladıktan sonra ilk 0x01'i bekliyoruz. */
  private senkronBekleniyor = false

  /** Kısma penceresi içinde birikmiş, durumu değişen clientID'ler. */
  private readonly bekleyenPresence = new Set<number>()
  private presenceZamanlayici: ReturnType<typeof setTimeout> | null = null
  private readonly duyuruZamanlayici: ReturnType<typeof setInterval>

  status: ProviderStatus = 'connecting'
  synced = false

  /**
   * Yazma hakkımız var mı? (rol !== 'viewer')
   *
   * BULGU — bu alan bir optimizasyon değil, bir hata düzeltmesi. El sıkışmayı
   * körlemesine uygularsak viewer da 0x01 yolluyor: sunucunun 0x00'ına
   * `encodeStateAsUpdate` ile cevap veriyoruz ve BOŞ bir Yjs farkı bile boş
   * olmayan bir yük. Sunucu bunu her seferinde reddediyor, yani her viewer
   * BAĞLANIR BAĞLANMAZ bir `forbidden` yiyor.
   *
   * Sorun sadece gürültü değil: SPEC_FRONT §7.4'e göre `forbidden`,
   * editor→viewer düşürmesinin İSTEMCİYE ULAŞAN TEK işareti. Bağlantı anında
   * da tetiklenirse adım 6'daki "erişiminiz değişti" uyarısı her viewer'a
   * yalan söylerdi. Yazamayacağımızı bilerek yolladığımız bir yazma isteğinin
   * zaten anlamı yok — o yarıyı atlıyoruz.
   *
   * Düşürme tespiti bundan etkilenmiyor: düşürülen bir EDITOR yazmaya devam
   * ettiği için ilk yerel düzenlemesinde 0x01 yolluyor ve `forbidden`ı orada
   * alıyor.
   */
  private readonly yazabilir: boolean

  constructor(opts: { wsUrl: URL; doc: Y.Doc; awareness: Awareness; canWrite: boolean }) {
    this.doc = opts.doc
    this.awareness = opts.awareness
    this.yazabilir = opts.canWrite
    this.doc.on('update', this.dokumanGuncellendi)
    this.awareness.on('update', this.presenceGuncellendi)
    this.duyuruZamanlayici = setInterval(this.duyuruyuYenile, PRESENCE_ARALIK)
    this.baglan(opts.wsUrl)
  }

  on<K extends keyof OlayHaritasi>(olay: K, cb: OlayHaritasi[K]): void {
    let küme = this.dinleyiciler.get(olay)
    if (!küme) {
      küme = new Set()
      this.dinleyiciler.set(olay, küme)
    }
    küme.add(cb as (arg: never) => void)
  }

  destroy(): void {
    this.yokEdildi = true

    // Sıra önemli: VEDA soket hâlâ açıkken gitmek zorunda.
    this.vedaEt()

    // Önce dinleyiciler, sonra soket. Y.Doc'a DOKUNMUYORUZ: ömrü onu
    // yaratanın sorumluluğunda (SPEC_FRONT §5.5).
    this.doc.off('update', this.dokumanGuncellendi)
    this.awareness.off('update', this.presenceGuncellendi)
    clearInterval(this.duyuruZamanlayici)
    this.kismayiDurdur()
    const ws = this.ws
    this.ws = null
    if (ws) {
      ws.onopen = null
      ws.onmessage = null
      ws.onclose = null
      ws.onerror = null
      if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
        ws.close(1000, 'istemci kapatıyor')
      }
    }
  }

  // --- iç işler -------------------------------------------------------------

  private yay<K extends keyof OlayHaritasi>(olay: K, arg: Parameters<OlayHaritasi[K]>[0]): void {
    for (const cb of this.dinleyiciler.get(olay) ?? []) (cb as (a: typeof arg) => void)(arg)
  }

  private durumAyarla(s: ProviderStatus): void {
    if (this.status === s) return
    this.status = s
    this.yay('status', s)
  }

  private syncedAyarla(v: boolean): void {
    if (this.synced === v) return
    this.synced = v
    this.yay('synced', v)
  }

  private baglan(wsUrl: URL): void {
    this.durumAyarla('connecting')
    // URL'yi ASLA loglamayın — token içinde.
    const ws = new WebSocket(wsUrl)
    // Yoksa Blob gelir ve her çerçevede await .arrayBuffer() gerekir.
    ws.binaryType = 'arraybuffer'
    this.ws = ws
    ws.onopen = this.acildi
    ws.onmessage = this.mesaj
    ws.onclose = this.kapandi
    ws.onerror = () => {
      /* onclose zaten arkasından geliyor; durumu orada tek yerde yönetiyoruz */
    }
  }

  private gonder(veri: Uint8Array): void {
    const ws = this.ws
    if (!ws || ws.readyState !== WebSocket.OPEN) return
    ws.send(veri)
  }

  private acildi = (): void => {
    /**
     * DİKKAT: "açıldı" tek başına HİÇBİR ŞEY ifade etmiyor.
     *
     * Sunucu handshake'i koşulsuz kabul ediyor (accept()), token'ı, UUID'yi ve
     * rolü ONDAN SONRA kontrol edip 44xx ile kapatıyor — accept'ten önce
     * kapatmak düz bir HTTP 403 üretir ve kapanış kodları görünmez olurdu.
     * Yani her ret, başarılı bir onopen'ın ARDINDAN onclose olarak geliyor.
     * (SPEC_FRONT §3.3)
     */
    this.durumAyarla('connected')

    // Bağlanınca kendi eksiğimizi ÇEKİYORUZ. Karşı taraf da aynı anda kendi
    // state vector'ünü yolluyor; iki uç simetrik davranıyor.
    this.senkronBekleniyor = true
    this.gonder(cerceve(SYNC, Y.encodeStateVector(this.doc)))

    // Kendimizi HEMEN duyuruyoruz. Sunucu awareness'ı biriktirmediği için
    // (§6.3) odada bizden önce olanlar bizi ancak biz konuşunca görüyor;
    // el sıkışmayı beklemenin bir anlamı yok, presence dokümandan bağımsız.
    this.kendiniDuyur(true)
  }

  private mesaj = (ev: MessageEvent): void => {
    // Text frame'ler SUNUCUDAN İSTEMCİYE tek yönlü: error ve permission_revoked.
    if (typeof ev.data === 'string') {
      this.kontrolMesaji(ev.data)
      return
    }

    const görünüm = new Uint8Array(ev.data as ArrayBuffer)
    // Boş çerçeveyi 0. bayta bakmadan ele: view[0] undefined olurdu.
    if (görünüm.length === 0) return

    const tip = görünüm[0]
    const govde = görünüm.subarray(1)

    switch (tip) {
      case SYNC:
        /**
         * "Elimde bu var" dedi. Eksiğini hesaplayıp İTİYORUZ.
         *
         * El sıkışma kuralı SİMETRİK ve iki yarısı da ZORUNLU:
         *   0x00 geldi → 0x01 + encodeStateAsUpdate(doc, onun sv'si) ile cevap ver.
         * Yalnızca çekme yarısını yazarsanız yerel içerik sunucuya HİÇ ulaşmaz
         * ve hata da almazsınız. (SPEC_FRONT §3.4)
         */
        if (this.yazabilir) {
          this.gonder(cerceve(UPDATE, Y.encodeStateAsUpdate(this.doc, govde)))
        }
        break

      case UPDATE:
        // origin = this: aşağıdaki doc.on('update') bunu geri yollamasın.
        Y.applyUpdate(this.doc, govde, this)
        if (this.senkronBekleniyor) {
          // Sunucu 0x00'a HER ZAMAN 0x01 ile cevap veriyor (boş bir Yjs farkı
          // bile boş olmayan bir yük). Yani kendi 0x00'ımızdan sonraki ilk
          // 0x01, "ilk senkron bitti" için sağlam bir işaret.
          //
          // Kabul edilen kabalık: zarfta ayrı bir SYNC_STEP2 tipi yok, o yüzden
          // biz katılırken yazan bir eşin yayılan düzenlemesi synced'ı bir tık
          // ERKEN çevirebilir. Zararsız — asla geç kalmıyor. (SPEC_FRONT §5.4)
          this.senkronBekleniyor = false
          this.syncedAyarla(true)
        }
        break

      case AWARENESS: {
        // Uygulamadan ÖNCE kimleri tanıdığımızın fotoğrafı — aşağıdaki
        // "yeni biri mi?" karşılaştırması buna dayanıyor.
        const tanidiklar = new Set(this.awareness.getStates().keys())
        // origin = this: aşağıdaki awareness.on('update') bunu geri yollamasın.
        // Yükün içeriği sunucu için TAMAMEN opak — ne doğruluyor ne saklıyor,
        // sadece dağıtıyor. Yani "kim, hangi renk, hangi userId" bilgisinin
        // tek kaynağı karşı istemcinin kendi iddiası; gösterilir ama üzerine
        // yetki kurulmaz. (SPEC_FRONT §6.4)
        applyAwarenessUpdate(this.awareness, govde, this)
        this.yenilereKendiniTanit(tanidiklar)
        break
      }

      default:
        // Sunucu bilinmeyen tip yollamaz; yollarsa da bizim işimiz değil.
        break
    }
  }

  private kontrolMesaji(ham: string): void {
    let m: { type?: string; code?: string; message?: string }
    try {
      m = JSON.parse(ham)
    } catch {
      return
    }

    if (m.type === 'error') {
      const kod = m.code ?? 'unknown'
      this.yay('error', { code: kod, message: m.message ?? '' })
      /**
       * bad_update: güncellememiz ÇÖZÜLEMEDİ — uygulanmadı ve yayılmadı.
       * Sessizce ayrışmamak için yeniden senkron istiyoruz. (SPEC_FRONT §7.5)
       *
       * forbidden (viewer'a düşürüldük) adım 6'da ele alınıyor; hiçbir error
       * kodu soketi KAPATMIYOR.
       */
      if (kod === 'bad_update') {
        this.senkronBekleniyor = true
        this.gonder(cerceve(SYNC, Y.encodeStateVector(this.doc)))
      }
      return
    }

    if (m.type === 'permission_revoked') {
      // Ardından 4410 geliyor; nihai kararı onclose veriyor. Burada yalnızca
      // erken haber vermiş oluyoruz.
      this.yay('terminal', { kind: 'revoked' })
    }
  }

  private kapandi = (ev: CloseEvent): void => {
    this.ws = null
    this.senkronBekleniyor = false
    // Kuyrukta bekleyen presence'ın gideceği bir yer kalmadı.
    this.kismayiDurdur()
    this.bekleyenPresence.clear()
    /**
     * Uzak eşleri HEMEN düşürüyoruz.
     *
     * Sunucu "eş ayrıldı" diye bir şey yollamıyor ve y-protocols'un kendi
     * zaman aşımı ~30 saniye. Yani soket öldükten sonra da eş listesi dolu
     * kalır: bağlantısı kopmuş bir editör hâlâ kalabalık ve sağlıklı görünür —
     * §5.5'in uyardığı yanlış güven tam olarak bu. Soket yoksa kimseyi
     * göremiyoruz, öyle de söylüyoruz. (y-websocket de disconnect'te bunu
     * yapıyor; §9.5 bunu ölçüyor.)
     *
     * origin = this: bu YEREL bir temizlik, kimseye duyurulmuyor — hem soket
     * kapalı hem de başkalarının o eşleri görüp görmediği bizi ilgilendirmiyor.
     */
    const uzaktakiler = [...this.awareness.getStates().keys()].filter(
      (id) => id !== this.awareness.clientID
    )
    if (uzaktakiler.length > 0) removeAwarenessStates(this.awareness, uzaktakiler, this)

    this.durumAyarla('disconnected')
    this.syncedAyarla(false)
    if (this.yokEdildi) return

    const kind = NIHAI_KODLAR.get(ev.code)
    if (kind) {
      this.yay('terminal', { kind })
      return
    }
    if (ev.code === 1000 || ev.code === 1001) {
      this.yay('terminal', { kind: 'closed' })
      return
    }
    // 1006 / 1011 / ağ arızası: yeniden bağlanılabilir. Geri çekilmeli yeniden
    // bağlanma ADIM 5'te; şu an sadece 'disconnected' olarak duruyoruz.
  }

  /**
   * Yankı bastırma bir BAYRAK değil, origin kimliği.
   *
   * Python istemcisindeki modül seviyesi `_uzaktan_uyguluyor` boolean'ı yalnızca
   * pycrdt'nin doc seviyesindeki origin'inin origin'in kendisi değil bir HASH'i
   * olmasından doğuyor. Yjs'te böyle bir kusur yok; origin karşılaştırması
   * yeniden girişe karşı güvenli. O bayrağı buraya taşımayın. (SPEC_FRONT §5.3)
   */
  private dokumanGuncellendi = (update: Uint8Array, origin: unknown): void => {
    if (origin === this) return // uzaktan geldi; geri yollamıyoruz
    this.gonder(cerceve(UPDATE, update))
  }

  // --- presence (0x02) ------------------------------------------------------

  /**
   * Yerel presence değişti — kısma penceresine yaz.
   *
   * DİKKAT: `yazabilir` burada YOK ve olmamalı. O bayrak yalnızca 0x01'i
   * kapatıyor; 0x02 viewer için de serbest ve sunucu bunu bilerek böyle
   * yazmış ("Viewers do participate in awareness", ws.py'deki rol kontrolü
   * yalnızca UPDATE'e bakıyor). Buraya da koyarsak her viewer görünmez olur —
   * kimsenin imlecini göremediği değil, kimsenin ONUN imlecini göremediği bir
   * hata; yani ekranında her şey yolunda görünür. (SPEC_FRONT §6.4)
   */
  private presenceGuncellendi = (
    { added, updated, removed }: { added: number[]; updated: number[]; removed: number[] },
    origin: unknown
  ): void => {
    if (origin === this) return // uzaktan geldi; geri yollamıyoruz
    for (const id of added) this.bekleyenPresence.add(id)
    for (const id of updated) this.bekleyenPresence.add(id)
    for (const id of removed) this.bekleyenPresence.add(id)
    this.presenceKuyrukla()
  }

  private presenceKuyrukla(): void {
    if (this.presenceZamanlayici !== null) return
    this.presenceZamanlayici = setTimeout(this.presenceBosalt, PRESENCE_KISMA)
  }

  /**
   * Kendini duyur — SAATİ ARTIRARAK. Her duyuru yolu buradan geçiyor.
   *
   * Saati artırmak seçenek değil, ZORUNLU. `applyAwarenessUpdate` saati büyük
   * olmayan bir güncellemeyi SESSİZCE yok sayıyor, ve karşı tarafın bizi
   * "unuttuğu" ama saatimizi HATIRLADIĞI iki durum var:
   *   - vedaEt() aynı saatle `null` yolladı (kapanış),
   *   - kapandi() uzak eşleri düşürdü — states siliniyor, meta KALIYOR.
   * İkisinden sonra da aynı saatle yollanan bir duyuru hiç uygulanmıyor.
   * Ölçtük: yeniden bağlanmada eşler 5057 ms sonra (yalnızca periyodik duyuru
   * saati artırdığı için) görünüyordu; saat artınca 22 ms.
   *
   * `setLocalState(getLocalState())` durumu aynı bırakıp saati bir artırıyor;
   * presenceGuncellendi bunu kuyruğa alıyor. Awareness'ın kendi 15 saniyelik
   * saati de tam olarak bunu yapıyor.
   */
  private kendiniDuyur(hemen: boolean): void {
    const durum = this.awareness.getLocalState()
    if (durum === null) {
      // Olmaması gerekiyor (kimlik efekti provider'dan önce yazıyor); olursa da
      // susmaktansa boş bir duyuru yollamak yeğ.
      this.bekleyenPresence.add(this.awareness.clientID)
      this.presenceKuyrukla()
    } else {
      this.awareness.setLocalState(durum)
    }
    if (hemen) this.presenceBosalt()
  }

  /**
   * Odaya yeni giren birine kendimizi ANINDA tanıt.
   *
   * Sunucuda `queryAwareness` yok (§6.3), yani yeni bağlanan istemci
   * "kimler var?" diye soramıyor — yalnızca kendini duyurabiliyor. Duyuruyu
   * duyan taraf biz olduğumuz için soruyu bizim adına biz cevaplıyoruz:
   * daha önce hiç görmediğimiz bir clientID konuştuysa kendi durumumuzu
   * geri yolluyoruz. Sunucunun eksiğini istemci tarafında kapatmanın en ucuz
   * yolu bu; sunucuda hiçbir şey değişmiyor.
   *
   * Bunun olmadığı hâli ÖLÇTÜK: yeni gelen, oradakileri ancak onların 5
   * saniyelik periyodik duyurusuyla görüyordu (5034 ms). Yani dosyayı açıyor
   * ve beş saniye boyunca odada kimse yokmuş gibi duruyor. Bununla 20 ms.
   *
   * SONSUZ DÖNGÜ YOK, çünkü koşul "daha önce görmediğim biri": A yeni geleni
   * B'yi öğrenir → kendini yollar → B, A'yı öğrenir (o da yeni) → kendini
   * yollar → A bu kez B'yi ZATEN tanıyor ve susar. İki turda kapanıyor.
   * Periyodik duyuru yine de kalıyor: 30 saniyelik zaman aşımına karşı
   * `lastUpdated`'ı tazeleyen tek şey o.
   */
  private yenilereKendiniTanit(tanidiklar: Set<number>): void {
    let yeniVar = false
    for (const id of this.awareness.getStates().keys()) {
      if (id !== this.awareness.clientID && !tanidiklar.has(id)) {
        yeniVar = true
        break
      }
    }
    if (!yeniVar) return
    // kendiniDuyur, saati artırma zorunluluğu dâhil işi tek yerde tutuyor:
    // yeniden bağlanan bir eş bizi hatırlıyor ama unutmuş olabilir, o hâlde
    // aynı saatle yollanan duyuru sessizce düşerdi.
    this.kendiniDuyur(false)
  }

  private kismayiDurdur(): void {
    if (this.presenceZamanlayici === null) return
    clearTimeout(this.presenceZamanlayici)
    this.presenceZamanlayici = null
  }

  /**
   * Birikmiş presence'ı tek çerçevede yolla.
   *
   * Biriktirmek güvenli: `encodeAwarenessUpdate` yalnızca clientID LİSTESİ
   * alıyor, durumu çağrıldığı anda okuyor. Yani pencere içinde imleç üç kez
   * kımıldadıysa yollanan şey en SON konum, arada kalan iki konum değil. Silinmiş
   * bir clientID de `null` durum olarak kodlanıyor — "bu eş gitti" işareti zaten
   * bu.
   */
  private presenceBosalt = (): void => {
    this.kismayiDurdur()
    if (this.bekleyenPresence.size === 0) return
    const kimlikler = [...this.bekleyenPresence]
    this.bekleyenPresence.clear()
    this.gonder(cerceve(AWARENESS, encodeAwarenessUpdate(this.awareness, kimlikler)))
  }

  /**
   * Kendimizi periyodik olarak yeniden duyur.
   *
   * İKİ işi var ve ikincisi tek başına yeterli sebep:
   *
   * 1. Hayalete düşmemek. y-protocols durumu 30 saniye tazelenmeyen bir eşi
   *    siliyor; `lastUpdated`'ı tazeleyen TEK şey bu tik. (Awareness'ın kendi
   *    saati de 15 saniyede bir aynısını yapıyor — bu onun hızlandırılmışı.)
   * 2. Emniyet ağı: bir duyuru yolda kaybolursa ya da yenilereKendiniTanit
   *    bir sebeple tetiklenmezse, geç katılan en kötü hâlde beş saniye içinde
   *    yine görünür oluyor. SPEC_FRONT §6.3 bunu istiyor.
   *
   * Geç katılanın kendi körlüğünü çözen şey bu DEĞİL — o yenilereKendiniTanit;
   * ölçüm orada. Tek başına periyodik duyuruyla 5034 ms sürüyordu.
   *
   * Bu kancada değil provider'da duruyor, çünkü soketin açık olup olmadığını
   * bilen tek yer burası — kapalıyken saati artırmanın kimseye faydası yok.
   */
  private duyuruyuYenile = (): void => {
    if (this.ws?.readyState !== WebSocket.OPEN) return
    if (this.awareness.getLocalState() === null) return
    this.kendiniDuyur(false)
  }

  /**
   * "Ayrıldım" duyurusu.
   *
   * y-protocols'un sözleşmesi: bir istemci kapanmadan önce `null` bir durum
   * yayınlamalı. Yapmazsak kalanlar bizi 30 saniye hayalet olarak listeler —
   * hem de her temiz kapanışta.
   *
   * Çerçeveyi ELLE kuruyoruz ve Awareness'a DOKUNMUYORUZ. Buradaki doğal
   * refleks `removeAwarenessStates(awareness, [clientID], 'local')` çağırmaktı
   * ve YANLIŞTI: o fonksiyon bizim YEREL DURUMUMUZU siliyor, Awareness ise bu
   * provider'ın malı değil — ömrü useCollab'ın efektinde ve provider'dan uzun
   * yaşıyor. Reload gelene kadar görünmedi, çünkü destroy() yalnızca unmount'ta
   * çağrılıyordu ve orada doküman da hemen ölüyordu.
   *
   * ÖLÇTÜK: reload'dan sonra yerel durum boş kaldığı için acildi()'nin
   * duyurusu `null` gidiyor (encodeAwarenessUpdate eksik durumu null kodluyor),
   * duyuruyuYenile ve yenilereKendiniTanit `getLocalState() === null` görüp
   * çekiliyor, kimlik efekti de bağımlılıkları değişmediği için yeniden
   * çalışmıyor. Sonuç: yeniden bağlandıktan sonra HERKESE görünmez oluyorduk,
   * kendi ekranımız kusursuz görünürken. Y.Doc için yazdığımız kural
   * awareness için de geçerli — yaratmadığımız nesneyi yok etmiyoruz.
   *
   * `states` override'ı yalnızca GÖNDERİLEN yükü değiştiriyor; saat hâlâ
   * awareness.meta'dan okunuyor, yani AYNI saatle `null` yolluyoruz.
   * applyAwarenessUpdate'in tam olarak bunun için bir dalı var:
   * `currClock === clock && state === null && states.has(clientID)` →
   * eşi çevrimdışı işaretle. Protokolün kendi yolu bu.
   */
  private vedaEt(): void {
    if (this.ws?.readyState !== WebSocket.OPEN) return
    const kimlik = this.awareness.clientID
    if (!this.awareness.getStates().has(kimlik)) return
    // Boş harita: encodeAwarenessUpdate bulamadığı durumu `null` kodluyor.
    const bos = new Map<number, Record<string, unknown>>()
    this.gonder(cerceve(AWARENESS, encodeAwarenessUpdate(this.awareness, [kimlik], bos)))
  }
}
