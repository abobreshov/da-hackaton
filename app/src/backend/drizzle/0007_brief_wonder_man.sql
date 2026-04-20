CREATE TABLE "attachments" (
	"id" uuid PRIMARY KEY NOT NULL,
	"room_id" integer,
	"dm_id" integer,
	"message_id" bigint,
	"uploader_id" integer NOT NULL,
	"filename" text NOT NULL,
	"mime" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"path" text NOT NULL,
	"comment" text,
	"is_image" boolean NOT NULL,
	"created_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "attachments_scope_xor_check" CHECK (("attachments"."room_id" IS NOT NULL) <> ("attachments"."dm_id" IS NOT NULL))
);
--> statement-breakpoint
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_room_id_rooms_id_fk" FOREIGN KEY ("room_id") REFERENCES "public"."rooms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_dm_id_dm_channels_id_fk" FOREIGN KEY ("dm_id") REFERENCES "public"."dm_channels"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_message_id_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."messages"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_uploader_id_users_id_fk" FOREIGN KEY ("uploader_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "attachments_message_idx" ON "attachments" USING btree ("message_id") WHERE "attachments"."message_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "attachments_room_created_idx" ON "attachments" USING btree ("room_id","created_at") WHERE "attachments"."room_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "attachments_dm_created_idx" ON "attachments" USING btree ("dm_id","created_at") WHERE "attachments"."dm_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "attachments_created_prune_idx" ON "attachments" USING btree ("created_at");