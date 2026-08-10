import { app, shell, BrowserWindow, screen } from 'electron'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'

/** İki pencerenin kimliği. Renderer bunu ?pane= query parametresinden okur. */
type PaneName = 'write' | 'watch'

const PANES: PaneName[] = ['write', 'watch']

/**
 * İkinci pencerenin gecikmesi (ms).
 *
 * SİLMEYİN — bu bir batıl inanç değil, gerçek bir yarış koşulunun geçici
 * çözümü. Henüz var olmayan bir odaya aynı anda bağlanan iki istemci,
 * pycrdt-websocket'te oda oluşturma yarışını tetikliyor ve biri sessizce
 * senkronize olmadan kalıyor: iki ayrı doküman, ikisi de sapasağlam görünür,
 * hiç birleşmezler. İki BrowserWindow'u aynı tick'te açmak bunu neredeyse her
 * seferinde tetikliyor. Oda bir kez oluştuktan sonra eşzamanlı bağlanmak
 * sorunsuz. (SPEC §6.4)
 */
const IKINCI_PENCERE_GECIKMESI = 1000

function createWindow(pane: PaneName): BrowserWindow {
  // Pencereleri yan yana koy: her biri çalışma alanının yarısı kadar.
  const { workArea } = screen.getPrimaryDisplay()
  const width = Math.floor(workArea.width / 2)
  const height = workArea.height
  const x = workArea.x + (pane === 'write' ? 0 : width)

  const window = new BrowserWindow({
    x,
    y: workArea.y,
    width,
    height,
    show: false,
    autoHideMenuBar: true,
    title: `Collab IDE — ${pane}`,
    backgroundColor: '#1e1e2e',
    ...(process.platform === 'linux' ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      // Electron'un güvenli varsayılanları yeterli: renderer'ın Node'a hiç
      // ihtiyacı yok. WebSocket zaten bir Chromium API'si. (SPEC §5.1)
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  })

  window.on('ready-to-show', () => {
    window.show()
  })

  window.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  // Pencere kimliğini query parametresi olarak taşıyoruz; App.tsx bunu
  // location.search'ten okuyup hangi pane olduğunu öğreniyor.
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    window.loadURL(`${process.env['ELECTRON_RENDERER_URL']}?pane=${pane}`)
  } else {
    window.loadFile(join(__dirname, '../renderer/index.html'), { query: { pane } })
  }

  return window
}

/** İki pane'i sırayla açar — aradaki gecikme yukarıdaki yarış koşulu için. */
function createBothPanes(): void {
  createWindow(PANES[0])
  setTimeout(() => createWindow(PANES[1]), IKINCI_PENCERE_GECIKMESI)
}

app.whenReady().then(() => {
  electronApp.setAppUserModelId('com.electron')

  // Geliştirmede F12 ile DevTools, üretimde Ctrl+R'yi yoksay.
  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  createBothPanes()

  // Şablondan sapma: varsayılan handler ?pane= parametresi olmayan TEK bir
  // pencere açıyordu — kimliksiz üçüncü bir pane. Bunun yerine ikisini de,
  // yine kademeli olarak yeniden açıyoruz.
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createBothPanes()
  })
})

// Şablondan sapma: 'process.platform !== darwin' koruması kaldırıldı.
// Bu bir doküman uygulaması değil, iki pencerelik bir demo; penceresiz kalan
// süreç yalnızca ortalıkta öksüz dolaşır. macOS dahil her yerde çık. (SPEC §5.1)
app.on('window-all-closed', () => {
  app.quit()
})
