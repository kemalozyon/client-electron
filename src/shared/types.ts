/**
 * Main process ile renderer arasındaki sözleşme.
 *
 * Bu dosya İKİ tsconfig projesinde birden derleniyor (node + web), çünkü aynı
 * tipleri IPC'nin iki ucu da görmek zorunda. Buraya yalnızca tip koyun —
 * çalışma zamanı kodu koyarsanız hem main hem renderer bundle'ına girer.
 *
 * Kaynak: SPEC_FRONT §3.1. Alan adları sunucunun JSON'ıyla birebir aynı
 * (snake_case), bilerek: gelen gövdeyi yeniden adlandırmıyoruz, böylece bir
 * alan kaybolursa TypeScript değil sunucu sözleşmesi tartışılıyor.
 */

/** resolve_role'ün döndürdüğü etkin rol. */
export type Role = 'owner' | 'editor' | 'viewer'

/**
 * Verilebilir rol. 'owner' burada YOK: sahiplik documents.owner_id sütununda
 * yaşıyor, document_roles tablosunda değil. Sunucu sahibine rol vermeye
 * çalışırsanız 400 "Sahip kendi dokümanında rol alamaz." diyor.
 */
export type GrantableRole = 'editor' | 'viewer'

export type User = {
  id: string
  email: string
  created_at: string
}

/**
 * DİKKAT: bu ad renderer'da DOM'un global `Document`'ını gölgeliyor. Ad
 * SPEC_FRONT §3.1'in sözlüğü olduğu için korundu; `import type { Document }`
 * yazdığınız dosyada `document`ın tipini kastediyorsanız yanılırsınız —
 * ama TypeScript bunu sessizce geçmez, yüksek sesle patlar.
 *
 * İçerik alanı YOK ve içerik döndüren bir endpoint de yok: doküman metni
 * yalnızca WebSocket sync alışverişinden geliyor (SPEC_FRONT §3.1).
 */
export type Document = {
  id: string
  owner_id: string
  title: string
  /** Sunucu için opak bir metin; asla yorumlanmıyor. */
  language: string
  created_at: string
  updated_at: string
}

/**
 * GET /documents öğeleri. `role` alanı REST'te editor ile viewer'ı ayıran
 * TEK yer — JWT rol taşımıyor, GET .../roles ise yalnızca sahibe açık.
 * Salt-okunur kararının tek girdisi burası (SPEC_FRONT §3.2, §7.4).
 */
export type DocumentListItem = Document & { role: Role }

export type Collaborator = {
  document_id: string
  user_id: string
  /** Listede UUID değil bunu gösterin; alan tam da bunun için var. */
  email: string
  role: GrantableRole
  granted_by: string
  granted_at: string
}

/**
 * IPC üzerinden dönen sonuç.
 *
 * Türü ALAN olarak taşıyoruz, sınıf hiyerarşisi olarak DEĞİL. Electron
 * değerleri structured-clone ediyor; bir Error alt sınıfı karşı tarafa kendisi
 * olarak geçmiyor zaten. Ama asıl sebep başka: Python istemcisindeki
 * YetkiHatasi(ApiHatasi) kalıbı her çağrı yerini sıraya duyarlı yapıyor —
 * `except ApiHatasi` önce yazılırsa 401 dalı hiç çalışmıyor. Ayrık bir alanla
 * bu hatayı yapmak mümkün değil. (SPEC_FRONT §4.2)
 */
export type ApiErrorKind = 'auth' | 'validation' | 'server' | 'network'

export type ApiFailure = {
  ok: false
  kind: ApiErrorKind
  /** Sunucunun kendi `detail` metni. Kendi kopyanızı uydurmayın. */
  message: string
  /**
   * HTTP durumu. `kind` kaba bir ayrım; 409 (e-posta kayıtlı) ile 404
   * (kullanıcı yok) arasını ayırmak isteyen çağrı yeri buna baksın.
   */
  status?: number
}

export type ApiSuccess<T> = { ok: true; value: T }

export type ApiResult<T> = ApiSuccess<T> | ApiFailure

/** POST /documents ve PATCH /documents/{id} gövdeleri. */
export type DocumentCreate = { title: string; language?: string }
export type DocumentUpdate = { title?: string; language?: string }

/** PUT /documents/{id}/roles gövdesi — yetki E-POSTA ile veriliyor. */
export type RoleGrantByEmail = { email: string; role: GrantableRole }

/**
 * Sunucu adresi ayarı. Adres artık derleme zamanı sabiti değil: tünel her
 * yeniden başladığında değiştiği için kullanıcı UI'dan giriyor (main/config.ts).
 */
export type ServerSource = 'stored' | 'env' | 'default'

