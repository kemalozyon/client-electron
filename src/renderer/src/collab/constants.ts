/** Pencere kimlikleri — main process ?pane= ile bunlardan birini gönderir. */
export type PaneName = 'write' | 'watch'

/**
 * Websocket sunucusunun kök adresi.
 *
 * DİKKAT — sondaki eğik çizgi (SPEC §3.3 / §6.2):
 * y-websocket adresi `serverUrl + '/' + room` diye kuruyor. Sunucu tarafında
 * ise Starlette'in Mount'u scope["path"]'i yeniden yazmadığı için oda anahtarı
 * TAM YOL oluyor, yani "/ws/belge-1".
 *
 *   'ws://localhost:8000/ws'   + 'belge-1' -> /ws/belge-1   ✅
 *   'ws://localhost:8000/ws/'  + 'belge-1' -> /ws//belge-1  ❌ bambaşka bir oda
 *
 * Yanlış hâlde iki istemci de sorunsuz bağlanır ve birbirini asla görmez.
 */
export const SERVER_URL = 'ws://localhost:8000/ws'

/** Python istemcisiyle (editor.py) aynı oda. */
export const DEFAULT_ROOM = 'belge-1'

/**
 * Paylaşılan kökün adı. editor.py `doc.get("content", type=Text)` diyor;
 * bir harf bile farklı olursa iki doküman asla birleşmez — üstelik ikisi de
 * gayet sağlıklı görünür. (SPEC §3.4)
 */
export const ROOT_NAME = 'content'

/** Presence rengi — y-codemirror.next uzak imleçleri bu alandan çiziyor. */
export type PaneColor = {
  /** İmleç çizgisinin rengi */
  color: string
  /** Seçim vurgusunun rengi (aynı renk, düşük alfa) */
  colorLight: string
}

export const PANE_COLORS: Record<PaneName, PaneColor> = {
  write: { color: '#30bced', colorLight: '#30bced33' },
  watch: { color: '#f4a261', colorLight: '#f4a26133' }
}

/** Bilinmeyen bir ?pane= değeri gelirse buna düşüyoruz. */
export const DEFAULT_PANE: PaneName = 'write'

export function isPaneName(value: string | null): value is PaneName {
  return value === 'write' || value === 'watch'
}

/**
 * Oda adı doğrulaması (SPEC §7.4).
 *
 * .trim() kozmetik değil: 'belge-1 ' adresi ws://localhost:8000/ws/belge-1%20
 * yapar — 'belge-1'den sessizce farklı bir oda. Yukarıdaki eğik çizgi tuzağının
 * kılık değiştirmiş hâli, aynı sessizlikte patlar.
 */
export function normalizeRoom(raw: string): string | null {
  const room = raw.trim()
  if (room.length === 0) return null
  if (room.includes('/')) return null
  return room
}
