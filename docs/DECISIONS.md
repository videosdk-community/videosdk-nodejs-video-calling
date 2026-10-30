# Decisions

How this app works and why. The single authority: where any other file disagrees with this one,
this one wins. A commit that changes behaviour updates this file in the same commit.

Facts marked **probed** were checked against the real VideoSDK service in two browsers on
2026-10-29.

## What the app is

A group video call where the Node server owns the room. The server creates the room, decides who
gets a token and what that token allows, and ends the call for everyone. The browser only joins
with the JS SDK. VideoSDK carries all media; the app contains no WebRTC code.

**Node never joins the call.** It manages rooms and signs tokens over the VideoSDK REST API. Only
browsers are participants.

In scope: create room, scoped token, join, camera toggle, mic toggle, leave, end for everyone.
Out of scope: webhooks, recording, room listing, chat, screen share, waiting lobby.

## Stack

- Node 20.11+ (`--env-file`, `import.meta.dirname`), plain JavaScript ESM, no TypeScript, no build
  step, no bundler, no tests.
- `express` 5.3.0, `@videosdk.live/server-sdk` 0.1.1, `@videosdk.live/js-sdk` 1.2.1, all pinned
  exact.
- The browser loads the JS SDK from the installed package: Express serves
  `node_modules/@videosdk.live/js-sdk/videosdk.js` at `/vendor/videosdk.js`. It is a UMD bundle and
  exposes a global `VideoSDK`. One `npm install`, and `package.json` pins both SDKs.
- UI is plain HTML and CSS using the VideoSDK design tokens, vendored into `public/tokens.css`
  (generated, do not hand-edit). Dark only.

## Files

- `server.js` - everything server-side. One `VideoSDK` client, one `mintToken` helper, three
  routes, static files.
- `public/index.html` - one page for every state: join form, call, ended.
- `public/app.js` - the browser side. Talks only to our own server and the JS SDK.
- `public/styles.css`, `public/tokens.css`, `public/videosdk-wordmark-white.svg`.

## Environment

`VIDEOSDK_API_KEY` and `VIDEOSDK_SECRET` from app.videosdk.live, in `.env` (gitignored),
loaded by `node --env-file=.env`. `PORT` is optional, default 3000. The secret never leaves the
server process. Tokens are signed locally by the Server SDK (HS256); signing makes no network call.

## Routes

| Route | Does | Returns |
|---|---|---|
| `POST /api/rooms` | `videosdk.rooms.create()`, then a **host** token | `{ roomId, participantId, token, host: true }` |
| `POST /api/rooms/:roomId/token` | `videosdk.rooms.validate(roomId)`, then a **guest** token | `{ roomId, participantId, token, host: false }`; 404 unknown room; 410 ended room |
| `POST /api/rooms/:roomId/end` | checks the caller's token, then ends the call | 204; 401 bad or expired token; 403 not the host of this room |
| `GET /room/:roomId` | serves `index.html` | the share link |
| `GET /vendor/videosdk.js` | serves the JS SDK bundle | |

Unhandled errors return `500 { error }` and are logged.

## Tokens

Built with the Server SDK's builder:
`videosdk.accessToken().setParticipant(id).forRoom(roomId).grant(...).expiresIn(...).toJwt()`.

| | Grants | Expiry |
|---|---|---|
| Host (whoever created the room) | `allow_join`, `allow_mod` | `2h` |
| Guest (anyone with the link) | `allow_join` | `10m` |

- **Probed** payload: `apikey`, `permissions`, `version: 2`, `roles: ["rtc"]`, `participantId`,
  `roomId`, `iat`, `exp`. `roles: ["rtc"]` means the token can join a meeting but cannot call the
  management API.
- The server generates `participantId` with `crypto.randomUUID()`. The browser must pass the same
  id to `VideoSDK.initMeeting({ participantId })`, because the token is scoped to it.
- The display name is typed by the user and is not part of the token.
- Why two expiries: VideoSDK checks a token only at the moment of joining, so an expiry never kicks
  anyone out of a running call. A guest token only has to live long enough to join, so it is short.
  The host token is also the host's proof for the end endpoint, so it has to outlive the call.
