-- CreateTable
CREATE TABLE "bhp_standard_items" (
    "standard_id" TEXT NOT NULL,
    "line_no" INTEGER NOT NULL,
    "item_code" TEXT NOT NULL,
    "name" TEXT,
    "standard_qty" DECIMAL NOT NULL DEFAULT 0,
    "uom" TEXT,
    "extra" JSONB,

    CONSTRAINT "bhp_standard_items_pkey" PRIMARY KEY ("standard_id","line_no")
);

-- CreateTable
CREATE TABLE "bhp_standards" (
    "id" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "treatment_code" TEXT,
    "treatment_name" TEXT NOT NULL,
    "version" TEXT,
    "is_promo_version" BOOLEAN NOT NULL DEFAULT false,
    "standard_duration_minutes" INTEGER,
    "updated_at" TEXT,
    "updated_by" TEXT,
    "extra" JSONB,
    "db_updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bhp_standards_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bhp_unit_overrides" (
    "item_code" TEXT NOT NULL,
    "usage_uom" TEXT,
    "per_pack" DECIMAL,
    "updated_by" TEXT,
    "updated_at" TEXT,
    "extra" JSONB,
    "db_updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bhp_unit_overrides_pkey" PRIMARY KEY ("item_code")
);

-- CreateTable
CREATE TABLE "doctor_followup_status" (
    "rec_id" TEXT NOT NULL,
    "status" TEXT,
    "last_contacted_at" TEXT,
    "contacted_by" TEXT,
    "notes" TEXT,
    "booking_date" TEXT,
    "updated_at" TEXT,
    "null_props" TEXT[],
    "extra" JSONB,
    "db_updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "doctor_followup_status_pkey" PRIMARY KEY ("rec_id")
);

-- CreateTable
CREATE TABLE "doctor_recommendations" (
    "position" INTEGER NOT NULL,
    "id" TEXT,
    "invoice_code" TEXT,
    "customer_id" JSONB,
    "customer_name" TEXT,
    "doctor_name" TEXT,
    "doctor_id" JSONB,
    "consultation_date" TEXT,
    "skin_analysis" TEXT,
    "return_interval_days" DECIMAL,
    "recommended_return_date" TEXT,
    "roadmap_steps" JSONB,
    "roadmap_months" JSONB,
    "homecare_skincare" JSONB,
    "doctor_notes" TEXT,
    "recommendation" TEXT,
    "updated_by" TEXT,
    "created_at" TEXT,
    "updated_at" TEXT,
    "null_props" TEXT[],
    "extra" JSONB,
    "db_updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "doctor_recommendations_pkey" PRIMARY KEY ("position")
);

-- CreateTable
CREATE TABLE "document_history" (
    "id" BIGSERIAL NOT NULL,
    "path" TEXT NOT NULL,
    "body_json" JSONB,
    "body_text" TEXT,
    "changed_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "document_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "documents" (
    "path" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "body_json" JSONB,
    "body_text" TEXT,
    "size_bytes" INTEGER NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "documents_pkey" PRIMARY KEY ("path")
);

-- CreateTable
CREATE TABLE "marketing_promos" (
    "position" INTEGER NOT NULL,
    "id" TEXT,
    "name" TEXT,
    "period_start" TEXT,
    "period_end" TEXT,
    "branch" TEXT,
    "target_item" TEXT,
    "target_type" TEXT,
    "normal_price" DECIMAL,
    "promo_price" DECIMAL,
    "bottom_price" DECIMAL,
    "quota_total" DECIMAL,
    "quota_used" DECIMAL,
    "target_patient" TEXT,
    "terms_conditions" TEXT,
    "status" TEXT,
    "created_at" TEXT,
    "created_by" TEXT,
    "null_props" TEXT[],
    "extra" JSONB,
    "db_updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "marketing_promos_pkey" PRIMARY KEY ("position")
);

-- CreateTable
CREATE TABLE "monthly_costs" (
    "period_key" TEXT NOT NULL,
    "period" TEXT,
    "bhp_petty_cash" DECIMAL,
    "gaji_karyawan" DECIMAL,
    "sewa_utilitas" DECIMAL,
    "lain_lain" DECIMAL,
    "filled" BOOLEAN,
    "updated_by" TEXT,
    "updated_at" TEXT,
    "null_props" TEXT[],
    "extra" JSONB,
    "db_updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "monthly_costs_pkey" PRIMARY KEY ("period_key")
);

-- CreateTable
CREATE TABLE "monthly_targets" (
    "month" TEXT NOT NULL,
    "total_target" DECIMAL,
    "depok_target" DECIMAL,
    "pondok_kopi_target" DECIMAL,
    "notes" TEXT,
    "updated_at" TEXT,
    "updated_by" TEXT,
    "null_props" TEXT[],
    "extra" JSONB,
    "db_updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "monthly_targets_pkey" PRIMARY KEY ("month")
);

-- CreateTable
CREATE TABLE "patient_feedbacks" (
    "position" INTEGER NOT NULL,
    "id" TEXT,
    "date" TEXT,
    "submitted_at" TEXT,
    "customer_name" TEXT,
    "patient_name" TEXT,
    "phone" TEXT,
    "branch" TEXT,
    "treatment" TEXT,
    "doctor_name" TEXT,
    "nurse_name" TEXT,
    "rating" DECIMAL,
    "rating_overall" DECIMAL,
    "rating_doctor" DECIMAL,
    "rating_nurse" DECIMAL,
    "rating_facility" DECIMAL,
    "rating_treatment" DECIMAL,
    "nps_score" DECIMAL,
    "review_text" TEXT,
    "comments" TEXT,
    "source" TEXT,
    "routing_action" TEXT,
    "google_maps_url" TEXT,
    "complaint_ticket_id" TEXT,
    "auto_ticket_id" TEXT,
    "null_props" TEXT[],
    "extra" JSONB,
    "db_updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "patient_feedbacks_pkey" PRIMARY KEY ("position")
);

-- CreateTable
CREATE TABLE "petty_cash_entries" (
    "position" INTEGER NOT NULL,
    "id" TEXT,
    "period" TEXT,
    "date" TEXT,
    "description" TEXT,
    "amount" DECIMAL,
    "category" TEXT,
    "added_by" TEXT,
    "added_at" TEXT,
    "null_props" TEXT[],
    "extra" JSONB,
    "db_updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "petty_cash_entries_pkey" PRIMARY KEY ("position")
);

-- CreateTable
CREATE TABLE "price_campaigns" (
    "position" INTEGER NOT NULL,
    "id" TEXT,
    "name" TEXT,
    "memo_no" TEXT,
    "start_date" TEXT,
    "end_date" TEXT,
    "offer" TEXT,
    "terms" TEXT,
    "source_url" TEXT,
    "items" JSONB,
    "bundles" JSONB,
    "null_props" TEXT[],
    "extra" JSONB,
    "db_updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "price_campaigns_pkey" PRIMARY KEY ("position")
);

-- CreateTable
CREATE TABLE "price_items" (
    "position" INTEGER NOT NULL,
    "key" TEXT,
    "name" TEXT,
    "category" TEXT,
    "product_id" DECIMAL,
    "product_code" TEXT,
    "product_name" TEXT,
    "match" TEXT,
    "list_price" DECIMAL,
    "bottom_price" DECIMAL,
    "pkg3_per_session" DECIMAL,
    "pkg6_per_session" DECIMAL,
    "pkg3_total" DECIMAL,
    "pkg6_total" DECIMAL,
    "note" TEXT,
    "null_props" TEXT[],
    "extra" JSONB,
    "db_updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "price_items_pkey" PRIMARY KEY ("position")
);

-- CreateTable
CREATE TABLE "price_master_meta" (
    "id" INTEGER NOT NULL,
    "version" DECIMAL,
    "updated_at" TEXT,
    "updated_by" TEXT,
    "drive_folder_url" TEXT,
    "currency_note" TEXT,
    "arrays_present" TEXT[],
    "null_props" TEXT[],
    "extra" JSONB,
    "db_updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "price_master_meta_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sales_bottom_prices" (
    "code_key" TEXT NOT NULL,
    "code" TEXT,
    "name" TEXT,
    "normal_price" DECIMAL,
    "bottom_price" DECIMAL,
    "max_discount_pct" DECIMAL,
    "allowed_roles" JSONB,
    "notes" TEXT,
    "updated_at" TEXT,
    "null_props" TEXT[],
    "extra" JSONB,
    "db_updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sales_bottom_prices_pkey" PRIMARY KEY ("code_key")
);

-- CreateTable
CREATE TABLE "schema_info" (
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "schema_info_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE INDEX "bhp_standard_items_item_idx" ON "bhp_standard_items"("item_code");

-- CreateIndex
CREATE INDEX "bhp_standards_code_idx" ON "bhp_standards"("treatment_code");

-- CreateIndex
CREATE INDEX "doctor_recommendations_id_idx" ON "doctor_recommendations"("id");

-- CreateIndex
CREATE INDEX "document_history_path_idx" ON "document_history"("path", "changed_at" DESC);

-- CreateIndex
CREATE INDEX "marketing_promos_id_idx" ON "marketing_promos"("id");

-- CreateIndex
CREATE INDEX "patient_feedbacks_id_idx" ON "patient_feedbacks"("id");

-- CreateIndex
CREATE INDEX "petty_cash_entries_period_idx" ON "petty_cash_entries"("period");

-- CreateIndex
CREATE INDEX "price_campaigns_id_idx" ON "price_campaigns"("id");

-- CreateIndex
CREATE INDEX "price_items_key_idx" ON "price_items"("key");

-- AddForeignKey
ALTER TABLE "bhp_standard_items" ADD CONSTRAINT "bhp_standard_items_standard_id_fkey" FOREIGN KEY ("standard_id") REFERENCES "bhp_standards"("id") ON DELETE CASCADE ON UPDATE NO ACTION;


-- ===== Bagian manual (tidak bisa dinyatakan di schema.prisma) =====

-- documents: kind harus konsisten dengan isi
ALTER TABLE "documents" ADD CONSTRAINT "documents_kind_check" CHECK ("kind" IN ('json', 'text'));
ALTER TABLE "documents" ADD CONSTRAINT "documents_body_check"
  CHECK (("kind" = 'json' AND "body_json" IS NOT NULL) OR ("kind" = 'text' AND "body_text" IS NOT NULL));

-- price_master_meta: hanya satu baris
ALTER TABLE "price_master_meta" ADD CONSTRAINT "price_master_meta_single_row" CHECK ("id" = 1);

-- indeks ekspresi (folder teratas) untuk daftar dokumen per direktori
CREATE INDEX "documents_dir_idx" ON "documents" ((split_part("path", '/', 1)));

-- metadata skema
INSERT INTO "schema_info" ("key", "value") VALUES ('schema_version', 'prisma:0_init')
  ON CONFLICT ("key") DO NOTHING;
