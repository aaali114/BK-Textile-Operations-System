-- Baseline: the schema as it stood before migrations were introduced
-- (it was created with drizzle-kit push). Written to be a no-op on a database
-- that already has these tables, and to build them on an empty database.
CREATE TABLE IF NOT EXISTS "bk_activity" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"actor" text NOT NULL,
	"actor_id" text,
	"description" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" text,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "bk_inspections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"material_id" uuid NOT NULL,
	"inspection_type" text NOT NULL,
	"result" text NOT NULL,
	"defect_count" double precision DEFAULT 0 NOT NULL,
	"notes" text DEFAULT '' NOT NULL,
	"inspected_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "bk_material_lots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid,
	"material" text NOT NULL,
	"type" text NOT NULL,
	"supplier" text NOT NULL,
	"lot_reference" text NOT NULL,
	"quantity" double precision NOT NULL,
	"unit" text NOT NULL,
	"status" text DEFAULT 'pending_qc' NOT NULL,
	"received_at" date NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "bk_orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"reference" text NOT NULL,
	"buyer" text NOT NULL,
	"agency_name" text,
	"previous_order_reference" text,
	"order_value" numeric(14, 2),
	"currency_code" text,
	"po_number" text,
	"style" text NOT NULL,
	"description" text,
	"quantity" integer NOT NULL,
	"delivery_date" date NOT NULL,
	"status" text DEFAULT 'development' NOT NULL,
	"priority" text DEFAULT 'normal' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "bk_orders_reference_unique" UNIQUE("reference")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "bk_order_files" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"file_type" text NOT NULL,
	"original_name" text NOT NULL,
	"content_type" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"object_path" text NOT NULL,
	"uploaded_by" text NOT NULL,
	"uploaded_by_name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"uploaded_at" timestamp with time zone,
	CONSTRAINT "bk_order_files_object_path_unique" UNIQUE("object_path")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "bk_work_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"title" text NOT NULL,
	"department" text NOT NULL,
	"assignee" text,
	"due_date" date NOT NULL,
	"status" text DEFAULT 'not_started' NOT NULL,
	"priority" text DEFAULT 'normal' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "bk_inspections" ADD CONSTRAINT "bk_inspections_material_id_bk_material_lots_id_fk" FOREIGN KEY ("material_id") REFERENCES "public"."bk_material_lots"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "bk_material_lots" ADD CONSTRAINT "bk_material_lots_order_id_bk_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."bk_orders"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "bk_order_files" ADD CONSTRAINT "bk_order_files_order_id_bk_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."bk_orders"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "bk_work_items" ADD CONSTRAINT "bk_work_items_order_id_bk_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."bk_orders"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;