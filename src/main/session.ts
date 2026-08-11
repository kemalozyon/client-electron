import { app, safeStorage } from 'electron'
import { readFileSync, writeFileSync, rmSync } from 'fs'
import { join } from 'path'

/**
 * Diskte tutulan oturum.
 *
 * `baseUrl` bilerek ANAHTARIN PARÇASI: başka bir sunucunun ürettiği token'ın
 * imzası farklıdır, dolayısıyla o token'ı denemek kafa karıştırıcı bir 401'den
 * başka bir şey getirmez. Baştan reddetmek daha dürüst. (SPEC_FRONT §4.3)
 */
export type StoredSession = {
  baseUrl: string
  accessToken: string
  email: string
  /** JWT 'exp' claim'i — unix SANİYE (milisaniye değil). */
  expiresAt: number
}

/**
 * Son kullanmaya 10 saniye kala token'ı ölü sayıyoruz.
 *
 * Kontrol anında geçerli olup soket açılana kadar ölen bir token, karşımıza
 * 4401 olarak çıkıyor — ve bu bir süre dolumu gibi değil, bir hata gibi
 * okunuyor. (SPEC_FRONT §4.3)
 */
const SON_KULLANMA_MARJI_MS = 10_000

/** Soket açmadan önce en az bu kadar ömür kalmalı (SPEC_FRONT §7.5). */
export const SOKET_ICIN_ASGARI_OMUR_MS = 60_000

function dosyaYolu(): string {
  return join(app.getPath('userData'), 'session.bin')
}

let bellek: StoredSession | null = null
let disktenOkundu = false

/**
 * safeStorage her platformda hazır değil (özellikle anahtarlık servisi olmayan
 * Linux masaüstlerinde). O durumda oturumu diske YAZMIYORUZ — düz metin bir
 * JWT'yi kullanıcı olarak çalışan her süreç okuyabilir ve Electron'un Python
 * istemcisindeki os.open(..., 0o600) numarasının bir karşılığı yok. Uygulama
 * çalışırken bellekte tutmak yeterli; bedeli her açılışta bir kez parola.
 */
function sifrelemeVarMi(): boolean {
  try {
    return safeStorage.isEncryptionAvailable()
  } catch {
    return false
  }
}

function diskten(): StoredSession | null {
  if (!sifrelemeVarMi()) return null
  try {
    const ham = readFileSync(dosyaYolu())
    const cozulmus = JSON.parse(safeStorage.decryptString(ham)) as Partial<StoredSession>
    if (
      typeof cozulmus.baseUrl !== 'string' ||
      typeof cozulmus.accessToken !== 'string' ||
      typeof cozulmus.email !== 'string' ||
      typeof cozulmus.expiresAt !== 'number'
    ) {
      return null
    }
    return cozulmus as StoredSession
  } catch {
    // Bozuk, yarım yazılmış veya başka bir anahtarla şifrelenmiş dosya:
    // SESSİZCE login'e düş. Yarım bir dosya yüzünden uygulamayı tuğlaya
    // çevirmek, bir kez daha parola sormaktan çok daha kötü. (SPEC_FRONT §4.3)
    return null
  }
}

/**
 * Geçerli oturumu döndürür — ya da null.
 *
 * DİKKAT: buradan dönen bir oturum "kullanıcı giriş yapmış" DEMEK DEĞİL.
 * Önbelleğe asla güvenmiyoruz; kimliğin tek kaynağı GET /auth/me'nin cevabı.
 * Bu fonksiyon sadece "denemeye değer mi" sorusunu cevaplıyor.
 */
export function oturumOku(baseUrl: string): StoredSession | null {
  if (!disktenOkundu) {
    bellek = diskten()
    disktenOkundu = true
  }
  const oturum = bellek
  if (!oturum) return null

  if (oturum.baseUrl !== baseUrl) {
    oturumSil()
    return null
  }
  if (oturum.expiresAt * 1000 - SON_KULLANMA_MARJI_MS <= Date.now()) {
    oturumSil()
    return null
  }
  return oturum
}

export function oturumYaz(oturum: StoredSession): void {
  bellek = oturum
  disktenOkundu = true
  if (!sifrelemeVarMi()) return
  try {
    writeFileSync(dosyaYolu(), safeStorage.encryptString(JSON.stringify(oturum)))
  } catch {
    // Yazamadıysak bellekteki oturum yine de geçerli; kullanıcı sadece
    // uygulamayı kapatınca tekrar giriş yapar.
  }
}

export function oturumSil(): void {
  bellek = null
  disktenOkundu = true
  try {
    rmSync(dosyaYolu(), { force: true })
  } catch {
    // Dosya zaten yoksa veya silinemiyorsa yapacak bir şey yok.
  }
}

/**
 * JWT'nin 'exp' claim'ine bakar.
 *
 * Bu bir DOĞRULAMA DEĞİL: imzayı kontrol etmiyoruz, edemeyiz de — istemcide
 * JWT_SECRET yok ve olmamalı. Yalnızca "bu token denemeye değer mi" sorusunu
 * ucuza cevaplamak için. Yetkilendirme kararı asla buna dayanmaz.
 * (SPEC_FRONT §3.5, §4.3)
 */
export function tokenBitisi(token: string): number | null {
  const govde = token.split('.')[1]
  if (!govde) return null
  try {
    const json = Buffer.from(govde.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8')
    const exp = (JSON.parse(json) as { exp?: unknown }).exp
    return typeof exp === 'number' ? exp : null
  } catch {
    return null
  }
}
