import { useEffect, useRef } from 'react'
import * as Y from 'yjs'
import { EditorView, basicSetup } from 'codemirror'
import { Compartment } from '@codemirror/state'
import { yCollab } from 'y-codemirror.next'
import type { CollabSession } from '../collab/useCollab'
import { languageExtension, type LanguageId } from './languages'
import { editorTheme } from './editorTheme'

/** Status bar'ın gösterdiği imleç konumu (1 tabanlı). */
export type CursorPosition = { line: number; column: number }

type Props = {
  session: CollabSession
  language: LanguageId
  onCursorChange: (position: CursorPosition) => void
}

export function CodeMirrorSurface({ session, language, onCursorChange }: Props): React.JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null)
  const viewRef = useRef<EditorView | null>(null)
  const languageCompartmentRef = useRef<Compartment | null>(null)

  // Callback'i ref'te tutuyoruz ki her render'da yeni bir fonksiyon gelmesi
  // aşağıdaki kurulum efektini yeniden tetiklemesin — editörü yeniden kurmak
  // pahalı ve yıkıcı.
  const onCursorChangeRef = useRef(onCursorChange)
  useEffect(() => {
    onCursorChangeRef.current = onCursorChange
  }, [onCursorChange])

  // Kurulum efekti: yalnızca doküman/oturum kimliği değişince çalışır.
  useEffect(() => {
    const container = containerRef.current
    if (!container) return undefined

    const { ytext, awareness } = session
    const languageCompartment = new Compartment()
    languageCompartmentRef.current = languageCompartment

    // UndoManager belirli bir Y.Text'e bağlıdır ve ondan uzun yaşayamaz;
    // her doküman için yenisi kurulur, temizlikte de yok edilir.
    // (SPEC_FRONT §8)
    const undoManager = new Y.UndoManager(ytext)

    const view = new EditorView({
      extensions: [
        basicSetup,
        // Compartment boş başlıyor; dili aşağıdaki ikinci efekt aynı commit
        // içinde yapılandırıyor. Böylece kurulum efektinin 'language'a
        // bağımlılığı kalmıyor.
        languageCompartment.of([]),
        // Metin tamponu, uzak düzenlemeler arasında imleç taşıma, uzak imleç
        // çizimi ve ortak undo — hepsi bağlamanın işi. Elle yazmıyoruz.
        yCollab(ytext, awareness, { undoManager }),
        editorTheme,
        EditorView.updateListener.of((update) => {
          if (!update.docChanged && !update.selectionSet) return
          const head = update.state.selection.main.head
          const line = update.state.doc.lineAt(head)
          onCursorChangeRef.current({ line: line.number, column: head - line.from + 1 })
        })
      ],
      parent: container
    })

    viewRef.current = view

    // Açılış konumunu bir kez bildir (updateListener henüz tetiklenmedi).
    const head = view.state.selection.main.head
    const line = view.state.doc.lineAt(head)
    onCursorChangeRef.current({ line: line.number, column: head - line.from + 1 })

    return () => {
      view.destroy()
      undoManager.destroy()
      viewRef.current = null
      languageCompartmentRef.current = null
    }
  }, [session])

  // Dil değişimi: view'ı YENİDEN KURMA, sadece compartment'ı yapılandır.
  // Yeniden kurmak yCollab'ı söküp aynı Y.Text'e tekrar bağlar; tampon
  // yeniden tohumlanır ve bütün uzak imleçler düşer — repaint olması gereken
  // şey gözle görülür bir glitch'e dönüşür. Viewer için salt-okunurluk da
  // adım 6'da aynı yolla, İKİNCİ bir Compartment ile gelecek — yine yeniden
  // kurarak değil. (SPEC_FRONT §7.4)
  useEffect(() => {
    const view = viewRef.current
    const languageCompartment = languageCompartmentRef.current
    if (!view || !languageCompartment) return
    view.dispatch({
      effects: languageCompartment.reconfigure(languageExtension(language))
    })
  }, [language, session])

  // İçeriği React state'inden sürmüyoruz: tamponun sahibi yCollab.
  // Controlled-component kalıbı burada bağlamayla kavga eder ve imleçleri bozar.
  return <div ref={containerRef} className="h-full min-h-0 overflow-hidden" />
}
