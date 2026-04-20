CREATE TABLE "user_last_read" (
	"user_id" integer NOT NULL,
	"room_id" integer,
	"dm_id" integer,
	"last_read_id" bigint,
	"last_read_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "user_last_read_scope_xor_check" CHECK (("user_last_read"."room_id" IS NOT NULL) <> ("user_last_read"."dm_id" IS NOT NULL))
);
--> statement-breakpoint
ALTER TABLE "user_last_read" ADD CONSTRAINT "user_last_read_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_last_read" ADD CONSTRAINT "user_last_read_room_id_rooms_id_fk" FOREIGN KEY ("room_id") REFERENCES "public"."rooms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_last_read" ADD CONSTRAINT "user_last_read_dm_id_dm_channels_id_fk" FOREIGN KEY ("dm_id") REFERENCES "public"."dm_channels"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "user_last_read_scope_idx" ON "user_last_read" USING btree ("user_id",COALESCE("room_id", 0),COALESCE("dm_id", 0));