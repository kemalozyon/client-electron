/**
 * IPC kanal adları — main ile preload'ın TEK ortak kaynağı.
 *
 * SPEC_FRONT §4.2 bu kanalları `ipc-channel` skill'iyle eklemeyi söylüyor
 * (handler + köprü + .d.ts + renderer sarmalayıcı birlikte dursun diye) ve o
 * skill ARTIK VAR. Ama yerleşimi bu projeye birebir uymuyor: skill
 * `src/shared/ipc.ts` + `src/main/ipc/<domain>.ts` ve istek/yanıt için
 * `ipcMain.handle` varsayıyor. Buradaki karşılıkları bu dosya ve tek bir
 * `src/main/ipc.ts`; aşağıdaki iki yayın kanalı ise istek/yanıt değil, tek
 * yönlü. Skill'in KURALLARI geçerli (kanal adı tek yerde, köprüde adlandırılmış
 * fonksiyon, asla ipcRenderer'ı ya da genel bir invoke geçişini açma), yerleşimi
 * değil.
 *
 * Kanal adı bir kez yazılıyor, iki uç da buradan okuyor. Elle yazılmış bir
 * string'in iki taraftan birinde yanlış olması sessiz bir "handler yok" hatası
 * demek.
 *
 * Yeni bir kanal eklerken DÖRT yeri birden güncelleyin:
 *   1. buradaki sabit
 *   2. src/main/ipc.ts       — ipcMain.handle
 *   3. src/preload/index.ts  — köprü fonksiyonu
 *   4. src/preload/index.d.ts + src/renderer/src/api.ts — tipler ve sarmalayıcı
 */
export const KANAL = {
  authRegister: 'auth:register',
  authLogin: 'auth:login',
  authMe: 'auth:me',
  authLogout: 'auth:logout',
  authWsToken: 'auth:wsToken',

  documentsList: 'documents:list',
  documentsCreate: 'documents:create',
  documentsUpdate: 'documents:update',
  documentsDelete: 'documents:delete',

  rolesList: 'roles:list',
  rolesGrantByEmail: 'roles:grantByEmail',
  rolesRevoke: 'roles:revoke',

  // Sunucu adresi main/config.ts'te yaşıyor; renderer hem soket adresini
  // (server:get) hem de ayar ekranını (server:set / server:reset) buradan
  // görüyor. Adres artık derleme zamanı sabiti DEĞİL.
  serverGet: 'server:get',
  serverSet: 'server:set',
  serverReset: 'server:reset'
} as const

/**
 * Main → renderer tek yönlü yayın. Main bir 401 gördüğü her yerde çıkıyor;
 * renderer bunu WS 4401 ile AYNI şekilde ele almalı (SPEC_FRONT §7.5).
 *
 * Tek argümanı var: SEBEP (`string | undefined`). Sunucu adresi değişince de
 * bu kanaldan çıkıyoruz ve orada "oturumunuzun süresi doldu" demek yalan
 * olurdu — metni yayınlayan taraf söylüyor, renderer uydurmuyor.
 */
export const OTURUM_GECERSIZ = 'session:invalidated'

/**
 * Main → renderer tek yönlü yayın. Cmd/Ctrl+R'ye basıldı.
 *
 * Tuşu main yakalamak ZORUNDA: macOS'ta menü hızlandırıcısı (View→Reload)
 * sayfadaki bir preventDefault'a bakmıyor. Main hem menüyü hem sayfa olayını
 * kesip niyeti buradan iletiyor; ne yapılacağına renderer karar veriyor —
 * editör açıksa dokümanı yeniden bağla, değilse (yalnızca dev'de) sayfayı
 * yenile.
 */
export const EDITOR_YENILE = 'editor:reload'
