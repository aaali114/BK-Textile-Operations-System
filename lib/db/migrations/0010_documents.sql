CREATE TABLE "bk_documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"type" text NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"doc_number" text NOT NULL,
	"settings" jsonb NOT NULL,
	"snapshot" jsonb,
	"template_version" text NOT NULL,
	"source_hash" text,
	"prepared_by" text NOT NULL,
	"contributors" text[] DEFAULT '{}' NOT NULL,
	"submitted_by" text,
	"submitted_at" timestamp with time zone,
	"reviewed_by" text,
	"reviewed_at" timestamp with time zone,
	"review_note" text,
	"xlsx_object_path" text,
	"pdf_object_path" text,
	"xlsx_sha256" text,
	"pdf_sha256" text,
	"supersedes_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "bk_documents_order_type_revision_unique" UNIQUE("order_id","type","revision")
);
--> statement-breakpoint
CREATE TABLE "bk_settings" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL,
	"updated_by" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "bk_orders" ADD COLUMN "responsible_user_id" text;--> statement-breakpoint
ALTER TABLE "bk_orders" ADD COLUMN "pcs_per_carton" integer;--> statement-breakpoint
ALTER TABLE "bk_orders" ADD COLUMN "garment_description" text;--> statement-breakpoint
ALTER TABLE "bk_documents" ADD CONSTRAINT "bk_documents_order_id_bk_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."bk_orders"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "bk_documents_one_open_per_type" ON "bk_documents" USING btree ("order_id","type") WHERE "bk_documents"."status" IN ('draft', 'in_review', 'changes_requested');--> statement-breakpoint
CREATE INDEX "bk_documents_status_idx" ON "bk_documents" USING btree ("status");--> statement-breakpoint
ALTER TABLE "bk_orders" ADD CONSTRAINT "bk_orders_pcs_per_carton_positive" CHECK ("bk_orders"."pcs_per_carton" IS NULL OR "bk_orders"."pcs_per_carton" > 0);--> statement-breakpoint
-- Approved documents are permanent. Only one change is allowed: approved -> superseded
-- (when a newer revision is approved), with every content field unchanged.
CREATE OR REPLACE FUNCTION bk_documents_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status IN ('approved', 'superseded') THEN
      RAISE EXCEPTION 'Approved documents cannot be deleted (document %)', OLD.id;
    END IF;
    RETURN OLD;
  END IF;
  IF OLD.status = 'superseded' THEN
    RAISE EXCEPTION 'Superseded documents cannot be changed (document %)', OLD.id;
  END IF;
  IF OLD.status = 'approved' THEN
    IF NEW.status = 'superseded'
       AND NEW.order_id = OLD.order_id AND NEW.type = OLD.type AND NEW.revision = OLD.revision
       AND NEW.doc_number = OLD.doc_number AND NEW.settings = OLD.settings
       AND NEW.snapshot IS NOT DISTINCT FROM OLD.snapshot AND NEW.source_hash IS NOT DISTINCT FROM OLD.source_hash
       AND NEW.template_version = OLD.template_version
       AND NEW.prepared_by = OLD.prepared_by AND NEW.contributors = OLD.contributors
       AND NEW.submitted_by IS NOT DISTINCT FROM OLD.submitted_by AND NEW.submitted_at IS NOT DISTINCT FROM OLD.submitted_at
       AND NEW.reviewed_by IS NOT DISTINCT FROM OLD.reviewed_by AND NEW.reviewed_at IS NOT DISTINCT FROM OLD.reviewed_at
       AND NEW.review_note IS NOT DISTINCT FROM OLD.review_note
       AND NEW.xlsx_object_path IS NOT DISTINCT FROM OLD.xlsx_object_path AND NEW.pdf_object_path IS NOT DISTINCT FROM OLD.pdf_object_path
       AND NEW.xlsx_sha256 IS NOT DISTINCT FROM OLD.xlsx_sha256 AND NEW.pdf_sha256 IS NOT DISTINCT FROM OLD.pdf_sha256 THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'Approved documents cannot be changed (document %); create a new revision instead', OLD.id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
DROP TRIGGER IF EXISTS bk_documents_guard ON "bk_documents";--> statement-breakpoint
CREATE TRIGGER bk_documents_guard BEFORE UPDATE OR DELETE ON "bk_documents"
  FOR EACH ROW EXECUTE FUNCTION bk_documents_guard();
