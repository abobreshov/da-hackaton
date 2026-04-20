DROP INDEX "messages_room_created_idx";--> statement-breakpoint
DROP INDEX "messages_dm_created_idx";--> statement-breakpoint
CREATE INDEX "messages_room_created_idx" ON "messages" USING btree ("room_id","created_at" DESC NULLS LAST,"id" DESC NULLS LAST) WHERE "messages"."deleted_at" IS NULL;--> statement-breakpoint
CREATE INDEX "messages_dm_created_idx" ON "messages" USING btree ("dm_id","created_at" DESC NULLS LAST,"id" DESC NULLS LAST) WHERE "messages"."deleted_at" IS NULL;