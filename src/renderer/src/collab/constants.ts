/**
 * Paylaşılan kökün adı.
 *
 * Backend içerikten habersiz — hiçbir kök tipi tanımlamıyor, gelen update'i
 * çıplak bir Doc'a uyguluyor. Yani bu ad tamamen istemci tarafı bir sözleşme.
 * Ama Python istemcisi `doc.get("content", type=Text)` diyor; bir harf bile
 * farklı olursa iki doküman asla birleşmez — üstelik ikisi de gayet sağlıklı
 * görünür. (SPEC_FRONT §3.6)
 */
export const ROOT_NAME = 'content'

/** Presence rengi — y-codemirror.next uzak imleçleri bu alandan çiziyor. */
export type UserColor = {
  /** İmleç çizgisinin rengi */
  color: string
  /** Seçim vurgusunun rengi (aynı renk, düşük alfa) */
  colorLight: string
}

/**
 * Presence paleti.
 *
 * Renkler editorTheme.ts ve index.css'teki @theme token'larıyla aynı aileden
 * (Catppuccin Mocha), böylece uzak imleçler editörün içine yabancı düşmüyor.
 */
export const PRESENCE_PALETTE = [
  '#89b4fa', // mavi
  '#a6e3a1', // yeşil
  '#f9e2af', // sarı
  '#f38ba8', // kırmızı
  '#cba6f7', // mor
  '#fab387', // şeftali
  '#94e2d5', // turkuaz
  '#f5c2e7' // pembe
] as const

/**
 * Kullanıcı UUID'sinden DETERMİNİSTİK renk.
 *
 * Neden pencere başına sabit bir renk değil: renk bir kimlik işareti, herkesin
 * AYNI kişiyi AYNI renkte çizmesi gerekiyor. Ali'nin imleci Ayşe'nin ekranında
 * yeşil, Mehmet'in ekranında kırmızı görünürse renk hiçbir şey anlatmıyor.
 *
 * Girdi olarak `clientID` değil kullanıcı UUID'si kullanılıyor: clientID
 * Y.Doc'a özel, yeniden bağlanmada ve doküman değişiminde yenisi üretiliyor —
 * yani kişiyi değil bağlantıyı adlandırıyor. (SPEC_FRONT §6.2)
 *
 * Karma FNV-1a 32-bit: kısa, bağımlılıksız ve platformdan bağımsız aynı sonucu
 * veriyor (JS'te `>>> 0` ile işaretsiz tutmak şart, yoksa `%` negatif çıkar).
 */
export function renkUret(userId: string): UserColor {
  let karma = 0x811c9dc5
  for (let i = 0; i < userId.length; i++) {
    karma ^= userId.charCodeAt(i)
    karma = Math.imul(karma, 0x01000193) >>> 0
  }
  const color = PRESENCE_PALETTE[karma % PRESENCE_PALETTE.length]
  // '33' = %20 alfa. y-codemirror.next seçim vurgusunu bu alandan okuyor ve
  // yoksa kendisi de tam olarak color + '33' üretiyor.
  return { color, colorLight: `${color}33` }
}

/** İmleç etiketinin yazı rengi için iki uç — ikisi de @theme token'larından. */
export const METIN_KOYU = '#181825' // surface-sunken
export const METIN_AYDINLIK = '#cdd6f4' // ink

/** WCAG bağıl parlaklık (sRGB → doğrusal → ağırlıklı toplam). */
function parlaklik(hex: string): number {
  const kanal = (i: number): number => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * kanal(1) + 0.7152 * kanal(3) + 0.0722 * kanal(5)
}

/** WCAG kontrast oranı; 1 (aynı renk) ile 21 (siyah/beyaz) arasında. */
export function kontrastOrani(a: string, b: string): number {
  const [x, y] = [parlaklik(a), parlaklik(b)]
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05)
}

/**
 * Verilen ZEMİN üzerinde okunabilen yazı rengi.
 *
 * y-codemirror.next imleç etiketinin yazı rengini kendi baseTheme'inde `white`
 * olarak SABİTLİYOR, zemini ise imlecin satır içi `background-color`'ından
 * miras alıyor. Paletimiz baştan sona açık pastel olduğu için sonuç açık
 * zeminde beyaz yazı — yani okunmuyor.
 *
 * Eşiği gözle seçmek yerine iki uç adayın kontrast oranını ÖLÇÜP daha iyisini
 * veriyoruz: koyu zeminde açık yazı, açık zeminde koyu yazı. Palet değişirse
 * karar kendiliğinden değişiyor, kimsenin bir tabloyu elle güncellemesi
 * gerekmiyor.
 */
export function kontrastMetin(zemin: string): string {
  return kontrastOrani(zemin, METIN_KOYU) >= kontrastOrani(zemin, METIN_AYDINLIK)
    ? METIN_KOYU
    : METIN_AYDINLIK
}

// LOCAL_DOCUMENT_ID / LOCAL_DOCUMENT_TITLE adım 3'te kaldırıldı: dokümanlar
// artık sunucudaki listeden seçiliyor ve kimlik gerçek bir UUID.

/**
 * Doküman soketinin adresi. Token QUERY STRING'de, çünkü tarayıcı WebSocket
 * API'siyle özel başlık gönderilemiyor (SPEC_FRONT §3.3).
 *
 * Dönen URL'yi ASLA loglamayın.
 *
 * `base` bir PARAMETRE, modül sabiti değil. Burada bir API_BASE/WS_BASE ikilisi
 * vardı ve adresin üç yerde birden (burası, main/api.ts, index.html'in CSP'si)
 * elle tutarlı tutulması gerekiyordu; EDITOR_BASE_URL yalnızca REST'i taşıdığı
 * için ikisi sessizce ayrışabiliyordu. Adresin tek kaynağı artık
 * main/config.ts, buraya `server:get` ile geliyor. Bir sabit geri KOYMAYIN.
 *
 * http→ws çevirisi de bilerek içeride: tek tüketici bu fonksiyon, modül
 * kapsamında durursa ikinci bir gerçek kaynağı yeniden doğar. (https→wss aynı
 * `replace`'ten kendiliğinden çıkıyor, ayrı bir dal gerekmiyor.)
 */
export function belgeSoketUrl(base: string, documentId: string, token: string): URL {
  const url = new URL(`${base.replace(/^http/, 'ws')}/ws/documents/${documentId}`)
  url.searchParams.set('token', token)
  return url
}
