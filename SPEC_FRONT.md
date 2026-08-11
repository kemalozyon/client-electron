# SPEC_FRONT — Collaborative IDE Desktop Client

> Implementation brief for the Electron client, written against the **current** FastAPI backend in
> `../server` (SPEC §12 steps 1–7 complete). Build the app described here by evolving the existing
> code in this repository.
>
> **This document supersedes `SPEC.md`.** That file specifies a client for a server that no longer
> exists — see §1.1. Where the two disagree, this one is correct. `CLAUDE.md` in this repo is also
> stale (it claims no code has been written); it gets rewritten once the work below lands.

---

## 1. Purpose & non-goals

### 1.1 What changed, and why the existing client is broken

`SPEC.md` was written against the backend's **spike**: `main.py` did
`app.mount("/ws", asgi_server)` over `pycrdt-websocket`, a room was a free-text path segment, there
was no authentication, no persistence, and the wire protocol was stock `y-websocket`. The current
client implements that faithfully — and cannot talk to the product server at all.

The backend has since built the real thing. Four consequences, each of which invalidates a load-
bearing assumption in `SPEC.md`:

| Then (spike) | Now (product) |
|---|---|
| No auth. Connecting to a path joined it. | JWT bearer auth. Register / login / `GET /auth/me`. |
| A room was any string you typed. | A document is a UUID row with an owner and a role table. Access is resolved server-side. |
| Stock `y-websocket` protocol at `ws://…/ws/{room}` | **Custom binary envelope** at `ws://…/ws/documents/{uuid}?token=…` |
| In-memory only; server restart emptied every room. | Debounced Postgres persistence, rehydration on room open. |

The spike still exists, mounted at **`/ws-spike`**, kept only as a fallback reference. Nothing
points at it and the backend's `CLAUDE.md` lists deleting it as available cleanup. **Do not aim
this client at it.**

### 1.2 Purpose

Turn the two-pane demo into a real desktop application: log in, see the documents you have access
to, open one, and edit it collaboratively with everyone else who has access — with remote cursors,
correct read-only enforcement for viewers, and graceful handling of an owner cutting you off
mid-session.

The editing surface stays what it is: CodeMirror 6 driven by `y-codemirror.next`, not a
`<textarea>`.

### 1.3 Non-goals

- **No backend changes.** Every capability below is reachable with the server exactly as it stands.
  If something appears to need a server change, re-read §3 — it does not. (The one place this is a
  near-miss is CORS; §4.1 explains how the architecture avoids it.)
- **No file tree, no multi-file projects, no local file open/save.** One document per editor
  session, chosen from the server's list.
- **No offline editing.** The CRDT would make it possible; queueing, conflict surfacing and
  reconnect-merge UX would not fit in v1.
- **No installers, packaging, or auto-update.** `npm run dev` remains the target experience.
- **No token refresh flow.** The backend has no refresh endpoint (§3.5). §7.5 defines what happens
  instead, and it is deliberately not a silent re-auth.

---

## 2. Migration ledger

This repository already contains working code. Most of the editor is worth keeping; everything
about transport and identity is not. Read this section before touching a file.

### 2.1 Keep unchanged

| File | Why it survives |
|---|---|
| `components/CodeMirrorSurface.tsx` | The `Compartment`-based language swap, the "reconfigure, never rebuild the `EditorView`" rule, the `updateListener` for Ln/Col, and the "don't drive content from React state" discipline are all protocol-independent. Only additions (§7.4 read-only compartment). |
| `components/editorTheme.ts`, `components/languages.ts`, `components/LanguagePicker.tsx` | Pure view concerns. Language stays **per-window state, not in the `Y.Doc`** — it is view state like scroll position, and the shared root is text only. |
| `electron.vite.config.ts` → `resolve.dedupe` | **Still critical, for the same reason.** `y-codemirror.next` declares `@codemirror/state` and `@codemirror/view` as *peer* deps while the `codemirror` meta package brings its own. Two copies means two `Facet` identities: `ySyncFacet` resolves to nothing, `yCollab` silently never attaches, and you get a normal-looking editor that does not sync. Keep all three entries — `['yjs', '@codemirror/state', '@codemirror/view']`. Do not trim. |
| Tailwind v4 setup | `@import "tailwindcss"` + `@theme`, `@tailwindcss/vite` plugin, no `tailwind.config.js`. |

### 2.2 Rewrite

| File | Change |
|---|---|
| `collab/useCollab.ts` | Drop `WebsocketProvider`. Build on `EnvelopeProvider` (§5). Keyed by `documentId`, not room name. Surfaces role, control-message events and close reasons upward. |
| `collab/constants.ts` | `SERVER_URL` splits into an API base and a WS base derived from it. `PANE_COLORS` becomes a deterministic per-user color (§6.2). `normalizeRoom()` is deleted with `RoomSwitcher`. |
| `main/index.ts` | One window, not two. No stagger (§2.4). Add the REST + session IPC handlers (§4.2) — or better, put them in `main/api.ts` and `main/session.ts` and keep `index.ts` about windows. |
| `App.tsx` | Becomes the screen router (§7). Stops reading `?pane=`. |
| `components/PaneHeader.tsx`, `components/StatusBar.tsx` | Document title + role badge instead of pane name; peers, Ln/Col, `synced` + `status` as before. |
| `preload/index.ts`, `preload/index.d.ts` | Currently an empty `api = {}`. Becomes the typed bridge (§4.2). |
| `renderer/index.html` CSP | `connect-src` keeps the `ws://` origin and the Vite HMR origin. It must **not** gain an `http://` API origin — see §4.1. |

### 2.3 Delete

- `components/RoomSwitcher.tsx` and `normalizeRoom()` — documents are chosen from a server list, so
  free-text room names and their `'belge-1 '` → `%20` trap are gone with them.
- The `y-websocket` dependency. **`y-protocols` stays** — §6 uses its awareness encoding.

### 2.4 Constraints from `SPEC.md` that are now obsolete

