import { afterEach, describe, expect, it, vi } from "vitest";
import type { Me } from "@relay/shared";
import type { Db } from "../db/client.js";
import { assertActive, assertOwner, assertSuperadmin } from "./admin.js";
import { assertCommunityMember } from "./communities.js";
import { getMe } from "./users.js";

vi.mock("./users.js", () => ({ getMe: vi.fn() }));
vi.mock("./communities.js", () => ({ assertCommunityMember: vi.fn() }));
const communityId = "00000000-0000-4000-8000-000000000002";
const db = {} as Db;
const user: Me = { id: "00000000-0000-4000-8000-000000000001", email: "member@example.com", displayName: "Member", avatarColor: "amber", role: "member", status: "active" };
afterEach(() => vi.resetAllMocks());

describe("community permissions", () => {
  it("lets active members chat but denies owner operations", async () => {
    vi.mocked(getMe).mockResolvedValue(user);
    vi.mocked(assertCommunityMember).mockResolvedValue("member");
    await expect(assertActive(db, user.id)).resolves.toEqual(user);
    await expect(assertOwner(db, user.id, communityId)).rejects.toMatchObject({ code: "forbidden" });
  });
  it("allows active owners to administer the workspace", async () => {
    vi.mocked(getMe).mockResolvedValue(user);
    vi.mocked(assertCommunityMember).mockResolvedValue("owner");
    await expect(assertOwner(db, user.id, communityId)).resolves.toBeUndefined();
  });
  it.each(["pending", "rejected", "blocked"] as const)("denies chat and administration to %s accounts, including owners", async (status) => {
    vi.mocked(getMe).mockResolvedValue({ ...user, role: "owner", status });
    await expect(assertActive(db, user.id)).rejects.toMatchObject({ code: "forbidden" });
    await expect(assertOwner(db, user.id, communityId)).rejects.toMatchObject({ code: "forbidden" });
  });
  it("does not give a superadmin implicit ownership of private communities", async () => {
    vi.mocked(getMe).mockResolvedValue({ ...user, role: "superadmin" });
    vi.mocked(assertCommunityMember).mockRejectedValue(new Error("Community not found"));
    await expect(assertSuperadmin(db, user.id)).resolves.toBeUndefined();
    await expect(assertOwner(db, user.id, communityId)).rejects.toThrow("Community not found");
  });
  it("denies community creation to ordinary accounts", async () => {
    vi.mocked(getMe).mockResolvedValue(user);
    await expect(assertSuperadmin(db, user.id)).rejects.toMatchObject({ code: "forbidden" });
  });
  it("rejects tokens for deleted accounts", async () => {
    vi.mocked(getMe).mockResolvedValue(null);
    await expect(assertOwner(db, user.id, communityId)).rejects.toMatchObject({ code: "unauthorized" });
  });
});
