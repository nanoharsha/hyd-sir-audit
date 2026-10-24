// Real-time "someone else changed a record" notifications. Ported from the
// developer's events.py in-process pub/sub broker + SSE endpoint, but that
// design assumes one long-running process holding state in memory — Workers
// handle each request independently, so there's nothing to hold a broker's
// state between requests. A Durable Object is the Workers-native equivalent:
// a single object instance that *does* persist across requests and can hold
// live WebSocket connections. Clients connect over WebSocket instead of SSE
// (Workers' WebSocket support is the better-trodden path of the two).
export class BroadcastRoom {
  state: DurableObjectState;
  sockets: Set<WebSocket>;

  constructor(state: DurableObjectState) {
    this.state = state;
    this.sockets = new Set();
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/broadcast") {
      const message = await request.text();
      for (const ws of this.sockets) {
        try {
          ws.send(message);
        } catch {
          this.sockets.delete(ws);
        }
      }
      return new Response("ok");
    }

    if (request.headers.get("Upgrade") !== "websocket") {
      return new Response("Expected WebSocket", { status: 426 });
    }
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair) as [WebSocket, WebSocket];
    server.accept();
    this.sockets.add(server);
    server.addEventListener("close", () => this.sockets.delete(server));
    server.addEventListener("error", () => this.sockets.delete(server));
    return new Response(null, { status: 101, webSocket: client });
  }
}

// The room name for the logged-in app. Carries the full event payload.
export const STAFF_ROOM = "global";
// The room name for the public dashboard at /live/. Carries the event name
// and a timestamp, nothing else — see the comment in broadcast() below.
export const PUBLIC_ROOM = "public";

export async function broadcast(env: any, event: string, data: any) {
  const at = new Date().toISOString();

  const staff = env.BROADCAST.get(env.BROADCAST.idFromName(STAFF_ROOM));
  // The public dashboard is served without a login in front of it, so it gets
  // its own room and its own payload, rebuilt from scratch with only `event`
  // and `at`. `data` carries the elector id and the surveyor's email and is
  // deliberately not forwarded. Keeping the rooms separate means the public
  // socket cannot leak PII even if someone later adds a field to `data` —
  // there is no filtering step here to forget to update.
  const pub = env.BROADCAST.get(env.BROADCAST.idFromName(PUBLIC_ROOM));

  await Promise.all([
    staff.fetch("https://broadcast/broadcast", {
      method: "POST",
      body: JSON.stringify({ event, data, at }),
    }),
    pub.fetch("https://broadcast/broadcast", {
      method: "POST",
      body: JSON.stringify({ event, at }),
    }),
  ]);
}
