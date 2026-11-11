ALTER TABLE "bk_orders" DROP CONSTRAINT "bk_orders_bk_invoice_number_unique";--> statement-breakpoint
ALTER TABLE "bk_orders" DROP CONSTRAINT "bk_orders_bk_invoice_number_format";--> statement-breakpoint
ALTER TABLE "bk_orders" DROP CONSTRAINT "bk_orders_parent_order_id_bk_orders_id_fk";
--> statement-breakpoint
DROP INDEX "bk_orders_parent_order_id_idx";--> statement-breakpoint
ALTER TABLE "bk_orders" DROP COLUMN "bk_invoice_number";--> statement-breakpoint
ALTER TABLE "bk_orders" DROP COLUMN "parent_order_id";