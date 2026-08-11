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
 * edersiniz. Yani dil eklentisi opsiyonel değil, zorunlu. (SPEC_FRONT §2.1)
 */
export type LanguageId = 'plaintext' | 'javascript' | 'markdown' | 'python'

export const LANGUAGES: { id: LanguageId; label: string; extension: () => Extension }[] = [
  // 'plaintext' sunucunun DB varsayılanı (documents.language). Listede olmasa
  // başka bir istemcinin ya da bootstrap.py'nin açtığı her doküman sessizce
  // JavaScript gibi görünürdü. Uzantısı bilerek boş: dil eklentisi yok demek.
  { id: 'plaintext', label: 'Düz metin', extension: () => [] },
  { id: 'javascript', label: 'JavaScript', extension: () => javascript() },
  { id: 'markdown', label: 'Markdown', extension: () => markdown() },
  { id: 'python', label: 'Python', extension: () => python() }
]

export const DEFAULT_LANGUAGE: LanguageId = 'plaintext'

export function languageExtension(id: LanguageId): Extension {
  const found = LANGUAGES.find((lang) => lang.id === id) ?? LANGUAGES[0]
  return found.extension()
}

/**
 * Sunucudaki `language` SERBEST bir metin — backend onu asla yorumlamıyor,
 * yalnızca saklıyor. Yani tanımadığımız bir değer gelmesi normal; o zaman düz
 * metne düşüyoruz, uydurmuyoruz.
 */
export function toLanguageId(raw: string): LanguageId {
  return LANGUAGES.some((lang) => lang.id === raw) ? (raw as LanguageId) : DEFAULT_LANGUAGE
}
