import { resolve } from 'path'
import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  main: {},
  preload: {},
  renderer: {
    resolve: {
      alias: {
        '@renderer': resolve('src/renderer/src')
      },
      // DİKKAT — bu üç paket tek kopyaya indirgenmek zorunda (SPEC §6.6).
      //
      // y-codemirror.next, '@codemirror/state' ve '@codemirror/view'i peer
      // dependency olarak ister; 'codemirror' meta paketi ise kendi kopyasını
      // getirir. İki ayrı '@codemirror/state' kopyası, iki ayrı Facet kimliği
      // demektir: ySyncFacet hiçbir şeye çözülmez, yCollab editöre sessizce
      // hiç bağlanmaz. Hata da uyarı da çıkmaz — gayet normal görünen ama
      // senkronize olmayan bir editör elde edersiniz.
      //
      // Aynı tehlike yjs için de geçerli (iki kopya "Yjs was already imported"
      // uyarısı verir). Listeyi kısaltmayın.
      dedupe: ['yjs', '@codemirror/state', '@codemirror/view']
    },
    plugins: [react(), tailwindcss()]
  }
})
