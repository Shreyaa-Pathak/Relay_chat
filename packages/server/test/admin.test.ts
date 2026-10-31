import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { resetDb, startCluster, TestUser, type Cluster } from "./helpers.js";
import { DEFAULT_COMMUNITY_ID } from "../src/repo/communities.js";
import { seedDefaultChannels } from "../src/db/seed.js";
import { createRoom, deleteRoom } from "../src/repo/admin.js";
import { sendMessage } from "../src/repo/messages.js";
import { randomUUID } from "node:crypto";

let cluster: Cluster;
let root: TestUser;
let ownerA: TestUser;
let ownerB: TestUser;
let member: TestUser;
let communityA: string;
let communityB: string;
const admin = (id: string) => `/communities/${id}/admin`;
const email = (u: TestUser) => (u as TestUser & { email: string }).email;

beforeAll(async () => {
  await resetDb();
  cluster = await startCluster(2);
  root = await TestUser.register(cluster.servers[0]!.url, "Root");
  ownerA = await TestUser.register(cluster.servers[0]!.url, "Owner A");
  ownerB = await TestUser.register(cluster.servers[1]!.url, "Owner B");
  member = await TestUser.register(cluster.servers[1]!.url, "Member");
  const a = await root.req("POST", "/superadmin/communities", { name: "Community A", slug: "community-a", ownerEmail: email(ownerA) });
  const b = await root.req("POST", "/superadmin/communities", { name: "Community B", slug: "community-b", ownerEmail: email(ownerB), isPrivate: true });
  expect(a.status).toBe(201);
  expect(b.status).toBe(201);
  communityA = a.body.id;
  communityB = b.body.id;
});
afterAll(async () => { await cluster?.close(); });

