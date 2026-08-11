import { app } from 'electron'
import { readFileSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import type { ServerConfig } from '../shared/types'

/**
 * Sunucu adresinin TEK KAYNAĞI.
 *
 * Eskiden adres üç ayrı yerde sabitti — main/api.ts, collab/constants.ts ve
 * index.html'in CSP'si — ve tünel her yeniden başladığında (trycloudflare her
 * seferinde YENİ bir alan adı veriyor) üçünü birden elle değiştirmek
 * gerekiyordu. Daha kötüsü üçü sessizce ayrışabiliyordu: EDITOR_BASE_URL
 * yalnızca REST'i taşıdığı için soket eski adrese gitmeye devam ediyor, CSP de
 * onu engelliyordu. Bu, istemci hatası gibi okunan bir yapılandırma hatasıydı.
 *
 * Artık adres burada yaşıyor, kullanıcı UI'dan değiştiriyor, REST de soket de
 * buradan okuyor. Renderer main'in ortam değişkenlerini göremediği için soket
 * tarafı adresi `server:get` kanalıyla alıyor.
 */

/** Hiçbir şey kayıtlı değilse ve ortam değişkeni de yoksa buraya bağlanılır. */
const VARSAYILAN_ADRES = 'https://alcohol-invision-rfc-teach.trycloudflare.com'

/**
 * Adres bir SIR DEĞİL, bu yüzden safeStorage kullanmıyoruz (oturumdan farkı bu).
 * Şifreleme servisi olmayan masaüstlerinde session.ts diske hiç yazmıyor; aynı
 * kısıtı adrese de uygulasaydık ayar her açılışta boşuna sıfırlanırdı.
 */
function dosyaYolu(): string {
  // app.getPath ready'den önce çağrılamaz; bu yüzden modül seviyesinde değil,
  // fonksiyon içinde. Modül KAPSAMINDA adres okuyan bir sabit (eski
  // api.ts'teki BASE_URL gibi) tam da bu yüzden geri gelmemeli: dosya ilk
  // ihtiyaç duyulduğunda okunuyor, ipcKur() sırasında değil — kanalların hepsi
  // app.whenReady() sonrasında çalışıyor, yani tembel okuma her zaman güvenli.
  return join(app.getPath('userData'), 'server.json')
}

let bellek: ServerConfig | null = null

function diskten(): string | null {
  try {
    const cozulmus = JSON.parse(readFileSync(dosyaYolu(), 'utf8')) as { url?: unknown }
    if (typeof cozulmus.url !== 'string' || cozulmus.url.length === 0) return null
    // Eski bir sürümün yazdığı normalize edilmemiş bir değer olabilir.
    return adresNormalize(cozulmus.url)
  } catch {
    // Bozuk, yarım yazılmış ya da hiç olmayan dosya: sessizce env/varsayılana
    // düş, ama dosyayı SİLMEYİN. session.ts'ten bilerek ayrılıyoruz: oturum bir
    // kimlik bilgisi, şüpheliyi atmanın bedeli bir kez parola sormak. Ayar ise
    // kullanıcının KENDİ girdisi; bir ayrıştırma tökezlemesinde silmek onu
    // sessizce reddettiği adrese geri döndürür. Bir sonraki başarılı kayıt
    // dosyanın üstüne yazıyor.
    return null
  }
}

/** EDITOR_BASE_URL — normalize edilebiliyorsa. */
function ortamAdresi(): string | null {
  const ham = process.env['EDITOR_BASE_URL']
  if (!ham) return null
  try {
    return adresNormalize(ham)
  } catch {
    // Bozuk bir ortam değişkeni yüzünden açılışta patlamak yerine varsayılana
    // düşüyoruz; kullanıcı zaten UI'dan düzeltebilir.
    return null
  }
}

/**
 * Kullanıcının yazdığını kanonik bir ORIGIN'e indirger.
 *
 * Şema yoksa https:// varsayıyoruz — tünel adresi çoğu zaman çıplak bir alan
 * adı olarak kopyalanıyor. Sorgu ve fragment atılıyor, SONDAKİ EĞİK ÇİZGİ de:
 * çizgi önemli, çünkü `/documents/` istemek Starlette'ten 307 yiyor
 * (SPEC_FRONT §3.2) ve api.ts redirect'i hata sayıyor.
 *
 * Ama YOL KORUNUYOR — `URL.origin` kullanmıyoruz. Ters vekil arkasında /api
 * altına monte edilmiş bir sunucu origin'e indirgenirse erişilemez hâle
 * gelirdi; `${base}${yol}` birleştirmesi zaten yolu destekliyor, korumanın
 * bedeli yok.
 *
 * ws:// ve wss:// yapıştırılırsa REDDETMİYORUZ, çeviriyoruz: insanların elinin
 * altındaki adres çoğu zaman soket adresi oluyor (CSP'de ve eski
 * constants.ts'te gördükleri o). Sonuç zaten ekrana geri yazılıyor, yani
 * sessiz bir dönüşüm değil.
 *
 * Şema testi `://` arıyor, yalnızca `:` DEĞİL. Bu önemli: `new URL('localhost:8000')`
 * hata vermiyor, protokolü "localhost:" olan bir URL üretiyor — ve kutuya
 * yazılması en muhtemel şeylerden biri tam olarak bu.
 *
 * Hata mesajları Türkçe ve doğrudan kullanıcıya gösteriliyor.
 */
export function adresNormalize(ham: string): string {
  const kirpilmis = ham.trim()
  if (kirpilmis.length === 0) throw new Error('Sunucu adresi boş olamaz.')

  const semali = /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(kirpilmis)
    ? kirpilmis
    : `https://${kirpilmis}`

  let url: URL
  try {
    url = new URL(semali)
  } catch {
    throw new Error(`"${kirpilmis}" geçerli bir adres değil.`)
  }

  if (url.protocol === 'ws:') url.protocol = 'http:'
  if (url.protocol === 'wss:') url.protocol = 'https:'

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error(
      `Yalnızca http:// ve https:// adresleri kabul ediliyor ("${url.protocol}" verildi).`
    )
  }
  if (url.hostname.length === 0) throw new Error('Adreste sunucu adı yok.')

  return `${url.origin}${url.pathname.replace(/\/+$/, '')}`
}

