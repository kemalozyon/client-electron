import { BrowserWindow, ipcMain } from 'electron'
import { KANAL, OTURUM_GECERSIZ } from '../shared/channels'
import type {
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
} from '../shared/types'
import { istek, sondaCek } from './api'
import {
  adresNormalize,
  sunucuAdresi,
  sunucuAdresiSifirla,
  sunucuAdresiYaz,
  sunucuAyari
} from './config'
import { SOKET_ICIN_ASGARI_OMUR_MS, oturumOku, oturumSil, oturumYaz, tokenBitisi } from './session'

/** Sunucu varsayılanı; token'ın exp'i okunamazsa bu kadar ömür varsayıyoruz. */
const VARSAYILAN_OMUR_SN = 30 * 60

/**
 * `sebep` neden var: bu kanaldan iki farklı olay geçiyor — token ölümü ve
 * kullanıcının kendi yaptığı adres değişikliği. Renderer'da sabit bir
 * "oturumunuzun süresi doldu" metni ikincisinde yalan olurdu, o yüzden metni
 * yayınlayan taraf söylüyor.
 */
function oturumGecersizDuyur(sebep?: string): void {
  for (const pencere of BrowserWindow.getAllWindows()) {
    pencere.webContents.send(OTURUM_GECERSIZ, sebep)
  }
}

const OTURUM_YOK: ApiResult<never> = {
  ok: false,
  kind: 'auth',
  message: 'Oturum bulunamadı veya süresi doldu. Tekrar giriş yapın.'
}

/**
 * Token gerektiren her çağrı buradan geçiyor.
 *
 * 401 görürsek oturumu SİLİP renderer'a haber veriyoruz — REST 401 ile WS 4401
 * tek bir yola çıkıyor (SPEC_FRONT §7.5). Dikkat: bu sarmalayıcı bilerek
 * /auth/login için kullanılmıyor; oradaki 401 "parola yanlış" demek, ölmüş bir
 * oturum değil. İkisini karıştırmak, hiç var olmamış bir oturumun "süresi
 * doldu" diye anlatılmasına yol açıyor.
 */
async function yetkili<T>(o: {
  yol: string
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE'
  govde?: unknown
}): Promise<ApiResult<T>> {
  const oturum = oturumOku(sunucuAdresi())
  if (!oturum) return OTURUM_YOK

  const sonuc = await istek<T>({ ...o, token: oturum.accessToken })
  if (!sonuc.ok && sonuc.status === 401) {
    oturumSil()
    oturumGecersizDuyur()
  }
  return sonuc
}

