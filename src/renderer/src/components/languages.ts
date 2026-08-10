import type { Extension } from '@codemirror/state'
import { javascript } from '@codemirror/lang-javascript'
import { markdown } from '@codemirror/lang-markdown'
import { python } from '@codemirror/lang-python'

/**
 * Kurulu dil modları.
 *
 * basicSetup TEK BAŞINA hiçbir şeyi renklendirmez — kendi dokümantasyonu da
 * "muhtemelen bir dil paketi de eklemek isteyeceksiniz" diye bitiyor. İçinde
 * defaultHighlightStyle var ama parser yok; @codemirror/lang-* eklentisi
 * olmadan satır numaralı, parantez eşleşen, tamamen renksiz bir metin elde
 * edersiniz. Yani dil eklentisi opsiyonel değil, zorunlu. (SPEC §8)
 */
export type LanguageId = 'javascript' | 'markdown' | 'python'

export const LANGUAGES: { id: LanguageId; label: string; extension: () => Extension }[] = [
  { id: 'javascript', label: 'JavaScript', extension: () => javascript() },
  { id: 'markdown', label: 'Markdown', extension: () => markdown() },
  { id: 'python', label: 'Python', extension: () => python() }
]

export const DEFAULT_LANGUAGE: LanguageId = 'javascript'

export function languageExtension(id: LanguageId): Extension {
  const found = LANGUAGES.find((lang) => lang.id === id) ?? LANGUAGES[0]
  return found.extension()
}
