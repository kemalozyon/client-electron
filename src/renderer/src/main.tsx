import './index.css'

import { createRoot } from 'react-dom/client'
import App from './App'

// StrictMode bilerek YOK.
//
// Geliştirmede StrictMode her efekti iki kez çalıştırır (mount → unmount →
// mount). useCollab'ın efekti bir Y.Doc yaratıp yok ediyor; adım 4'ten sonra
// buna bir de soket açıp kapatmak eklenecek — yani her açılışta gereksiz bir
// bağlan/kop turu.
//
// NOT: eski gerekçe pycrdt-websocket'teki oda oluşturma yarışıydı; o yarış
// artık yok (SPEC_FRONT §2.4). Kalan gerekçe daha zayıf, sadece gürültü.
// Efekt temizliği doğru yazıldığı için StrictMode'u açmak da güvenli olmalı;
// açmadan önce EnvelopeProvider'ın destroy()'unun gerçekten idempotent
// olduğunu doğrulayın.
createRoot(document.getElementById('root')!).render(<App />)