Each of these was a real, correctly-diagnosed workaround for the spike. Retiring them is not
loosening discipline; keeping them would be cargo cult. Recorded here so nobody reintroduces them
from the old document.

- **The 1000 ms second-window stagger is obsolete.** That room-creation race belonged to
  `pycrdt-websocket`. The backend owns its room manager now and create-or-gets under an
  `asyncio.Lock` — verified with 50 concurrent joins landing in one room. Simultaneous connects are
  fine.
- **`disableBc: true` is obsolete.** It was a `y-websocket` option. With no `WebsocketProvider`
  there is no `BroadcastChannel` and nothing to disable. The *test* it protected still matters and
  survives as §9.5 — two app instances must genuinely stop syncing when the server dies.
- **The full-path room key (`/ws/belge-1`) and the trailing-slash trap are obsolete.** The endpoint
  is a real FastAPI route with a path parameter; Starlette's `Mount` is not in the picture.
- **`GET /` is no longer forbidden to the renderer for the reason stated** — but it stays forbidden,
  because REST does not live in the renderer at all now (§4.1).

What is **not** obsolete: the byte-offset warning. `editor.py`'s UTF-8 arithmetic is a pycrdt
binding artifact — `len(Text)` counts bytes there. JS `Y.Text` indices are ordinary UTF-16 code
units. Do not port `imleci_tasi`, `_karakter_indeksi` or `_bayt_ofseti`; `yCollab` owns cursor
transformation.

---

## 3. Server contract

Verified against the installed code, not against the backend's `SPEC.md` — the REST surface has
grown two endpoints and two response fields beyond what §7 there lists.

Base URL `http://localhost:8000`. Auth is `Authorization: Bearer <jwt>` on every route except
`/auth/register`, `/auth/login` and `GET /`. **Exception: the WebSocket takes its token in the
query string** (§3.3).

Routes are registered with **no trailing slash** (`prefix="/documents"` + path `""`). Starlette's
`redirect_slashes` is on, so `/documents/` yields a 307. Send the exact path.

### 3.1 Types

```ts
type Role = 'owner' | 'editor' | 'viewer'      // effective role, from resolve_role
type GrantableRole = 'editor' | 'viewer'       // what you may SEND; 'owner' is documents.owner_id

type User = { id: string; email: string; created_at: string }
type Document = {
  id: string; owner_id: string; title: string; language: string
  created_at: string; updated_at: string
}
type DocumentListItem = Document & { role: Role }
type Collaborator = {
  document_id: string; user_id: string; email: string
  role: GrantableRole; granted_by: string; granted_at: string
}
```

UUIDs are canonical lowercase hyphenated strings; timestamps are ISO-8601 with offset (every column
is `DateTime(timezone=True)`).

**`Document` has no content field, and there is no endpoint that returns one.** Content arrives
only through the WebSocket `sync` exchange. One path for state, one source of truth.

### 3.2 REST endpoints

13 endpoints — 12 product routes plus a health check. Error bodies are always
`{"detail": "<string>"}` for `HTTPException`s, or FastAPI's validation array on 422.

**Auth**

| Route | Body | Success | Errors |
|---|---|---|---|
| `POST /auth/register` | `{email, password}` (password ≥ 8) | **201** `User` | **409** `"Bu e-posta adresi zaten kayıtlı."` · 422 |
| `POST /auth/login` | `{email, password}` | **200** `{access_token, token_type:"bearer"}` | **401** `"E-posta veya parola hatalı."` · 422 |
| `GET /auth/me` | — | **200** `User` | 401 |

Register does **not** return a token — chain register → login (§7.1). The 401 on login is
identical for unknown email and wrong password (the server even hashes against a dummy to equalize
timing); that is deliberate anti-enumeration, not something to improve on.

**Documents**

| Route | Body | Success | Errors |
|---|---|---|---|
| `GET /documents` | — | **200** `DocumentListItem[]`, **`updated_at DESC`** | 401 |
| `POST /documents` | `{title, language?}` | **201** `Document` | 401 · 422 |
| `GET /documents/{id}` | — | **200** `Document` | **404** `"Doküman bulunamadı."` |
| `PATCH /documents/{id}` | `{title?, language?}` | **200** `Document` | 404 · **403** `"Sadece sahip düzenleyebilir."` |
| `DELETE /documents/{id}` | — | **204** | 404 · **403** `"Sadece sahip silebilir."` |

`language` omitted on create yields the DB default `"plaintext"`. `PATCH` applies only non-null
fields; `{}` is a legal no-op.

**`role` on `GET /documents` items is the only place REST distinguishes editor from viewer for a
non-owner.** `GET .../roles` is owner-only, and the JWT carries no role. This field is therefore
the sole input to the read-only decision in §7.4.

**Roles** — all four run an ownership check first, which raises **404** `"Doküman bulunamadı."` if
you have no access at all, or **403** `"Sadece sahip işbirlikçileri yönetebilir."` if you have
access but are not the owner.

| Route | Body | Success | Extra errors |
|---|---|---|---|
| `GET /documents/{id}/roles` | — | **200** `Collaborator[]`, ordered by email | — |
| `PUT /documents/{id}/roles/{user_id}` | `{role}` | **200** `Collaborator` | **404** `"Kullanıcı bulunamadı."` · **400** `"Sahip kendi dokümanında rol alamaz."` |
| `PUT /documents/{id}/roles` | `{email, role}` | **200** `Collaborator` | **404** `"Bu e-posta ile kayıtlı kullanıcı yok."` · **400** same as above |
| `DELETE /documents/{id}/roles/{user_id}` | — | **204** | **404** `"Bu kullanıcının erişimi zaten yok."` |

**Grant is by email, revoke is by `user_id`.** The client has no user UUIDs to grant with, so use
the email route; get `user_id` for revocation from the collaborator listing. The owner never
appears in that listing (ownership is `documents.owner_id`, not a role row).

The email-grant route is a deliberate **email-existence oracle** for document owners — the owner
must be told they mistyped. Surface the server's wording plainly; do not invent softer copy that
obscures what happened.

