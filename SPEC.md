# SPEC — Collaborative IDE Client (Electron + React + Tailwind + TypeScript)

> Implementation brief for Claude Code. Build the desktop client described here against the
> **existing, unmodified** FastAPI collaboration server in `../server`.

---

## 1. Purpose & non-goals

### Purpose

`../server` already runs a working CRDT collaboration server (FastAPI + `pycrdt-websocket`) and a
terminal client (`editor.py`, launched as `write.py` / `watch.py`). Two terminal clients are equal
peers editing one shared `Y.Text`; whatever one types, the other sees.

Rebuild that client as an Electron desktop app: **two editor windows, side by side, synchronized
through the same FastAPI websocket server**. The editing surface should feel like a real code
editor — syntax highlighting, line numbers, multiple cursors, undo — not a `<textarea>`.

### Non-goals

Do not build any of these. They are deliberately out of scope:

- **Auth, login, accounts, sessions, tokens.** There is none on the server and none is wanted.
  A room is just a path segment; connecting to it joins it.
- **Persistence.** Server state is in-memory only and dies with the process. (`pycrdt-store` is
  pulled in transitively but unused.) Restarting the server empties every room — that is expected
  behavior, not a bug to fix.
- **File tree, tabs, multiple documents, opening/saving files.** One shared document per room.
- **Production packaging / installers / auto-update.** `npm run dev` is the target experience.
- **Changing the server.** If something seems to require a server change, re-read §3 — it almost
  certainly does not.

---

## 2. Stack

| Layer | Choice | Notes |
|---|---|---|
| Shell | Electron via **`electron-vite`** | Scaffold: `npm create @quick-start/electron@latest` → **react-ts** template |
| UI | **React 19** + **TypeScript** | Strict mode on |
| Styling | **Tailwind CSS v4** | `npm i tailwindcss @tailwindcss/vite` |
| Editor surface | **CodeMirror 6** | `codemirror` meta package, plus `@codemirror/state` and `@codemirror/view` **installed explicitly** — see below |
| Language modes | `@codemirror/lang-javascript`, `@codemirror/lang-markdown`, `@codemirror/lang-python` | Swapped at runtime through a CodeMirror `Compartment` — §8. `basicSetup` alone highlights **nothing** |
| CRDT | **`yjs`** | |
| Transport | **`y-websocket`** (v3.x, exports `WebsocketProvider`) | The ecosystem is mid-rename to `@y/websocket` / `@y/protocols`; use the classic `y-websocket` unless it fails to install |
| Editor ↔ CRDT binding | **`y-codemirror.next`** (`yCollab`) | Owns the text buffer, cursor transformation, remote carets, shared undo |

`@codemirror/state` and `@codemirror/view` are **peer** dependencies of `y-codemirror.next`, not
transitive ones — list them in `package.json` yourself. They also need deduping; see §6.6.

Local toolchain verified present: **Node 25.9.0**, **npm 11.12.1**. Versions verified on the
registry: `y-websocket 3.1.0` (exports `WebsocketProvider`, supports `disableBc`),
`y-codemirror.next 0.3.5`, `yjs 13.6.32`, `codemirror 6.0.2`.

### Tailwind v4 setup (it is not v3 — do not write a `tailwind.config.js`)

```ts
// electron.vite.config.ts — renderer section
import tailwindcss from '@tailwindcss/vite'

renderer: {
  plugins: [react(), tailwindcss()],
  resolve: { dedupe: ['yjs', '@codemirror/state', '@codemirror/view'] },   // see §6.6
}
```

```css
/* src/renderer/src/index.css */
@import "tailwindcss";

@theme {
  --color-surface: #1e1e2e;
  --color-surface-raised: #282a36;
  /* ...design tokens live here in v4, not in a JS config file */
}
```

There is no `@tailwind base/components/utilities` in v4 and no config file by default.

### Division of labor (this is the architectural decision — respect it)

**The binding owns:** the text buffer, cursor/selection transformation through remote edits,
remote caret rendering, shared undo/redo. Do not hand-roll any of this.

**The app owns:** window layout, pane chrome, theme, connection status UI, presence list, room
switching. This is where the custom work goes.

