# Running Pathwaay on our own SFU

The client is done. `src/lib/use-pathwaay-sfu.ts` speaks the socket.io protocol
in [Pathwaay-SFU](https://github.com/ninadaradhye-code/Pathwaay-SFU) exactly as
it stands, and the app picks it over LiveKit the moment `SFU_URL` is set.

What is left is the server. As written it only works on one Wi-Fi network, so
two people in different states cannot connect. This is why, and what to change.

## Why LAN-only today

`Src/mediasoup.js` announces the address browsers should send media to:

```js
listenIps: [{ ip: "0.0.0.0", announcedIp: lanIp }],
```

`lanIp` is `192.168.x.x`. A browser in another state is told to send its video
to `192.168.x.x`, which on their network is either nothing or their own router.
Signalling succeeds, the call appears to connect, and no video ever arrives.

Two smaller blockers follow from the same assumption:

- `Src/server.js` allows only `localhost:5173` and `LAN_IP:5173` as origins, so
  a socket.io connection from `kaenyon.vercel.app` is refused outright.
- The certs are mkcert. A page on `https://` cannot open `wss://` to a
  self-signed host, and there is no click-through for a subresource.

Good news: **only signalling needs TLS.** Media is DTLS-SRTP straight to the
UDP ports and authenticates on fingerprints exchanged during signalling, so a
reverse proxy in front of socket.io is enough. The media path stays direct.

## The three file changes

### `Src/config.js`

Add a public address and a configurable origin list.

```js
const lanIp = process.env.LAN_IP || detectLanIp();

// The address browsers are told to send media to. On a server this must be the
// public IP; LAN_IP only ever works for people on the same Wi-Fi.
const publicIp = process.env.PUBLIC_IP || lanIp;

// Extra browser origins allowed to open a socket, comma-separated.
// e.g. ALLOWED_ORIGINS=https://kaenyon.vercel.app,https://pathwaay.com
const allowedOrigins = (process.env.ALLOWED_ORIGINS || "")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);

module.exports = {
  lanIp,
  publicIp,
  allowedOrigins,
  port: Number(process.env.PORT || 3000),
  clientPort: Number(process.env.CLIENT_PORT || 5173),
  httpsEnabled: process.env.HTTPS === "true",
  certificateDirectory: path.resolve(__dirname, "..", "certs"),
};
```

### `Src/mediasoup.js`

Announce the public address, and give the transport a sensible bitrate ceiling
so one person on fast internet cannot swamp everyone else.

```js
const { publicIp } = require("./config");

async function createWebRtcTransport(router) {
  if (!router) throw new Error("Router is required");

  if (!publicIp) {
    throw new Error("No address to announce. Set PUBLIC_IP (server) or LAN_IP (local).");
  }

  const transport = await router.createWebRtcTransport({
    listenIps: [{ ip: "0.0.0.0", announcedIp: publicIp }],
    enableUdp: true,
    // Keep TCP: college and office networks often block UDP entirely, and this
    // is the difference between "works" and "works for everyone".
    enableTcp: true,
    preferUdp: true,
    initialAvailableOutgoingBitrate: 1_000_000,
  });

  // The client publishes three simulcast layers totalling ~1.4 Mbps.
  await transport.setMaxIncomingBitrate(1_500_000);

  console.log(`WebRTC transport created: ${transport.id}`);
  return transport;
}
```

### `Src/server.js`

Let the deployed app connect.

```js
const { lanIp, publicIp, allowedOrigins, port: PORT, clientPort, httpsEnabled, certificateDirectory } = require("./config");

const allowed = new Set([
  `${protocol}://localhost:${clientPort}`,
  ...(lanIp ? [`${protocol}://${lanIp}:${clientPort}`] : []),
  ...allowedOrigins,
]);

const io = new Server(server, {
  cors: {
    origin(origin, callback) {
      if (!origin || allowed.has(origin)) return callback(null, true);
      return callback(new Error(`Origin ${origin} is not allowed`));
    },
    credentials: false,
  },
});
```

## Deploying it

Any VPS with a public IP works — Oracle Cloud's always-free tier, a small
DigitalOcean or Hetzner box. Not Vercel: this needs a long-lived socket and raw
UDP, neither of which a serverless function has.

1. **Open the ports.** In the provider's firewall *and* the OS firewall, allow
   TCP 3000 (or whatever `PORT` is) and **UDP + TCP 40000-49999**. Missing the
   UDP range is the single most common reason a deployed mediasoup is silent.

2. **Set the env vars** in the SFU's `.env`:

   ```
   PUBLIC_IP=<the VPS public IP>
   ALLOWED_ORIGINS=https://kaenyon.vercel.app
   PORT=3000
   ```

3. **Terminate TLS** in front of socket.io. With Caddy this is two lines and
   the certificate is automatic:

   ```
   sfu.yourdomain.com {
     reverse_proxy localhost:3000
   }
   ```

   That gives `https://sfu.yourdomain.com`, and socket.io upgrades to `wss://`
   on it by itself.

4. **Point the app at it.** In Vercel → Settings → Environment Variables:

   ```
   SFU_URL=https://sfu.yourdomain.com
   ```

   Not sensitive, and no `VITE_` prefix: the app hands it to the browser from
   `classroom-video.functions.ts` only after that student passes the course and
   year check. Redeploy after setting it.

Leaving `SFU_URL` empty falls back to LiveKit, so this is reversible with one
variable and no code change.

## Testing it locally first

`npm run dev` serves on `http://localhost:5173`, which the SFU already allows.
So on one machine, with the SFU running locally, set `SFU_URL=http://localhost:3000`
in this project's `.env` and it works with no server changes at all.

Two machines on the same Wi-Fi need HTTPS on both, because `getUserMedia` only
runs in a secure context and `http://192.168.x.x` is not one. That is what the
mkcert setup in the SFU's README is for. Going straight to a deployed server is
usually less work.

## What our client does that the server does not

The SFU carries media and nothing else — no identities, names, screen-share
flag, mute command, or camera-off signal. Rather than fork it, all of that
rides on a Supabase Realtime broadcast channel next to the media:

| Need | How |
| --- | --- |
| Names, and matching a tile to a Supabase user | `peer` broadcast carrying `socketId` → `userId` |
| Telling a screen share from a camera | the sharer announces its `shareProducerId` |
| Raise hand | a flag on the same `peer` broadcast |
| Mute everyone | a `mute-all` broadcast each client honours |
| Camera off | track disabled, plus a `camMuted` flag so peers show the avatar |

Two consequences worth knowing:

- **Mute-everyone is advisory, not enforced.** The SFU has no per-producer
  commands, so it asks each client to mute itself. LiveKit enforced this on the
  server. Adding `pauseProducer` / `resumeProducer` / `closeProducer` handlers
  to the SFU would let us make it real, and would also let camera-off stop
  sending instead of sending black frames.
- **Room membership is not checked by the SFU.** Our server decides who may
  join and only then hands out the room id, but anyone who learns a room id can
  join it directly. Verifying the Supabase JWT inside `joinRoom` would close
  that. Worth doing before real classes, not before a test call.