**Health** — `GET /` → `{"status":"ok","service":"collab-ide-server"}`. Unauthenticated. Not used
by the renderer (§4.1).

**Two REST calls have WebSocket side effects**, and the UI must expect them:
`DELETE /documents/{id}` pushes `permission_revoked` and closes **every** socket on that document
with 4410 before returning 204. `DELETE /documents/{id}/roles/{user_id}` does the same for that one
user's sockets. Both happen after the DB commit, so a fast reconnect cannot slip back in.

### 3.3 WebSocket

```
ws://localhost:8000/ws/documents/{document_id}?token=<jwt>
```

Build it with `new URL()` + `searchParams.set('token', …)`. **Never log this URL** — the token is
in it. (The backend installs a log filter for its own access lines for exactly this reason.)

**The server accepts the handshake before validating anything.** `websocket.accept()` runs
unconditionally, then the token, the UUID parse and the role lookup are checked and the socket is
closed with a 44xx code. Closing before `accept()` would surface as a plain HTTP 403 and the close
codes would be unobservable. **Consequence: every rejection arrives as `onclose` *after* a
successful `onopen`.** A "connected" event means nothing on its own.

Connect sequence:

1. `accept()`.
2. Token → user, else close **4401**.
3. `document_id` parsed as UUID, else close **4404**.
4. `resolve_role` → role, else close **4404**.
5. Server joins/creates the room and **waits for rehydration from Postgres**. The client may sit
   here with zero frames received; that wait is what stops the first state vector being computed
   from an empty document.
6. Server sends exactly one frame: **binary `0x00` + its state vector**. No JSON hello, no ack.
7. Message loop.

### 3.4 The envelope

```
BINARY   [0x00] + state vector    sync
         [0x01] + yjs update      update
         [0x02] + awareness       awareness

TEXT     {"type":"error","code":"…","message":"…"}
         {"type":"permission_revoked","document_id":"…"}
```

One leading type byte, no length prefix, no version byte, **no base64**. The byte exists so the
server can decide whether the sender may write by looking at one byte, before parsing any
attacker-controlled payload.

**Text frames are server→client only.** The server answers any inbound text with
`error/text_not_supported`. Set `ws.binaryType = 'arraybuffer'` and branch on
`typeof ev.data === 'string'` for control messages.

**The handshake rule is symmetric, and both halves are mandatory:**

```
on connect:   S -> C   [0x00] + server state vector
              C -> S   [0x01] + encodeStateAsUpdate(doc, serverSV)   # push what S lacks
              C -> S   [0x00] + encodeStateVector(doc)               # pull what C lacks
              S -> C   [0x01] + diff
```

Read it as one rule applied by both ends: **receive `0x00` → reply `0x01 + update(their sv)`.**
Implement only the pull and your local content never reaches the server. `0x00` is a
**request/response and is never broadcast**, so the client sees it exactly once per connection.

Server behaviour per inbound type:

| Type | Server does |
|---|---|
| `0x00` | computes the diff and replies `0x01` **to the requester only**. Allowed for viewers. |
| `0x01` | **rejects with `error/forbidden` if the sender is a viewer**, else applies to the room doc, marks it dirty for persistence, and relays the **raw original frame** to every *other* connection. Never echoed to the sender. |
| `0x02` | no validation, no doc mutation, no dirty flag — relayed raw to all others. **Allowed for viewers**, per SPEC §6: viewers do participate in presence. |

Malformed payloads produce an error frame, not a disconnect: the server wraps every
`apply_update`/`get_update` call, so a hostile peer cannot take down a room.

**`error` codes, and none of them close the socket:**

| Code | Meaning for the UI |
|---|---|
| `forbidden` | you sent `0x01` as a viewer — **the only signal that a demotion happened** (§7.4) |
| `bad_update` | the server could not decode your update; it was **not** applied or relayed |
| `bad_state_vector` | your `0x00` payload was not a state vector |
| `unknown_type` | first byte outside `{0,1,2}` — a client bug |
| `empty_frame` | zero-length binary frame — a client bug |
| `text_not_supported` | you sent a text frame — a client bug |

**Close codes:**

| Code | Reason string | When |
|---|---|---|
| **4401** | `Geçersiz veya eksik token.` | token missing, malformed, expired, bad signature, or its user row is gone |
| **4404** | `Doküman bulunamadı.` | document does not exist **or** you have no access — deliberately merged |
| **4410** | `Erişim iptal edildi.` | revoked mid-session; **always preceded by** the `permission_revoked` text frame |
| 1000 / 1001 | — | normal close |

**4403 is never sent.** The backend deliberately deviates from its own SPEC §7 table, because
distinguishing "forbidden" from "not found" tells any token holder which document IDs exist. Do not
write a 4403 branch. There is likewise **no close code for demotion** — editor→viewer keeps the
socket open by design.

### 3.5 Tokens

`HS256`, three claims: `sub` (user UUID as string), `iat`, `exp`. **No role, no email** — identity
comes from `GET /auth/me`, never from the token. Lifetime is `JWT_EXPIRE_MINUTES`, default **30
minutes**. There is **no refresh endpoint and no refresh token**; on expiry you re-login.

Reading `exp` client-side without verifying the signature is fine for "is this worth trying" and is
never authorization (§4.3).

### 3.6 pycrdt ↔ Yjs

The backend is content-agnostic — it never declares a root type and applies updates to a bare
`Doc`. But the terminal client uses `doc.get("content", type=Text)`, so for three-way interop
(§9.4) the root name must match exactly:

```ts
const ytext = ydoc.getText('content')
```

| pycrdt | Yjs |
|---|---|
| `doc.get_state()` | `Y.encodeStateVector(doc)` |
| `doc.get_update(sv)` | `Y.encodeStateAsUpdate(doc, sv)` |
| `doc.get_update()` | `Y.encodeStateAsUpdate(doc)` |
| `doc.apply_update(u)` | `Y.applyUpdate(doc, u, origin)` |