---

## 3. Server contract

The server is at `../server` and **must not be modified**. Every fact below was verified against
the installed code, not assumed.

### 3.1 Running it

```bash
cd ../server
uv run uvicorn main:app --port 8000
```

**Never pass `--reload` while testing the client.** Uvicorn restarts on every `.py` save, which
wipes the in-memory rooms and drops all websockets — connected clients stay alive but silently
stop updating. It looks exactly like a sync bug in your code, and you will waste an hour on it.

### 3.2 Wire protocol — stock y-protocols, fully compatible

`pycrdt/websocket/yroom.py` → `YRoom.serve()` sends a `SYNC_STEP1` message immediately on connect,
then dispatches on `message[0]`:

| Constant | Value |
|---|---|
| `YMessageType.SYNC` | `0` |
| `YMessageType.AWARENESS` | `1` |
| `YSyncMessageType.SYNC_STEP1` | `0` |
| `YSyncMessageType.SYNC_STEP2` | `1` |
| `YSyncMessageType.SYNC_UPDATE` | `2` |

Awareness messages are relayed to every client in the room (including the sender, which keeps the
connection alive). This is byte-identical to what `y-protocols` speaks.

**Consequence: stock `y-websocket` interoperates with this server out of the box.** No custom
protocol code, no adapter, no server change. If you find yourself hand-encoding varints, stop.

### 3.3 The URL — and the one trap in it

```
ws://localhost:8000/ws/belge-1
```

`main.py` does `app.mount("/ws", asgi_server)`. **Starlette 1.6.0's `Mount.matches()` sets
`root_path` but does *not* rewrite `scope["path"]`** (verified by reading the installed source).
`ASGIServer` passes `scope["path"]` straight through to `WebsocketServer.serve()`, which calls
`get_room(websocket.path)`.

**So the room key is the full path string `/ws/belge-1`** — not `belge-1`, not `/belge-1`.

`y-websocket` builds its URL as `serverUrl + '/' + room`. Therefore:

```ts
// ✅ correct — resolves to ws://localhost:8000/ws/belge-1, room key "/ws/belge-1"
new WebsocketProvider('ws://localhost:8000/ws', 'belge-1', ydoc, { disableBc: true })

// ❌ trailing slash — resolves to ws://localhost:8000/ws//belge-1, room key "/ws//belge-1"
//    A silently different room. Both clients connect fine and never see each other.
new WebsocketProvider('ws://localhost:8000/ws/', 'belge-1', ydoc, { disableBc: true })
```

Query parameters are excluded from `scope["path"]`, so the params `y-websocket` appends are
harmless.

### 3.4 Shared root

The Python client does:

```python
doc = Doc()
text = doc.get("content", type=Text)
```

TypeScript must therefore use exactly:

```ts
const ytext = ydoc.getText('content')
```

Room **and** root name must both match, or the two documents will never converge — while both
sides look perfectly healthy.

### 3.5 Health check

`GET http://localhost:8000/` → `{"status": "ok", "service": "collab-ide-server"}`

**Do not poll this from the renderer.** The server has no `CORSMiddleware`, so a browser `fetch()`
is blocked. (Websocket upgrades are unaffected — they are not subject to CORS.) Drive all
connection UI from provider events instead; see §7.2.

### 3.6 Installed server versions

`pycrdt 0.14.2` · `pycrdt-websocket 0.16.4` · `fastapi 0.141.1` · `uvicorn 0.52.1` ·
`starlette 1.6.0` · Python 3.11

---

## 4. Project structure