export function ipcKur(): void {
  // ---- auth ----------------------------------------------------------------

  // Register TOKEN DÖNDÜRMÜYOR (201 + User). Ekran tarafı register → login
  // zincirini kuracak, ama önce kaydın oluştuğunu DUYURACAK: sessizce devam
  // etmek kullanıcıyı hesabın açılıp açılmadığından emin edemiyor.
  // (SPEC_FRONT §7.1)
  ipcMain.handle(KANAL.authRegister, (_e, email: string, password: string) =>
    istek<User>({ yol: '/auth/register', method: 'POST', govde: { email, password } })
  )

  ipcMain.handle(
    KANAL.authLogin,
    async (_e, email: string, password: string): Promise<ApiResult<User>> => {
      // Adresi BİR KEZ okuyup hem isteklerde hem de oturum kaydında kullanıyoruz:
      // arada bir server:set geçerse, oturumun yanlış sunucu adıyla etiketlenmesi
      // yalnızca kafa karıştırıcı bir 401 üretirdi.
      const kok = sunucuAdresi()

      const token = await istek<{ access_token: string; token_type: string }>({
        base: kok,
        yol: '/auth/login',
        method: 'POST',
        govde: { email, password }
      })
      if (!token.ok) return token

      // Kimliğin tek kaynağı /auth/me — token'ın içinde e-posta yok, yalnızca
      // sub/iat/exp var (SPEC_FRONT §3.5).
      const ben = await istek<User>({
        base: kok,
        yol: '/auth/me',
        token: token.value.access_token
      })
      if (!ben.ok) {
        // Girişin BAŞARISIZ olduğunu söylemiyoruz, çünkü olmadı. Ne olduysa
        // onu anlatıyoruz. (SPEC_FRONT §7.1)
        return {
          ok: false,
          kind: ben.kind,
          message: `Giriş başarılı, ancak kimlik bilgisi alınamadı: ${ben.message}`,
          status: ben.status
        }
      }

      oturumYaz({
        baseUrl: kok,
        accessToken: token.value.access_token,
        email: ben.value.email,
        expiresAt:
          tokenBitisi(token.value.access_token) ??
          Math.floor(Date.now() / 1000) + VARSAYILAN_OMUR_SN
      })
      return { ok: true, value: ben.value }
    }
  )

  /**
   * Önbelleğe ASLA güvenme — /auth/me ile doğrula. Üç sonuç var ve ilk ikisini
   * birbirine karıştırmak kolay hata (SPEC_FRONT §4.3):
   *   401           → oturumu sil, login göster       (value: null)
   *   başka bir hata → hatayı yüzeye çıkar; sunucu bozuk, kullanıcıyı çıkış
   *                    yapmış gibi göstermek yalan olur
   *   başarı        → dönen cevap kimliğin tek kaynağı
   */
  ipcMain.handle(KANAL.authMe, async (): Promise<ApiResult<User | null>> => {
    const oturum = oturumOku(sunucuAdresi())
    if (!oturum) return { ok: true, value: null }

    const ben = await istek<User>({ yol: '/auth/me', token: oturum.accessToken })
    if (ben.ok) return ben
    if (ben.status === 401) {
      // Açılışta zaten null döndürüp login'e yönlendiriyoruz; ayrıca
      // session:invalidated yayınlamak gereksiz gürültü olurdu.
      oturumSil()
      return { ok: true, value: null }
    }
    return ben
  })

  ipcMain.handle(KANAL.authLogout, (): ApiResult<void> => {
    oturumSil()
    return { ok: true, value: undefined }
  })

  /**
   * Token'ın renderer'a geçtiği TEK yer, ve yalnızca soket URL'sinde bulunmak
   * zorunda olduğu için. Genel bir "bana token ver" getter'ı yapmayın; dar ve
   * doküman başına kalsın ki var olma sebebi okunur olsun. (SPEC_FRONT §4.2)
   *
   * URL'yi ASLA loglamayın — token içinde.
   */
  ipcMain.handle(KANAL.authWsToken, (_e, _documentId: string): ApiResult<string> => {
    const oturum = oturumOku(sunucuAdresi())
    if (!oturum) return OTURUM_YOK

    // Ömrü bir dakikadan azsa soket açmak boşuna: açılır açılmaz 4401 yer.
    // Önce yeniden giriş, sonra soket. (SPEC_FRONT §7.5)
    if (oturum.expiresAt * 1000 - Date.now() < SOKET_ICIN_ASGARI_OMUR_MS) {
      return {
        ok: false,
        kind: 'auth',
        message: 'Oturumun ömrü bir dakikadan az. Soket açmadan önce tekrar giriş yapın.'
      }
    }
    return { ok: true, value: oturum.accessToken }
  })

  // ---- documents -----------------------------------------------------------

  // Zaten updated_at DESC sıralı geliyor; yeniden sıralamayın (SPEC_FRONT §7.2).
  ipcMain.handle(KANAL.documentsList, () => yetkili<DocumentListItem[]>({ yol: '/documents' }))

  ipcMain.handle(KANAL.documentsCreate, (_e, govde: DocumentCreate) =>
    yetkili<Document>({ yol: '/documents', method: 'POST', govde })
  )

  ipcMain.handle(KANAL.documentsUpdate, (_e, id: string, govde: DocumentUpdate) =>
    yetkili<Document>({ yol: `/documents/${id}`, method: 'PATCH', govde })
  )

  // DİKKAT: bu çağrının WEBSOCKET YAN ETKİSİ var. Sunucu, dönmeden önce o
  // dokümandaki HER sokete permission_revoked yollayıp 4410 ile kapatıyor —
  // kendi soketimiz de dahil. (SPEC_FRONT §3.2)
  ipcMain.handle(KANAL.documentsDelete, (_e, id: string) =>
    yetkili<void>({ yol: `/documents/${id}`, method: 'DELETE' })
  )

  // ---- roles ---------------------------------------------------------------

  ipcMain.handle(KANAL.rolesList, (_e, documentId: string) =>
    yetkili<Collaborator[]>({ yol: `/documents/${documentId}/roles` })
  )

  // Yetki E-POSTA ile veriliyor: istemcinin elinde kullanıcı UUID'si yok.
  // Bu rota sahipler için bilinçli bir "e-posta var mı" oracle'ı — sunucunun
  // "Bu e-posta ile kayıtlı kullanıcı yok." cevabını olduğu gibi gösterin,
  // yoksa sahibi yazım hatasını asla anlamaz. (SPEC_FRONT §3.2)
  ipcMain.handle(KANAL.rolesGrantByEmail, (_e, documentId: string, govde: RoleGrantByEmail) =>
    yetkili<Collaborator>({ yol: `/documents/${documentId}/roles`, method: 'PUT', govde })
  )

  // İptal ise user_id ile — UUID'yi işbirlikçi listesinden alıyoruz.
  // Bunun da WS yan etkisi var: o kullanıcının soketleri 4410 ile kapanıyor.
  ipcMain.handle(KANAL.rolesRevoke, (_e, documentId: string, userId: string) =>
    yetkili<void>({ yol: `/documents/${documentId}/roles/${userId}`, method: 'DELETE' })
  )

  // ---- server --------------------------------------------------------------

  /**
   * YALNIZCA yerel okuma — buraya asla ağ işi koymayın.
   *
   * useCollab bunu her bağlanma denemesinde çağırıyor (soket adresini buradan
   * öğreniyor); bir istek eklemek soket açma yoluna doğrudan ağ gecikmesi
   * bindirirdi.
   */
  ipcMain.handle(KANAL.serverGet, (): ApiResult<ServerConfig> => {
    return { ok: true, value: sunucuAyari() }
  })

  /**
   * Adresi değiştir.
   *
   * Sıra önemli: normalize → yokla → kaydet → oturumu sil. Normalize edilemeyen
   * bir adres HİÇ yazılmıyor; yoklama ise yalnızca TEŞHİS, kaydı engellemiyor
   * (bkz. api.ts'teki sondaCek notu). Kaydı yoklamaya bağlamak, adresi tam da
   * düzeltmek istediğiniz durumda — tünel yeniden başlıyor, container bayat —
   * doğru adresi reddetmek olurdu.
   *
   * Adres GERÇEKTEN değiştiyse oturumu siliyoruz: başka bir sunucunun ürettiği
   * token buraya yaramaz (session.ts'teki baseUrl eşleşmesi zaten aynı sonucu
   * veriyor, bu onun açık hâli). Aynı adres tekrar kaydedilirse silmiyoruz —
   * yalnızca bağlantıyı sınamak için Kaydet'e basmak insanı oturumdan atmasın;
   * `changed` alanı bunu çağırana da söylüyor.
   */
  ipcMain.handle(
    KANAL.serverSet,
    async (_e, giris: string): Promise<ApiResult<ServerSetResult>> => {
      let yeni: string
      try {
        yeni = adresNormalize(giris)
      } catch (e) {
        return {
          ok: false,
          kind: 'validation',
          message: e instanceof Error ? e.message : String(e)
        }
      }

      const degisti = yeni !== sunucuAdresi()
      const probe = await sondaCek(yeni)

      const ayar = sunucuAdresiYaz(yeni)
      if (degisti) {
        oturumSil()
        oturumGecersizDuyur(
          'Sunucu adresi değişti. Yeni sunucuda tekrar giriş yapın — yazdıklarınız duruyor.'
        )
      }

      return { ok: true, value: { ...ayar, probe, changed: degisti } }
    }
  )

  /**
   * Kaydı sil, env/varsayılana dön.
   *
   * `set(fallback)` ile aynı şey değil (config.ts'teki nota bakın). Sonuç şekli
   * set ile AYNI, çünkü çağıran taraf ikisini de aynı yerde gösteriyor.
   */
  ipcMain.handle(KANAL.serverReset, async (): Promise<ApiResult<ServerSetResult>> => {
    const eski = sunucuAdresi()
    const ayar = sunucuAdresiSifirla()
    const degisti = ayar.url !== eski
    if (degisti) {
      oturumSil()
      oturumGecersizDuyur(
        'Sunucu adresi varsayılana döndü. Tekrar giriş yapın — yazdıklarınız duruyor.'
      )
    }
    return { ok: true, value: { ...ayar, probe: await sondaCek(ayar.url), changed: degisti } }
  })
}
