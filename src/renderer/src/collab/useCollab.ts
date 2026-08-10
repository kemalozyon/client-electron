import { useEffect, useState } from 'react'
import * as Y from 'yjs'
import { WebsocketProvider } from 'y-websocket'
import type { Awareness } from 'y-protocols/awareness'
import { PANE_COLORS, ROOT_NAME, SERVER_URL, type PaneName } from './constants'

/** Bağlantı durumu — provider'ın 'status' olayından gelir. */
export type ConnectionStatus = 'connecting' | 'connected' | 'disconnected'

/** Status bar'da listelediğimiz uzak eş. */
export type Peer = {
  clientId: number
  name: string
  color: string
}

/**
 * Bir oda için kurulan CRDT oturumu. Oda değişince komple yenisi kurulur;
 * bu nesnenin kimliği "hangi doküman" sorusunun cevabı olduğu için
 * CodeMirror efekti de buna bakarak kendini yeniden kuruyor.
 */
export type CollabSession = {
  ytext: Y.Text
  awareness: Awareness
}

export type CollabState = {
  session: CollabSession | null
  status: ConnectionStatus
  synced: boolean
  peers: Peer[]
}

/**
 * Bir pencerenin bütün CRDT yaşam döngüsü.
 *
 * Y.Doc -> ydoc.getText('content') -> WebsocketProvider zincirini kurar,
 * awareness'a kendi kimliğini yazar, 'status'/'sync' olaylarını dinler ve
 * oda değişiminde her şeyi baştan kurar.
 */
export function useCollab(room: string, paneName: PaneName): CollabState {
  const [session, setSession] = useState<CollabSession | null>(null)
  const [status, setStatus] = useState<ConnectionStatus>('connecting')
  const [synced, setSynced] = useState(false)
  const [peers, setPeers] = useState<Peer[]>([])

  useEffect(() => {
    // Her oda için SIFIRDAN doküman. Bir Y.Doc'u odalar arasında yeniden
    // kullanmak, eski odanın içeriğinin yeni odaya sızıp oradaki herkese
    // yayınlanması demek. (SPEC §5.3)
    const ydoc = new Y.Doc()
    const ytext = ydoc.getText(ROOT_NAME)

    const provider = new WebsocketProvider(SERVER_URL, room, ydoc, {
      // ZORUNLU (SPEC §6.1): iki pencere aynı origin'de olduğu için
      // y-websocket varsayılan olarak BroadcastChannel üzerinden birbirleriyle
      // SUNUCUSUZ senkronlaşır. Açık bırakırsak sunucu kapalıyken bile mükemmel
      // çalışırlar ve demo FastAPI backend hakkında hiçbir şey kanıtlamaz.
      disableBc: true
    })

    const { awareness } = provider

    // y-codemirror.next uzak imleçleri tam olarak bu alan şeklinden okuyor.
    // (SPEC §7.3)
    awareness.setLocalStateField('user', {
      name: paneName,
      ...PANE_COLORS[paneName]
    })

    // 'status' ve 'sync' AYNI ŞEY DEĞİL (SPEC §7.2): bağlantı kurulmuş ama
    // doküman henüz senkronlanmamış olabilir. İkisini ayrı gösteriyoruz.
    const onStatus = ({ status }: { status: ConnectionStatus }): void => setStatus(status)
    const onSync = (isSynced: boolean): void => setSynced(isSynced)

    const onAwarenessChange = (): void => {
      const next: Peer[] = []
      awareness.getStates().forEach((state, clientId) => {
        // getStates() yerel istemciyi de içerir; çıkarmazsak tek başına
        // duran bir pencere gururla "1 peer" der. (SPEC §7.2)
        if (clientId === awareness.clientID) return
        const user = (state as { user?: { name?: string; color?: string } }).user
        next.push({
          clientId,
          name: user?.name ?? 'anonim',
          color: user?.color ?? '#7f849c'
        })
      })
      setPeers(next)
    }

    provider.on('status', onStatus)
    provider.on('sync', onSync)
    awareness.on('change', onAwarenessChange)

    // react-hooks/set-state-in-effect burada bilerek kapalı: bu efektin işi tam
    // da kuralın "harici bir sisteme abone ol" istisnası — Y.Doc ve provider
    // React'in dışında yaratılıyor ve React'e ancak state ile duyurulabiliyor.
    // Oda başına bir kez çalışır, yani tek bir ek render demek.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSession({ ytext, awareness })
    setStatus('connecting')
    setSynced(false)
    onAwarenessChange()

    return () => {
      provider.off('status', onStatus)
      provider.off('sync', onSync)
      awareness.off('change', onAwarenessChange)
      // Sıra önemli: provider awareness'ı temizleyip soketi kapatsın,
      // sonra doküman gitsin.
      provider.destroy()
      ydoc.destroy()
      setSession(null)
    }
  }, [room, paneName])

  return { session, status, synced, peers }
}
