CREATE TABLE "dm_channels" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_low" integer NOT NULL,
	"user_high" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now(),
	"frozen_at" timestamp with time zone,
	CONSTRAINT "dm_channels_canonical_order_check" CHECK ("dm_channels"."user_low" < "dm_channels"."user_high")
);
--> statement-breakpoint
CREATE TABLE "messages" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"room_id" integer,
	"dm_id" integer,
	"author_id" integer NOT NULL,
	"body" text NOT NULL,
	"reply_to" bigint,
	"edited_at" timestamp with time zone,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "messages_scope_xor_check" CHECK (("messages"."room_id" IS NOT NULL) <> ("messages"."dm_id" IS NOT NULL))
);
--> statement-breakpoint
ALTER TABLE "dm_channels" ADD CONSTRAINT "dm_channels_user_low_users_id_fk" FOREIGN KEY ("user_low") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dm_channels" ADD CONSTRAINT "dm_channels_user_high_users_id_fk" FOREIGN KEY ("user_high") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_room_id_rooms_id_fk" FOREIGN KEY ("room_id") REFERENCES "public"."rooms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_dm_id_dm_channels_id_fk" FOREIGN KEY ("dm_id") REFERENCES "public"."dm_channels"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_reply_to_messages_id_fk" FOREIGN KEY ("reply_to") REFERENCES "public"."messages"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "dm_channels_pair_unique" ON "dm_channels" USING btree ("user_low","user_high");--> statement-breakpoint
CREATE INDEX "messages_room_created_idx" ON "messages" USING btree ("room_id","created_at" DESC NULLS LAST) WHERE "messages"."deleted_at" IS NULL;--> statement-breakpoint
CREATE INDEX "messages_dm_created_idx" ON "messages" USING btree ("dm_id","created_at" DESC NULLS LAST) WHERE "messages"."deleted_at" IS NULL;--> statement-breakpoint
CREATE INDEX "messages_reply_to_idx" ON "messages" USING btree ("reply_to") WHERE "messages"."reply_to" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "messages_author_idx" ON "messages" USING btree ("author_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "messages_created_prune_idx" ON "messages" USING btree ("created_at") WHERE "messages"."deleted_at" IS NULL;