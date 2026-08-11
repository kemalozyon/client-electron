import type { ApiFailure, ApiResult, ServerProbe } from '../shared/types'
import { sunucuAdresi } from './config'

/**
 * REST istemcisi MAIN PROCESS'te yaşıyor ve bu bir tercih değil, zorunluluk.
 *
 * Backend'de CORSMiddleware yok. Renderer bir Chromium bağlamı olduğu için
 * oradan atılan fetch cross-origin sayılır ve doğrudan engellenir; çözümü de
 * sunucuya dokunmak olurdu, ki kapsam dışı. Node'un fetch'i CORS'a tabi değil,
 * mesele bu kadar. WebSocket upgrade'i CORS'tan muaf olduğu için soket
 * renderer'da kalabiliyor — CRDT çerçevelerini IPC'den geçirmiyoruz.
 * (SPEC_FRONT §4.1)
 */
type IstekSecenekleri = {
  yol: string
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE'
  govde?: unknown
  token?: string
  /** Yalnızca yoklama kullanıyor: ölü bir adres dakikalarca asılı kalmasın. */
  zamanAsimiMs?: number
  /**
   * Adresi ezmek için — yalnızca "bu adres çalışıyor mu" yoklaması kullanıyor.
   * Verilmezse kayıtlı adres (config.ts). Normal çağrı yerleri BUNU GEÇMESİN:
   * adresin tek kaynağı config.ts, ve iki kaynak demek REST ile soketin farklı
   * sunuculara gitmesi demek — bu değişikliğin ortadan kaldırdığı hata tam da o.
   */
  base?: string
}

/** FastAPI 422 doğrulama dizisinin bir öğesi. */
type DogrulamaHatasi = { loc?: unknown[]; msg?: string }

function hataMesaji(status: number, govde: unknown, base: string): string {
  const detail = (govde as { detail?: unknown } | null)?.detail

  // 422: FastAPI string yerine dizi döndürüyor.
  if (Array.isArray(detail)) {
    const satirlar = (detail as DogrulamaHatasi[])
      .map((h) => {
        const alan = Array.isArray(h.loc) ? h.loc.filter((p) => p !== 'body').join('.') : ''
        return alan ? `${alan}: ${h.msg ?? 'geçersiz'}` : (h.msg ?? 'geçersiz değer')
      })
      .filter(Boolean)
    if (satirlar.length > 0) return satirlar.join(' · ')
  }

  if (typeof detail === 'string' && detail.length > 0) {
    /**
     * BAYAT SUNUCU TEŞHİSİ.
     *
     * Buradaki her gerçek 404'ün mesajı Türkçe. İngilizce ve harfi harfine
     * "Not Found" olan bir detail, FastAPI'nin eşleşmeyen-rota varsayılanıdır
     * — yani istediğimiz endpoint o sunucuda YOK. Pratikte bunun anlamı
     * neredeyse her zaman :8000'de eski bir sürümün (çoğunlukla bayat bir
     * Docker container'ı) dinlemesi: register ve login çalışır, /auth/me
     * "Not Found" der ve saatlerce istemci hatası aranır. (SPEC_FRONT §4.3)
     */
    if (status === 404 && detail === 'Not Found') {
      return (
        `Sunucu bu adresi tanımıyor (404 "Not Found"). Büyük ihtimalle ${base} ` +
        "adresinde ESKİ bir sunucu sürümü çalışıyor — bayat bir Docker container'ı olabilir. " +
        "Kontrol: curl -o /dev/null -w '%{http_code}' " +
        `${base}/auth/me → 401 güncel, 404 bayat demek.`
      )
    }
    return detail
  }

  return `Sunucu ${status} döndürdü.`
}

function hataTuru(status: number): ApiFailure['kind'] {
  if (status === 401) return 'auth'
  if (status >= 500) return 'server'
  return 'validation'
}

