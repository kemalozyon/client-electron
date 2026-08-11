import { useEffect, useState } from 'react'
import type { DocumentListItem, User } from '@shared/types'
import { api } from '../api'
import { useCollab } from '../collab/useCollab'
import { PaneHeader } from './PaneHeader'
import { StatusBar } from './StatusBar'
import { CodeMirrorSurface, type CursorPosition } from './CodeMirrorSurface'
import { toLanguageId, type LanguageId } from './languages'

type Props = {
  doc: DocumentListItem
  /**
   * Presence'ta yayınlanacak kimlik. App bunu EDİTÖR EKRANININ durumunda
   * taşıyor, kendi `user` state'inde değil: oturum ölünce o null'a düşüyor ama
   * editör mount kalıyor (App'teki bindirme katmanı) ve o anda da imleç
   * etiketimizin bir adı olması gerekiyor.
   */
  user: User
  onBack: () => void
}

export function EditorPane({ doc, user, onBack }: Props): React.JSX.Element {
  // Dil PENCEREYE ÖZEL: bilerek Y.Doc'ta değil. Kaydırma konumu gibi bir
  // görünüm durumu, üstelik paylaşılan kök yalnızca metin. (SPEC_FRONT §2.1)
  //
  // Başlangıç değeri sunucudaki metadata'dan geliyor; oradaki `language`
  // serbest bir metin olduğu için tanımadığımız değerler düz metne düşüyor.
  // useState'in başlangıcı ilk render'da sabitlenir, yani doküman değişince
  // yeniden okunması gerekir — bu bileşen doküman başına yeniden monte
  // edildiği için (App'teki switch) sorun olmuyor.
  const [language, setLanguage] = useState<LanguageId>(() => toLanguageId(doc.language))
  const [cursor, setCursor] = useState<CursorPosition>({ line: 1, column: 1 })

  const { session, status, synced, peers, terminal, error, yenile, reloadEdilebilir } = useCollab(
    doc.id,
    doc.role,
    user
  )

  /**
   * Cmd/Ctrl+R — main kesip buraya yolluyor.
   *
   * Abone olan yer BURASI, App değil: bu bileşen tam olarak bir doküman açıkken
   * mount durumda. Yeniden giriş bindirmesinin ALTINDA da mount kalıyor ve
   * orada da doğru davranış bu — bağlantının en çok istendiği an o.
   * App yalnızca editör açık DEĞİLKEN devreye giriyor, yani ikisi asla aynı
   * anda iş yapmıyor.
   */
  useEffect(() => api.onEditorReload(yenile), [yenile])

  /**
   * Nihai kapanış ve error çerçeveleri şimdilik YALNIZCA bir şerit.
   *
   * Adım 5 bunu gerçek yola bağlayacak: 4410 için sebebi söyleyen bir modal +
   * listeye dönüş, 4404 için listeye dönüp yenileme, 4401 için login. Ama
   * görünmez bırakmıyoruz — §5.5'in uyardığı arıza tam olarak bu: sunucu
   * bağlantıyı kestikten sonra hâlâ canlı ve yazılabilir görünen bir editör.
   */
  const nihaiMesaj =
    terminal?.kind === 'revoked'
      ? 'Bu dokümana erişiminiz kaldırıldı. Bağlantı kapatıldı.'
      : terminal?.kind === 'notFound'
        ? 'Doküman bulunamadı ya da erişiminiz yok.'
        : terminal?.kind === 'unauthorized'
          ? 'Oturumunuzun süresi doldu.'
          : null

  return (
    <div className="flex h-full flex-col bg-surface">
      <PaneHeader
        title={doc.title}
        role={doc.role}
        status={status}
        language={language}
        onLanguageChange={setLanguage}
        onBack={onBack}
        onReload={yenile}
        reloadEnabled={reloadEdilebilir}
      />

      {(nihaiMesaj || error) && (
        <div className="shrink-0 border-b border-state-down/40 bg-state-down/10 px-3 py-1.5 text-xs text-state-down">
          {nihaiMesaj ?? `${error?.code}: ${error?.message}`}
        </div>
      )}

      <main className="min-h-0 flex-1">
        {session ? (
          // key: doküman değişince CodeMirror da komple yeniden kurulmalı.
          <CodeMirrorSurface
            key={doc.id}
            session={session}
            language={language}
            onCursorChange={setCursor}
          />
        ) : (
          <div className="flex h-full items-center justify-center text-sm text-ink-faint">
            editör hazırlanıyor…
          </div>
        )}
      </main>

      <StatusBar peers={peers} synced={synced} cursor={cursor} />
    </div>
  )
}
