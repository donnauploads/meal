-- Optional single attachment per support message (customer/admin only).
-- Images are re-encoded server-side before storage; documents are validated
-- by magic bytes and served download-only. attachmentKey is the private
-- storage key; bytes are fetched via an authenticated, thread-scoped endpoint.
ALTER TABLE "SupportMessage"
  ADD COLUMN "attachmentKey" TEXT,
  ADD COLUMN "attachmentName" TEXT,
  ADD COLUMN "attachmentType" TEXT,
  ADD COLUMN "attachmentSize" INTEGER,
  ADD COLUMN "attachmentKind" TEXT;
