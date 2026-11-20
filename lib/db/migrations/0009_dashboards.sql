CREATE TABLE "bk_dashboards" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_user_id" text,
	"department" text,
	"name" text NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"layout" jsonb NOT NULL,
	"updated_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "bk_dashboards_owner_xor_department" CHECK (("bk_dashboards"."owner_user_id" IS NULL) <> ("bk_dashboards"."department" IS NULL))
);
--> statement-breakpoint
ALTER TABLE "bk_dashboards" ADD CONSTRAINT "bk_dashboards_owner_user_id_bk_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."bk_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "bk_dashboards_one_template_per_department" ON "bk_dashboards" USING btree ("department") WHERE "bk_dashboards"."department" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "bk_dashboards_one_default_per_user" ON "bk_dashboards" USING btree ("owner_user_id") WHERE "bk_dashboards"."is_default";--> statement-breakpoint
CREATE INDEX "bk_dashboards_owner_idx" ON "bk_dashboards" USING btree ("owner_user_id");