The first two are **different objects** and swapping them fails silently: a state vector is ~10
bytes and `applyUpdate` on one throws, while sending an update where a vector is expected produces
`bad_state_vector`. The backend lost real time to this; its measured note is that persisting the
vector instead of the update made every document come back empty and read as "rehydration is
broken."

### 3.7 Running the server

```bash
cd ../server
export DATABASE_URL="postgresql+psycopg://dev:dev@localhost:15432/editor"
export JWT_SECRET="dev-secret-not-for-prod"
docker compose up -d db && uv run alembic upgrade head
uv run uvicorn main:app --port 8000        # NEVER --reload
```

`--reload` restarts uvicorn on every `.py` save, wiping in-memory rooms and dropping every socket.
Connected clients stay alive and silently stop updating — indistinguishable from a client sync bug.

Host Postgres port is **15432**, not 5432 (this machine runs native servers on 5432/5433 bound to
loopback). Port 8000 has been observed occupied by unrelated processes; check with
`lsof -nP -iTCP:8000 -sTCP:LISTEN` before assuming a stale server of your own.

Also worth knowing, because it wastes an hour when it happens: **a stale `backend` container on
:8000 looks exactly like a client bug.** Register and login succeed (those endpoints are old), then
`/auth/me` returns `{"detail":"Not Found"}`. `curl -o /dev/null -w '%{http_code}'
localhost:8000/auth/me` → **401 means current, 404 means stale**. §4.3 ports the diagnostic.

---

## 4. Architecture

```
main process                             renderer
────────────                             ────────
REST client (node fetch)                 Y.Doc            ← one per open document
session store (safeStorage)              EnvelopeProvider ← WebSocket
      │                                  Awareness
      │  typed IPC bridge                yCollab + CodeMirror
      └──────────────────────────────▶   React screens
```

### 4.1 Why REST lives in the main process

The backend installs **no `CORSMiddleware`**. The renderer is a Chromium browser context, so a
renderer `fetch('http://localhost:8000/…')` is a cross-origin request and would be blocked outright
— and the fix would be a server change, which §1.3 rules out. Doing REST in the main process side-
steps the question entirely: Node's `fetch` is not subject to CORS.

WebSocket upgrades are **not** subject to CORS, so the socket can stay in the renderer where the
`Y.Doc` and CodeMirror live. That avoids shuttling every CRDT frame across IPC.

The observable consequence, and a useful invariant: `connect-src` in the renderer CSP needs the
`ws://` origin but **not** the `http://` one. If an `http://localhost:8000` ever appears there, REST
has leaked into the renderer.

### 4.2 IPC surface

Add each channel with the **`ipc-channel` skill** so the main handler, preload bridge, `.d.ts` types
and renderer wrapper stay in sync.

```
auth:register(email, password)          → User
auth:login(email, password)             → User          (stores the token in main)
auth:me()                               → User | null   (validates the cached session)
auth:logout()                           → void
auth:wsToken(documentId)                → string        (token, for building the ws:// URL)

documents:list()                        → DocumentListItem[]
documents:create({title, language?})    → Document
documents:update(id, {title?, language?})→ Document
documents:delete(id)                    → void

roles:list(documentId)                  → Collaborator[]
roles:grantByEmail(documentId, {email, role}) → Collaborator
roles:revoke(documentId, userId)        → void
```

Plus one main→renderer broadcast: **`session:invalidated`**, emitted whenever main sees a 401. The
renderer treats it identically to a WS 4401 (§7.5).

`auth:wsToken` is the one place the token crosses into the renderer, and only because the token has
to be in the socket URL. Keep it a narrow, per-document call rather than a general "give me the
token" getter, so the reason it exists stays legible.

**Errors must survive IPC.** Electron structured-clones values; `Error` subclasses do not come
through as themselves. So main returns a discriminated result and the renderer wrapper re-throws:

```ts
// Türü ALAN olarak taşıyoruz, sınıf hiyerarşisi olarak DEĞİL.
// Python istemcisindeki YetkiHatasi(ApiHatasi) kalıbı her çağrı yerini
// sıraya duyarlı yapıyor: `except ApiHatasi` önce yazılırsa 401 dalı hiç
// çalışmıyor. Ayrık bir alanla bu hatayı yapmak mümkün değil.
type ApiErrorKind = 'auth' | 'validation' | 'server' | 'network'
type ApiFailure = { ok: false; kind: ApiErrorKind; message: string; status?: number }
type ApiSuccess<T> = { ok: true; value: T }
```

### 4.3 Session storage in main

Store `{ baseUrl, accessToken, email, expiresAt }` under `app.getPath('userData')`, encrypted with
`safeStorage.encryptString()` — a plaintext JWT on disk is readable by any process running as the
user, and Electron has no equivalent of the `os.open(…, 0o600)` trick the Python client uses.

Four rules, all ported from `terminal_script/api.py` where each fixed a real failure:

1. **`baseUrl` is part of the cache key.** A token minted by a different server has a different
   signature; reject it up front instead of eating a confusing 401.
2. **A 10-second expiry margin.** A token valid at check time but dead by the time the socket opens
   comes back as a 4401, which reads as a bug rather than an expiry.
3. **A corrupt or unreadable session file falls back to login, silently.** Bricking the app over a
   half-written file is a far worse outcome than asking for a password once more.
4. **Never trust the cache — validate with `GET /auth/me`.** Three outcomes, and conflating the
   first two is the easy mistake: **401** → wipe the session, show login; **any other API error** →
   surface it (the server is broken; do not pretend the user is logged out); **success** → that
   response is the identity source of truth.

Reading `exp` is an unverified base64url peek, used only to skip a token not worth trying. The
client holds no `JWT_SECRET` and must never behave as if it does.

**Never hardcode copy for a 401.** `POST /auth/login` returns 401 for bad credentials; every other
route returns 401 for a dead token. Surface the server's `detail`. A single fixed "your session
expired" told users who simply mistyped a password about a session they never had.

