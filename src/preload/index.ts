import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'
import { EDITOR_YENILE, KANAL, OTURUM_GECERSIZ } from '../shared/channels'
import type {
  Api,
  ApiResult,
  Collaborator,
  Document,
  DocumentCreate,
  DocumentListItem,
  DocumentUpdate,
  RoleGrantByEmail,
  ServerConfig,
  ServerSetResult,
  User
} from '../shared/types'

/**
 * Renderer'a açılan ince köprü.
 *
 * Burada MANTIK YOK: her fonksiyon karşılık gelen kanalı çağırıp main'in
 * döndürdüğü ApiResult'ı olduğu gibi geçiriyor. Sonucu açıp hata fırlatma işi
 * renderer tarafındaki sarmalayıcının (src/renderer/src/api.ts) — Electron
 * değerleri structured-clone ettiği için bir Error nesnesi buradan karşıya
 * kendisi olarak geçemezdi zaten. (SPEC_FRONT §4.2)
 */
const api = {
  auth: {
    register: (email: string, password: string): Promise<ApiResult<User>> =>
      ipcRenderer.invoke(KANAL.authRegister, email, password),
    login: (email: string, password: string): Promise<ApiResult<User>> =>
      ipcRenderer.invoke(KANAL.authLogin, email, password),
    me: (): Promise<ApiResult<User | null>> => ipcRenderer.invoke(KANAL.authMe),
    logout: (): Promise<ApiResult<void>> => ipcRenderer.invoke(KANAL.authLogout),
    wsToken: (documentId: string): Promise<ApiResult<string>> =>
      ipcRenderer.invoke(KANAL.authWsToken, documentId)
  },
  documents: {
    list: (): Promise<ApiResult<DocumentListItem[]>> => ipcRenderer.invoke(KANAL.documentsList),
    create: (govde: DocumentCreate): Promise<ApiResult<Document>> =>
      ipcRenderer.invoke(KANAL.documentsCreate, govde),
    update: (id: string, govde: DocumentUpdate): Promise<ApiResult<Document>> =>
      ipcRenderer.invoke(KANAL.documentsUpdate, id, govde),
    delete: (id: string): Promise<ApiResult<void>> => ipcRenderer.invoke(KANAL.documentsDelete, id)
  },
  roles: {
    list: (documentId: string): Promise<ApiResult<Collaborator[]>> =>
      ipcRenderer.invoke(KANAL.rolesList, documentId),
    grantByEmail: (documentId: string, govde: RoleGrantByEmail): Promise<ApiResult<Collaborator>> =>
      ipcRenderer.invoke(KANAL.rolesGrantByEmail, documentId, govde),
    revoke: (documentId: string, userId: string): Promise<ApiResult<void>> =>
      ipcRenderer.invoke(KANAL.rolesRevoke, documentId, userId)
  },
  server: {
    get: (): Promise<ApiResult<ServerConfig>> => ipcRenderer.invoke(KANAL.serverGet),
    set: (url: string): Promise<ApiResult<ServerSetResult>> =>
      ipcRenderer.invoke(KANAL.serverSet, url),
    reset: (): Promise<ApiResult<ServerSetResult>> => ipcRenderer.invoke(KANAL.serverReset)
  },
  /**
   * Main 401 gördüğünde (ya da adres değiştiğinde) tetiklenir. Dönen fonksiyon
   * aboneliği kaldırır. `sebep` yayınlayan taraftan geliyor — bkz. channels.ts.
   */
  onSessionInvalidated: (cb: (reason?: string) => void): (() => void) => {
    const dinleyici = (_e: unknown, sebep?: string): void => cb(sebep)
    ipcRenderer.on(OTURUM_GECERSIZ, dinleyici)
    return () => ipcRenderer.off(OTURUM_GECERSIZ, dinleyici)
  },
  /** Cmd/Ctrl+R. Dönen fonksiyon aboneliği kaldırır. */
  onEditorReload: (cb: () => void): (() => void) => {
    const dinleyici = (): void => cb()
    ipcRenderer.on(EDITOR_YENILE, dinleyici)
    return () => ipcRenderer.off(EDITOR_YENILE, dinleyici)
  }
  // `satisfies`: köprü ile index.d.ts'teki ilan ayrışırsa burada patlasın.
} satisfies Api

if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI)
    contextBridge.exposeInMainWorld('api', api)
  } catch (error) {
    console.error(error)
  }
} else {
  // @ts-ignore (define in dts)
  window.electron = electronAPI
  // @ts-ignore (define in dts)
  window.api = api
}
