CREATE TYPE "public"."area_kind" AS ENUM('BARRIO', 'VEREDA');--> statement-breakpoint
CREATE TYPE "public"."place_category" AS ENUM('AIRPORT', 'TRANSPORT', 'PARK', 'TOURISM', 'HEALTH', 'EDUCATION', 'GOVERNMENT', 'COMMERCE', 'FOOD', 'LODGING', 'RELIGION', 'OTHER');--> statement-breakpoint
CREATE TYPE "public"."catalog_action" AS ENUM('CREATE', 'UPDATE', 'IMPORT');--> statement-breakpoint
CREATE TYPE "public"."catalog_entity" AS ENUM('AREA', 'PLACE');--> statement-breakpoint
CREATE TABLE "areas" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"name_search" text NOT NULL,
	"kind" "area_kind" NOT NULL,
	"polygon" geography(Polygon,4326) NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"source" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	CONSTRAINT "areas_name_check" CHECK (char_length("areas"."name") BETWEEN 2 AND 80)
);
--> statement-breakpoint
CREATE TABLE "catalog_changes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"entity" "catalog_entity" NOT NULL,
	"entity_id" uuid NOT NULL,
	"action" "catalog_action" NOT NULL,
	"before" jsonb,
	"after" jsonb,
	"changed_by" uuid,
	"changed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "places" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"name_search" text NOT NULL,
	"category" "place_category" NOT NULL,
	"location" geography(Point,4326) NOT NULL,
	"pickup_point" geography(Point,4326),
	"area_id" uuid,
	"verified" boolean DEFAULT false NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"source" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	CONSTRAINT "places_slug_format" CHECK ("places"."slug" ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
	CONSTRAINT "places_name_check" CHECK (char_length("places"."name") BETWEEN 2 AND 80)
);
--> statement-breakpoint
ALTER TABLE "areas" ADD CONSTRAINT "areas_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "catalog_changes" ADD CONSTRAINT "catalog_changes_changed_by_users_id_fk" FOREIGN KEY ("changed_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "places" ADD CONSTRAINT "places_area_id_areas_id_fk" FOREIGN KEY ("area_id") REFERENCES "public"."areas"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "places" ADD CONSTRAINT "places_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "areas_polygon_gist" ON "areas" USING gist ("polygon");--> statement-breakpoint
CREATE UNIQUE INDEX "areas_kind_name_search_key" ON "areas" USING btree ("kind","name_search");--> statement-breakpoint
CREATE INDEX "catalog_changes_entity_idx" ON "catalog_changes" USING btree ("entity","entity_id","changed_at","id");--> statement-breakpoint
CREATE UNIQUE INDEX "places_slug_key" ON "places" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "places_location_gist" ON "places" USING gist ("location");--> statement-breakpoint
CREATE INDEX "places_name_search_idx" ON "places" USING btree ("name_search");