```
client/
├── SPEC.md                        ← this file
├── .gitignore                     # node_modules/, out/, dist/, .vite/, CLAUDE.md, .claude/
├── package.json
├── electron.vite.config.ts
├── tsconfig.json / tsconfig.node.json / tsconfig.web.json
└── src/
    ├── main/
    │   └── index.ts               # creates the two BrowserWindows (staggered — §6.4)
    ├── preload/
    │   └── index.ts               # minimal; contextBridge only
    └── renderer/
        ├── index.html
        └── src/
            ├── main.tsx
            ├── App.tsx            # reads ?pane= from location.search, renders one EditorPane
            ├── index.css          # @import "tailwindcss";
            ├── collab/
            │   ├── constants.ts   # SERVER_URL, DEFAULT_ROOM, ROOT_NAME, PANE_COLORS
            │   └── useCollab.ts   # Y.Doc + WebsocketProvider lifecycle hook
            └── components/
                ├── EditorPane.tsx
                ├── CodeMirrorSurface.tsx
                ├── PaneHeader.tsx
                ├── LanguagePicker.tsx    # dil seçici — pencereye özel, paylaşılmaz (§8)
                ├── StatusBar.tsx
                └── RoomSwitcher.tsx
```

---

## 5. Architecture

### 5.1 Main process — two windows

`src/main/index.ts` creates **two** `BrowserWindow`s, one per pane, distinguished by a query
parameter on the renderer URL:

```ts
createWindow('write')                                  // ?pane=write
setTimeout(() => createWindow('watch'), 1000)          // ?pane=watch — the delay is required, see §6.4
```

Position them side by side so both are visible on launch (`x`/`y` offsets from
`screen.getPrimaryDisplay().workAreaSize`).

**Window lifecycle — deviate from the scaffold here, deliberately.** The `electron-vite` react-ts
template ships two behaviors that are wrong for a two-pane app, and this is a macOS project:

- `window-all-closed` guards with `if (process.platform !== 'darwin') app.quit()`. **Drop the
  guard** — quit on every platform, darwin included. This app is a two-window demo, not a document
  app; leaving it alive with no windows just orphans the process.
- The `activate` handler recreates **one** window with no `?pane=` query parameter, which would
  open a third, identity-less pane. Either delete the handler, or have it recreate **both** panes
  using the same staggered path as launch (§6.4).

Renderer security — standard Electron defaults, no relaxation needed:

```ts
webPreferences: {
  contextIsolation: true,
  nodeIntegration: false,
  preload: join(__dirname, '../preload/index.js'),
}
```

`WebSocket` is a Chromium API available in the renderer, so the collaboration layer needs no Node
access whatsoever.

CSP must permit the websocket connection:

```
connect-src 'self' ws://localhost:8000;
```

### 5.2 Renderer — one pane per window

`App.tsx` reads its identity from the URL and renders exactly one `EditorPane`:

```ts
const pane = new URLSearchParams(location.search).get('pane') ?? 'write'
```

### 5.3 Collab layer — `useCollab.ts`

One hook owns the whole CRDT lifecycle for the window:

```ts
export function useCollab(room: string, paneName: string) {
  // Creates: Y.Doc → ydoc.getText('content') → WebsocketProvider
  // Sets:    awareness local user field (§7.3)
  // Tracks:  'status' and 'sync' events
  // Cleans:  provider.destroy() + ydoc.destroy() on unmount / room change
  return { ytext, awareness, status, synced, peers }
}
```

Changing the room must fully tear down and rebuild both the doc and the provider — never reuse a
`Y.Doc` across rooms; stale content will leak into the new room and be broadcast to everyone in it.

---

## 6. Critical constraints

Each of these was learned the hard way on the Python side or verified in the installed source.
Every one of them fails **silently** — no exception, no error in the console, just two documents
that look fine and never converge.

### 6.1 `disableBc: true` is mandatory

Both windows load the same origin (`http://localhost:5173` in dev, `file://` when packaged).
`y-websocket` uses a `BroadcastChannel` by default to sync same-origin peers **directly, without
the server**. Leave it on and your two windows will sync perfectly with the server stopped — the
demo becomes a lie and proves nothing about the FastAPI backend.

```ts
new WebsocketProvider(SERVER_URL, room, ydoc, { disableBc: true })
```

§9 includes a kill-the-server test specifically to catch this.

### 6.2 No trailing slash on `serverUrl`

See §3.3. The room key is the full path; `/ws/` + `belge-1` produces a different room than
`/ws` + `belge-1`.

### 6.3 Root name is `'content'`

See §3.4.

### 6.4 Stagger the second window — room-creation race