**Port the stale-backend diagnostic.** A 404 whose `detail` is the literal English `"Not Found"` is
FastAPI's unmatched-route default — every real 404 here has a Turkish message. Translate that case
into a message naming the likely cause (an old server or Docker image on :8000) instead of
displaying a bare "Not Found" that diagnoses nothing.

### 4.4 Windows

One `BrowserWindow`. Keep the existing deviations from the electron-vite template: quit on
`window-all-closed` on every platform including darwin, and either delete the `activate` handler or
have it recreate the single window properly. Drop the `?pane=` query parameter and the stagger.

Renderer security stays at Electron defaults — `contextIsolation: true`, `nodeIntegration: false`.
The renderer needs no Node access: `WebSocket` is a Chromium API and everything privileged is behind
the IPC bridge.

For side-by-side manual testing, launch the app twice (two processes, two session files if you point
`userData` elsewhere) rather than reintroducing two windows in one process. §9 assumes that.

---

## 5. `EnvelopeProvider`

Nothing off the shelf speaks this envelope, so this class is the one genuinely new piece of
infrastructure. Put it in `collab/EnvelopeProvider.ts` and keep it framework-free — no React
imports; `useCollab` adapts it.

### 5.1 Contract

```ts
type ProviderStatus = 'connecting' | 'connected' | 'disconnected'

type Terminal =
  | { kind: 'revoked' }         // 4410 — sahibi erişimi geri aldı
  | { kind: 'unauthorized' }    // 4401 — token öldü
  | { kind: 'notFound' }        // 4404 — doküman yok VEYA erişim yok
  | { kind: 'closed' }          // 1000/1001 — normal kapanış

class EnvelopeProvider {
  constructor(opts: {
    wsUrl: URL              // token dahil; ASLA loglanmaz
    doc: Y.Doc
    awareness: Awareness
  })

  readonly status: ProviderStatus
  readonly synced: boolean

  on(e: 'status',   cb: (s: ProviderStatus) => void): void
  on(e: 'synced',   cb: (v: boolean) => void): void
  on(e: 'error',    cb: (m: { code: string; message: string }) => void): void
  on(e: 'terminal', cb: (t: Terminal) => void): void

  destroy(): void
}
```

### 5.2 Framing

```ts
const SYNC = 0x00, UPDATE = 0x01, AWARENESS = 0x02

function frame(type: number, payload: Uint8Array): Uint8Array {
  const out = new Uint8Array(payload.length + 1)
  out[0] = type
  out.set(payload, 1)
  return out
}
```

Inbound: `const view = new Uint8Array(ev.data); const type = view[0], body = view.subarray(1)`.
Guard the empty frame before indexing.

### 5.3 Message handling

```ts
ws.binaryType = 'arraybuffer'

// Bağlanınca kendi eksiğimizi ÇEKİYORUZ. Karşı taraf da aynı anda kendi
// state vector'ünü yolluyor; iki uç simetrik davranıyor.
ws.onopen = () => send(frame(SYNC, Y.encodeStateVector(doc)))

// SYNC geldi: "elimde bu var" demiş. Eksiğini hesaplayıp İTİYORUZ.
// Bu yarısı olmadan yerel içerik sunucuya HİÇ ulaşmaz.
case SYNC:  send(frame(UPDATE, Y.encodeStateAsUpdate(doc, body))); break

case UPDATE: Y.applyUpdate(doc, body, this); markSynced(); break

case AWARENESS: applyAwarenessUpdate(awareness, body, this); break
```

**Echo suppression is `origin`, not a flag:**

```ts
doc.on('update', (update, origin) => {
  if (origin === this) return          // uzaktan gelen; geri yollamıyoruz
  send(frame(UPDATE, update))
})
```

The terminal client's module-level `_uzaktan_uyguluyor` boolean exists **only** because pycrdt's
doc-level `origin` is a *method* returning a *hash* of the origin rather than the origin itself, so
`event.transaction.origin == "yerel"` is silently always false there. Yjs has no such defect and
`origin` identity comparison is reentrancy-safe. **Do not port the flag.**

There is also no need for the Python client's outbound `asyncio.Queue`: it exists because pycrdt's
observer is a synchronous callback that cannot `await ws.send`. `ws.send()` is buffered and
ordering is guaranteed by the socket.

### 5.4 `synced`

`status` and `synced` are **different facts** and must not be conflated — a socket can be open while
the document is unsynced. Render both (§7.4).

The server always answers a `0x00` with a `0x01` (an empty Yjs diff is still a non-empty payload),
so **the first inbound `0x01` after we sent our `0x00`** is a sound marker for "initial sync done".

Accepted imprecision, recorded so it is not mistaken for a bug: the envelope has no distinct
`SYNC_STEP2` type, so a peer's relayed edit arriving before the sync reply would flip `synced` a
beat early. Harmless — it only ever fires early, never late, and only when another peer is actively
typing at the moment you join.

### 5.5 Close handling and reconnect

**Treat `onclose(code)` as a first-class state transition, not an error path.** This is the shape of
the Python client's hardest bug: a server-initiated 4410 raised inside the receiver *task* and never
reached the main coroutine, which sat waiting on the user-quit event — the editor froze silently
with the terminal stuck in cbreak mode. The TS analogue is an editor that stays live and editable
after the server has cut you off.

```ts
// Kodlar karar veriyor. 44xx'ler NİHAİ: yeniden bağlanmak ya boşuna
// (4401/4404) ya da sahibinin kararını görmezden gelmek (4410) olurdu.
const TERMINAL = new Set([4401, 4404, 4410])
```

- Reconnect with exponential backoff (~500 ms → 15 s cap, jittered) on 1006 / 1001 / 1011 and
  network failures.
- **Never** reconnect on 4401 / 4404 / 4410. Emit `terminal` and stop; each routes somewhere
  different (§7.5).
- **Keep the `Y.Doc` alive across a transient disconnect.** Same document, so the handshake simply
  re-pushes local edits on reconnect and nothing is lost. This is safe precisely *because* the
  document identity has not changed — contrast §8.
