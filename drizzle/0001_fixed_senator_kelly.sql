ALTER TABLE "messages" ALTER COLUMN "conversation_id" SET DATA TYPE integer;--> statement-breakpoint
ALTER TABLE "messages" ALTER COLUMN "conversation_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "tool_calls" ALTER COLUMN "conversation_id" SET DATA TYPE integer;--> statement-breakpoint
ALTER TABLE "tool_calls" ALTER COLUMN "conversation_id" DROP NOT NULL;-->statement-breakpoint
ALTER TABLE "messages" ALTER COLUMN "conversation_id" DROP DEFAULT;-->statement-breakpoint
ALTER TABLE "tool_calls" ALTER COLUMN "conversation_id" DROP DEFAULT;
