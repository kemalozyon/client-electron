import { app, shell, BrowserWindow, screen } from 'electron'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'
import { EDITOR_YENILE } from '../shared/channels'
import { ipcKur } from './ipc'

/**
 * TEK pencere (SPEC_FRONT §4.4).
 *
 * Eski hâlde iki BrowserWindow vardı ve kimliklerini ?pane=write / ?pane=watch
 * ile taşıyorlardı; ikincisi de 1000 ms geciktiriliyordu. İkisi de gitti:
 *
 *   - ?pane= : artık pencere kimliği diye bir şey yok. Hangi dokümanı
 *     açtığımız sunucudaki listeden seçiliyor (SPEC_FRONT §7.2).
 *   - gecikme: o yarış koşulu pycrdt-websocket'e aitti. Yeni backend kendi oda
 *     yöneticisini bir asyncio.Lock altında create-or-get ile işletiyor,
 *     eşzamanlı bağlanmak sorunsuz (SPEC_FRONT §2.4). Geri koymayın.
 *
 * Yan yana manuel test için uygulamayı İKİ KEZ başlatın (iki ayrı süreç);
 * tek süreçte iki pencereye dönmeyin — SPEC_FRONT §9 bunu varsayıyor.
 */
const VARSAYILAN_GENISLIK = 1200
const VARSAYILAN_YUKSEKLIK = 800

function createWindow(): BrowserWindow {
  // Ekrana sığdır: küçük ekranlarda çalışma alanını taşmasın.
  const { workArea } = screen.getPrimaryDisplay()
  const width = Math.min(VARSAYILAN_GENISLIK, workArea.width)
  const height = Math.min(VARSAYILAN_YUKSEKLIK, workArea.height)

  const window = new BrowserWindow({
    x: workArea.x + Math.floor((workArea.width - width) / 2),
    y: workArea.y + Math.floor((workArea.height - height) / 2),
    width,
    height,
    show: false,
    autoHideMenuBar: true,
    title: 'Collab IDE',
    backgroundColor: '#1e1e2e',
    ...(process.platform === 'linux' ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      // Electron'un güvenli varsayılanları yeterli: renderer'ın Node'a hiç
      // ihtiyacı yok. WebSocket zaten bir Chromium API'si, ayrıcalıklı olan
      // her şey de IPC köprüsünün arkasında duracak. (SPEC_FRONT §4.4)
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  })

  window.on('ready-to-show', () => {
    window.show()
  })

  /**
   * Cmd/Ctrl+R'yi ELE GEÇİR.
   *
   * Bu tuş şu an iki farklı şekilde yanlış davranıyor:
   *   - üretimde @electron-toolkit/utils'in watchWindowShortcuts'u onu tamamen
   *     yutuyor (`if (!is.dev)` dalı), yani hiçbir yenileme yolu yok;
   *   - geliştirmede yutmuyor, dolayısıyla Electron'un menüsündeki
   *     View→Reload çalışıyor ve BÜTÜN renderer'ı yeniden yüklüyor. Bu Y.Doc'u
   *     yok eder ve soketin henüz itemediği her şey gider. Yani kullanıcının
   *     hazır refleksi tam da yıkıcı olan.
   *
   * Kesme işi main'de olmak zorunda: macOS'ta menü hızlandırıcısı sayfadaki
   * preventDefault'a bakmıyor. before-input-event'te preventDefault ise hem
   * menüyü hem sayfa olayını kesiyor — toolkit'in üretimde reload'ı bloke
   * etmek için kullandığı mekanizmanın aynısı, biz dev'de de uyguluyoruz.
   *
   * Ne yapılacağına renderer karar veriyor: main hangi ekranda olduğumuzu
   * bilmiyor. Editör açıksa dokümanı yeniden bağlıyor, değilse (yalnızca
   * dev'de) sayfayı gerçekten yeniliyor.
   */
  window.webContents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown') return
    if (input.code !== 'KeyR' || !(input.control || input.meta)) return
    event.preventDefault()
    window.webContents.send(EDITOR_YENILE)
  })

  window.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    window.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    window.loadFile(join(__dirname, '../renderer/index.html'))
  }

  return window
}

app.whenReady().then(() => {
  // electron-builder.yml'deki appId ile AYNI olmak zorunda: Windows görev
  // çubuğuna sabitleme ve bildirim kimliği bu ikisinin eşleşmesine bakıyor.
  // (Şablondan 'com.electron' olarak geliyordu, appId ise com.electron.app'ti —
  // ikisi de placeholder'dı ve birbirinden de farklıydı.)
  electronApp.setAppUserModelId('com.eczanerapor.collabide')

  // Geliştirmede F12 ile DevTools, üretimde Ctrl+R'yi yoksay.
  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  // REST ve oturum main process'te yaşıyor; pencere açılmadan önce kurulsun
  // ki renderer ilk render'da window.api'yi hazır bulsun. (SPEC_FRONT §4.1)
  ipcKur()

  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

// Şablondan sapma: 'process.platform !== darwin' koruması bilerek yok.
// Bu bir doküman uygulaması değil; penceresiz kalan süreç yalnızca ortalıkta
// öksüz dolaşır. macOS dahil her yerde çık. (SPEC_FRONT §4.4)
app.on('window-all-closed', () => {
  app.quit()
})
