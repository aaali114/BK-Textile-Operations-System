CREATE TABLE "bk_intake_cursor" (
	"mailbox" text NOT NULL,
	"imap_folder" text NOT NULL,
	"imap_uidvalidity" bigint NOT NULL,
	"last_uid" bigint NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "bk_intake_cursor_mailbox_imap_folder_pk" PRIMARY KEY("mailbox","imap_folder")
);
--> statement-breakpoint
ALTER TABLE "bk_orders" ADD COLUMN "header_source_email_id" uuid;--> statement-breakpoint
ALTER TABLE "bk_order_trims" ADD COLUMN "source_label" text;--> statement-breakpoint
ALTER TABLE "bk_order_trims" ADD COLUMN "required" boolean DEFAULT true NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "bk_order_trims_order_source_label_unique" ON "bk_order_trims" USING btree ("order_id","source_label") WHERE "bk_order_trims"."source_label" IS NOT NULL AND "bk_order_trims"."colourway_id" IS NULL AND "bk_order_trims"."size_label" IS NULL;