**Two clients connecting at the same instant to a not-yet-existing room leaves one silently
unsynced.** This is a real, reproducible race in `pycrdt-websocket`: you get two isolated
documents that both look healthy. Opening two `BrowserWindow`s in the same tick triggers it
essentially every time.

Workaround: delay the second window by ~1000 ms. Write the reason in a comment — without it the
`setTimeout` reads like superstition and someone will delete it.

Once the room exists, simultaneous connects are fine. Optional hardening if the delay proves
flaky: have the first renderer send an IPC message when its provider fires `sync`, and create the
second window only then.

**The same race fires on room switching (§7.4).** Sending both windows to the same *brand-new*
room at the same moment reproduces it exactly — the stagger at launch does not protect you later.
Switch one window, wait for it to report `synced`, then switch the other. §9 criterion 6 is
written in that order on purpose.

### 6.5 Do not port the byte-offset math from `editor.py`

`editor.py` is full of UTF-8 byte-offset arithmetic (`_karakter_indeksi`, `_bayt_ofseti`,
`imleci_tasi`). **That is an artifact of the pycrdt Python bindings, not a property of the CRDT.**
In pycrdt, `len(Text)` and all indices are UTF-8 byte counts — `str(text) == "hızlı"` but
`len(text) == 7`, and a mis-aligned delete panics in the Rust layer.

In JavaScript, `Y.Text` indices are ordinary **UTF-16 code units**, exactly like `String.prototype`.
The wire format is item-based and carries no offsets, so this never crosses the network. Write
normal JS string handling and let `yCollab` handle cursor transformation. Do not reimplement
`imleci_tasi`.

### 6.6 One copy of `yjs` — **and one copy of `@codemirror/state`**

`yjs`, `y-websocket`, and `y-codemirror.next` must all resolve to the same `yjs` module instance.
Two copies break in confusing ways (and log `Yjs was already imported`).

The same hazard applies to CodeMirror, and it is easier to hit: `y-codemirror.next` declares
`@codemirror/state` and `@codemirror/view` as **peer** dependencies, while the `codemirror` meta
package brings its own. Two copies of `@codemirror/state` means two distinct `Facet` identities —
`ySyncFacet` then resolves to nothing, `yCollab` silently never attaches, and you get a perfectly
normal-looking editor that simply does not sync. No error, no warning. Add all three:

```ts
resolve: { dedupe: ['yjs', '@codemirror/state', '@codemirror/view'] }
```

to the renderer config in `electron.vite.config.ts`. Keep this list identical to the snippet in
§2 — a drift between the two is how this gets reintroduced. Do not trim it.

### 6.7 Server runs without `--reload`

See §3.1.

---

## 7. UI specification

Dark theme, monospace editor surface, styled with Tailwind utilities. Each window renders one
pane:

```
┌─────────────────────────────────────────┐
│ write · belge-1   [JS ▾]     ● connected│   PaneHeader + LanguagePicker
├─────────────────────────────────────────┤
│  1  merhaba dünya▌                      │
│  2  ığüşiöç ÇĞİÖŞÜ                      │   CodeMirrorSurface
│  3                                      │
├─────────────────────────────────────────┤
│ 2 peers · Ln 1, Col 14 · synced   [room]│   StatusBar + RoomSwitcher
└─────────────────────────────────────────┘
```

### 7.1 `PaneHeader`

Pane name (`write` / `watch`), current room, the `LanguagePicker` dropdown, and a colored
connection dot.

`LanguagePicker` is a plain `<select>` over the installed language modes (JavaScript / Markdown /
Python). Its value is **per-window React state** — it is *not* shared through the CRDT, so the two
panes can legitimately show different modes for the same text. See §8 for why.

### 7.2 `StatusBar` — status comes from two different events

`'status'` and `'sync'` mean different things and must not be conflated:

```ts
provider.on('status', ({ status }) => { /* 'connecting' | 'connected' | 'disconnected' */ })
provider.on('sync',   (isSynced: boolean) => { /* initial document sync complete */ })
```

A connection can be established without the document being synced. Show both: a connection dot
(amber connecting / green connected / red disconnected) and a distinct "synced" indicator.

