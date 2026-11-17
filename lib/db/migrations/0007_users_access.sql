CREATE TABLE "bk_user_area_access" (
	"user_id" text NOT NULL,
	"area" text NOT NULL,
	"level" text NOT NULL,
	"granted_by" text NOT NULL,
	"granted_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "bk_user_area_access_user_id_area_pk" PRIMARY KEY("user_id","area"),
	CONSTRAINT "bk_user_area_access_level_valid" CHECK ("bk_user_area_access"."level" IN ('read', 'write'))
);
--> statement-breakpoint
CREATE TABLE "bk_user_permissions" (
	"user_id" text NOT NULL,
	"permission" text NOT NULL,
	"granted_by" text NOT NULL,
	"granted_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "bk_user_permissions_user_id_permission_pk" PRIMARY KEY("user_id","permission")
);
--> statement-breakpoint
CREATE TABLE "bk_users" (
	"id" text PRIMARY KEY NOT NULL,
	"email" text,
	"name" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"role" text DEFAULT 'user' NOT NULL,
	"department" text,
	"approved_by" text,
	"approved_at" timestamp with time zone,
	"last_seen_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "bk_users_status_valid" CHECK ("bk_users"."status" IN ('pending', 'active', 'disabled')),
	CONSTRAINT "bk_users_role_valid" CHECK ("bk_users"."role" IN ('admin', 'deputy', 'user'))
);
--> statement-breakpoint
ALTER TABLE "bk_user_area_access" ADD CONSTRAINT "bk_user_area_access_user_id_bk_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."bk_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bk_user_permissions" ADD CONSTRAINT "bk_user_permissions_user_id_bk_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."bk_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "bk_user_permissions_permission_idx" ON "bk_user_permissions" USING btree ("permission");--> statement-breakpoint
CREATE UNIQUE INDEX "bk_users_one_admin" ON "bk_users" USING btree ("role") WHERE "bk_users"."role" = 'admin';--> statement-breakpoint
CREATE UNIQUE INDEX "bk_users_one_deputy" ON "bk_users" USING btree ("role") WHERE "bk_users"."role" = 'deputy';