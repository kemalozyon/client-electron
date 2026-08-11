# Collab IDE

Gerçek zamanlı ortak düzenleme yapılan bir masaüstü editörü. Electron + React 19 +
CodeMirror 6, metni [Yjs](https://github.com/yjs/yjs) CRDT'siyle paylaşıyor ve bir FastAPI
sunucusuna kendi ikili çerçeve protokolüyle bağlanıyor: JWT ile kimlik, doküman başına rol
(sahip / editör / izleyici), imleç ve seçim paylaşımı.

**Bu istemci tek başına çalışmaz** — bir sunucuya ihtiyacı var (ayrı bir depo). İlk açılışta
sunucunun adresini girmeniz gerekiyor; aşağıya bakın.

## Kurulum

Sürüm sayfasından işletim sisteminize uygun dosyayı indirin:
[Releases](https://github.com/kemalozyon/client-electron/releases)

| Platform              | Dosya                                                   |
| --------------------- | ------------------------------------------------------- |
| macOS (Apple Silicon) | `collab-ide-client-<sürüm>-arm64.dmg`                   |
| macOS (Intel)         | `collab-ide-client-<sürüm>-x64.dmg`                     |
| Windows               | `collab-ide-client-<sürüm>-setup.exe`                   |
| Linux                 | `collab-ide-client-<sürüm>-x86_64.AppImage` veya `.deb` |

Uygulama **imzalı değil** (Apple Developer ID ve Windows kod imzalama sertifikası yok), o
yüzden ilk açılışta işletim sistemi araya giriyor:

**macOS** — "bozuk olduğu için açılamıyor" ya da "geliştirici doğrulanamıyor" diyorsa,
uygulamayı `/Applications` içine attıktan sonra karantina işaretini silin:

```bash
xattr -cr "/Applications/Collab IDE.app"
```

**Windows** — SmartScreen uyarısında **More info → Run anyway**.

**Linux** — AppImage'a çalıştırma izni verin: `chmod +x collab-ide-client-*.AppImage`

## İlk açılış: sunucu adresi

Uygulama, geliştirme sırasında kullanılan geçici bir tünel adresiyle geliyor ve o adres
kalıcı değil — yani ilk açılışta büyük olasılıkla **"Sunucuya ulaşılamadı"** ekranını
göreceksiniz. Bu bir arıza değil, eksik yapılandırma:

1. O ekrandaki **Sunucu adresi** alanına kendi sunucunuzun adresini yazın
   (`https://…`; şema yazmazsanız `https://` varsayılır).
2. **Kaydet**. Adres denenip kaydediliyor ve ekran kendini yeniden deniyor.
3. Giriş ekranı gelince kayıt olun ya da giriş yapın.

Adres daha sonra giriş ekranındaki **Sunucu: … · değiştir** bağlantısından değiştirilebilir.
Adresi değiştirmek oturumu kapatır: başka bir sunucunun ürettiği token burada geçersiz.

> `EDITOR_BASE_URL` ortam değişkeni yalnızca uygulamayı terminalden başlatırken işe yarıyor.
> Finder ya da Başlat menüsünden açılan bir uygulama kabuk ortamını devralmadığı için,
> paketlenmiş sürümde adresi ayarlamanın tek yolu arayüzdeki alan.

## Bilinen sınırlar

- **Otomatik güncelleme yok.** Yeni sürümü elle indirip kurun.
- Sürüm imzasız olduğu için, güncellemeden sonra tekrar giriş yapmanız gerekebilir: oturum
  şifrelemesi (`safeStorage`) macOS'ta uygulamanın imzasına bağlı bir anahtar kullanıyor ve
  imzasız her derleme farklı bir uygulama gibi görünüyor. Yazdığınız hiçbir şey kaybolmuyor.
- Paketlenmiş uygulamada geliştirici araçları kapalı.
- macOS'ta ikinci bir pencere açmak için Finder yetmiyor (LaunchServices var olanı öne
  alıyor); yan yana iki istemciyle denemek için `open -n "/Applications/Collab IDE.app"`.

## Geliştirme

```bash
npm install
npm run dev          # electron-vite dev — hedeflenen deneyim bu
npm run typecheck    # node + web, ikisi de geçmeli
npm run lint
npm run start        # üretim paketini electron-vite preview ile çalıştır
```

Sunucuyu ayağa kaldırma, doğrulama ölçütleri ve mimarinin gerekçeleri için `SPEC_FRONT.md`
ve `CLAUDE.md`'ye bakın.

### Paketleme

```bash
npm run build:unpack  # dist/mac-arm64/Collab IDE.app — hızlı duman testi, DMG üretmez
npm run build:mac     # arm64 + x64 DMG
npm run build:win     # NSIS kurucu
npm run build:linux   # AppImage + deb
```

Windows ve Linux hedefleri macOS'ta üretilemiyor. Sürüm derlemeleri
`.github/workflows/release.yml` içinde, `v*` etiketi gönderildiğinde üç platformda birden
çalışıyor; çıktılar koşunun artifact'ları olarak iniyor ve sürüm sayfasına elle yükleniyor.
