# Classroom video: Cloudflare Realtime SFU

Pathwaay uses only Cloudflare Realtime SFU for classroom media. Each browser
creates one Cloudflare session, publishes its camera track, and subscribes to
other classroom camera tracks through that SFU. No peer-to-peer mesh, LiveKit,
mediasoup, or fallback backend is used.

## Server configuration

Create a Cloudflare Realtime SFU application, then set these server-only
environment variables locally and in the deployment host:

```
CF_REALTIME_APP_ID=<Cloudflare application id>
CF_REALTIME_APP_TOKEN=<Cloudflare application token>
CLASSROOM_TICKET_SECRET=<long random string, optional>
```

`CF_REALTIME_APP_TOKEN` must never have a `VITE_` prefix. It is consumed
only by `src/lib/cloudflare-realtime.functions.ts`, which calls
`https://rtc.live.cloudflare.com/v1/apps/<app-id>/...` on the server. The
browser receives an HMAC-signed, four-hour ticket, Cloudflare session ID, and
SDP only. The ticket cannot reveal or be used as the Cloudflare app token.

## Admission and camera enforcement

Apply the migration
`supabase/migrations/20260916090000_classroom_video_participants.sql`.
It creates an authoritative, server-only participant lease. Before a
Cloudflare session is created, the server atomically claims a seat and rejects
the 31st active participant. A refresh replaces the same user's lease instead
of consuming another seat.

The browser requests `getUserMedia({ video, audio: false })` and publishes
only its camera. It sends a server heartbeat every five seconds. After a
five-second grace period for camera transitions, the server records up to three
warnings at least ten seconds apart; continued camera-off state then marks the
lease as kicked. Refreshing cannot reset that record.
