CREATE TABLE "bk_buyers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"abbreviation" text NOT NULL,
	"email_domains" text[] DEFAULT '{}' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "bk_buyers_name_unique" UNIQUE("name"),
	CONSTRAINT "bk_buyers_abbreviation_unique" UNIQUE("abbreviation"),
	CONSTRAINT "bk_buyers_abbreviation_format" CHECK ("bk_buyers"."abbreviation" ~ '^[A-Z]{2,5}$')
);
--> statement-breakpoint
CREATE TABLE "bk_invoice_counter" (
	"id" smallint PRIMARY KEY DEFAULT 1 NOT NULL,
	"last_number" integer NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "bk_invoice_counter_single_row" CHECK ("bk_invoice_counter"."id" = 1)
);
--> statement-breakpoint
CREATE TABLE "bk_order_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"style_number" text NOT NULL,
	"description" text NOT NULL,
	"unit_price" numeric(12, 4),
	"quantity" integer NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"source_email_id" uuid,
	"source_attachment_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "bk_order_lines_order_style_description_unique" UNIQUE("order_id","style_number","description"),
	CONSTRAINT "bk_order_lines_quantity_nonnegative" CHECK ("bk_order_lines"."quantity" >= 0)
);
--> statement-breakpoint
ALTER TABLE "bk_order_colourways" DROP CONSTRAINT "bk_order_colourways_order_code_unique";--> statement-breakpoint
ALTER TABLE "bk_order_colourways" ADD COLUMN "line_id" uuid;--> statement-breakpoint
ALTER TABLE "bk_orders" ADD COLUMN "buyer_id" uuid;--> statement-breakpoint
ALTER TABLE "bk_orders" ADD COLUMN "end_customer" text;--> statement-breakpoint
ALTER TABLE "bk_orders" ADD COLUMN "invoice_number" integer;--> statement-breakpoint
ALTER TABLE "bk_orders" ADD COLUMN "invoice_ref" text;--> statement-breakpoint
ALTER TABLE "bk_orders" ADD COLUMN "po_received_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "bk_orders" ADD COLUMN "po_issue_date" date;--> statement-breakpoint
ALTER TABLE "bk_orders" ADD COLUMN "price_terms" text;--> statement-breakpoint
ALTER TABLE "bk_orders" ADD COLUMN "payment_terms" text;--> statement-breakpoint
ALTER TABLE "bk_orders" ADD COLUMN "ship_via" text;--> statement-breakpoint
ALTER TABLE "bk_orders" ADD COLUMN "country_of_origin" text;--> statement-breakpoint
ALTER TABLE "bk_orders" ADD COLUMN "over_ship_tolerance_pct" numeric(5, 2);--> statement-breakpoint
ALTER TABLE "bk_order_lines" ADD CONSTRAINT "bk_order_lines_order_id_bk_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."bk_orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bk_order_lines" ADD CONSTRAINT "bk_order_lines_source_email_id_bk_source_emails_id_fk" FOREIGN KEY ("source_email_id") REFERENCES "public"."bk_source_emails"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bk_order_lines" ADD CONSTRAINT "bk_order_lines_source_attachment_id_bk_source_email_attachments_id_fk" FOREIGN KEY ("source_attachment_id") REFERENCES "public"."bk_source_email_attachments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bk_order_colourways" ADD CONSTRAINT "bk_order_colourways_line_id_bk_order_lines_id_fk" FOREIGN KEY ("line_id") REFERENCES "public"."bk_order_lines"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bk_orders" ADD CONSTRAINT "bk_orders_buyer_id_bk_buyers_id_fk" FOREIGN KEY ("buyer_id") REFERENCES "public"."bk_buyers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bk_order_colourways" ADD CONSTRAINT "bk_order_colourways_order_line_code_unique" UNIQUE NULLS NOT DISTINCT("order_id","line_id","code");--> statement-breakpoint
ALTER TABLE "bk_orders" ADD CONSTRAINT "bk_orders_invoice_number_unique" UNIQUE("invoice_number");--> statement-breakpoint
ALTER TABLE "bk_orders" ADD CONSTRAINT "bk_orders_invoice_ref_unique" UNIQUE("invoice_ref");--> statement-breakpoint
ALTER TABLE "bk_orders" ADD CONSTRAINT "bk_orders_buyer_po_unique" UNIQUE("buyer_id","po_number");--> statement-breakpoint
ALTER TABLE "bk_orders" ADD CONSTRAINT "bk_orders_invoice_ref_format" CHECK ("bk_orders"."invoice_ref" IS NULL OR "bk_orders"."invoice_ref" ~ '^[0-9]+/BK-[A-Z]{2,5}/[0-9]{4}$');--> statement-breakpoint
ALTER TABLE "bk_orders" ADD CONSTRAINT "bk_orders_invoice_number_with_ref" CHECK (("bk_orders"."invoice_number" IS NULL) = ("bk_orders"."invoice_ref" IS NULL));--> statement-breakpoint
-- Reference data supplied by the owner (2026-11-11). Email domains added later.
INSERT INTO "bk_buyers" ("name", "abbreviation") VALUES
	('Spartan Apparel Sourcing', 'SAS'),
	('Rainbow Sourcing', 'RS'),
	('Metropolitan Manufacturing INC', 'MMI'),
	('God''s Love Overcomes', 'LIF')
ON CONFLICT DO NOTHING;--> statement-breakpoint
-- The next order created (PO 36572) gets BK invoice 4040.
INSERT INTO "bk_invoice_counter" ("id", "last_number") VALUES (1, 4039) ON CONFLICT DO NOTHING;
