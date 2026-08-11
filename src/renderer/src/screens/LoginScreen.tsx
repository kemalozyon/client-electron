import { useEffect, useState } from 'react'
import type { User } from '@shared/types'
import { api } from '../api'
import { ErrorNote, InfoNote } from '../components/ErrorNote'
import { ServerAddressField } from '../components/ServerAddressField'

type Mod = 'login' | 'register'

type Props = {
  onSignedIn: (user: User) => void
  /** Oturum ortasında token ölünce gösteriliyor (SPEC_FRONT §7.5). */
  reason?: string
  /** Sunucu ayarına eklenecek ekrana özel uyarı — App bindirme katmanında veriyor. */
  serverNote?: React.ReactNode
}

/**
 * Tek ekran, iki mod.
 *
 * Register TOKEN DÖNDÜRMÜYOR (201 + User), bu yüzden kayıt → giriş zincirini
 * burada kuruyoruz. Ama zinciri SESSİZCE kurmuyoruz: önce kaydın oluştuğunu
 * duyuruyoruz, sonra giriyoruz. Sessiz devam, kullanıcıyı hesabın gerçekten
 * açılıp açılmadığından emin edemiyordu. (SPEC_FRONT §7.1)
 */
export function LoginScreen({ onSignedIn, reason, serverNote }: Props): React.JSX.Element {
  const [mod, setMod] = useState<Mod>('login')
  const [email, setEmail] = useState('')
  const [parola, setParola] = useState('')
  const [calisiyor, setCalisiyor] = useState(false)
  const [hata, setHata] = useState<string | null>(null)
  const [duyuru, setDuyuru] = useState<string | null>(null)
  /** Kayıt duyurusu EKRANA ÇİZİLDİKTEN sonra girişi tetikleyen bayrak. */
  const [otomatikGiris, setOtomatikGiris] = useState<{ email: string; parola: string } | null>(null)

  async function girisYap(e: string, p: string): Promise<void> {
    try {
      onSignedIn(await api.auth.login(e, p))
    } catch (err) {
      // Sunucunun metnini olduğu gibi göster: "E-posta veya parola hatalı."
      // Bilinmeyen e-posta ile yanlış parola aynı cevabı veriyor; bu bilinçli
      // bir sayım-önleme tedbiri, düzeltilecek bir şey değil. (SPEC_FRONT §3.2)
      setHata(err instanceof Error ? err.message : String(err))
      setCalisiyor(false)
    }
  }

  // Duyuru bir render boyunca görünsün diye giriş EFEKTTE yapılıyor: aynı
  // fonksiyon içinde setDuyuru + await, duyurunun hiç boyanmamasına yol
  // açabilirdi. Efektin gövdesinde senkron setState yok; her şey await'ten
  // sonra oluyor.
  useEffect(() => {
    if (!otomatikGiris) return
    let iptal = false
    const { email: e, parola: p } = otomatikGiris
    void (async () => {
      try {
        const kullanici = await api.auth.login(e, p)
        if (!iptal) onSignedIn(kullanici)
      } catch (err) {
        if (iptal) return
        setHata(err instanceof Error ? err.message : String(err))
        setCalisiyor(false)
        setOtomatikGiris(null)
      }
    })()
    return () => {
      iptal = true
    }
  }, [otomatikGiris, onSignedIn])

  async function gonder(event: React.FormEvent): Promise<void> {
    event.preventDefault()
    setHata(null)
    setCalisiyor(true)
    if (mod === 'login') {
      setDuyuru(null)
      await girisYap(email, parola)
      return
    }

    try {
      const kullanici = await api.auth.register(email, parola)
      // Önce DUYUR — sonra gir. Duyuru giriş boyunca ve giriş başarısız olursa
      // sonrasında da ekranda kalıyor; kullanıcı hesabın açıldığını her hâlde
      // öğrensin.
      setDuyuru(`Hesap oluşturuldu: ${kullanici.email}. Şimdi giriş yapılıyor…`)
      setOtomatikGiris({ email, parola })
    } catch (err) {
      // 409 "Bu e-posta adresi zaten kayıtlı." aynen görünsün.
      setHata(err instanceof Error ? err.message : String(err))
      setCalisiyor(false)
    }
  }

  return (
    <div className="flex h-full items-center justify-center bg-surface p-6">
      {/*
        Sunucu ayarı formun KARDEŞİ, içinde değil.
        Formun içine koymak iki tehlike getiriyordu: kaza ile bir submit, ve
        Enter'ın anlamının odağa göre değişmesi (giriş mi, kaydet mi). Kardeşlik
        ikisini de tek bir sarmalayıcı div bedeliyle ortadan kaldırıyor.
      */}
      <div className="flex w-full max-w-sm flex-col gap-3">
        <form
          onSubmit={gonder}
          className="flex w-full flex-col gap-4 rounded-2xl border border-border-subtle bg-surface-raised p-7 shadow-2xl"
        >
          <div>
            <h1 className="text-lg font-semibold text-ink">Collab IDE</h1>
            <p className="mt-1 text-sm text-ink-muted">
              {mod === 'login' ? 'Hesabınıza giriş yapın.' : 'Yeni bir hesap oluşturun.'}
            </p>
          </div>

          {reason && <ErrorNote>{reason}</ErrorNote>}
          {duyuru && <InfoNote>{duyuru}</InfoNote>}
          {hata && <ErrorNote>{hata}</ErrorNote>}

          <label className="flex flex-col gap-1.5 text-xs text-ink-muted">
            E-posta
            <input
              type="email"
              required
              autoFocus
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="rounded-lg border border-border-subtle bg-surface-sunken px-2.5 py-1.5 text-sm text-ink outline-none transition-colors focus:border-accent focus:ring-2 focus:ring-accent/30"
            />
          </label>

          <label className="flex flex-col gap-1.5 text-xs text-ink-muted">
            Parola{' '}
            {mod === 'register' && <span className="text-ink-faint">(en az 8 karakter)</span>}
            <input
              type="password"
              required
              minLength={mod === 'register' ? 8 : undefined}
              value={parola}
              onChange={(e) => setParola(e.target.value)}
              className="rounded-lg border border-border-subtle bg-surface-sunken px-2.5 py-1.5 text-sm text-ink outline-none transition-colors focus:border-accent focus:ring-2 focus:ring-accent/30"
            />
          </label>

          <button
            type="submit"
            disabled={calisiyor}
            className="rounded-lg bg-accent px-3 py-2 text-sm font-medium text-surface shadow-glow transition-all hover:shadow-glow-lg active:scale-[0.98] disabled:opacity-50 disabled:shadow-none"
          >
            {calisiyor ? 'çalışıyor…' : mod === 'login' ? 'Giriş yap' : 'Kayıt ol'}
          </button>

          <button
            type="button"
            onClick={() => {
              setMod(mod === 'login' ? 'register' : 'login')
              setHata(null)
              setDuyuru(null)
            }}
            className="text-xs text-ink-muted underline-offset-2 transition-colors hover:text-ink hover:underline"
          >
            {mod === 'login'
              ? 'Hesabınız yok mu? Kayıt olun.'
              : 'Zaten hesabınız var mı? Giriş yapın.'}
          </button>
        </form>

        {/*
          Günlük bir kontrol değil, bir kaçış kapağı: katlanmış başlıyor.
          Bu mount aynı zamanda App'in editör üstündeki login KATMANINI da
          kapsıyor — tünel adresi oturum ortasında dönerse tek çıkış yolu orası.
        */}
        <ServerAddressField note={serverNote} />
      </div>
    </div>
  )
}