Also show peer count (from awareness) and the cursor's Ln/Col (from the CodeMirror state).

**Peer count means *remote* peers.** `awareness.getStates()` includes the local client, so subtract
one — otherwise a lone window proudly reports "1 peer".

### 7.3 Presence & remote cursors

`y-codemirror.next` renders remote carets from a specific awareness field shape — use exactly this:

```ts
provider.awareness.setLocalStateField('user', {
  name: paneName,             // 'write' | 'watch'
  color: '#30bced',           // caret color
  colorLight: '#30bced33',    // selection highlight
})
```

Give each pane a distinct color. Render the peer list in the status bar from
`provider.awareness.getStates()`, subscribing to the awareness `'change'` event.

Note that awareness entries time out after ~30 s without a heartbeat, so a peer that vanishes
without a clean disconnect will disappear on its own — do not treat that as a bug.

**The Python client is invisible to presence — by design, not by accident.** `pycrdt/_provider.py`
handles `YMessageType.SYNC` only; it contains no awareness code and never publishes a local state.
The server *does* relay awareness (`yroom.py`), so the two Electron windows see each other
normally — `write.py` simply never joins the conversation. With both Electron windows **and**
`write.py` connected, the remote peer count reads **1** per window (2 states total), not 2. Text
still syncs all three ways. This is a presence gap in the Python client, not a sync bug, and there
is nothing to fix on either side.

### 7.4 `RoomSwitcher`

A plain text input for the room name (default `belge-1`). On commit, tear down and rebuild the
doc + provider (§5.3). There is no auth and no room registry — connecting to a path creates it.

Validation: **`.trim()` the value**, then require non-empty and no `/`. The trim is not cosmetic —
`belge-1 ` becomes `ws://localhost:8000/ws/belge-1%20`, a silently different room from `belge-1`.
That is the §6.2 trailing-slash trap wearing a different hat, and it fails exactly as quietly.

---

## 8. Editor composition

**`basicSetup` does not highlight anything on its own.** Its own documentation ends with
"(You'll probably want to add some language package to your setup too.)" — it bundles
`defaultHighlightStyle` but no language parser, so without an explicit `@codemirror/lang-*`
extension you get line numbers, bracket matching and multiple cursors over completely uncolored
text. That is not the editor §1 asks for. The language extension is mandatory, not optional.

```ts
import { EditorView, basicSetup } from 'codemirror'
import { Compartment } from '@codemirror/state'
import { javascript } from '@codemirror/lang-javascript'
import { markdown } from '@codemirror/lang-markdown'
import { yCollab } from 'y-codemirror.next'
import * as Y from 'yjs'

// Dili sonradan değiştirebilmek için compartment kullanıyoruz.
const language = new Compartment()

const undoManager = new Y.UndoManager(ytext)

const view = new EditorView({
  extensions: [
    basicSetup,
    language.of(javascript()),    // §7.1'deki LanguagePicker'ın başlangıç değeri
    yCollab(ytext, provider.awareness, { undoManager }),
    editorTheme,
  ],
  parent: containerEl,
})

// Dil değişince view'ı yeniden kurma — sadece compartment'ı yeniden yapılandır.
view.dispatch({ effects: language.reconfigure(markdown()) })
```

**Reconfigure the compartment; never rebuild the `EditorView` to change language.** Rebuilding
tears down `yCollab` and re-attaches it to the same `Y.Text`, which re-seeds the buffer and drops
every remote caret — a visible glitch for something that should be a repaint.

**The language choice is deliberately not in the `Y.Doc`.** It is per-window view state, like
scroll position. Putting it in the shared document would mean a second CRDT root that `editor.py`
knows nothing about (it reads only `doc.get("content", type=Text)`, §3.4), for no benefit — two
people may reasonably want different modes over the same buffer.

Mount the `EditorView` in a `useEffect` keyed on the doc/provider identity, and call
`view.destroy()` in the cleanup. Destroy the `UndoManager` alongside it, and build a fresh one per
room — it is bound to a specific `Y.Text` and cannot outlive it (§5.3).

