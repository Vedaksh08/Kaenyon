# Classroom video: Cloudflare Realtime

Pathwaay's classroom runs on the **Cloudflare Realtime SFU**, and nothing else.
There is no second backend and no fallback.

## Setup

1. **dash.cloudflare.com → Realtime → SFU → create an app.** Note the App ID
   and the App Token.

2. **Set two variables** — locally in `.env`, and in Vercel under Settings →
   Environment Variables:

   ```
   CF_REALTIME_APP_ID=<app id>
   CF_REALTIME_APP_TOKEN=<app token>
   ```

   Mark the token **Sensitive** in Vercel. Neither gets a `VITE_` prefix, and
   the token must never reach the browser — see below.

3. **Redeploy.** Without these the classroom refuses to load with
   _"Classroom video is not configured."_

Optionally set `CLASSROOM_TICKET_SECRET` to any long random string. It signs
the short-lived ticket described below; if unset it falls back to
`SUPABASE_SERVICE_ROLE_KEY`.

## How it works

Cloudflare Realtime is a pure SFU: each browser sends **one** upload, and
Cloudflare forwards it to everyone. That is what makes 30 cameras possible — a
peer-to-peer mesh needs one upload per participant, so a 20-person room asks
~5 Mbps of every laptop and collapses.

There is no client SDK involved. `src/lib/use-cloudflare-realtime.ts` is a
plain `RTCPeerConnection` driving Cloudflare's HTTP API: one session per
student, on one connection, pushing their own tracks and pulling everyone
else's.

### The app token never reaches the browser

Cloudflare's token carries no notion of rooms or users. Anyone holding it can
create sessions and pull **any track in the whole app**. So every call is
proxied by `src/lib/cloudflare-realtime.functions.ts`, which runs on the
server. The page only ever sees session ids and SDP.

Authorisation runs in `src/lib/classroom-access.ts`, shared by both server
functions so the page and the media layer can never disagree about who is
allowed in. It checks the caller's Supabase JWT, that they are onboarded and
not suspended, and that the subject is on their course and year. Teachers
(`moderator` / `admin`) may enter any room.

Re-running that on every Cloudflare call would add a Supabase round trip each
time somebody's camera appears, so it runs once, at session creation, and the
result is HMAC-signed into a 4-hour ticket the later calls present.

### Cloudflare knows nothing but media

No rooms, no membership, no names, no mute. All of that comes from **Supabase
Realtime presence**, which is what makes a stateless SFU workable: a late
joiner is handed the full roster on `sync`, and a browser that closes is
dropped without having to announce anything.

| Need                                    | Where it comes from                              |
| --------------------------------------- | ------------------------------------------------ |
| Who is in the room, names, identities   | Supabase presence on `cfrt:<classId>`            |
| Which track is a camera, mic, or screen | deterministic track names, announced in presence |
| Raise hand, mic/camera state            | flags on the same presence payload               |
| Mute everyone                           | a `mute-all` broadcast each client honours       |

One consequence worth knowing: **mute-everyone is advisory, not enforced.**
Cloudflare has no concept of a room, so there is nobody to enforce it but the
clients themselves.

### Simulcast

The camera publishes three layers (`f`, `h`, `q` — full, half, quarter), set in
`CAMERA_ENCODINGS` in `src/lib/classroom-video.ts`. An SFU only fixes the
upload side; without simulcast every viewer still downloads 29 full-resolution
streams, which is what actually breaks a 30-tile grid on a student laptop.

Pulls are batched on a 250 ms debounce, so a 30-person room costs a handful of
renegotiations rather than thirty, and every SDP exchange is serialised through
one queue — two people joining at the same instant would otherwise collide
mid-negotiation and never recover.

## Cost

Billed on **egress only** — traffic Cloudflare sends to clients. What you push
up is free.

- **1,000 GB/month free**, then $0.05/GB.
- A 30-person one-hour class is roughly 60 GB if viewers pull the low layer, so
  the free tier covers on the order of 15–20 such classes a month.

The next optimisation, when there is real usage to measure, is requesting a
specific layer per tile (`simulcast: { preferredRid }` on a pull) rather than
letting Cloudflare choose — asking for `q` on small tiles and `f` only on the
active speaker would cut that figure substantially.

## Verifying which backend is live

There is only one, but to confirm media is flowing through Cloudflare: open
DevTools → Network → Fetch/XHR and look for calls to
`rtc.live.cloudflare.com/v1/apps/...`, or check `chrome://webrtc-internals` for
a single PeerConnection per tab rather than one per participant.