export async function istek<T>(o: IstekSecenekleri): Promise<ApiResult<T>> {
  // Adres artık sabit değil, çağrı ANINDA okunuyor: kullanıcı UI'dan
  // değiştirebiliyor (main/config.ts).
  const base = o.base ?? sunucuAdresi()

  const headers: Record<string, string> = {}
  if (o.token) headers['Authorization'] = `Bearer ${o.token}`
  if (o.govde !== undefined) headers['Content-Type'] = 'application/json'

  let cevap: Response
  try {
    cevap = await fetch(`${base}${o.yol}`, {
      method: o.method ?? 'GET',
      headers,
      body: o.govde === undefined ? undefined : JSON.stringify(o.govde),
      // Yeniden yönlendirme beklemiyoruz. Sondaki eğik çizgi kazası 307
      // üretir; sessizce takip etmek yerine burada patlasın.
      redirect: 'error',
      signal: o.zamanAsimiMs === undefined ? undefined : AbortSignal.timeout(o.zamanAsimiMs)
    })
  } catch (e) {
    return {
      ok: false,
      kind: 'network',
      message: `${base} adresine ulaşılamadı: ${e instanceof Error ? e.message : String(e)}`
    }
  }

  // 204 No Content: DELETE'ler böyle dönüyor, gövde yok.
  if (cevap.status === 204) return { ok: true, value: undefined as T }

  const govde: unknown = await cevap.json().catch(() => null)

  if (!cevap.ok) {
    return {
      ok: false,
      kind: hataTuru(cevap.status),
      message: hataMesaji(cevap.status, govde, base),
      status: cevap.status
    }
  }

  return { ok: true, value: govde as T }
}

/** Yoklama beş saniyede cevap vermezse ulaşılamaz sayıyoruz. */
const SONDA_ZAMAN_ASIMI_MS = 5000

/**
 * "Bu adreste doğru sunucu var mı?" — token'sız bir GET /auth/me.
 *
 * Cevabın kendisi teşhis: 401 güncel bir sunucu demek, 404 ise BAYAT bir sürüm
 * (register/login çalışır, /auth/me "Not Found" der — çoğunlukla eski bir
 * Docker container'ı; yukarıdaki bayat sunucu notuna bakın).
 *
 * TAVSİYE NİTELİĞİNDE: kaydı engellemiyor. Adresi tam da tünel yeniden
 * başlarken ya da sunucu kapalıyken düzeltmek isteyeceksiniz; doğru adresi
 * "şu an cevap vermiyor" diye reddetmek, bu özelliğin var olma sebebini
 * ortadan kaldırırdı.
 */
export async function sondaCek(kok: string): Promise<ServerProbe> {
  const sonuc = await istek<unknown>({
    base: kok,
    yol: '/auth/me',
    zamanAsimiMs: SONDA_ZAMAN_ASIMI_MS
  })

  if (sonuc.ok) {
    // Token'sız bir 200 beklemiyoruz; araya giren bir portal olabilir.
    return {
      state: 'unexpected',
      status: 200,
      message: `${kok} adresi token'sız /auth/me için 200 döndürdü — araya bir vekil giriyor olabilir.`
    }
  }
  // ULAŞILAMADI'yı önce ayıklıyoruz, çünkü `status` yalnızca bu dalda yok.
  if (sonuc.kind === 'network') {
    /**
     * redirect: 'error' burada görünür hâle geliyor: captive bir giriş sayfasına
     * 302 atan bir tünel "ulaşılamadı" olarak, üstelik bir redirect mesajıyla
     * çıkıyor. Dürüst ama şaşırtıcı; teşhis mesajı olduğu gibi gösteriliyor.
     */
    return { state: 'unreachable', message: sonuc.message }
  }
  if (sonuc.status === 401) return { state: 'current' }
  if (sonuc.status === 404) {
    // hataMesaji zaten bayat sunucu teşhisini (curl tarifi dahil) üretti.
    return { state: 'stale', status: 404, message: sonuc.message }
  }
  return { state: 'unexpected', status: sonuc.status ?? 0, message: sonuc.message }
}
