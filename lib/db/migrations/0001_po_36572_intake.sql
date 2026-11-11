CREATE TABLE "bk_order_colourways" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"buyer_reference" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"source_email_id" uuid,
	"source_attachment_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "bk_order_colourways_order_code_unique" UNIQUE("order_id","code")
);
--> statement-breakpoint
CREATE TABLE "bk_order_size_quantities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"colourway_id" uuid NOT NULL,
	"size_label" text NOT NULL,
	"size_sort" integer NOT NULL,
	"quantity" integer NOT NULL,
	"source_email_id" uuid,
	"source_attachment_id" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "bk_order_size_quantities_colourway_size_unique" UNIQUE("colourway_id","size_label"),
	CONSTRAINT "bk_order_size_quantities_quantity_nonnegative" CHECK ("bk_order_size_quantities"."quantity" >= 0)
);
--> statement-breakpoint
CREATE TABLE "bk_order_fabrics" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"colourway_id" uuid,
	"placement" text NOT NULL,
	"description" text NOT NULL,
	"composition" text,
	"construction" text,
	"gsm" integer,
	"width_cm" numeric(12, 4),
	"colour" text,
	"supplier" text,
	"consumption_per_piece" numeric(12, 4),
	"consumption_unit" text,
	"notes" text DEFAULT '' NOT NULL,
	"source_email_id" uuid,
	"source_attachment_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bk_source_email_attachments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email_id" uuid NOT NULL,
	"filename" text NOT NULL,
	"content_type" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"sha256" text NOT NULL,
	"content_id" text,
	"is_inline" boolean DEFAULT false NOT NULL,
	"object_path" text NOT NULL,
	"extract_status" text DEFAULT 'pending' NOT NULL,
	"extracted_text" text,
	"extract_error" text,
	"order_file_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "bk_source_email_attachments_object_path_unique" UNIQUE("object_path")
);
--> statement-breakpoint
CREATE TABLE "bk_source_email_orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email_id" uuid NOT NULL,
	"order_id" uuid NOT NULL,
	"match_status" text NOT NULL,
	"match_method" text NOT NULL,
	"match_reason" text,
	"matched_at" timestamp with time zone DEFAULT now() NOT NULL,
	"reviewed_by" text,
	"reviewed_at" timestamp with time zone,
	CONSTRAINT "bk_source_email_orders_email_order_unique" UNIQUE("email_id","order_id")
);
--> statement-breakpoint
CREATE TABLE "bk_source_emails" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"mailbox" text NOT NULL,
	"imap_folder" text NOT NULL,
	"imap_uidvalidity" bigint NOT NULL,
	"imap_uid" bigint NOT NULL,
	"message_id" text NOT NULL,
	"in_reply_to" text,
	"references_header" text,
	"thread_key" text,
	"from_address" text NOT NULL,
	"from_name" text,
	"to_addresses" text[] DEFAULT '{}' NOT NULL,
	"cc_addresses" text[] DEFAULT '{}' NOT NULL,
	"forwarded_via" text,
	"subject" text DEFAULT '' NOT NULL,
	"sent_at" timestamp with time zone,
	"received_at" timestamp with time zone NOT NULL,
	"body_text" text,
	"raw_object_path" text NOT NULL,
	"category" text DEFAULT 'unclassified' NOT NULL,
	"parse_status" text DEFAULT 'pending' NOT NULL,
	"parse_error" text,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL,
	"processed_at" timestamp with time zone,
	CONSTRAINT "bk_source_emails_message_id_unique" UNIQUE("message_id"),
	CONSTRAINT "bk_source_emails_raw_object_path_unique" UNIQUE("raw_object_path"),
	CONSTRAINT "bk_source_emails_imap_position_unique" UNIQUE("mailbox","imap_folder","imap_uidvalidity","imap_uid")
);
--> statement-breakpoint
CREATE TABLE "bk_order_trims" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"colourway_id" uuid,
	"size_label" text,
	"trim_type" text NOT NULL,
	"description" text NOT NULL,
	"supplier" text,
	"quantity_per_piece" numeric(12, 4),
	"unit" text,
	"buyer_supplied" boolean DEFAULT false NOT NULL,
	"notes" text DEFAULT '' NOT NULL,
	"source_email_id" uuid,
	"source_attachment_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "bk_activity" ADD COLUMN "order_id" uuid;--> statement-breakpoint
