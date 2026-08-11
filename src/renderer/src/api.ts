import type {
  ApiErrorKind,
  ApiResult,
  Collaborator,
  Document,
  DocumentCreate,
  DocumentListItem,
  DocumentUpdate,
  RoleGrantByEmail,
  ServerConfig,
  ServerSetResult,
  User
} from '@shared/types'

/**
 * IPC'den dönen başarısız sonucun renderer tarafındaki hâli.
 *
 * `kind` bir ALAN, sınıf hiyerarşisi değil — tek bir ApiError sınıfı var ve
 * ayrım instanceof ile değil `e.kind` ile yapılıyor. Alt sınıflara bölseydik
 * `catch (e) { if (e instanceof ApiError) ... }` sıralaması yanlış yazıldığında
 * 401 dalı hiç çalışmazdı; Python istemcisi tam olarak buna düştü.
 * (SPEC_FRONT §4.2)
 */
export class ApiError extends Error {
  readonly kind: ApiErrorKind
  readonly status?: number

  constructor(kind: ApiErrorKind, message: string, status?: number) {
    super(message)
    this.name = 'ApiError'
    this.kind = kind
    this.status = status
  }
}

/**
 * ApiResult'ı açar; başarısızsa fırlatır.
 *
 * Main tarafı ayrık bir sonuç döndürüyor çünkü Electron değerleri
 * structured-clone ediyor ve bir Error alt sınıfı karşıya kendisi olarak
 * geçmiyor. Sınıfa dönüştürme işi bu yüzden burada, sınırın renderer
 * tarafında yapılıyor.
 */
async function ac<T>(cagri: Promise<ApiResult<T>>): Promise<T> {
  const sonuc = await cagri
  if (sonuc.ok) return sonuc.value
  throw new ApiError(sonuc.kind, sonuc.message, sonuc.status)
}

/**
 * REST yüzeyi. Hepsi main process'e gidiyor — backend'de CORSMiddleware
 * olmadığı için renderer'dan doğrudan fetch atmak engellenirdi (SPEC_FRONT
 * §4.1). Buradan hiçbir zaman http://localhost:8000'e gitmiyoruz.
 */
export const api = {
  auth: {
    /** 201 + User döndürür, TOKEN DÖNDÜRMEZ. Girişi ayrıca yapın. */
    register: (email: string, password: string): Promise<User> =>
      ac(window.api.auth.register(email, password)),
    login: (email: string, password: string): Promise<User> =>
      ac(window.api.auth.login(email, password)),
    /** null = giriş yapılmamış. Hata fırlatması "sunucu bozuk" demek. */
    me: (): Promise<User | null> => ac(window.api.auth.me()),
    logout: (): Promise<void> => ac(window.api.auth.logout()),
    /** Soket URL'si için token. URL'yi ASLA loglamayın. */
    wsToken: (documentId: string): Promise<string> => ac(window.api.auth.wsToken(documentId))
  },
  documents: {
    /** Zaten updated_at DESC sıralı; yeniden sıralamayın (SPEC_FRONT §7.2). */
    list: (): Promise<DocumentListItem[]> => ac(window.api.documents.list()),
    create: (body: DocumentCreate): Promise<Document> => ac(window.api.documents.create(body)),
    update: (id: string, body: DocumentUpdate): Promise<Document> =>
      ac(window.api.documents.update(id, body)),
    /** Bağlı HERKESİ 4410 ile atar. Yıkıcı bir işlem, onay isteyin. */
    delete: (id: string): Promise<void> => ac(window.api.documents.delete(id))
  },
  roles: {
    list: (documentId: string): Promise<Collaborator[]> => ac(window.api.roles.list(documentId)),
    grantByEmail: (documentId: string, body: RoleGrantByEmail): Promise<Collaborator> =>
      ac(window.api.roles.grantByEmail(documentId, body)),
    revoke: (documentId: string, userId: string): Promise<void> =>
      ac(window.api.roles.revoke(documentId, userId))
  },
  /**
   * Sunucu adresi. Derleme zamanı sabiti DEĞİL — tünel her yeniden başladığında
   * değişiyor, o yüzden kullanıcı UI'dan giriyor ve tek kaynağı main/config.ts.
   */
  server: {
    /** Yalnızca yerel okuma, ağ yok. Soket her bağlanma denemesinde çağırıyor. */
    get: (): Promise<ServerConfig> => ac(window.api.server.get()),
    /** Adres değişirse OTURUM SİLİNİR; `changed` bunu söylüyor. */
    set: (url: string): Promise<ServerSetResult> => ac(window.api.server.set(url)),
    /** Kaydı siler, env/varsayılana döner — set(fallback) ile aynı şey değil. */
    reset: (): Promise<ServerSetResult> => ac(window.api.server.reset())
  },
  /**
   * Main 401 gördü (ya da adres değişti). WS 4401 ile AYNI yola çıkmalı
   * (SPEC_FRONT §7.5). `reason` metnini main söylüyor; burada uydurmuyoruz.
   */
  onSessionInvalidated: (cb: (reason?: string) => void): (() => void) =>
    window.api.onSessionInvalidated(cb),
  /** Cmd/Ctrl+R. Kime ne yaptığı çağıran ekranın kararı. */
  onEditorReload: (cb: () => void): (() => void) => window.api.onEditorReload(cb)
}
