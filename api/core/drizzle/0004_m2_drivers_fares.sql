CREATE TYPE "public"."document_status" AS ENUM('SUBMITTED', 'APPROVED', 'REJECTED');--> statement-breakpoint
CREATE TYPE "public"."document_type" AS ENUM('CEDULA', 'LICENCIA', 'TARJETA_PROPIEDAD', 'SOAT', 'TECNOMECANICA');--> statement-breakpoint
CREATE TYPE "public"."driver_availability" AS ENUM('OFFLINE', 'AVAILABLE', 'ON_TRIP');--> statement-breakpoint
CREATE TYPE "public"."driver_verification_status" AS ENUM('PENDING', 'APPROVED', 'REJECTED', 'SUSPENDED');--> statement-breakpoint
CREATE TYPE "public"."geofence_kind" AS ENUM('AIRPORT', 'PERIPHERAL');--> statement-breakpoint
CREATE TYPE "public"."pricing_model" AS ENUM('FLAT', 'METERED');--> statement-breakpoint
CREATE TYPE "public"."vehicle_type" AS ENUM('MOTOTAXI', 'TAXI', 'JEEP_4X4');--> statement-breakpoint
CREATE TYPE "public"."fare_change_entity" AS ENUM('FARE_RULE', 'GEOFENCE');--> statement-breakpoint
CREATE TABLE "driver_documents" (
	"user_id" uuid NOT NULL,
	"type" "document_type" NOT NULL,
	"r2_key" text NOT NULL,
	"content_type" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"status" "document_status" DEFAULT 'SUBMITTED' NOT NULL,
	"rejection_reason" text,
	"uploaded_at" timestamp with time zone DEFAULT now() NOT NULL,
	"reviewed_at" timestamp with time zone,
	"reviewed_by" uuid,
	CONSTRAINT "driver_documents_user_id_type_pk" PRIMARY KEY("user_id","type"),
	CONSTRAINT "driver_documents_size_check" CHECK ("driver_documents"."size_bytes" > 0)
);
--> statement-breakpoint
CREATE TABLE "driver_profiles" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"vehicle_type" "vehicle_type" NOT NULL,
	"plate" text NOT NULL,
	"brand" text NOT NULL,
	"model" text NOT NULL,
	"color" text NOT NULL,
	"year" smallint NOT NULL,
	"verification_status" "driver_verification_status" DEFAULT 'PENDING' NOT NULL,
	"availability" "driver_availability" DEFAULT 'OFFLINE' NOT NULL,
	"rejection_reason" text,
	"applied_at" timestamp with time zone DEFAULT now() NOT NULL,
	"reviewed_at" timestamp with time zone,
	"reviewed_by" uuid,
	"wallet_balance" integer DEFAULT 0 NOT NULL,
	"rating_avg" numeric(3, 2),
	"rating_count" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "driver_profiles_year_check" CHECK ("driver_profiles"."year" BETWEEN 1980 AND 2100),
	CONSTRAINT "driver_profiles_plate_format" CHECK ("driver_profiles"."plate" ~ '^[A-Z]{3}[0-9]{2}[0-9A-Z]$')
);
--> statement-breakpoint
CREATE TABLE "fare_changes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"entity" "fare_change_entity" NOT NULL,
	"entity_key" text NOT NULL,
	"before" jsonb,
	"after" jsonb,
	"changed_by" uuid,
	"changed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "fare_rules" (
	"vehicle_type" "vehicle_type" PRIMARY KEY NOT NULL,
	"pricing_model" "pricing_model" NOT NULL,
	"base_fare" integer NOT NULL,
	"per_km" integer DEFAULT 0 NOT NULL,
	"per_minute" integer DEFAULT 0 NOT NULL,
	"minimum_fare" integer DEFAULT 0 NOT NULL,
	"night_surcharge" integer DEFAULT 0 NOT NULL,
	"night_start_minute" smallint DEFAULT 1200 NOT NULL,
	"night_end_minute" smallint DEFAULT 300 NOT NULL,
	"round_to" integer DEFAULT 100 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	CONSTRAINT "fare_rules_amounts_check" CHECK ("fare_rules"."base_fare" >= 0 AND "fare_rules"."per_km" >= 0 AND "fare_rules"."per_minute" >= 0 AND "fare_rules"."minimum_fare" >= 0 AND "fare_rules"."night_surcharge" >= 0),
	CONSTRAINT "fare_rules_night_check" CHECK ("fare_rules"."night_start_minute" BETWEEN 0 AND 1439 AND "fare_rules"."night_end_minute" BETWEEN 0 AND 1439),
	CONSTRAINT "fare_rules_round_check" CHECK ("fare_rules"."round_to" BETWEEN 1 AND 1000)
);
--> statement-breakpoint
CREATE TABLE "geofences" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"kind" "geofence_kind" NOT NULL,
	"area" geography(Polygon,4326) NOT NULL,
	"surcharge" integer DEFAULT 0 NOT NULL,
	"applies_to" "vehicle_type"[] NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	CONSTRAINT "geofences_surcharge_check" CHECK ("geofences"."surcharge" >= 0),
	CONSTRAINT "geofences_applies_to_check" CHECK (cardinality("geofences"."applies_to") > 0)
);
--> statement-breakpoint
ALTER TABLE "driver_documents" ADD CONSTRAINT "driver_documents_user_id_driver_profiles_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."driver_profiles"("user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "driver_documents" ADD CONSTRAINT "driver_documents_reviewed_by_users_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "driver_profiles" ADD CONSTRAINT "driver_profiles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "driver_profiles" ADD CONSTRAINT "driver_profiles_reviewed_by_users_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fare_changes" ADD CONSTRAINT "fare_changes_changed_by_users_id_fk" FOREIGN KEY ("changed_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fare_rules" ADD CONSTRAINT "fare_rules_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "geofences" ADD CONSTRAINT "geofences_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "driver_profiles_plate_key" ON "driver_profiles" USING btree ("plate");--> statement-breakpoint
CREATE INDEX "driver_profiles_status_applied_idx" ON "driver_profiles" USING btree ("verification_status","applied_at","user_id");--> statement-breakpoint
CREATE INDEX "fare_changes_changed_at_idx" ON "fare_changes" USING btree ("changed_at","id");--> statement-breakpoint
CREATE INDEX "geofences_area_gist" ON "geofences" USING gist ("area");