- Re-run the full handshake on every reconnect, and re-announce awareness (§6.3).
- `destroy()`: remove listeners, then close the socket, then clear awareness. Do not destroy the
  `Y.Doc` here — its lifetime belongs to whoever created it (§8).

---

## 6. Awareness — presence and remote cursors

The `0x02` channel is **fully live on the server and used by no client today.** The terminal client
declares `AWARENESS = 0x02` and never references it again; an inbound `0x02` there is silently
dropped. The server relays it, and explicitly permits it for viewers per SPEC §6 ("Viewers do
participate in awareness"). So this is greenfield work that needs **no backend change**.

### 6.1 Encoding

The payload is entirely opaque to the server — there is no encode/decode helper on that side and no
validation. The client defines it, and the natural choice follows from the CRDT: standard
`y-protocols/awareness`.

```ts
import { Awareness, encodeAwarenessUpdate, applyAwarenessUpdate } from 'y-protocols/awareness'

awareness.on('update', ({ added, updated, removed }, origin) => {
  if (origin === this) return                       // uzaktan geldi
  const changed = [...added, ...updated, ...removed]
  send(frame(AWARENESS, encodeAwarenessUpdate(awareness, changed)))
})
```

### 6.2 The local state shape

`y-codemirror.next` renders remote carets from a specific field — use exactly this:

```ts
awareness.setLocalStateField('user', {
  name: user.email,
  color: renkUret(user.id),        // UUID'den türetilmiş, herkes aynı rengi çizsin
  colorLight: renkUret(user.id) + '33',
})
awareness.setLocalStateField('userId', user.id)
```

Two decisions worth stating:

- **Derive the color deterministically from the user's UUID** (hash → fixed palette), not from a
  per-window constant. Every peer must paint the same person the same color.
- **Carry the stable `userId` from `/auth/me` in the payload.** Yjs `clientID` is per-`Y.Doc`, so a
  reconnect or a document switch mints a new one. Without a stable id the UI cannot dedupe a peer
  across reconnects or label them correctly.

### 6.3 The two things the server does not do

- **No presence replay on join.** The server holds no awareness state and does not implement
  `queryAwareness`. A client joining an existing room sees nobody until each existing peer next
  broadcasts — `y-protocols`' own timer does that roughly every 15 s. The current `useCollab`
  already fixed this and its comment records the measurement: the second window saw the first
  immediately, but the first did not see the second for up to 15 seconds. **Keep the periodic
  re-announce (5 s).** What it sends is a standard awareness update; nothing server-side changes.
- **No "peer left" signal.** An unclean disconnect leaves a ghost until `y-protocols`' ~30 s
  outdated-state timeout clears it. Not a bug; do not build a workaround.

### 6.4 Rate and trust

- **Throttle cursor awareness to ~50–100 ms.** It otherwise fires on every keystroke and mouse move,
  and there is **no rate limiting anywhere in the backend**. Note the asymmetry this creates: `0x02`
  is the one channel a viewer may write to freely.
- **Peer count means *remote* peers.** `awareness.getStates()` includes the local client; subtract it
  or a lone window proudly reports "1 peer".
- **The server validates nothing here.** A peer can claim any name, color or `userId`. Display it,
  but do not build any authorization or identity assertion on it — the trustworthy role signal is
  the server's own enforcement.

---

## 7. Screens

Four screens, routed by a plain `useState` discriminated union in `App.tsx`. No router library for
four states.

```ts
type Screen =
  | { name: 'login' }
  | { name: 'documents' }
  | { name: 'share'; doc: DocumentListItem }
  | { name: 'editor'; doc: DocumentListItem }
```

### 7.1 Login / Register

One screen, two modes. Register does not return a token, so **chain register → login**.

- **Announce registration success before auto-logging-in.** Silently proceeding left users unsure
  whether the account had been created at all.
- **A login that succeeds but whose `/auth/me` fails is not a login failure.** Report what actually
  happened.
- Surface the server's `detail` verbatim for 401 and for the 409 on a duplicate email.

### 7.2 Document list

`GET /documents`, already ordered `updated_at DESC` — do not re-sort. Each row: title, language,
`updated_at`, and a **role badge** (`owner` / `editor` / `viewer`).

Actions: create (title + language); rename and delete **for owners only**; open; and share for
owners only.

**Hide owner-only actions rather than letting them fail.** The server enforces with 403 — that is
the guarantee. The client's job is to not offer a user something they cannot do. Server enforces,
client declutters.

Deleting a document kicks every connected client with 4410 (§3.2). Confirm destructively.

### 7.3 Share / collaborators (owner only)

- Grant by email (`PUT /documents/{id}/roles` with `{email, role}`), role from a two-value select.
- Collaborator list from `GET /documents/{id}/roles` — **show emails, not UUIDs.** That field exists
  in the response for exactly this reason.
- Revoke via `DELETE /documents/{id}/roles/{user_id}`, using `user_id` from the listing.
- The owner is not in the listing; render them separately from `doc.owner_id` if you show them.
- Surface `"Bu e-posta ile kayıtlı kullanıcı yok."` as-is (§3.2).

### 7.4 Editor

`PaneHeader`: document title, role badge, `LanguagePicker`, connection dot.
`StatusBar`: remote peer count, Ln/Col, and `synced` — **as a separate indicator from the connection
dot**, since a socket can be open while the document is unsynced.

**Viewer read-only** through a second CodeMirror `Compartment`:

```ts
const readOnly = new Compartment()
// extensions: readOnly.of(EditorState.readOnly.of(rol === 'viewer'))
view.dispatch({ effects: readOnly.reconfigure(EditorState.readOnly.of(true)) })
```

Reconfigure it; never rebuild the `EditorView` (rebuilding detaches `yCollab`, re-seeds the buffer
and drops every remote caret — a visible glitch for what should be a repaint).

Initial value comes from the `role` field on the list item (§3.2).

**Demotion has no push, and this is the only place the client can notice it.** editor→viewer keeps
the socket open deliberately — the user still has read access, so `permission_revoked` would be a
lie — and the server updates the role cached on the live connection in place. The *only*
client-visible signal is the next `0x01` coming back as `error/forbidden`. So on `forbidden`: flip
the read-only compartment, tell the user their access changed, and refetch `GET /documents` to
confirm. It is not merely a toast.

The client-side read-only is **decluttering, not enforcement.** Enforcement is the server's, on
every inbound message; any modified client can emit valid updates.

Back-to-list destroys the session (§8).

### 7.5 Session and access loss — one path each

| Signal | Response |
|---|---|
| `error/forbidden` | read-only + refetch role (§7.4). Socket stays open. |
| `error/bad_update` | your update was dropped, not applied. Resync: send `0x00 + encodeStateVector(doc)`. |
| `permission_revoked` then 4410 | modal naming the cause, return to the list, **do not reconnect**. Not a crash — a deliberate act by the owner and a normal product event. |
| 4404 on connect | the document is gone or your access is. Return to the list and refresh it. |
| **REST 401 or WS 4401** | one shared path — see below. |

**REST 401 and WS 4401 converge.** Wipe the cached session, show login, and — the part worth being
explicit about — **keep the `Y.Doc` in memory.** The CRDT lives in the client, so after re-login the
socket reopens on the same document and the handshake pushes the local edits that were made while
the token was dead. Nothing is lost.

That is this client's answer to the still-open token-refresh question in the backend's SPEC §11,
given a 30-minute token and no refresh endpoint: **no silent re-auth, no dropped work.** As a
smaller mitigation, if the cached token has less than a minute left, re-login *before* opening a
socket rather than opening one that will die immediately.

---

## 8. The trap that corrupts data

Everything else in this document misbehaves. This one destroys other people's work.

> **One `Y.Doc` per document. Created when the document is opened, `destroy()`ed when it is closed.
> Never shared across two document IDs.**

Reusing a `Y.Doc` for document B after document A is not a display bug. On connect the client
answers the server's `0x00` with `0x01 + encodeStateAsUpdate(doc, sv)`, and **that diff carries
everything the local doc holds** — so A's text is written into B, relayed to everyone editing B, and
**persisted there** by the server's debounce writer. The backend has no way to detect it; from its
point of view a client legitimately pushed content.

The Python client hit this exactly and its fix note is worth quoting: recreating the `Doc` (rather
than unobserving) drops observers and content in one move. The existing `useCollab` already gets
this right for rooms — the rule is unchanged, only the key becomes `documentId`.

The safe case, so the rule is not over-applied: **reusing the doc across a *reconnect to the same
document* is correct and required** (§5.5). Document identity is what matters, not socket identity.

Structurally, make it impossible: create the `Y.Doc` inside the effect keyed on `documentId` and
destroy it in that effect's cleanup, exactly as `useCollab` does today. Never hold a module-level
doc, never cache docs by anything but document id.

### Other traps

- **`ws.binaryType = 'arraybuffer'`** or you get `Blob`s and have to `await .arrayBuffer()`.
- **Answer the server's `0x00`.** Only pulling means your content never reaches the server (§3.4).
- **`encodeStateVector` vs `encodeStateAsUpdate`** — swapping them silently empties documents (§3.6).
- **Dedupe `yjs`, `@codemirror/state`, `@codemirror/view`** or `yCollab` silently never attaches
  (§2.1).
- **Root name must be exactly `'content'`** for interop with the terminal client (§3.6).
- **Do not port the byte-offset math** from `editor.py` (§2.4).
- **Peer count must subtract the local client** (§6.4).
- **Never log the WS URL** (§3.3).

---

## 9. Verification

There is no test suite on either side; verification is manual. Run the server per §3.7, **without
`--reload`**. `../server/terminal_script/bootstrap.py` creates two users, a document and a role, and
prints the exports — use it rather than assembling accounts by hand.

Each criterion names the failure it catches.

1. **Auth round-trip.** Register → announced → auto-login → document list. Quit and relaunch: must
   not ask again. Then corrupt the session file by hand: must fall back to login, not crash. Then
   point the app at a different `baseUrl`: the cached token must be rejected up front, not produce a
   confusing 401. *(Catches: cache trusted blindly; corrupt file bricking the app.)*
2. **Roles are honest.** Open the same document as owner, editor and viewer from three accounts.
   Correct badge each time; the viewer's editor is read-only and offers no share action; a
   non-collaborator's `GET /documents` does not list it at all. *(Catches: the SQL role expression in
   `_dokuman_listesi_sorgusu` drifting from `resolve_role` — the backend flags this as its own
   deliberate duplication.)*
