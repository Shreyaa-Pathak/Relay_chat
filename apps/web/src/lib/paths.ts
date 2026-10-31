import type { Community } from "@relay/shared";

export function communityPath(slug: string) {
  return `/communities/${encodeURIComponent(slug)}`;
}

export function channelPath(communitySlug: string, channelSlug: string) {
  return `/c/${encodeURIComponent(communitySlug)}/${encodeURIComponent(channelSlug)}`;
}

/** Resolve old ID links as well as readable slug links after communities load. */
export function resolveCommunity(communities: Community[], key?: string) {
  if (!key) return communities.find((c) => c.isMember);
  return communities.find((c) => c.id === key) ?? communities.find((c) => c.slug === key);
}
