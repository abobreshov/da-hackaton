CREATE TABLE "friendships" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_a" integer NOT NULL,
	"user_b" integer NOT NULL,
	"status" text NOT NULL,
	"requested_by" integer NOT NULL,
	"request_text" text,
	"created_at" timestamp with time zone DEFAULT now(),
	"accepted_at" timestamp with time zone,
	CONSTRAINT "friendships_status_check" CHECK ("friendships"."status" IN ('pending','accepted')),
	CONSTRAINT "friendships_requested_by_check" CHECK ("friendships"."requested_by" IN ("friendships"."user_a", "friendships"."user_b")),
	CONSTRAINT "friendships_canonical_order_check" CHECK ("friendships"."user_a" < "friendships"."user_b")
);
--> statement-breakpoint
CREATE TABLE "user_bans" (
	"banner_id" integer NOT NULL,
	"banned_id" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "user_bans_banner_id_banned_id_pk" PRIMARY KEY("banner_id","banned_id")
);
--> statement-breakpoint
ALTER TABLE "friendships" ADD CONSTRAINT "friendships_user_a_users_id_fk" FOREIGN KEY ("user_a") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "friendships" ADD CONSTRAINT "friendships_user_b_users_id_fk" FOREIGN KEY ("user_b") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "friendships" ADD CONSTRAINT "friendships_requested_by_users_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_bans" ADD CONSTRAINT "user_bans_banner_id_users_id_fk" FOREIGN KEY ("banner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_bans" ADD CONSTRAINT "user_bans_banned_id_users_id_fk" FOREIGN KEY ("banned_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "friendships_pair_unique" ON "friendships" USING btree ("user_a","user_b");--> statement-breakpoint
CREATE INDEX "friendships_user_a_accepted_idx" ON "friendships" USING btree ("user_a") WHERE "friendships"."status" = 'accepted';--> statement-breakpoint
CREATE INDEX "friendships_user_b_accepted_idx" ON "friendships" USING btree ("user_b") WHERE "friendships"."status" = 'accepted';--> statement-breakpoint
CREATE INDEX "friendships_pending_idx" ON "friendships" USING btree ("user_b") WHERE "friendships"."status" = 'pending';--> statement-breakpoint
CREATE INDEX "user_bans_banned_idx" ON "user_bans" USING btree ("banned_id");