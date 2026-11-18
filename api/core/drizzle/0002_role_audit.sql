CREATE TYPE "public"."role_audit_action" AS ENUM('grant', 'revoke');--> statement-breakpoint
CREATE TABLE "role_audit" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"actor_id" uuid,
	"user_id" uuid NOT NULL,
	"role" "role" NOT NULL,
	"action" "role_audit_action" NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "role_audit" ADD CONSTRAINT "role_audit_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_audit" ADD CONSTRAINT "role_audit_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "role_audit_user_at_idx" ON "role_audit" USING btree ("user_id","at");--> statement-breakpoint
CREATE INDEX "users_created_at_id_idx" ON "users" USING btree ("created_at","id");