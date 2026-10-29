# CLAUDE.md

Guidance for Claude Code working in this repo.

## What this is

The app for the VideoSDK campaign "webrtc video call app node.js", shipping to
`videosdk-community/videosdk-nodejs-video-calling`. A group video call where the **Node server owns the
room**: it creates the room, mints a token scoped to that room and participant, and ends the call
for everyone. The browser only joins with the JS SDK.

It lives in a campaign folder. `../../brief.md` says why the campaign exists and is locked.
`docs/DECISIONS.md` says how the app works and is **the single authority**: where any other file
disagrees with it, it wins. Blog, video and diagrams are written from it by a separate session, so
keep it accurate. **A commit that changes behaviour updates `docs/DECISIONS.md` in the same
commit.**

## Commands

```bash
npm install
cp .env.example .env   # then fill VIDEOSDK_API_KEY / VIDEOSDK_SECRET from app.videosdk.live
npm run dev            # node --watch --env-file=.env server.js, http://localhost:3000
npm start              # same, no watch
```

Node 20+ (`--env-file`). No build step, no bundler, no TypeScript, no tests by standing decision.
Verification is two real browsers in one call (see `docs/DECISIONS.md`, Verification).

## Layout

- `server.js` - the whole server: Express 5 + `@videosdk.live/server-sdk`. Three API routes plus
  static files.
- `public/` - plain HTML, CSS and one ES module. The JS SDK is served from
  `node_modules/@videosdk.live/js-sdk/videosdk.js` at `/vendor/videosdk.js` (UMD, global
  `VideoSDK`), so `package.json` pins both SDKs.

## Settled - do not re-litigate

Reasoning for each is in `docs/DECISIONS.md`.

- Exact pins: `@videosdk.live/server-sdk` 0.1.1, `@videosdk.live/js-sdk` 1.2.1. The package is
  `@videosdk.live/server-sdk`; the official examples repo names `@videosdk/server-sdk` (404 on npm),
  never copy from it.
- Host is whoever created the room. Host token = `allow_join` + `allow_mod`, 2h. Guest token =
  `allow_join` only, 10m. Both carry `roomId` and a server-generated `participantId`.
- End for everyone is `sessions.end({ roomId })` then `rooms.end(roomId)`. Probed: `rooms.end`
  alone disables the room but leaves live participants in the call, despite the docs.
  `sessions.end` is what disconnects everyone (`meeting-left` code 1009). Guarded statelessly: the
  caller sends its token, the server `verifyToken`s it and requires matching `roomId` plus
  `allow_mod`. No server state.
- The token endpoint refuses unknown and ended (disabled) rooms via `rooms.validate`.
- No live demo and no deploy config. The repo is the deliverable; people run it locally.

## Honesty rules for anything published

- Node never joins the call. It manages rooms and signs tokens; only browsers are participants.
- Do not mention the AI agents product. Never name competitors. "Clone this repo" is fine in the
  CTA (user decision, 2026-10-29); never call the app a "clone" of another product.
- No em dash characters anywhere.

## Secrets

`VIDEOSDK_API_KEY` and `VIDEOSDK_SECRET` live in `.env` (gitignored) and are read only by
`server.js`. Nothing under `public/` may reference them.