- If the Builder is called with no grants it falls back to `allow_join` + `allow_mod`, so the guest
  path always passes `Grant.AllowJoin` explicitly.

## Who is host

The browser that calls `POST /api/rooms`. Nothing is stored server-side. The host browser keeps
its session (`{ roomId, participantId, token, host }`) in `sessionStorage` under the room id, so a
host who refreshes rejoins as host. Guests ask the server for a fresh token on every join. The
`host` field in responses only decides whether the End button is drawn; enforcement is the
`allow_mod` grant inside the signed token.

## End for everyone

`POST /api/rooms/:roomId/end` with the caller's token in the `Authorization` header (raw JWT, no
`Bearer`). The server runs `videosdk.verifyToken(token)` (signature and expiry), then requires
`claims.roomId === roomId` and `allow_mod` in `claims.permissions`. Then:

```js
await videosdk.sessions.end({ roomId }); // disconnects everyone
await videosdk.rooms.end(roomId);        // disables the room for good
```

- **Probed:** `rooms.end` (`POST /v2/rooms/deactivate`) alone sets `disabled: true` but leaves
  every live participant in the call, observed for 60 seconds.
- **Probed:** `sessions.end` (`POST /v2/sessions/end`) disconnects every participant within a
  second. Each browser receives `meeting-left` with `{ code: 1009, message: "Meeting Ended." }`
  (`VideoSDK.Constants.leaveReason.MEETING_END_API`). The room stays enabled.
- Hence both, in that order. Ended means ended: the token endpoint returns 410 for a disabled room,
  so the share link stops working.
- The host is disconnected by VideoSDK like everyone else. The browser never calls `meeting.end()`
  or `meeting.leave()` for this path; the server ends the call.
- **Probed:** a guest token sent straight to the end endpoint gets 403.

## Browser flow

1. `/` shows "Start a video call". Submit calls `POST /api/rooms` and moves the URL to
   `/room/:roomId` with `history.replaceState`.
2. `/room/:roomId` shows "Join the call". Submit uses the stored host session if there is one,
   otherwise `POST /api/rooms/:roomId/token`.
3. `VideoSDK.config(token)`, `VideoSDK.initMeeting({ meetingId, participantId, name, micEnabled:
   true, webcamEnabled: true })`, then `await meeting.join()`. The JS SDK's methods return Promises
   since 1.0.
4. Tiles: one per participant, added on `participant-joined` and for everyone in
   `meeting.participants` on `meeting-joined` (idempotent), removed on `participant-left`. Media is
   attached on `stream-enabled` / `stream-disabled`. The local participant's audio is never played.
   A tile with no video shows the name's initial.
   The page is bound to the viewport: a tile is 16:9 and never taller than the space above the
   controls, so the controls stay on screen with one participant or many. A grid too big to fit
   scrolls inside itself.
5. Controls: mic (`muteMic` / `unmuteMic`), camera (`disableWebcam` / `enableWebcam`), Leave
   (`meeting.leave()`, only you leave), and End for everyone (host only, calls our server).
6. On `meeting-left`, code 1009 shows "The host ended this call for everyone." and drops the stored
   host session; anything else shows "You left the call."

## Deploy

No live demo and no deploy config: the repo is the deliverable and people run it locally in
about two minutes.

## Verification

No tests in the repo. Verification is two real Chromium contexts in one call against the local
server, with `--use-fake-device-for-media-stream` and `--use-fake-ui-for-media-stream`, asserting
first that the devices really are fake. The script lives outside the repo. Last run 2026-10-29,
all passing:

- host creates a room, lands on `/room/xxxx-xxxx-xxxx`, sees End for everyone
- guest joins from the link; both browsers show two live video tiles; guest has no End button
- guest camera off shows as the initial on the host; back on shows video again
- guest mute empties the host's audio element for the guest; unmute restores it
- guest token on the end endpoint returns 403
- host End: both browsers leave with code 1009 and the ended message
- rejoining the ended room is refused with "This call has ended."
- guest Leave removes only the guest; the host stays with one tile