3. **Convergence.** Two app instances, two accounts, one document. Type in both simultaneously.
   Include Turkish characters (`ı ğ ş ö ü ÇĞİÖŞÜ`) and an emoji, with the cursor placed
   mid-string, and backspace over both. Expect no corruption and **no `PanicException: Couldn't
   remove 1 elements` in the server log.** *(Catches: byte/UTF-16 confusion.)*
4. **Three-way interop with the terminal client.** With both app instances connected, run
   `uv run python terminal_script/write.py` against the same document. Text must flow all three
   ways. The terminal peer contributes **no presence** — it never sends `0x02` — so remote peer
   count stays 1 per app instance, and that is correct. **This criterion is the real proof the
   envelope is right; if it fails, nothing else on this list means anything.**
5. **Honesty check.** Stop the server. Both instances must go `disconnected` and stop seeing each
   other's edits. Restart it: they reconnect on their own and content returns (the CRDT is in the
   clients; the rehydrated room merges with whatever they push). *(The old `disableBc` test,
   reframed — if two instances keep syncing with the server down, something is talking locally.)*
6. **Revocation.** With two clients connected, the owner revokes the editor. The revoked instance
   must receive `permission_revoked`, show the modal and land on the document list; the other must be
   completely untouched; a reconnect attempt must get 4404. Then delete a document with two clients
   in it: **both** get kicked. *(Catches: reconnecting on a terminal code; kicking the wrong socket.)*
