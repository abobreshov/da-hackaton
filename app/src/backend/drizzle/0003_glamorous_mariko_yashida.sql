-- Required for the `rooms_name_trgm` GIN index (AC-05-04 prefix/substring search).
CREATE EXTENSION IF NOT EXISTS pg_trgm;--> statement-breakpoint
CREATE TABLE "room_invitations" (
	"id" serial PRIMARY KEY NOT NULL,
	"room_id" integer NOT NULL,
	"inviter_id" integer NOT NULL,
	"invitee_id" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now(),
	"accepted_at" timestamp with time zone,
	"rejected_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "room_memberships" (
	"room_id" integer NOT NULL,
	"user_id" integer NOT NULL,
	"role" text NOT NULL,
	"joined_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "room_memberships_room_id_user_id_pk" PRIMARY KEY("room_id","user_id"),
	CONSTRAINT "room_memberships_role_check" CHECK ("room_memberships"."role" IN ('owner','admin','member'))
);
--> statement-breakpoint
CREATE TABLE "rooms" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" varchar(128) NOT NULL,
	"description" text,
	"visibility" text NOT NULL,
	"owner_id" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now(),
	"deleted_at" timestamp with time zone,
	CONSTRAINT "rooms_name_unique" UNIQUE("name"),
	CONSTRAINT "rooms_visibility_check" CHECK ("rooms"."visibility" IN ('public','private'))
);
--> statement-breakpoint
ALTER TABLE "room_invitations" ADD CONSTRAINT "room_invitations_room_id_rooms_id_fk" FOREIGN KEY ("room_id") REFERENCES "public"."rooms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "room_invitations" ADD CONSTRAINT "room_invitations_inviter_id_users_id_fk" FOREIGN KEY ("inviter_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "room_invitations" ADD CONSTRAINT "room_invitations_invitee_id_users_id_fk" FOREIGN KEY ("invitee_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "room_memberships" ADD CONSTRAINT "room_memberships_room_id_rooms_id_fk" FOREIGN KEY ("room_id") REFERENCES "public"."rooms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "room_memberships" ADD CONSTRAINT "room_memberships_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rooms" ADD CONSTRAINT "rooms_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "room_invitations_room_invitee_unique" ON "room_invitations" USING btree ("room_id","invitee_id");--> statement-breakpoint
CREATE INDEX "room_invitations_invitee_pending_idx" ON "room_invitations" USING btree ("invitee_id") WHERE "room_invitations"."accepted_at" IS NULL AND "room_invitations"."rejected_at" IS NULL;--> statement-breakpoint
CREATE INDEX "room_memberships_user_idx" ON "room_memberships" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "rooms_name_trgm" ON "rooms" USING gin ("name" gin_trgm_ops);