import { useState } from 'react'
import { DEFAULT_PANE, DEFAULT_ROOM, isPaneName } from './collab/constants'
import { EditorPane } from './components/EditorPane'

/**
 * Her pencere TEK bir pane render eder. Kimliğini main process'in eklediği
 * ?pane= query parametresinden öğrenir (SPEC §5.2).
 *
 * İki pencere arasında süreç içinde hiçbir ortak durum yok — iki ayrı makine
 * kadar ayrılar; paylaştıkları her şey sunucudan geçiyor.
 */
function App(): React.JSX.Element {
  const paneParam = new URLSearchParams(location.search).get('pane')
  const pane = isPaneName(paneParam) ? paneParam : DEFAULT_PANE

  const [room, setRoom] = useState(DEFAULT_ROOM)

  return <EditorPane pane={pane} room={room} onRoomChange={setRoom} />
}

export default App
