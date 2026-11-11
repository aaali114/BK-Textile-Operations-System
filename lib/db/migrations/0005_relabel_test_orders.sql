-- Orders created before BK invoice numbering existed are synthetic test
-- records. Some carry references like "4056/BK-XX/2026" that look like real
-- invoices; prefix them with TEST- so they cannot be mistaken for one.
-- Real orders always have invoice_ref set, so they are never touched.
UPDATE "bk_orders"
SET "reference" = 'TEST-' || "reference"
WHERE "invoice_ref" IS NULL
	AND "reference" NOT LIKE 'TEST-%';--> statement-breakpoint
INSERT INTO "bk_activity" ("actor", "description", "entity_type", "entity_id", "order_id", "source", "action")
SELECT 'System', 'Relabelled as a test order: ' || "reference", 'order', "id"::text, "id", 'system', 'order.relabelled_test'
FROM "bk_orders"
WHERE "invoice_ref" IS NULL AND "reference" LIKE 'TEST-%'
	AND NOT EXISTS (
		SELECT 1 FROM "bk_activity" a WHERE a."order_id" = "bk_orders"."id" AND a."action" = 'order.relabelled_test'
	);
