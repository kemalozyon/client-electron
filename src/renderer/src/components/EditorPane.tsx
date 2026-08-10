import { useState } from 'react'
import type { PaneName } from '../collab/constants'
import { useCollab } from '../collab/useCollab'
import { PaneHeader } from './PaneHeader'
import { StatusBar } from './StatusBar'
import { CodeMirrorSurface, type CursorPosition } from './CodeMirrorSurface'
import { DEFAULT_LANGUAGE, type LanguageId } from './languages'

type Props = {
  pane: PaneName
  room: string
  onRoomChange: (room: string) => void
}

export function EditorPane({ pane, room, onRoomChange }: Props): React.JSX.Element {
  // Dil PENCEREYE ÖZEL: bilerek Y.Doc'ta değil (SPEC §8).
  const [language, setLanguage] = useState<LanguageId>(DEFAULT_LANGUAGE)
  const [cursor, setCursor] = useState<CursorPosition>({ line: 1, column: 1 })

  const { session, status, synced, peers } = useCollab(room, pane)

  return (
    <div className="flex h-full flex-col bg-surface">
      <PaneHeader
        pane={pane}
        room={room}
        status={status}
        language={language}
        onLanguageChange={setLanguage}
      />

      <main className="min-h-0 flex-1">
        {session ? (
          // key: oda değişince CodeMirror da komple yeniden kurulmalı.
          <CodeMirrorSurface
            key={room}
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

      <StatusBar
        peers={peers}
        synced={synced}
        cursor={cursor}
        room={room}
        onRoomChange={onRoomChange}
      />
    </div>
  )
}
