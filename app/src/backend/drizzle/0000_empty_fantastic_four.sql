-- EPIC-01 / Accounts & Authentication — backend additions.
--
-- The `users` table (and the `role` / `access_status` enums) are owned by
-- auth-service. Drizzle-kit emits them here because backend's schema declares
-- a read-only `users` definition to support foreign-key references. They are
-- stripped from this migration to avoid double-creation; auth-service's own
-- migrations remain the source of truth for users/admins schema.

CREATE TABLE "password_resets" (
	"token_hash" text PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "password_resets" ADD CONSTRAINT "password_resets_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "password_resets_user_idx" ON "password_resets" USING btree ("user_id");
