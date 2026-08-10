import './index.css'

import { createRoot } from 'react-dom/client'
import App from './App'

// StrictMode bilerek YOK.
//
// Geliştirmede StrictMode her efekti iki kez çalıştırır (mount → unmount →
// mount). useCollab'ın efekti bir websocket açıp kapattığı için bu, aynı tick
// içinde odaya iki kez bağlanıp kopmak demek — SPEC §6.4'teki oda oluşturma
// yarışını davet eden tam da bu. Demonun bütün amacı senkronun gerçekten
// çalıştığını göstermek olduğundan, StrictMode'un çift-mount kontrolünden
// vazgeçiyoruz.
createRoot(document.getElementById('root')!).render(<App />)
