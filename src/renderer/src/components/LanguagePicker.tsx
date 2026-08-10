import { LANGUAGES, type LanguageId } from './languages'

type Props = {
  value: LanguageId
  onChange: (id: LanguageId) => void
}

/**
 * Dil seçici — değeri PENCEREYE ÖZEL React state'idir, CRDT'de paylaşılmaz.
 *
 * Dil, kaydırma konumu gibi bir görünüm durumu (SPEC §8). Y.Doc'a koymak,
 * editor.py'nin haberi olmayan ikinci bir kök yaratmak olurdu — üstelik iki
 * kişi aynı tampona makul şekilde farklı modlarla bakmak isteyebilir.
 */
export function LanguagePicker({ value, onChange }: Props): React.JSX.Element {
  return (
    <select
      value={value}
      onChange={(event) => onChange(event.target.value as LanguageId)}
      title="Dil modu (yalnızca bu pencere)"
      className="cursor-pointer rounded border border-border-subtle bg-surface-raised px-2 py-0.5 text-xs text-ink outline-none hover:border-ink-faint focus:border-accent"
    >
      {LANGUAGES.map((lang) => (
        <option key={lang.id} value={lang.id}>
          {lang.label}
        </option>
      ))}
    </select>
  )
}