Do not drive CodeMirror's content from React state — `yCollab` owns the buffer; a
controlled-component pattern here will fight the binding and corrupt cursors. Read the cursor's
Ln/Col for the status bar with an `EditorView.updateListener`, not by polling.

---

## 9. Acceptance criteria

Manual verification. Run the server first (`uv run uvicorn main:app --port 8000`, **no `--reload`**).

1. **Basic sync.** `npm run dev` → two windows open, both show `connected` and `synced`. Typing in
   one appears in the other within a keystroke.

2. **Interop with the Python client — this is the real proof.** With the Electron app running,
   start `uv run python write.py` in a terminal. Edits must flow **both ways**: text typed in the
   terminal appears in both Electron windows and vice versa. If this passes, the wire protocol is
   genuinely compatible; if it fails, nothing else in this list means anything.

3. **Kill-the-server test.** Stop the server. The two Electron windows must **stop** syncing with
   each other and show `disconnected`. If they keep syncing, `disableBc` is wrong (§6.1) and the
   app has been talking to itself.

4. **Turkish / UTF-8.** Type `ğüşiöç ÇĞİÖŞÜ` and a few emoji, in both the Electron app and
   `write.py`, with the cursor placed mid-string. Expect: no corruption, no mid-character
   garbling, no `PanicException: Couldn't remove 1 elements` in the server log. Test backspacing
   over multi-byte characters and over an emoji specifically.

5. **Presence — between the two Electron windows only.** Remote carets appear in the correct peer
   color with the peer's name. Peer count is accurate as windows connect and disconnect. **Do not
   run this one against `write.py`**: the Python client never publishes awareness (§7.3), so it
   contributes no caret and no peer entry no matter how correct your code is.

6. **Room switching.** Switching one window to a fresh room name gives an empty document.
   Switching the second window to the same new room re-converges them. Switching back to
   `belge-1` restores the original content (as long as a client stayed in it — rooms are deleted
   when the last client leaves).

7. **Reconnect.** Restart the server while the app is running; the providers reconnect on their
   own (exponential backoff). **Expect the content to come back, not to vanish.** The server's
   room is recreated empty, but the CRDT state lives in the *clients*: the new room sends
   `SYNC_STEP1` with an empty state vector and each client answers `SYNC_STEP2` with its entire
   document, repopulating the room. Content is genuinely lost only when every client has
   disconnected (§1). Text reappearing after a server restart is correct behavior — do not "fix"
   it.

---

## 10. Reference appendix

### 10.1 The server, in full (`../server/main.py`)

```python
from pycrdt.websocket import ASGIServer, WebsocketServer

websocket_server = WebsocketServer()
asgi_server = ASGIServer(websocket_server)

@asynccontextmanager
async def lifespan(app: FastAPI):
    async with websocket_server:      # required — starts the internal task group
        yield

app = FastAPI(lifespan=lifespan)
app.mount("/ws", asgi_server)         # room key = full path, e.g. "/ws/belge-1"
```

### 10.2 The Python client's connection (`../server/editor.py`)

```python
ROOM = "belge-1"
URL = f"http://localhost:8000/ws/{ROOM}"

doc = Doc()
text = doc.get("content", type=Text)

async with (
    aconnect_ws(URL) as websocket,
    Provider(doc, HttpxWebsocket(websocket, ROOM)),
):
    ...
```

The TypeScript client must produce the identical URL path.

### 10.3 If you go back to the Python side

`../server/CLAUDE.md` documents import-path traps that the published `pycrdt-websocket` docs get
wrong (they are behind the installed 0.16.4). Briefly: modules live under `pycrdt.websocket` (not
`pycrdt_websocket`), and the client provider moved into core `pycrdt` and was renamed
`WebsocketProvider` → **`Provider`**. Ignore any tutorial showing
`from pycrdt_websocket import WebsocketProvider`.

Note the naming collision: on the **Python** side the class is `Provider`; on the **JavaScript**
side it is `WebsocketProvider`. Both are correct for their own ecosystem.

### 10.4 Code style

The server project writes code comments in **Turkish**, explanatory in tone — it is a
learning/exploration project. Match that style in the client so the two halves read as one
project. Identifiers and types stay in English.