export type ServerConfig = {
  url: string
  source: ServerSource
  /** Kayıtlı değer silinirse geçerli olacak adres (env ?? varsayılan). */
  fallback: string
  /**
   * EDITOR_BASE_URL ayarlıysa değeri, yoksa null.
   *
   * `source === 'stored'` iken bile taşınıyor, bilerek: kayıtlı değer ortam
   * değişkenini EZİYOR ve bu ikisi ayrıştığında ekranda bir adres görünüp
   * isteklerin başkasına gitmesi tam da bu özelliğin ortadan kaldırdığı hata.
   * Çelişkiyi gizlemek yerine gösteriyoruz.
   */
  env: string | null
}

/**
 * Adres kaydedilirken yapılan yoklamanın sonucu — TAVSİYE NİTELİĞİNDE, kayıt
 * her hâlükârda yapılıyor (main/api.ts'teki sondaCek notu).
 *
 * Yoklama, token'sız bir GET /auth/me. Sunucunun cevabı doğrudan teşhis:
 * 401 güncel bir sunucu, 404 ise BAYAT bir sürüm (çoğunlukla eski bir Docker
 * container'ı — register/login çalışır, /auth/me "Not Found" der).
 *
 * `message` alanı sunucunun kendi teşhisini taşıyor; ekranda kendi kopyanızı
 * uydurmayın (api.ts'teki bayat sunucu notu curl tarifini de veriyor).
 */
export type ServerProbe =
  | { state: 'current' }
  | { state: 'stale'; status: number; message: string }
  | { state: 'unexpected'; status: number; message: string }
  | { state: 'unreachable'; message: string }

/** `server:set` / `server:reset` sonucu. */
export type ServerSetResult = ServerConfig & {
  probe: ServerProbe
  /**
   * Adres GERÇEKTEN değişti mi? Değişmediyse oturum silinmedi — yalnızca
   * bağlantıyı sınamak için Kaydet'e basmak insanı oturumdan atmasın.
   */
  changed: boolean
}

/**
 * window.api'nin şekli — IPC köprüsünün sözleşmesi.
 *
 * Burada tek bir kez yazılıyor ve İKİ yerden birden tutuluyor:
 *   - src/preload/index.ts  köprüyü `satisfies Api` ile kuruyor
 *   - src/preload/index.d.ts  window.api'yi bu tiple ilan ediyor
 * Yani gerçek fonksiyonlarla ilan edilen tip birbirinden ayrılırsa derleme
 * patlar; .d.ts'i elle güncellemeyi unutmak sessiz bir `any` üretmez.
 */
export type Api = {
  auth: {
    register(email: string, password: string): Promise<ApiResult<User>>
    login(email: string, password: string): Promise<ApiResult<User>>
    me(): Promise<ApiResult<User | null>>
    logout(): Promise<ApiResult<void>>
    wsToken(documentId: string): Promise<ApiResult<string>>
  }
  documents: {
    list(): Promise<ApiResult<DocumentListItem[]>>
    create(body: DocumentCreate): Promise<ApiResult<Document>>
    update(id: string, body: DocumentUpdate): Promise<ApiResult<Document>>
    delete(id: string): Promise<ApiResult<void>>
  }
  roles: {
    list(documentId: string): Promise<ApiResult<Collaborator[]>>
    grantByEmail(documentId: string, body: RoleGrantByEmail): Promise<ApiResult<Collaborator>>
    revoke(documentId: string, userId: string): Promise<ApiResult<void>>
  }
  server: {
    /**
     * YALNIZCA yerel okuma, ağ yok. Soket her bağlanma denemesinde bunu
     * çağırıyor (useCollab); buraya bir istek koymak soket açma yoluna ağ
     * gecikmesi eklerdi.
     */
    get(): Promise<ApiResult<ServerConfig>>
    /** Normalize eder, yoklar, kaydeder ve (adres değiştiyse) oturumu siler. */
    set(url: string): Promise<ApiResult<ServerSetResult>>
    /**
     * Kaydı SİLER — `set(fallback)` ile aynı şey değil.
     *
     * `set(fallback)` bugünün varsayılanına eşit bir KAYIT yazar; `source`
     * sonsuza kadar 'stored' kalır ve kaynaktaki varsayılan bir daha
     * değiştiğinde (tünel alan adı yine dönecek) o kullanıcı için sessizce
     * yok sayılır. Bu kanal kaydı silip env/varsayılana geri düşüyor.
     */
    reset(): Promise<ApiResult<ServerSetResult>>
  }
  /**
   * Aboneliği kaldıran fonksiyonu döndürür.
   *
   * `reason` main'in gördüğü SEBEP — token ölümü ile kullanıcının kendi
   * yaptığı adres değişikliği aynı yoldan geçiyor ama aynı şey değil. Sabit
   * bir "oturumunuzun süresi doldu" metni ikincisinde düpedüz yalan olurdu.
   */
  onSessionInvalidated(cb: (reason?: string) => void): () => void
  /**
   * Cmd/Ctrl+R'ye basıldı. Aboneliği kaldıran fonksiyonu döndürür.
   *
   * Ne yapılacağı renderer'ın kararı: dokümanı yeniden bağlamak main'in
   * bilmediği bir şey (hangi ekranda olduğumuzu bilmiyor).
   */
  onEditorReload(cb: () => void): () => void
}
