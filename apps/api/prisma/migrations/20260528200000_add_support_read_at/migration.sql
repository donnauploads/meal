-- Read receipt timestamp for admin-authored support messages. NULL
-- until the customer opens the chat (which calls
-- POST /support/thread/:id/read).
ALTER TABLE "SupportMessage" ADD COLUMN "readAt" TIMESTAMP(3);
