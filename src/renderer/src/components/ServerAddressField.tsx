import { useEffect, useState } from 'react'
import type { ServerConfig, ServerProbe, ServerSetResult } from '@shared/types'
import { api } from '../api'
import { ErrorNote, InfoNote } from './ErrorNote'

type Props = {
  /** Adres GERÇEKTEN değiştiyse (changed === true) çağrılır. */
  onChanged?: (url: string) => void
  /** Açılışta genişletilmiş mi? Login'de false, açılış hata panelinde true. */
  defaultOpen?: boolean
  /** Ekrana özel ek uyarı — ör. editör açıkken. */
  note?: React.ReactNode
}

const GIRDI =
  'rounded-lg border border-border-subtle bg-surface-sunken px-2.5 py-1.5 text-sm text-ink outline-none transition-colors focus:border-accent focus:ring-2 focus:ring-accent/30'

/** Kaynağı kullanıcının diliyle söylüyoruz; 'stored' ekranda bir şey anlatmıyor. */
const KAYNAK_ETIKETI: Record<ServerConfig['source'], string> = {
  stored: 'kayıtlı',
  env: 'EDITOR_BASE_URL',
  default: 'varsayılan'
}

/** Katlanmış hâlde tam URL değil sunucu adı gösteriyoruz; ayırt eden kısım o. */
function sunucuAdi(url: string): string {
  try {
    return new URL(url).host
  } catch {
    return url
  }
}

/**
 * Yoklama sonucu — TAVSİYE, kaydın kendisi her hâlükârda yapıldı.
 *
 * 'current' dışındaki her şeyi kırmızı gösteriyoruz ama metni SUNUCUNUN kendi
 * teşhisinden alıyoruz (bayat sunucu dalı curl tarifini bile veriyor); kendi
 * kopyamızı uydurmak ErrorNote'un kuralına aykırı olurdu.
 */
function SondaNotu({ probe }: { probe: ServerProbe }): React.JSX.Element {
  if (probe.state === 'current') {
    return <InfoNote>Adres kaydedildi. Sunucu yanıt verdi (401) — sürüm güncel.</InfoNote>
  }
  if (probe.state === 'stale') {
    return <ErrorNote>Adres kaydedildi, ama: {probe.message}</ErrorNote>
  }
  if (probe.state === 'unexpected') {
    return (
      <ErrorNote>
        Adres kaydedildi, ama sunucu beklenmedik bir cevap verdi ({probe.status}): {probe.message}
      </ErrorNote>
    )
  }
  return <ErrorNote>Adres kaydedildi, ama şu an ulaşılamıyor: {probe.message}</ErrorNote>
}

/**
 * Sunucu adresi ayarı.
 *
 * Neden var: trycloudflare tüneli her yeniden başladığında YENİ bir alan adı
 * veriyor. Adres eskiden üç yerde sabitti (main/api.ts, collab/constants.ts,
 * index.html'in CSP'si) ve üçünü elle güncellemek gerekiyordu — dahası üçü
 * sessizce ayrışabiliyordu. Artık tek kaynağı main/config.ts ve girişi burası.
 *
 * BU BİLEŞEN <form> ÇİZMEZ ve içindeki her düğme type="button". Login ekranının
 * formunun içine girerse Enter'a basmak ya girişi ya kaydı tetikler — hangisi
 * olduğu da odağa bakar. Bu yüzden LoginScreen'de formun KARDEŞİ olarak duruyor
 * ve Enter'ı kendisi ele alıyor.
 */
