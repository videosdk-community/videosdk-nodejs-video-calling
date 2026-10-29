const { VideoSDK } = window; // loaded by /vendor/videosdk.js
const $ = (id) => document.getElementById(id);
const roomInUrl = () => location.pathname.match(/^\/room\/([\w-]+)$/)?.[1];

let session; // { roomId, participantId, token, host }, minted by the Node server
let meeting;
let micOn = true;
let camOn = true;

// Every request goes to our own server. The browser never sees the API secret.
async function api(path, headers = {}) {
  const res = await fetch(path, { method: "POST", headers });
  if (!res.ok) throw new Error((await res.json()).error);
  return res.status === 204 ? null : res.json();
}

function showForm(message = "") {
  const roomId = roomInUrl();
  $("join-title").textContent = roomId ? "Join the call" : "Start a video call";
  $("join-hint").textContent = roomId
    ? `Room ${roomId}`
    : "Your Node server creates the room and hands you a token for it.";
  $("join-button").textContent = roomId ? "Join call" : "Start call";
  $("join-button").disabled = false;
  $("status").textContent = message;
  $("join-form").hidden = false;
  $("call").hidden = true;
  $("room-label").hidden = $("copy-link").hidden = true;
}

$("join-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  $("join-button").disabled = true;
  $("status").textContent = "Connecting...";
  try {
    const roomId = roomInUrl();
    // A host who refreshes keeps their host token. Everyone else asks the server.
    session = roomId
      ? (JSON.parse(sessionStorage.getItem(roomId)) ?? (await api(`/api/rooms/${roomId}/token`)))
      : await api("/api/rooms");
    if (session.host) sessionStorage.setItem(session.roomId, JSON.stringify(session));
    history.replaceState(null, "", `/room/${session.roomId}`);
    await join($("name").value.trim());
  } catch (error) {
    showForm(error.message);
  }
});

async function join(name) {
  VideoSDK.config(session.token);
  meeting = VideoSDK.initMeeting({
    meetingId: session.roomId,
    participantId: session.participantId, // must match the id inside the token
    name,
    micEnabled: true,
    webcamEnabled: true,
  });

  meeting.on("meeting-joined", () => {
    meeting.participants.forEach(addTile);
    $("join-form").hidden = true;
    $("call").hidden = false;
    $("end").hidden = !session.host;
    $("room-label").textContent = session.roomId;
    $("room-label").hidden = $("copy-link").hidden = false;
  });
  meeting.on("participant-joined", addTile);
  meeting.on("participant-left", (participant) => $(`tile-${participant.id}`)?.remove());
  meeting.on("meeting-left", onMeetingLeft);

  addTile(meeting.localParticipant);
  await meeting.join();
}

function addTile(participant) {
  if ($(`tile-${participant.id}`)) return;
  const tile = document.createElement("figure");
  tile.id = `tile-${participant.id}`;
  tile.className = "tile cam-off";
  tile.dataset.initial = participant.displayName.charAt(0).toUpperCase();

  const video = document.createElement("video");
  video.autoplay = video.playsInline = video.muted = true;
  const caption = document.createElement("figcaption");
  caption.textContent = participant.local ? `${participant.displayName} (you)` : participant.displayName;
  // Never play your own audio back to yourself.
  const audio = participant.local ? null : document.createElement("audio");
  if (audio) audio.autoplay = true;
  tile.append(video, caption, ...(audio ? [audio] : []));
  $("grid").append(tile);

  const render = (stream, on) => {
    const media = on ? new MediaStream([stream.track]) : null;
    if (stream.kind === "video") {
      video.srcObject = media;
      tile.classList.toggle("cam-off", !on);
    }
    if (stream.kind === "audio" && audio) audio.srcObject = media;
  };
  participant.on("stream-enabled", (stream) => render(stream, true));
  participant.on("stream-disabled", (stream) => render(stream, false));
  participant.streams.forEach((stream) => render(stream, true));
}

function onMeetingLeft(reason) {
  // The server's sessions.end() arrives here as MEETING_END_API (1009).
  const endedByServer = reason?.code === VideoSDK.Constants.leaveReason.MEETING_END_API;
  $("grid").replaceChildren();
  if (endedByServer) sessionStorage.removeItem(session.roomId);
  micOn = camOn = true;
  setControlLabels();
  showForm(endedByServer ? "The host ended this call for everyone." : "You left the call.");
}

function setControlLabels() {
  $("toggle-mic").textContent = micOn ? "Mute" : "Unmute";
  $("toggle-mic").setAttribute("aria-pressed", micOn);
  $("toggle-cam").textContent = camOn ? "Stop camera" : "Start camera";
  $("toggle-cam").setAttribute("aria-pressed", camOn);
}

$("toggle-mic").addEventListener("click", async () => {
  await (micOn ? meeting.muteMic() : meeting.unmuteMic());
  micOn = !micOn;
  setControlLabels();
});

$("toggle-cam").addEventListener("click", async () => {
  await (camOn ? meeting.disableWebcam() : meeting.enableWebcam());
  camOn = !camOn;
  setControlLabels();
});

$("leave").addEventListener("click", () => meeting.leave());

// The browser only asks. The Node server checks the host token and ends the room,
// and VideoSDK disconnects every participant, including this one.
$("end").addEventListener("click", async () => {
  $("end").disabled = true;
  try {
    await api(`/api/rooms/${session.roomId}/end`, { Authorization: session.token });
  } catch (error) {
    alert(error.message);
  } finally {
    $("end").disabled = false;
  }
});

$("copy-link").addEventListener("click", async () => {
  await navigator.clipboard.writeText(location.href);
  $("copy-link").textContent = "Copied";
  setTimeout(() => ($("copy-link").textContent = "Copy invite link"), 1500);
});

showForm();
