DROP INDEX IF EXISTS "bk_documents_one_open_per_type";--> statement-breakpoint
ALTER TABLE "bk_source_emails" ALTER COLUMN "imap_uidvalidity" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "bk_source_emails" ALTER COLUMN "imap_uid" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "bk_documents" ADD COLUMN "archived_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "bk_documents" ADD COLUMN "archived_by" text;--> statement-breakpoint
ALTER TABLE "bk_documents" ADD COLUMN "archive_reason" text;--> statement-breakpoint
ALTER TABLE "bk_orders" ADD COLUMN "archived_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "bk_orders" ADD COLUMN "archived_by" text;--> statement-breakpoint
ALTER TABLE "bk_orders" ADD COLUMN "archive_reason" text;--> statement-breakpoint
ALTER TABLE "bk_order_files" ADD COLUMN "archived_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "bk_order_files" ADD COLUMN "archived_by" text;--> statement-breakpoint
ALTER TABLE "bk_order_files" ADD COLUMN "archive_reason" text;--> statement-breakpoint
ALTER TABLE "bk_source_email_orders" ADD COLUMN "archived_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "bk_source_email_orders" ADD COLUMN "archived_by" text;--> statement-breakpoint
ALTER TABLE "bk_source_email_orders" ADD COLUMN "archive_reason" text;--> statement-breakpoint
CREATE UNIQUE INDEX "bk_documents_one_open_per_type" ON "bk_documents" USING btree ("order_id","type") WHERE "bk_documents"."status" IN ('draft', 'in_review', 'changes_requested') AND "bk_documents"."archived_at" IS NULL;--> statement-breakpoint
-- Email links staff had already set to "ignored" count as removed (in the Bin).
UPDATE "bk_source_email_orders" SET "archived_at" = coalesce("reviewed_at", now()), "archived_by" = coalesce("reviewed_by", 'staff')
  WHERE "match_status" = 'ignored' AND "archived_at" IS NULL;--> statement-breakpoint
-- Approved documents stay frozen. The only changes allowed are:
--  * moving it to or from the Bin (archived_at / archived_by / archive_reason), and
--  * approved -> superseded when a newer revision is approved,
-- with every other column unchanged. Deleting one is allowed only once it is in the Bin
-- (the application lets only an administrator do either).
CREATE OR REPLACE FUNCTION bk_documents_guard() RETURNS trigger AS $$
DECLARE
  bin text[] := ARRAY['archived_at', 'archived_by', 'archive_reason', 'updated_at'];
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status IN ('approved', 'superseded') AND OLD.archived_at IS NULL THEN
      RAISE EXCEPTION 'Approved documents cannot be deleted (document %); an administrator must move it to the Bin first', OLD.id;
    END IF;
    RETURN OLD;
  END IF;
  IF OLD.status IN ('approved', 'superseded') THEN
    IF (to_jsonb(NEW) - bin) = (to_jsonb(OLD) - bin) THEN
      RETURN NEW;
    END IF;
    IF OLD.status = 'approved' AND NEW.status = 'superseded'
       AND (to_jsonb(NEW) - bin - 'status') = (to_jsonb(OLD) - bin - 'status') THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'Approved documents cannot be changed (document %); create a new revision instead', OLD.id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
