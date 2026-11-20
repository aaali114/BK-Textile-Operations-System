DROP INDEX "bk_users_one_admin";--> statement-breakpoint
DROP INDEX "bk_users_one_deputy";--> statement-breakpoint
CREATE INDEX "bk_users_role_idx" ON "bk_users" USING btree ("role");