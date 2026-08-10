import { useState } from 'react'
import { normalizeRoom } from '../collab/constants'

type Props = {
  room: string
  onRoomChange: (room: string) => void
}

/**
 * Oda değiştirici. Auth ya da oda kaydı yok — bir yola bağlanmak onu yaratır.
 *
 * Not (SPEC §6.4): iki pencereyi AYNI ANDA yepyeni bir odaya göndermek,
 * açılıştaki oda oluşturma yarışını birebir tekrar tetikler. Önce birini
 * gönderip 'synced' olmasını bekleyin, sonra diğerini.
 */
export function RoomSwitcher({ room, onRoomChange }: Props): React.JSX.Element {
  // Oda değişince taslak sıfırlanmalı. Bunu bir efektle senkronlamak yerine
  // StatusBar bu bileşene key={room} veriyor: React'in "prop değişince state'i
  // sıfırla" için önerdiği yol, cascading render yok.
  const [draft, setDraft] = useState(room)
  const [invalid, setInvalid] = useState(false)

  const commit = (event: React.FormEvent): void => {
    event.preventDefault()
    // normalizeRoom trim'liyor: 'belge-1 ' -> %20 -> sessizce farklı bir oda.
    const next = normalizeRoom(draft)
    if (next === null) {
      setInvalid(true)
      return
    }
    setInvalid(false)
    setDraft(next)
    if (next !== room) onRoomChange(next)
  }

  return (
    <form onSubmit={commit} className="flex items-center gap-1.5">
      <label htmlFor="room" className="text-ink-faint">
        room
      </label>
      <input
        id="room"
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        spellCheck={false}
        title="Oda adı — boş olamaz ve '/' içeremez"
        className={`w-28 rounded border bg-surface px-1.5 py-0.5 font-mono text-xs text-ink outline-none focus:border-accent ${
          invalid ? 'border-state-down' : 'border-border-subtle'
        }`}
      />
    </form>
  )
}
