# Security

- **Passwords:** bcrypt cost 12, via bcryptjs, which is pure JavaScript so there's no native build on
  Vercel. Logins for unknown emails run a dummy compare, so timing doesn't reveal which emails exist.
  Wrong password and unknown email return the same message.
- **Sessions:**
  - Access: a 15-minute HS256 JWT in the `relay_at` cookie.
  - Refresh: a random token in `relay_rt`, scoped to `/api/v1/auth`, valid 30 days, and stored as
    SHA-256 in `sessions`.
  - Refreshing rotates the token. Presenting a revoked token revokes every session for that user.
  - Both cookies are `HttpOnly` and `SameSite=Lax`, and `Secure` whenever `APP_URL` is https.
  - Nothing is stored in localStorage.
- **CSRF:** every non-GET request must carry `x-relay-csrf: 1`, which a cross-site form can't set. It
  must also send an `Origin` from the trusted list (`APP_URL` plus `TRUSTED_ORIGINS`).
- **WebSockets:**
  - The upgrade is refused (403) unless `Origin` is trusted, which prevents cross-site WebSocket
    hijacking.
  - The access cookie is verified during the handshake. Invalid or expired tokens are closed with
    4401; the client then refreshes and reconnects.
  - Frames are capped at 16 KB.
- **Authorization:**
  - Membership is checked inside the send transaction, on `room.subscribe`, on every history and
    thread read, and for typing.
  - Private rooms return 404 to non-members.
  - Leaving a room publishes `membership.revoked`, so every instance drops that user's live
    subscription at once.
- **Input:**
  - All REST bodies and socket events are validated with the shared Zod schemas.
  - Message bodies must be 1–4000 characters, and display names reject `<` and `>`.
  - React escapes all rendered text.
- **Rate limits:**
  - Per socket: bursts of 20 messages, refilling at 2 per second, plus the typing throttle.
  - Per instance: sign-in (`LOGIN_LIMIT_PER_MINUTE`, keyed on IP plus email) and sign-up
    (`REGISTER_LIMIT_PER_HOUR`, keyed on IP).
  - On Vercel these limits apply to each function instance, not globally. For a global limit, add
    Vercel Firewall rate-limit rules on `/api/v1/auth/*`.
- **Logging:**
  - Logs are structured JSON.
  - `password`, `token`, `cookie`, `body` and `secret` keys are always redacted.
  - Message bodies are never logged.
- **Headers:** `nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy` and `Permissions-Policy` are set
  in `vercel.json`, and API responses are `no-store`.

## Trusted origins

Set `APP_URL` to the production URL. Preview deployments get different URLs, so for logged-in previews
add a stable preview URL to `TRUSTED_ORIGINS`.
