// Relay load test (k6). Measures, rather than assumes, the performance targets.
//
//   k6 run load/k6-chat.js \
//     -e BASE_URLS=https://relay.example.vercel.app -e VUS=100 -e DURATION=3m
//
// Env:
//   BASE_URLS       comma-separated server origins; VUs are spread across them (use 2 local
//                   instances to exercise cross-instance delivery). Default http://localhost:3001
//   ORIGIN          Origin header (must be in the server's trusted origins). Default: first BASE_URL
//   VUS             virtual users (default 100)
//   DURATION        test length (default 2m)
//   SEND_EVERY_MS   per-VU send interval (default 6000 -> VUS*10 messages/min)
//   SESSION_S       seconds each socket stays open before reconnecting (default 60)
//   ROOM            channel slug to post in (default general)
//
// Accounts: setup() registers VUS users. The server limits sign-ups per IP
// (REGISTER_LIMIT_PER_HOUR, default 10): raise it temporarily for the test, then restore it.
import http from "k6/http";
import ws from "k6/ws";
import { check, sleep } from "k6";
import { Counter, Trend } from "k6/metrics";
import exec from "k6/execution";

const BASES = (__ENV.BASE_URLS || "http://localhost:3001").split(",").map((s) => s.trim().replace(/\/$/, ""));
const ORIGIN = __ENV.ORIGIN || BASES[0];
const VUS = Number(__ENV.VUS || 100);
const SEND_EVERY_MS = Number(__ENV.SEND_EVERY_MS || 6000);
const SESSION_S = Number(__ENV.SESSION_S || 60);
const ROOM = __ENV.ROOM || "general";

export const options = {
  scenarios: { chat: { executor: "constant-vus", vus: VUS, duration: __ENV.DURATION || "2m", gracefulStop: "20s" } },
  setupTimeout: "5m",
  thresholds: {
    // Targets from the brief. Reported pass/fail; they are targets, not guarantees.
    send_to_receive_ms: ["p(95)<80"],
    failed_sends: ["count==0"],
  },
};

const ackMs = new Trend("send_to_ack_ms", true);
const recvMs = new Trend("send_to_receive_ms", true);
const sent = new Counter("messages_sent");
const acked = new Counter("messages_acked");
const failed = new Counter("failed_sends");
const received = new Counter("messages_received");
const gaps = new Counter("live_seq_gaps");
const connects = new Counter("ws_connects");
const closes = new Counter("ws_unexpected_closes");

const wsUrl = (base) => base.replace(/^http/, "ws") + "/api/ws";
const headers = { Origin: ORIGIN, "Content-Type": "application/json", "x-relay-csrf": "1" };

function uuid() {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
  });
}

export function setup() {
  const run = Date.now().toString(36);
  const users = [];
  for (let i = 0; i < VUS; i++) {
    const base = BASES[i % BASES.length];
    const res = http.post(
      `${base}/api/v1/auth/register`,
      JSON.stringify({ email: `load-${run}-${i}@example.com`, password: "load-test-password-1", displayName: `Load ${i}` }),
      { headers },
    );
    if (res.status !== 201) throw new Error(`register ${i} failed: ${res.status} ${res.body}`);
    users.push({ cookie: `relay_at=${res.cookies.relay_at[0].value}`, base });
  }
  const rooms = http.get(`${BASES[0]}/api/v1/rooms`, { headers: { ...headers, Cookie: users[0].cookie } }).json("rooms");
  const room = rooms.find((r) => r.slug === ROOM);
  return { users, roomId: room.id, startSeq: room.lastSeq, startedAt: Date.now() };
}

export default function (data) {
  const me = data.users[(exec.vu.idInTest - 1) % data.users.length];
  const pending = {}; // clientId -> sentAt
  let lastSeq = null;
  const res = ws.connect(wsUrl(me.base), { headers: { Origin: ORIGIN, Cookie: me.cookie } }, (socket) => {
    socket.on("open", () => connects.add(1));
    socket.on("message", (raw) => {
      const ev = JSON.parse(raw);
      if (ev.type === "hello") socket.send(JSON.stringify({ type: "room.subscribe", roomIds: [data.roomId] }));
      else if (ev.type === "room.subscribed") {
        lastSeq = ev.rooms[0] ? ev.rooms[0].lastSeq : 0;
        socket.setInterval(() => {
          const clientId = uuid();
          pending[clientId] = Date.now();
          socket.send(JSON.stringify({ type: "message.send", roomId: data.roomId, clientId, body: `load ${Date.now()}` }));
          sent.add(1);
        }, SEND_EVERY_MS + Math.floor(Math.random() * 500));
      } else if (ev.type === "message.ack") {
        if (pending[ev.clientId]) ackMs.add(Date.now() - pending[ev.clientId]);
        acked.add(1);
        delete pending[ev.clientId];
      } else if (ev.type === "message.error") {
        failed.add(1);
        delete pending[ev.clientId];
      } else if (ev.type === "message.new") {
        received.add(1);
        // Body carries the sender's send time; all VUs share one clock on this machine.
        const t = Number(String(ev.message.body).split(" ")[1]);
        if (t) recvMs.add(Date.now() - t);
        if (lastSeq !== null) {
          if (ev.message.seq > lastSeq + 1) gaps.add(1);
          lastSeq = Math.max(lastSeq, ev.message.seq);
        }
      }
    });
    socket.on("close", (code) => {
      if (code !== 1000 && code !== 1005) closes.add(1, { code: String(code) });
    });
    socket.setTimeout(() => socket.close(1000), SESSION_S * 1000);
  });
  check(res, { "ws upgraded (101)": (r) => r && r.status === 101 });
  sleep(Math.random());
}

export function teardown(data) {
  sleep(3);
  // Persistence + ordering: every committed message after the start seq must be present, gap-free.
  const cookie = data.users[0].cookie;
  let after = data.startSeq;
  let count = 0;
  let contiguous = true;
  for (let page = 0; page < 1000; page++) {
    const r = http.get(`${BASES[0]}/api/v1/rooms/${data.roomId}/messages?afterSeq=${after}&limit=500`, { headers: { Origin: ORIGIN, Cookie: cookie } });
    if (r.status !== 200) {
      console.error(`verify failed: ${r.status}`);
      return;
    }
    const body = r.json();
    for (const m of body.messages) {
      if (m.seq !== after + 1) contiguous = false;
      after = m.seq;
      count++;
    }
    if (!body.hasMore) break;
  }
  console.log(`VERIFY persisted=${count} contiguous_seq=${contiguous} lastSeq=${after}`);
}
