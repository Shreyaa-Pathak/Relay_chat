import type { AdminMember, Community, CreateCommunityInput, CreateRoomInput, HistoryPage, Me, Message, Room } from "@relay/shared";

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
  }
}

type Json = Record<string, unknown> | undefined;

let refreshing: Promise<boolean> | null = null;
let onSessionLost: (() => void) | null = null;

export function setSessionLostHandler(fn: () => void) {
  onSessionLost = fn;
}

async function raw(method: string, path: string, body?: Json): Promise<Response> {
  return fetch(`/api/v1${path}`, {
    method,
    credentials: "same-origin",
    headers: {
      accept: "application/json",
      ...(method !== "GET" ? { "x-relay-csrf": "1" } : {}),
      ...(body !== undefined ? { "content-type": "application/json" } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

/** Single-flight refresh: many concurrent 401s trigger one refresh request. */
export function refreshSession(): Promise<boolean> {
  refreshing ??= raw("POST", "/auth/refresh")
    .then((r) => r.ok)
    .catch(() => false)
    .finally(() => {
      setTimeout(() => (refreshing = null), 0);
    });
  return refreshing;
}

async function request<T>(method: string, path: string, body?: Json, retried = false): Promise<T> {
  let res: Response;
  try {
    res = await raw(method, path, body);
  } catch {
    throw new ApiError(0, "network", "Can't reach the Relay server. Check your connection.");
  }
  if (res.status === 401 && (path === "/auth/me" || !path.startsWith("/auth/")) && !retried) {
    if (await refreshSession()) return request<T>(method, path, body, true);
    onSessionLost?.();
  }
  const text = await res.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    /* non-JSON (e.g. a platform error page) */
  }
  if (!res.ok) {
    const e = (data as { error?: { code: string; message: string; details?: unknown } } | null)?.error;
    throw new ApiError(res.status, e?.code ?? "http_" + res.status, e?.message ?? `Request failed (${res.status})`, e?.details);
  }
  return data as T;
}

export const api = {
  communities: () => request<{ communities: Community[] }>("GET", "/communities"),
  joinCommunity: (id: string) => request("POST", `/communities/${id}/join`),
  allCommunities: () => request<{ communities: Community[] }>("GET", "/superadmin/communities"),
  createCommunity: (input: CreateCommunityInput) => request<{ id: string }>("POST", "/superadmin/communities", input),
  updateCommunity: (id: string, input: { isSuspended?: boolean; ownerEmail?: string }) => request("PATCH", `/superadmin/communities/${id}`, input),
  platformMembers: () => request<{ members: Pick<Me, "id" | "email" | "displayName" | "role" | "status">[] }>("GET", "/superadmin/members"),
  suspendAccount: (id: string, status: "active" | "blocked") => request("PATCH", `/superadmin/members/${id}`, { status }),
  adminMembers: (communityId: string) => request<{ members: AdminMember[]; invitations: { email: string }[] }>("GET", `/communities/${communityId}/admin/members`),
  adminRooms: (communityId: string) => request<{ rooms: Room[] }>("GET", `/communities/${communityId}/admin/rooms`),
  invite: (communityId: string, email: string) => request<{ token: string }>("POST", `/communities/${communityId}/admin/invitations`, { email }),
  acceptInvite: (token: string) => request<{ community: { id: string; slug: string } }>("POST", "/invitations/accept", { token }),
  revokeInvite: (communityId: string, email: string) => request("DELETE", `/communities/${communityId}/admin/invitations`, { email }),
  moderate: (communityId: string, id: string, status: Me["status"]) => request("PATCH", `/communities/${communityId}/admin/members/${id}`, { status }),
  createRoom: (communityId: string, input: CreateRoomInput) => request<{ id: string }>("POST", `/communities/${communityId}/admin/rooms`, input),
  deleteRoom: (communityId: string, id: string) => request("DELETE", `/communities/${communityId}/admin/rooms/${id}`),
  channelMember: (communityId: string, roomId: string, userId: string, add: boolean) => request(add ? "PUT" : "DELETE", `/communities/${communityId}/admin/rooms/${roomId}/members/${userId}`),
  health: () => request<{ ok: boolean }>("GET", "/health"),
  me: () => request<{ user: Me }>("GET", "/auth/me"),
  login: (email: string, password: string) => request<{ user: Me }>("POST", "/auth/login", { email, password }),
  register: (email: string, password: string, displayName: string) =>
    request<{ user: Me }>("POST", "/auth/register", { email, password, displayName }),
  logout: () => request<{ ok: true }>("POST", "/auth/logout"),
  rooms: () => request<{ rooms: Room[] }>("GET", "/rooms"),
  join: (roomId: string) => request<{ ok: true }>("POST", `/rooms/${roomId}/join`),
  leave: (roomId: string) => request<{ ok: true }>("POST", `/rooms/${roomId}/leave`),
  history: (roomId: string, beforeSeq?: number, limit = 50) =>
    request<HistoryPage>("GET", `/rooms/${roomId}/messages?limit=${limit}${beforeSeq ? `&beforeSeq=${beforeSeq}` : ""}`),
  after: (roomId: string, afterSeq: number, limit = 500) => request<HistoryPage>("GET", `/rooms/${roomId}/messages?afterSeq=${afterSeq}&limit=${limit}`),
  replies: (parentId: string, afterSeq = 0, limit = 50) =>
    request<{ parent: Message; messages: Message[]; hasMore: boolean }>("GET", `/messages/${parentId}/replies?afterSeq=${afterSeq}&limit=${limit}`),
};