export function ServerAddressField({ onChanged, defaultOpen, note }: Props): React.JSX.Element {
  const [yapilandirma, setYapilandirma] = useState<ServerConfig | null>(null)
  const [adres, setAdres] = useState('')
  const [acik, setAcik] = useState(defaultOpen ?? false)
  const [calisiyor, setCalisiyor] = useState(false)
  const [hata, setHata] = useState<string | null>(null)
  const [sonuc, setSonuc] = useState<ServerProbe | null>(null)

  // Buradaki okuma yalnızca GÖSTERİM. Soket tarafı adresi kendi bağlanma
  // yolunda ayrıca okuyor (useCollab); orada bayat bir kopya yanlış sunucuya
  // bağlanmak demek olurdu, burada sadece eski bir etiket.
  useEffect(() => {
    let iptal = false
    void (async () => {
      try {
        const c = await api.server.get()
        if (iptal) return
        setYapilandirma(c)
        setAdres(c.url)
      } catch (err) {
        if (!iptal) setHata(err instanceof Error ? err.message : String(err))
      }
    })()
    return () => {
      iptal = true
    }
  }, [])

  async function uygula(is: () => Promise<ServerSetResult>): Promise<void> {
    setCalisiyor(true)
    setHata(null)
    setSonuc(null)
    try {
      const r = await is()
      setYapilandirma(r)
      // Normalize edilmiş hâli geri yazıyoruz: "ne kaydedildi" sorusunun cevabı
      // ekranda dursun (şema eklendi mi, sondaki çizgi atıldı mı).
      setAdres(r.url)
      setSonuc(r.probe)
      if (r.changed) onChanged?.(r.url)
    } catch (err) {
      // Normalize edilemeyen adres burada: HİÇBİR ŞEY kaydedilmedi.
      setHata(err instanceof Error ? err.message : String(err))
    } finally {
      setCalisiyor(false)
    }
  }

  if (!acik) {
    return (
      <button
        type="button"
        onClick={() => setAcik(true)}
        className="self-center text-xs text-ink-faint underline-offset-2 transition-colors hover:text-ink-muted hover:underline"
      >
        Sunucu: {yapilandirma ? sunucuAdi(yapilandirma.url) : '…'} · değiştir
      </button>
    )
  }

  const kaynak = yapilandirma?.source
  // Kayıtlı değer env'i EZİYOR (config.ts). Ayrıştıklarında bunu SÖYLÜYORUZ:
  // gizlemek, ekranda bir adres görünüp isteklerin başkasına gitmesi demek.
  const celiski =
    kaynak === 'stored' && yapilandirma?.env && yapilandirma.env !== yapilandirma.url
      ? yapilandirma.env
      : null

  return (
    <div className="flex flex-col gap-2 rounded-xl border border-border-subtle bg-surface-raised p-3 shadow-sm">
      <div className="flex items-center gap-2">
        <span className="text-xs font-medium text-ink">Sunucu adresi</span>
        {kaynak && (
          <span className="rounded-md border border-border-subtle px-1.5 py-0.5 font-mono text-[10px] text-ink-faint">
            {KAYNAK_ETIKETI[kaynak]}
          </span>
        )}
        <button
          type="button"
          onClick={() => setAcik(false)}
          className="ml-auto text-xs text-ink-faint transition-colors hover:text-ink-muted"
        >
          kapat
        </button>
      </div>

      <input
        value={adres}
        onChange={(e) => setAdres(e.target.value)}
        onKeyDown={(e) => {
          if (e.key !== 'Enter') return
          // Bir formun içinde olmasak da: Enter'ın burada tek anlamı kaydetmek.
          e.preventDefault()
          void uygula(() => api.server.set(adres))
        }}
        placeholder="https://ornek.trycloudflare.com"
        spellCheck={false}
        autoComplete="off"
        className={`font-mono ${GIRDI}`}
      />

      <p className="text-[11px] text-ink-faint">
        Şema yazılmazsa <span className="font-mono">https://</span> varsayılır; sondaki eğik çizgi
        atılır. <span className="font-mono">ws://</span> yapıştırırsanız çevrilir.
      </p>

      {note}

      <p className="text-[11px] text-ink-muted">
        Adresi değiştirmek oturumu kapatır — başka bir sunucunun token&apos;ı burada geçersiz.
      </p>

      {celiski && (
        <p className="text-[11px] text-ink-muted">
          <span className="font-mono">EDITOR_BASE_URL</span> başka bir adres söylüyor (
          <span className="font-mono">{celiski}</span>); kayıtlı adres önceliklidir.
        </p>
      )}

      {hata && <ErrorNote>{hata}</ErrorNote>}
      {sonuc && <SondaNotu probe={sonuc} />}

      <div className="flex items-center gap-2">
        <button
          type="button"
          disabled={calisiyor || adres.trim().length === 0}
          onClick={() => void uygula(() => api.server.set(adres))}
          className="rounded-lg bg-accent px-3 py-1.5 text-xs font-medium text-surface shadow-glow transition-all hover:shadow-glow-lg active:scale-[0.98] disabled:opacity-50 disabled:shadow-none"
        >
          {calisiyor ? 'deneniyor…' : 'Kaydet'}
        </button>
        {/*
          Yalnızca kayıt VARSA anlamlı. Ve api.server.set(fallback) DEĞİL:
          o, bugünün varsayılanına eşit bir kayıt bırakırdı (bkz. config.ts).
        */}
        {kaynak === 'stored' && (
          <button
            type="button"
            disabled={calisiyor}
            onClick={() => void uygula(() => api.server.reset())}
            className="rounded-lg border border-border-subtle px-2.5 py-1.5 text-xs text-ink-muted transition-colors hover:border-ink-faint hover:text-ink disabled:opacity-50"
          >
            Varsayılana dön
          </button>
        )}
      </div>
    </div>
  )
}