7. **Demotion.** Owner sets editor→viewer via the share screen. Expect **no** modal and **no**
   disconnect — the socket stays open and updates keep arriving. The next keystroke comes back
   `error/forbidden` and flips the editor read-only. *(Catches: treating demotion as revocation, or
   ignoring `forbidden`.)*
8. **Persistence.** Type, wait ~3 s, confirm `durum yazıldı: doc=… bayt=N` in the server log. Type
   continuously for 30 s without pausing: the log must keep writing every ~10 s (the max-interval
   cap). Close every client, reopen: content must be there **before you type**, and the log must
   show `rehydrate edildi`. *(Catches: the client failing to push before close.)*
9. **Presence.** Remote carets in the correct per-user color with the correct label. Peer count
   accurate as instances join and leave. A late joiner must see existing peers within the
   re-announce interval — a few seconds, not 15. *(Catches: dropping the periodic re-announce; not
   subtracting the local client.)*
10. **Token expiry.** Set `JWT_EXPIRE_MINUTES=1` and restart the server. Open a document, keep
    typing past the minute. The 4401 must land on the login screen **with local edits intact**, and
    re-login must reconnect and push them. *(Catches: destroying the doc on 4401 — the one place
    where discarding it silently loses the user's work.)*
11. **Read-only is not enforcement.** Optional but instructive: as a viewer, send a `0x01` by hand
    (a scratch script over `websockets`) and confirm the server rejects it. The client's read-only
    mode is decluttering.

When hand-testing the socket, remember the server sends **`[0x00] + state vector` immediately on
connect** — a test reading the first frame expecting relayed traffic gets that instead. Drain it.
And a broadcast reaches every connection except the sender, including ones you forgot were open.

---

## 10. Conventions

- **Code comments in Turkish**, explanatory in tone — `../server` is written this way and the two
  halves should read as one project. Identifiers, types and this document stay English.
- Tailwind is **v4**: `@import "tailwindcss"` plus `@theme` tokens, `@tailwindcss/vite` plugin, no
  `tailwind.config.js`, no `@tailwind base/components/utilities`.
- `npm run typecheck` (node + web) and `npm run lint` before considering anything done. There is no
  test suite.
- Never log the WebSocket URL or a token.
- The server must not be modified. If a change there looks necessary, re-read §3 and §4.1.

---

## 11. Open questions

- **Document size ceiling.** CRDT state grows with edit history and the server logs `bayt=N` on
  every write, so the curve is observable. Whether the client should surface it, and whether
  compaction happens at all, is undecided (the backend's SPEC §11 has the same item open).
- **Multi-window.** One window is specified. "Open in new window" was considered and deferred; it
  needs main-process window bookkeeping and a decision about whether two windows share one session.
- **Language as shared state.** Currently per-window view state, deliberately. If two collaborators
  wanting the same syntax mode turns out to be the common case, it would need a second CRDT root
  that the terminal client knows nothing about — a real cost, so this needs evidence first.
- **Awareness trust.** Peer identity is self-asserted (§6.4). If displayed identity ever matters
  for anything beyond a caret label, it needs a signal the server vouches for.

---

## 12. Build order

Each step is independently verifiable against §9. Do not proceed until the current one runs.

1. **Prune and rewire.** Delete `RoomSwitcher`, drop `y-websocket`, collapse `main/index.ts` to one
   window, strip `?pane=`. The app should still build and show an editor bound to a local `Y.Doc`
   with no server at all.
2. **Main-process REST + session.** The API client, `safeStorage` session store, and the IPC bridge
   (§4.2, §4.3). Verify with §9.1 — login and the document list, no editor yet.
3. **Screens.** Login, document list, share (§7.1–7.3). Verify §9.1, §9.2 and the owner-only
   hiding.
4. **`EnvelopeProvider`, sync only.** Handshake, `0x01` relay, `status`/`synced` (§5). No awareness,
   no reconnect. Verify §9.3 and — the gate that matters — **§9.4**.
5. **Close codes and recovery.** Terminal vs retryable, reconnect with backoff, the 4410 / 4401 /
   4404 paths (§5.5, §7.5). Verify §9.6, §9.10.
6. **Read-only and demotion.** The role compartment and the `forbidden` handler (§7.4). Verify
   §9.2, §9.7.
7. **Awareness.** `0x02`, remote carets, peer list, periodic re-announce, throttling (§6). Verify
   §9.9.
8. **Polish and confirm.** §9.5, §9.8, §9.11, then rewrite `CLAUDE.md` to describe what exists.

---

## 13. Reference

### 13.1 Source of truth for the contract

Read the code, not the prose — `../server/SPEC.md` scopes itself to the backend and predates two of
its own endpoints.

| File | What it settles |
|---|---|
| `../server/app/protocol.py` | envelope bytes, JSON control shapes, close codes |
| `../server/app/routers/ws.py` | connect order, per-frame handling, every `error` code |
| `../server/app/routers/{auth,documents,roles}.py`, `app/schemas.py` | the REST surface, verbatim `detail` strings |
| `../server/app/rooms.py` | what revocation (`erisimi_iptal_et`) and demotion (`rolu_guncelle`) actually do on the wire |
| `../server/app/deps.py` | `resolve_role` — the two-lookup permission rule, and why no-access is 404 |
| `../server/terminal_script/{editor,api}.py` | the working reference client; its comments document bugs that were hit, several of which recur in TS |
| `../server/CLAUDE.md` | operational knowledge: ports, stale-container symptoms, verification recipes |

### 13.2 Superseded documents in this repo

- **`SPEC.md`** — specifies a client for the retired spike server. Superseded by this file. Keep it
  only if you want the history; nothing in it should guide new work except §6.5 (byte offsets) and
  §6.6 (dedupe), both carried forward here.
- **`CLAUDE.md`** — claims the repo contains only `SPEC.md`, which stopped being true eight commits
  ago. Rewrite it at step 8.