describe("communities and platform permissions", () => {
  it("gives new signups immediate public chat access and restricts community creation", async () => {
    expect((await root.req("GET", "/auth/me")).body.user.role).toBe("superadmin");
    expect((await member.req("GET", "/auth/me")).body.user).toMatchObject({ status: "active", role: "member" });
    expect((await member.rooms()).filter((r) => r.isMember)).toHaveLength(4);
    expect((await member.req("GET", "/superadmin/communities")).status).toBe(403);
    expect((await ownerA.req("POST", "/superadmin/communities", { slug: "forbidden", name: "Forbidden", ownerEmail: email(ownerA) })).status).toBe(403);
    expect((await member.req("POST", `/communities/${communityA}/join`)).status).toBe(200);
    expect((await member.rooms()).some((r: { communityId?: string }) => r.communityId === communityA)).toBe(true);
  });

  it("hides private communities and rejects guessed access, including for the superadmin", async () => {
    const visible = (await member.req("GET", "/communities")).body.communities;
    expect(visible.some((c: { id: string }) => c.id === communityB)).toBe(false);
    expect((await member.req("POST", `/communities/${communityB}/join`)).status).toBe(404);
    expect((await root.req("GET", `${admin(communityB)}/members`)).status).toBe(404);
    expect((await ownerA.req("GET", `${admin(communityB)}/members`)).status).toBe(404);
    expect((await ownerB.req("GET", `${admin(communityA)}/rooms`)).status).toBe(404);
  });

  it("requires a matching account and single-use link for private invitations", async () => {
    const invitation = await ownerB.req("POST", `${admin(communityB)}/invitations`, { email: email(member) });
    expect(invitation.status).toBe(201);
    expect((await member.req("GET", "/communities")).body.communities.some((c: { id: string }) => c.id === communityB)).toBe(false);
    expect((await root.req("POST", "/invitations/accept", { token: invitation.body.token })).status).toBe(403);
    expect((await member.req("POST", "/invitations/accept", { token: invitation.body.token })).status).toBe(200);
    expect((await member.req("POST", "/invitations/accept", { token: invitation.body.token })).status).toBe(404);
    const fresh = await ownerB.req("POST", `${admin(communityB)}/invitations`, { email: "Invited@Example.com" });
    const invited = new TestUser(cluster.servers[0]!.url);
    const signup = await invited.req("POST", "/auth/register", { email: "invited@example.com", password: "correct horse battery", displayName: "Invited" });
    expect(signup.body.user.status).toBe("active");
    // Claiming an invited email alone must never reveal private communities.
    expect((await invited.req("GET", "/communities")).body.communities.some((c: { id: string }) => c.id === communityB)).toBe(false);
    expect((await invited.req("POST", "/invitations/accept", { token: fresh.body.token })).status).toBe(200);
    expect((await invited.req("GET", "/communities")).body.communities.some((c: { id: string; isMember: boolean }) => c.id === communityB && c.isMember)).toBe(true);
    expect((await ownerB.req("GET", `${admin(communityB)}/members`)).body.invitations).toEqual([]);
  });

  it("rejects revoked, replaced, expired and malformed invitation links", async () => {
    const user = await TestUser.register(cluster.servers[0]!.url, "Invite controls");
    const first = await ownerB.req("POST", `${admin(communityB)}/invitations`, { email: email(user) });
    const replacement = await ownerB.req("POST", `${admin(communityB)}/invitations`, { email: email(user) });
    expect((await user.req("POST", "/invitations/accept", { token: first.body.token })).status).toBe(404);
    await ownerB.req("DELETE", `${admin(communityB)}/invitations`, { email: email(user) });
    expect((await user.req("POST", "/invitations/accept", { token: replacement.body.token })).status).toBe(404);
    const expired = await ownerB.req("POST", `${admin(communityB)}/invitations`, { email: email(user) });
    const { sql } = await import("drizzle-orm");
    await cluster.servers[0]!.relay.db.execute(sql`update invitations set expires_at = now() - interval '1 minute' where community_id = ${communityB} and email = ${email(user)}`);
    expect((await user.req("POST", "/invitations/accept", { token: expired.body.token })).status).toBe(404);
    expect((await user.req("POST", "/invitations/accept", { token: "bad-token" })).status).toBe(400);
  });

  it("supports the same channel slug in different communities and enforces private channel membership", async () => {
    const a = await ownerA.req("POST", `${admin(communityA)}/rooms`, { slug: "staff", name: "Staff", isPrivate: true });
    const b = await ownerB.req("POST", `${admin(communityB)}/rooms`, { slug: "staff", name: "Staff", isPrivate: true });
    expect(a.status).toBe(201);
    expect(b.status).toBe(201);
    const id = a.body.id;
    expect((await member.req("GET", `/rooms/${id}/messages`)).status).toBe(404);
    expect((await member.req("POST", `/rooms/${id}/join`)).status).toBe(404);
    const socket = await member.connect(cluster.servers[1]!.wsUrl);
    await socket.ready();
    expect((await socket.subscribe([id])).denied).toContain(id);
    expect((await socket.sendAndAck(id, "Denied")).type).toBe("message.error");
    expect((await ownerA.req("DELETE", `${admin(communityA)}/rooms/${b.body.id}`)).status).toBe(404);
    expect((await ownerA.req("PUT", `${admin(communityA)}/rooms/${id}/members/${member.id}`)).status).toBe(200);
    await socket.subscribe([id]);
    expect((await socket.sendAndAck(id, "Private history")).type).toBe("message.ack");
    expect((await member.req("GET", `/rooms/${id}/messages`)).body.messages).toHaveLength(1);
    await ownerA.req("DELETE", `${admin(communityA)}/rooms/${id}/members/${member.id}`);
    await socket.waitFor("membership.revoked", (e) => e.roomId === id);
    expect((await member.req("GET", `/rooms/${id}/messages`)).status).toBe(404);
    expect((await socket.sendAndAck(id, "Denied again")).type).toBe("message.error");
    socket.close();
  });

  it("scopes online presence to the selected community and denies unauthorized snapshots", async () => {
    const watcher = await member.connect(cluster.servers[1]!.wsUrl);
    const ownerSocket = await ownerB.connect(cluster.servers[0]!.wsUrl);
    await Promise.all([watcher.ready(), ownerSocket.ready()]);
    await ownerSocket.waitFor("presence.snapshot");
    watcher.send({ type: "presence.request", communityId: communityB });
    const snapshot = await watcher.waitFor("presence.snapshot", (e) => e.communityId === communityB);
    expect(snapshot.entries.some((e) => e.user.id === ownerB.id)).toBe(true);
    expect(snapshot.entries.some((e) => e.user.id === root.id || e.user.id === ownerA.id)).toBe(false);
    const outsider = await root.connect(cluster.servers[0]!.wsUrl);
    await outsider.ready();
    outsider.send({ type: "presence.request", communityId: communityB });
    expect((await outsider.waitFor("presence.snapshot", (e) => e.communityId === communityB)).entries).toEqual([]);
    watcher.close(); ownerSocket.close(); outsider.close();
  });

  it("blocks only within a community and preserves access elsewhere", async () => {
    expect((await ownerA.req("PATCH", `${admin(communityA)}/members/${member.id}`, { status: "blocked" })).status).toBe(200);
    expect((await member.req("POST", `/communities/${communityA}/join`)).status).toBe(403);
    expect((await member.req("GET", "/auth/me")).body.user.status).toBe("active");
    expect((await member.req("POST", "/auth/refresh")).status).toBe(200);
    const roomB = (await ownerB.req("GET", `${admin(communityB)}/rooms`)).body.rooms.find((r: { slug: string }) => r.slug === "general");
    const socket = await member.connect(cluster.servers[1]!.wsUrl);
    await socket.ready();
    expect((await socket.sendAndAck(roomB.id, "Still allowed here")).type).toBe("message.ack");
    socket.close();
    expect((await ownerA.req("POST", `${admin(communityA)}/invitations`, { email: email(member) })).status).toBe(409);
    expect((await ownerA.req("PATCH", `${admin(communityA)}/members/${ownerA.id}`, { status: "blocked" })).status).toBe(403);
    expect((await ownerA.req("PATCH", `${admin(communityA)}/members/${member.id}`, { status: "active" })).status).toBe(200);
  });

  it("lets the superadmin reassign owners and suspend communities without deleting history", async () => {
    expect((await root.req("PATCH", `/superadmin/communities/${communityA}`, { ownerEmail: email(member) })).status).toBe(200);
    expect((await ownerA.req("GET", `${admin(communityA)}/members`)).status).toBe(403);
    expect((await member.req("GET", `${admin(communityA)}/members`)).status).toBe(200);
    const room = (await member.req("GET", `${admin(communityA)}/rooms`)).body.rooms.find((r: { slug: string }) => r.slug === "general");
    const socket = await member.connect(cluster.servers[1]!.wsUrl);
    await socket.ready();
    expect((await socket.sendAndAck(room.id, "Before suspension")).type).toBe("message.ack");
    await root.req("PATCH", `/superadmin/communities/${communityA}`, { isSuspended: true });
    expect((await member.req("GET", `/rooms/${room.id}/messages`)).status).toBe(404);
    expect((await socket.sendAndAck(room.id, "During suspension")).type).toBe("message.error");
    await root.req("PATCH", `/superadmin/communities/${communityA}`, { isSuspended: false });
    expect((await member.req("GET", `/rooms/${room.id}/messages`)).body.messages.some((m: { body: string }) => m.body === "Before suspension")).toBe(true);
    socket.close();
  });

  it("reserves global account suspension for the superadmin", async () => {
    const target = await TestUser.register(cluster.servers[1]!.url, "Suspend me");
    expect((await ownerB.req("PATCH", `/superadmin/members/${target.id}`, { status: "blocked" })).status).toBe(403);
    const socket = await target.connect(cluster.servers[1]!.wsUrl);
    await socket.ready();
    expect((await root.req("PATCH", `/superadmin/members/${target.id}`, { status: "blocked" })).status).toBe(200);
    expect((await socket.waitClose()).code).toBe(4401);
    expect((await target.req("GET", "/rooms")).status).toBe(403);
    expect((await target.req("POST", "/auth/refresh")).status).toBe(401);
    expect((await root.req("PATCH", `/superadmin/members/${root.id}`, { status: "blocked" })).status).toBe(403);
  });

  it("permanently deletes channels without reseeding deleted defaults", async () => {
    const general = (await root.rooms()).find((r) => r.slug === "general")!;
    expect((await root.req("DELETE", `${admin(DEFAULT_COMMUNITY_ID)}/rooms/${general.id}`)).status).toBe(200);
    await seedDefaultChannels(cluster.servers[0]!.relay.db);
    expect((await root.rooms()).some((r) => r.id === general.id)).toBe(false);
  });

  it("handles concurrent sends and channel deletion without database deadlocks", async () => {
    const db = cluster.servers[0]!.relay.db;
    for (let round = 0; round < 4; round++) {
      const roomId = await createRoom(db, communityB, ownerB.id, { slug: `concurrent-${round}`, name: "Concurrent", topic: "", isPrivate: false });
      const results = await Promise.allSettled([
        ...Array.from({ length: 8 }, () => sendMessage(db, { userId: ownerB.id, roomId, clientId: randomUUID(), body: "A queued send" })),
        deleteRoom(db, communityB, roomId),
      ]);
      expect(results.at(-1)?.status).toBe("fulfilled");
      for (const result of results.slice(0, -1)) if (result.status === "rejected") {
        expect(["not_found", "forbidden"]).toContain(result.reason.code);
      }
    }
  });
});