/** Kayıt silinirse geçerli olacak adres, ve ortam değişkeninin ham hâli. */
function geriDusus(): { fallback: string; env: string | null } {
  const env = ortamAdresi()
  return { env, fallback: env ?? adresNormalize(VARSAYILAN_ADRES) }
}

/**
 * Öncelik: kaydedilen > EDITOR_BASE_URL > varsayılan.
 *
 * Ortam değişkeni kayıtlı değeri EZMİYOR, bilerek: ortam "kullanıcı seçim
 * yapmadıysa nereye bağlan" sorusunun cevabı, "operatör neyi zorluyor"un değil.
 * Env kazansaydı UI bir adres gösterip istekler başkasına giderdi — bu
 * özelliğin var olma sebebi tam olarak o hata sınıfı. İkisi ayrıştığında
 * `env` alanı çelişkiyi ekrana taşıyor (bkz. shared/types.ts).
 */
export function sunucuAyari(): ServerConfig {
  if (bellek) return bellek

  const { env, fallback } = geriDusus()
  const kayitli = diskten()
  bellek = kayitli
    ? { url: kayitli, source: 'stored', fallback, env }
    : { url: fallback, source: env ? 'env' : 'default', fallback, env }
  return bellek
}

export function sunucuAdresi(): string {
  return sunucuAyari().url
}

/**
 * Normalize eder, diske yazar ve önbelleği tazeler.
 *
 * Yazamazsak (salt okunur userData) HATA ATMIYORUZ: ayar bu oturum boyunca
 * bellekte geçerli, kullanıcı sadece uygulamayı kapatınca kaybediyor —
 * session.ts'in yazamama davranışıyla aynı. `source` yine de 'stored'
 * dönüyor, çünkü artık kayıtlı değer O.
 */
export function sunucuAdresiYaz(ham: string): ServerConfig {
  const url = adresNormalize(ham)
  const { env, fallback } = geriDusus()
  bellek = { url, source: 'stored', fallback, env }
  try {
    writeFileSync(dosyaYolu(), JSON.stringify({ url }, null, 2), 'utf8')
  } catch {
    // Yukarıdaki nota bakın.
  }
  return bellek
}

/**
 * Kaydı siler; env/varsayılana geri düşer.
 *
 * `sunucuAdresiYaz(fallback)` ile AYNI ŞEY DEĞİL: o, bugünün varsayılanına eşit
 * bir kayıt bırakır ve kaynaktaki VARSAYILAN_ADRES bir daha değiştiğinde (tünel
 * alan adı yine dönecek) o kullanıcı için sessizce yok sayılır.
 *
 * Silme başarısız olsa bile önbelleği düşürüyoruz: sonraki okuma diski yeniden
 * ayrıştırıp kayıtlı değeri geri getirir — yani ekranda dürüst olan görünür.
 */
export function sunucuAdresiSifirla(): ServerConfig {
  bellek = null
  try {
    rmSync(dosyaYolu(), { force: true })
  } catch {
    // Dosya zaten yoksa veya silinemiyorsa yapacak bir şey yok.
  }
  return sunucuAyari()
}
