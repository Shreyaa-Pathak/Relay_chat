import { describe, expect, it } from "vitest";
import type { Community } from "@relay/shared";
import { channelPath, communityPath, resolveCommunity } from "./paths";

const community: Community = {
  id: "00000000-0000-4000-8000-000000000001", slug: "relay", name: "Relay",
  description: null, isPrivate: false, isSuspended: false, isMember: true, role: "member", memberCount: 1,
};

describe("community URLs", () => {
  it("uses readable slugs for channel and community links", () => {
    expect(channelPath("relay", "random")).toBe("/c/relay/random");
    expect(communityPath("studio")).toBe("/communities/studio");
  });
  it("resolves both readable links and existing UUID bookmarks to the same community", () => {
    expect(resolveCommunity([community], "relay")).toBe(community);
    expect(resolveCommunity([community], community.id)).toBe(community);
  });
  it("keeps a missing or inaccessible community from opening another community", () => {
    expect(resolveCommunity([community], "unknown")).toBeUndefined();
  });
  it("uses a joined community for legacy single-channel links", () => {
    expect(resolveCommunity([{ ...community, id: "other", isMember: false }, community])).toBe(community);
  });
});