ALTER TABLE "bk_activity" ADD COLUMN "source" text DEFAULT 'staff' NOT NULL;--> statement-breakpoint
ALTER TABLE "bk_activity" ADD COLUMN "action" text;--> statement-breakpoint
ALTER TABLE "bk_activity" ADD COLUMN "details" jsonb;--> statement-breakpoint
ALTER TABLE "bk_activity" ADD COLUMN "source_email_id" uuid;--> statement-breakpoint
ALTER TABLE "bk_orders" ADD COLUMN "bk_invoice_number" text;--> statement-breakpoint
ALTER TABLE "bk_orders" ADD COLUMN "parent_order_id" uuid;--> statement-breakpoint
ALTER TABLE "bk_order_colourways" ADD CONSTRAINT "bk_order_colourways_order_id_bk_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."bk_orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bk_order_colourways" ADD CONSTRAINT "bk_order_colourways_source_email_id_bk_source_emails_id_fk" FOREIGN KEY ("source_email_id") REFERENCES "public"."bk_source_emails"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bk_order_colourways" ADD CONSTRAINT "bk_order_colourways_source_attachment_id_bk_source_email_attachments_id_fk" FOREIGN KEY ("source_attachment_id") REFERENCES "public"."bk_source_email_attachments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bk_order_size_quantities" ADD CONSTRAINT "bk_order_size_quantities_order_id_bk_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."bk_orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bk_order_size_quantities" ADD CONSTRAINT "bk_order_size_quantities_colourway_id_bk_order_colourways_id_fk" FOREIGN KEY ("colourway_id") REFERENCES "public"."bk_order_colourways"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bk_order_size_quantities" ADD CONSTRAINT "bk_order_size_quantities_source_email_id_bk_source_emails_id_fk" FOREIGN KEY ("source_email_id") REFERENCES "public"."bk_source_emails"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bk_order_size_quantities" ADD CONSTRAINT "bk_order_size_quantities_source_attachment_id_bk_source_email_attachments_id_fk" FOREIGN KEY ("source_attachment_id") REFERENCES "public"."bk_source_email_attachments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bk_order_fabrics" ADD CONSTRAINT "bk_order_fabrics_order_id_bk_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."bk_orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bk_order_fabrics" ADD CONSTRAINT "bk_order_fabrics_colourway_id_bk_order_colourways_id_fk" FOREIGN KEY ("colourway_id") REFERENCES "public"."bk_order_colourways"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bk_order_fabrics" ADD CONSTRAINT "bk_order_fabrics_source_email_id_bk_source_emails_id_fk" FOREIGN KEY ("source_email_id") REFERENCES "public"."bk_source_emails"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bk_order_fabrics" ADD CONSTRAINT "bk_order_fabrics_source_attachment_id_bk_source_email_attachments_id_fk" FOREIGN KEY ("source_attachment_id") REFERENCES "public"."bk_source_email_attachments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bk_source_email_attachments" ADD CONSTRAINT "bk_source_email_attachments_email_id_bk_source_emails_id_fk" FOREIGN KEY ("email_id") REFERENCES "public"."bk_source_emails"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bk_source_email_attachments" ADD CONSTRAINT "bk_source_email_attachments_order_file_id_bk_order_files_id_fk" FOREIGN KEY ("order_file_id") REFERENCES "public"."bk_order_files"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bk_source_email_orders" ADD CONSTRAINT "bk_source_email_orders_email_id_bk_source_emails_id_fk" FOREIGN KEY ("email_id") REFERENCES "public"."bk_source_emails"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bk_source_email_orders" ADD CONSTRAINT "bk_source_email_orders_order_id_bk_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."bk_orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bk_order_trims" ADD CONSTRAINT "bk_order_trims_order_id_bk_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."bk_orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bk_order_trims" ADD CONSTRAINT "bk_order_trims_colourway_id_bk_order_colourways_id_fk" FOREIGN KEY ("colourway_id") REFERENCES "public"."bk_order_colourways"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bk_order_trims" ADD CONSTRAINT "bk_order_trims_source_email_id_bk_source_emails_id_fk" FOREIGN KEY ("source_email_id") REFERENCES "public"."bk_source_emails"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bk_order_trims" ADD CONSTRAINT "bk_order_trims_source_attachment_id_bk_source_email_attachments_id_fk" FOREIGN KEY ("source_attachment_id") REFERENCES "public"."bk_source_email_attachments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "bk_order_size_quantities_order_idx" ON "bk_order_size_quantities" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "bk_order_fabrics_order_idx" ON "bk_order_fabrics" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "bk_source_email_attachments_email_idx" ON "bk_source_email_attachments" USING btree ("email_id");--> statement-breakpoint
CREATE INDEX "bk_source_email_attachments_sha256_idx" ON "bk_source_email_attachments" USING btree ("sha256");--> statement-breakpoint
CREATE INDEX "bk_source_email_orders_order_idx" ON "bk_source_email_orders" USING btree ("order_id","match_status");--> statement-breakpoint
CREATE INDEX "bk_source_emails_in_reply_to_idx" ON "bk_source_emails" USING btree ("in_reply_to");--> statement-breakpoint
CREATE INDEX "bk_source_emails_thread_key_idx" ON "bk_source_emails" USING btree ("thread_key");--> statement-breakpoint
CREATE INDEX "bk_source_emails_received_at_idx" ON "bk_source_emails" USING btree ("received_at");--> statement-breakpoint
CREATE INDEX "bk_order_trims_order_idx" ON "bk_order_trims" USING btree ("order_id");--> statement-breakpoint
ALTER TABLE "bk_activity" ADD CONSTRAINT "bk_activity_order_id_bk_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."bk_orders"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bk_activity" ADD CONSTRAINT "bk_activity_source_email_id_bk_source_emails_id_fk" FOREIGN KEY ("source_email_id") REFERENCES "public"."bk_source_emails"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bk_orders" ADD CONSTRAINT "bk_orders_parent_order_id_bk_orders_id_fk" FOREIGN KEY ("parent_order_id") REFERENCES "public"."bk_orders"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "bk_activity_order_occurred_idx" ON "bk_activity" USING btree ("order_id","occurred_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "bk_orders_po_number_idx" ON "bk_orders" USING btree ("po_number");--> statement-breakpoint
CREATE INDEX "bk_orders_parent_order_id_idx" ON "bk_orders" USING btree ("parent_order_id");--> statement-breakpoint
ALTER TABLE "bk_orders" ADD CONSTRAINT "bk_orders_bk_invoice_number_unique" UNIQUE("bk_invoice_number");--> statement-breakpoint
ALTER TABLE "bk_orders" ADD CONSTRAINT "bk_orders_bk_invoice_number_format" CHECK ("bk_orders"."bk_invoice_number" IS NULL OR "bk_orders"."bk_invoice_number" ~ '^[0-9]{4}(-[A-Z0-9]{1,3})?$');