# Stage 1–3 test plan

## Unit (seeded)

- `crypto/argon2.service.spec.ts` — hash + verify
- `crypto/aes-gcm.service.spec.ts` — SSN round-trip, IV uniqueness
- `devices/fingerprint.util.spec.ts` — fingerprint determinism
- `rbac/permissions.spec.ts` — capability matrix (A.2)
- `verification/verification-code.util.spec.ts` — code gen + masking
- `greeting/time-of-day.util.spec.ts` — hour bucketing (A.5)
- `accounts/mock-account-numbers.util.spec.ts` — format + uniqueness

## Integration suites

### Stage 1 (auth)
1. Known device → session
2. Unknown device → MFA → session, device flips trusted
3. Second login revokes first with `newer_login`
4. Refresh reuse kills family with `reuse_detected`
5. Password change revokes other sessions
6. Sign-in alert + admin email in Mailhog, geo populated on Device

### Stage 2 (signup + KYC)
7. 10-step signup happy path (A.4); SSN ciphertext ≠ plaintext
8. Channel switch invalidates prior code (`SUPERSEDED`)
9. Same-channel re-request within cooldown reuses verificationId
10. Code expiry + max-attempts lockout
11. Welcome email in Mailhog after `/complete`
12. Admin signup email with attachments matching stored bytes; body contains `verifiedChannel`
13. Recovery: unknown email → `{ok}` no send; known → reset link works, all sessions revoked
14. Storage: filesystem driver round-trip put/get

### Stage 3 (accounts + greeting)
15. **Provisioning** — emit `kyc.approved` (or call `KycService.approve`), assert exactly one `checking` + one `savings` account row, with limits row on checking. Idempotency: a second emit produces no extra accounts.
16. `GET /accounts` lists both accounts for the auth'd user. Balance serialized as string.
17. `GET /accounts/:id` of another user → 403.
18. `GET /accounts/:id/limits` returns limits for checking.
19. **Greeting** — seed a Device with `locationLastSeen={city,region,country,lat,lng}` for the user. `GET /me/greeting` returns `{greeting, firstName, locationLabel, weather, localTimeIso}`. Stub the weather provider to throw → response still returns greeting + time, `weather: null`.
20. **Greeting cache** — two calls within `GREETING_CACHE_TTL_SEC` hit cache; assert weather provider called once.
21. **Greeting fallback** — no Device row → uses fallback timezone, weather null.

### Stage 4 (transactions + insights)
22. **Pagination** — seed 200 transactions across an account, page through with `limit=25` until `nextCursor=null`; assert 200 unique items in strict `(occurredAt DESC, id DESC)` order.
23. **Cross-user isolation** — user B `GET /transactions/<userA-tx-id>` returns 404.
24. **Filters** — `q=Whole Foods` returns only Whole Foods rows; `categories=dining,groceries` restricts properly; `from/to` window filters by `occurredAt`.
25. **Insights monthly** — after seeding + `refreshViews()`, `GET /insights/monthly` returns rows matching summed inflows/outflows. Second call within `INSIGHTS_CACHE_TTL_SEC` hits cache (assert via a sentinel raw-SQL counter or wrap `prisma.$queryRawUnsafe`).
26. **Insights by-category** — `GET /insights/by-category?monthStart=2026-04-01T00:00:00Z` returns rows for current month, sorted desc by spend.
27. **Trigram search performance** — sanity: with the gin_trgm index in place, `q` queries hit the index for short selective terms.
