import { randomUUID } from "node:crypto";
import express from "express";
import { VideoSDK, Grant } from "@videosdk.live/server-sdk";

// Your API key and secret never leave this process.
const videosdk = new VideoSDK({
  apiKey: process.env.VIDEOSDK_API_KEY,
  secret: process.env.VIDEOSDK_SECRET,
});

// A token that works for one room and one participant only.
// The host can moderate and needs the token for the whole call (it proves
// who may end it). Guests only need theirs long enough to join.
function mintToken(roomId, { host }) {
  const participantId = randomUUID();
  const token = videosdk
    .accessToken()
    .setParticipant(participantId)
    .forRoom(roomId)
    .grant(...(host ? [Grant.AllowJoin, Grant.AllowMod] : [Grant.AllowJoin]))
    .expiresIn(host ? "2h" : "10m")
    .toJwt();
  return { roomId, participantId, token, host };
}

const app = express();

// Create a room. Whoever creates it is the host.
app.post("/api/rooms", async (req, res) => {
  const room = await videosdk.rooms.create();
  res.json(mintToken(room.roomId, { host: true }));
});

// Let a guest in, but only into a room that exists and is still open.
app.post("/api/rooms/:roomId/token", async (req, res) => {
  const { valid, room } = await videosdk.rooms.validate(req.params.roomId);
  if (!valid) return res.status(404).json({ error: "No call with this link." });
  if (room.disabled) return res.status(410).json({ error: "This call has ended." });
  res.json(mintToken(room.roomId, { host: false }));
});

// End the call for everyone. Only a token this server minted with
// allow_mod for this exact room can do it.
app.post("/api/rooms/:roomId/end", async (req, res) => {
  let claims;
  try {
    claims = videosdk.verifyToken(req.get("Authorization") ?? "");
  } catch {
    return res.status(401).json({ error: "Invalid or expired token." });
  }
  if (claims.roomId !== req.params.roomId || !claims.permissions?.includes(Grant.AllowMod)) {
    return res.status(403).json({ error: "Only the host can end this call." });
  }
  // Ending the live session disconnects everyone in the call.
  // Ending the room then makes sure nobody can start it again.
  await videosdk.sessions.end({ roomId: req.params.roomId });
  await videosdk.rooms.end(req.params.roomId);
  res.sendStatus(204);
});

app.get("/vendor/videosdk.js", (req, res) =>
  res.sendFile(import.meta.dirname + "/node_modules/@videosdk.live/js-sdk/videosdk.js"),
);
app.use(express.static("public"));
app.get("/room/:roomId", (req, res) => res.sendFile(import.meta.dirname + "/public/index.html"));

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: err.message });
});

const port = process.env.PORT ?? 3000;
app.listen(port, () => console.log(`Open http://localhost:${port}`));
