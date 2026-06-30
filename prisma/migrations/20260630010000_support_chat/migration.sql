-- Support chat: har bir foydalanuvchi uchun bitta suhbat + xabarlar.

CREATE TABLE "support_conversation" (
    "id" SERIAL NOT NULL,
    "user_id" INTEGER NOT NULL,
    "company_id" INTEGER,
    "status" VARCHAR(20) NOT NULL DEFAULT 'open',
    "last_message_at" TIMESTAMP(3),
    "last_message_text" TEXT,
    "user_unread" INTEGER NOT NULL DEFAULT 0,
    "agent_unread" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "support_conversation_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "support_conversation_user_id_key" ON "support_conversation"("user_id");
CREATE INDEX "support_conversation_company_id_idx" ON "support_conversation"("company_id");
CREATE INDEX "support_conversation_status_last_message_at_idx" ON "support_conversation"("status", "last_message_at");

CREATE TABLE "support_message" (
    "id" SERIAL NOT NULL,
    "conversation_id" INTEGER NOT NULL,
    "sender_id" INTEGER NOT NULL,
    "sender_role" VARCHAR(10) NOT NULL,
    "body" TEXT,
    "attachments" JSONB,
    "is_read" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "support_message_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "support_message_conversation_id_created_at_idx" ON "support_message"("conversation_id", "created_at");

ALTER TABLE "support_conversation" ADD CONSTRAINT "support_conversation_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users_user"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "support_conversation" ADD CONSTRAINT "support_conversation_company_id_fkey"
    FOREIGN KEY ("company_id") REFERENCES "company"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "support_message" ADD CONSTRAINT "support_message_conversation_id_fkey"
    FOREIGN KEY ("conversation_id") REFERENCES "support_conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "support_message" ADD CONSTRAINT "support_message_sender_id_fkey"
    FOREIGN KEY ("sender_id") REFERENCES "users_user"("id") ON DELETE CASCADE ON UPDATE CASCADE;
