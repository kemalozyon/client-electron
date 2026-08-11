import { HighlightStyle, syntaxHighlighting } from '@codemirror/language'
import { EditorView } from '@codemirror/view'
import type { Extension } from '@codemirror/state'
import { tags as t } from '@lezer/highlight'
import { METIN_KOYU, PRESENCE_PALETTE, kontrastMetin } from '../collab/constants'

/**
 * Editörün koyu teması.
 *
 * Tema app'in sorumluluğu (SPEC_FRONT §2.1), bu yüzden hazır bir tema paketi
 * çekmek yerine elle yazıyoruz: renkler index.css'teki @theme token'larıyla
 * birebir aynı, dolayısıyla editör ile pane süslemesi tek parça görünüyor.
 */
const surface = '#1e1e2e'
const surfaceSunken = '#181825'
const borderSubtle = '#313244'
const ink = '#cdd6f4'
const inkMuted = '#7f849c'
const inkFaint = '#585b70'
const accent = '#89b4fa'

/**
 * İmleç etiketinin yazı rengi — zemine göre.
 *
 * Zemin DOM'da yalnızca imlecin satır içi `style`'ında var
 * (`background-color: #f9e2af; border-color: #f9e2af`) ve etiket onu `inherit`
 * ediyor. CSS bir elemanın hesaplanmış zemininden yazı rengi TÜRETEMİYOR
 * (`contrast-color()` yok, göreli renk sözdizimi de `background-color`'ı
 * okuyamıyor), o yüzden paletin her rengi için bir kural üretiyoruz.
 *
 * Seçici İMLECİ hedefliyor, etiketi değil: satır içi renk orada duruyor.
 *
 * Bu, imleç çizimini elle yazmak DEĞİL — çizen hâlâ yCollab (CLAUDE.md §3.3).
 * Yalnızca kütüphanenin baseTheme'indeki `color: white`ı eziyoruz; CodeMirror'da
 * theme kuralları baseTheme'den önce geliyor, o yüzden bu yetiyor.
 */
const presenceKontrast = Object.fromEntries(
  PRESENCE_PALETTE.map((renk) => [
    `.cm-ySelectionCaret[style*="${renk}"] .cm-ySelectionInfo`,
    { color: kontrastMetin(renk) }
  ])
)

const baseTheme = EditorView.theme(
  {
    ...presenceKontrast,
    '&': {
      color: ink,
      backgroundColor: surface,
      height: '100%',
      fontSize: '13px'
    },
    '.cm-scroller': {
      fontFamily:
        '"JetBrains Mono", "Fira Code", ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
      lineHeight: '1.6'
    },
    '.cm-content': {
      caretColor: accent,
      padding: '12px 0'
    },
    '.cm-cursor, .cm-dropCursor': { borderLeftColor: accent, borderLeftWidth: '2px' },
    '&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection':
      {
        backgroundColor: '#45475a'
      },
    '.cm-activeLine': { backgroundColor: '#ffffff08' },
    '.cm-gutters': {
      backgroundColor: surfaceSunken,
      color: inkFaint,
      border: 'none',
      borderRight: `1px solid ${borderSubtle}`
    },
    '.cm-activeLineGutter': { backgroundColor: '#ffffff08', color: inkMuted },
    '.cm-foldPlaceholder': {
      backgroundColor: 'transparent',
      border: 'none',
      color: inkMuted
    },
    '.cm-matchingBracket, &.cm-focused .cm-matchingBracket': {
      backgroundColor: '#45475a',
      outline: `1px solid ${inkMuted}`
    },
    '.cm-tooltip': {
      backgroundColor: '#282a36',
      border: `1px solid ${borderSubtle}`,
      borderRadius: '8px',
      boxShadow: '0 8px 20px -6px rgba(0, 0, 0, 0.35)',
      color: ink
    },
    '.cm-tooltip-autocomplete > ul > li[aria-selected]': {
      backgroundColor: '#45475a',
      color: ink
    },
    // Uzak imleçlerin üstündeki isim etiketi (y-codemirror.next çiziyor).
    // opacity: y-codemirror.next'in kendi teması etiketi yalnızca imlecin
    // üstüne gelindiğinde gösteriyor; kimin nerede olduğunun sürekli görünmesi
    // daha faydalı olduğu için sabitliyoruz. Ad bir e-posta olduğu için de
    // nowrap: sarmalanırsa etiket satırın üstünü kaplıyor.
    '.cm-ySelectionInfo': {
      fontFamily: 'inherit',
      fontSize: '10px',
      fontWeight: '600',
      padding: '1px 4px',
      borderRadius: '3px 3px 3px 0',
      whiteSpace: 'nowrap',
      opacity: '1',
      // Palet DIŞI bir renk için geri düşüş. SPEC_FRONT §6.4: sunucu awareness'ı
      // doğrulamıyor, yani bir eş HERHANGİ bir rengi iddia edebilir ve o zaman
      // yukarıdaki üretilmiş kuralların hiçbiri tutmaz. Buraya bir değer
      // koymazsak kütüphanenin `white`ına düşerdi — düzeltmeye çalıştığımız şeyin
      // ta kendisi.
      color: METIN_KOYU
    }
  },
  { dark: true }
)

/**
 * Sözdizimi renkleri.
 *
 * basicSetup kendi defaultHighlightStyle'ını `fallback: true` ile ekliyor,
 * yani bizimki ondan önce gelir ve o sadece boşta kalan etiketler için devreye
 * girer.
 */
const darkHighlightStyle = HighlightStyle.define([
  { tag: [t.keyword, t.moduleKeyword, t.controlKeyword], color: '#cba6f7' },
  { tag: [t.name, t.deleted, t.character, t.propertyName, t.macroName], color: '#f5e0dc' },
  { tag: [t.function(t.variableName), t.labelName], color: '#89b4fa' },
  { tag: [t.color, t.constant(t.name), t.standard(t.name)], color: '#fab387' },
  { tag: [t.definition(t.name), t.separator], color: ink },
  {
    tag: [t.typeName, t.className, t.number, t.changed, t.annotation, t.self, t.namespace],
    color: '#f9e2af'
  },
  {
    tag: [t.operator, t.operatorKeyword, t.url, t.escape, t.regexp, t.link, t.special(t.string)],
    color: '#94e2d5'
  },
  { tag: [t.meta, t.comment], color: '#6c7086', fontStyle: 'italic' },
  { tag: t.strong, fontWeight: 'bold' },
  { tag: t.emphasis, fontStyle: 'italic' },
  { tag: t.strikethrough, textDecoration: 'line-through' },
  { tag: t.link, color: inkMuted, textDecoration: 'underline' },
  { tag: t.heading, fontWeight: 'bold', color: '#f38ba8' },
  { tag: [t.atom, t.bool, t.special(t.variableName)], color: '#fab387' },
  { tag: [t.processingInstruction, t.string, t.inserted], color: '#a6e3a1' },
  { tag: t.invalid, color: '#f38ba8' }
])

export const editorTheme: Extension = [baseTheme, syntaxHighlighting(darkHighlightStyle)]
