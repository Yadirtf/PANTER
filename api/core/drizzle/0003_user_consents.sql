CREATE TABLE "user_consents" (
	"user_id" uuid NOT NULL,
	"version" text NOT NULL,
	"accepted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ip" text,
	"user_agent" text,
	CONSTRAINT "user_consents_user_id_version_pk" PRIMARY KEY("user_id","version")
);
--> statement-breakpoint
ALTER TABLE "user_consents" ADD CONSTRAINT "user_consents_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "user_consents_user_accepted_idx" ON "user_consents" USING btree ("user_id","accepted_at");