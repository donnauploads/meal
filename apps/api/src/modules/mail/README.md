# Admin Mail Desk

Admin-composed, **two-way threaded email** over Resend. An admin writes a
message from one of three sender identities (desks), the customer receives a
normal branded email and replies from their own inbox, and that reply lands
back in the dashboard in the same thread.

- UI: `frontend/app/(admin)/admin/mail/page.tsx`
- API: `MailController` (`/admin/mail/*`, admin + superadmin only)
- Inbound webhook: `MailWebhookController` (`POST /webhooks/resend/inbound`, public, Svix-verified)
- Template: `common/email/templates/plain-email.ts` (reuses the branded shell)

## How threading works

Each thread gets a random `replyToken`. Outbound mail is sent **from** the desk
address with **Reply-To** `t-<replyToken>@<MAIL_REPLY_DOMAIN>`. When the customer
replies, Resend receives it on the reply subdomain and fires the
`email.received` webhook; we parse the token from the `To` address to find the
thread (falling back to the `In-Reply-To`/`References` chain). Admin replies set
`In-Reply-To` + `References` so the customer's client keeps one conversation.

The webhook payload is **metadata only** — the body + attachment bytes are
fetched separately via `resend.emails.receiving.get()` /
`receiving.attachments.get()` and the attachments are downloaded into the
Documents storage driver.

## One-time setup

1. **Sending domain** — verify your domain in Resend (already done for
   `secure-access.site`). The three desk `From:` addresses live on it.
2. **Receiving subdomain** — add `MAIL_REPLY_DOMAIN` (default
   `reply.secure-access.site`) in Resend → **Receiving**, and create the MX
   record it shows.
3. **Webhook** — create an `email.received` webhook pointing at
   `https://<api-host>/api/v1/webhooks/resend/inbound`; copy its signing secret
   into `RESEND_WEBHOOK_SECRET`.
4. **Env** — see the "Admin Mail Desk" block in `.env.example`. Only
   `RESEND_WEBHOOK_SECRET` is strictly required for inbound; the rest have
   defaults.

## ⚠️ Prisma client

The `mail_threads` migration is already applied to the DB. The generated Prisma
client must be regenerated to expose the new model delegates at runtime — this
couldn't run while the Windows query-engine DLL was locked by the dev server.
**Stop the dev server and run `npx prisma generate`** (or `pnpm build`, which
runs it). Until then the service uses an `as unknown as` cast for types, but the
delegates won't exist at runtime, so the mail endpoints will 500. This mirrors
the same note in `support.service.ts`.

## End-to-end test

1. `npx prisma generate` (server stopped) → start API + frontend.
2. `/admin/mail` → **Compose** → send to your own inbox as each desk, with an
   image attachment. Confirm the branded plain template, the `From` identity,
   and the attachment.
3. Expose the API with a tunnel (ngrok), point the Resend webhook at it, and
   **reply from your inbox** → the reply appears as an inbound bubble in the same
   thread; the sidebar **Mail** badge increments.
4. Reply from the dashboard → it arrives in your inbox inside the same
   conversation.
