-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateTable
CREATE TABLE "company" (
    "id" SERIAL NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "name_uz_cyrl" VARCHAR(255),
    "slug" VARCHAR(255),
    "owner_id" INTEGER NOT NULL,
    "category_id" INTEGER,
    "country_id" INTEGER,
    "region_id" INTEGER,
    "district_id" INTEGER,
    "street" TEXT,
    "latitude" DECIMAL(10,7),
    "longitude" DECIMAL(10,7),
    "phone_number" VARCHAR(20),
    "email" VARCHAR(254),
    "logo" VARCHAR(255),
    "status" VARCHAR(20) NOT NULL DEFAULT 'onboarding',
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "company_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "company_category" (
    "id" SERIAL NOT NULL,
    "name" VARCHAR(150) NOT NULL,
    "name_uz_cyrl" VARCHAR(150),
    "slug" VARCHAR(160) NOT NULL,
    "description" TEXT,
    "icon" VARCHAR(255),
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "company_category_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "country" (
    "id" SERIAL NOT NULL,
    "name" VARCHAR(150) NOT NULL,
    "code" VARCHAR(5),
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "country_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "region" (
    "id" SERIAL NOT NULL,
    "country_id" INTEGER NOT NULL,
    "name" VARCHAR(150) NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "region_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "district" (
    "id" SERIAL NOT NULL,
    "region_id" INTEGER NOT NULL,
    "name" VARCHAR(150) NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "district_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "permission" (
    "id" SERIAL NOT NULL,
    "code" VARCHAR(100) NOT NULL,
    "label" VARCHAR(150) NOT NULL,
    "module" VARCHAR(50) NOT NULL,
    "scope" VARCHAR(10) NOT NULL DEFAULT 'company',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "permission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "role" (
    "id" SERIAL NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "description" TEXT,
    "scope" VARCHAR(10) NOT NULL,
    "company_id" INTEGER,
    "is_system" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "role_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "role_permission" (
    "id" SERIAL NOT NULL,
    "role_id" INTEGER NOT NULL,
    "permission_id" INTEGER NOT NULL,

    CONSTRAINT "role_permission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "plan" (
    "id" SERIAL NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "description" TEXT,
    "price" DECIMAL(15,2) NOT NULL,
    "duration_days" INTEGER NOT NULL,
    "features" JSONB,
    "max_stores" INTEGER,
    "max_users" INTEGER,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "plan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "subscription" (
    "id" SERIAL NOT NULL,
    "company_id" INTEGER NOT NULL,
    "plan_id" INTEGER NOT NULL,
    "status" VARCHAR(20) NOT NULL DEFAULT 'pending',
    "amount" DECIMAL(15,2) NOT NULL,
    "start_at" TIMESTAMP(3),
    "end_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "subscription_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payme_transaction" (
    "id" SERIAL NOT NULL,
    "paycom_id" VARCHAR(50) NOT NULL,
    "subscription_id" INTEGER,
    "amount" DECIMAL(15,2) NOT NULL,
    "state" INTEGER NOT NULL DEFAULT 1,
    "reason" INTEGER,
    "create_time" BIGINT NOT NULL DEFAULT 0,
    "perform_time" BIGINT NOT NULL DEFAULT 0,
    "cancel_time" BIGINT NOT NULL DEFAULT 0,
    "account" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payme_transaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "email_verification" (
    "id" SERIAL NOT NULL,
    "user_id" INTEGER NOT NULL,
    "token" VARCHAR(255) NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "used_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "email_verification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users_user" (
    "id" SERIAL NOT NULL,
    "full_name" VARCHAR(128),
    "phone_number" VARCHAR(20),
    "email" VARCHAR(254),
    "password" VARCHAR(255) NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "is_staff" BOOLEAN NOT NULL DEFAULT false,
    "is_superuser" BOOLEAN NOT NULL DEFAULT false,
    "is_email_verified" BOOLEAN NOT NULL DEFAULT false,
    "last_login" TIMESTAMP(3),
    "company_id" INTEGER,
    "role_id" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_user_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users_customer" (
    "id" SERIAL NOT NULL,
    "company_id" INTEGER NOT NULL,
    "full_name" VARCHAR(100) NOT NULL,
    "phone_number" VARCHAR(20) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_customer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users_userhistory" (
    "id" SERIAL NOT NULL,
    "user_id" INTEGER NOT NULL,
    "action" VARCHAR(10) NOT NULL,
    "ip_address" VARCHAR(45),
    "user_agent" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "users_userhistory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "store" (
    "id" SERIAL NOT NULL,
    "company_id" INTEGER NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "name_uz_cyrl" VARCHAR(255),
    "phone_number" VARCHAR(20) NOT NULL,
    "address" TEXT NOT NULL,
    "address_uz_cyrl" TEXT,
    "type" VARCHAR(10) NOT NULL,
    "latitude" DECIMAL(9,6),
    "longitude" DECIMAL(9,6),
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "store_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "store_user" (
    "id" SERIAL NOT NULL,
    "user_id" INTEGER NOT NULL,
    "store_id" INTEGER NOT NULL,
    "role" VARCHAR(20) NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "store_user_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "category" (
    "id" SERIAL NOT NULL,
    "company_id" INTEGER NOT NULL,
    "slug" VARCHAR(100) NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "name_uz_cyrl" VARCHAR(100),
    "description" TEXT NOT NULL,
    "description_uz_cyrl" TEXT,
    "image" VARCHAR(255),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "category_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "brand" (
    "id" SERIAL NOT NULL,
    "company_id" INTEGER NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "name_uz_cyrl" VARCHAR(100),

    CONSTRAINT "brand_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product" (
    "id" SERIAL NOT NULL,
    "company_id" INTEGER NOT NULL,
    "category_id" INTEGER,
    "brand_id" INTEGER,
    "name" VARCHAR(100) NOT NULL,
    "name_uz_cyrl" VARCHAR(100),
    "unit_measurement_id" INTEGER,
    "description" TEXT NOT NULL DEFAULT '',
    "description_uz_cyrl" TEXT,
    "sku" VARCHAR(64),
    "barcode" VARCHAR(13),
    "shtrix_code" VARCHAR(255),
    "status" VARCHAR(20) NOT NULL DEFAULT 'a',
    "min_stock" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "product_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_image" (
    "id" SERIAL NOT NULL,
    "product_id" INTEGER NOT NULL,
    "image" VARCHAR(255) NOT NULL,

    CONSTRAINT "product_image_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_batch" (
    "id" SERIAL NOT NULL,
    "company_id" INTEGER NOT NULL,
    "location_id" INTEGER,
    "product_id" INTEGER NOT NULL,
    "store_id" INTEGER NOT NULL,
    "quantity" INTEGER NOT NULL,
    "purchase_price" DECIMAL(12,2) NOT NULL,
    "selling_price" DECIMAL(12,2) NOT NULL,
    "wholesale_price" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "product_batch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_location" (
    "id" SERIAL NOT NULL,
    "company_id" INTEGER NOT NULL,
    "location" TEXT NOT NULL,
    "location_uz_cyrl" TEXT,
    "description" TEXT NOT NULL,
    "description_uz_cyrl" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "product_location_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_unit_measurement" (
    "id" SERIAL NOT NULL,
    "company_id" INTEGER NOT NULL,
    "measurement" VARCHAR(50) NOT NULL,
    "measurement_uz_cyrl" VARCHAR(50),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "product_unit_measurement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "supplier" (
    "id" SERIAL NOT NULL,
    "company_id" INTEGER NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "name_uz_cyrl" VARCHAR(255),
    "phone_number" VARCHAR(20) NOT NULL,
    "description" TEXT NOT NULL,
    "description_uz_cyrl" TEXT,
    "inn" VARCHAR(50),
    "address" TEXT NOT NULL,
    "address_uz_cyrl" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "supplier_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_entry" (
    "id" SERIAL NOT NULL,
    "company_id" INTEGER NOT NULL,
    "supplier_id" INTEGER NOT NULL,
    "store_id" INTEGER NOT NULL,
    "total_amount" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "cash_amount" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "card_amount" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "paid_amount" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "debt_amount" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "payment_type" VARCHAR(7) NOT NULL DEFAULT 'cash',
    "created_by_id" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "stock_entry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_entry_item" (
    "id" SERIAL NOT NULL,
    "entry_id" INTEGER NOT NULL,
    "product_id" INTEGER NOT NULL,
    "quantity" INTEGER NOT NULL,
    "purchase_price" DECIMAL(12,2) NOT NULL,
    "selling_price" DECIMAL(12,2) NOT NULL,
    "wholesale_price" DECIMAL(12,2) NOT NULL DEFAULT 0,

    CONSTRAINT "stock_entry_item_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "supplier_transaction" (
    "id" SERIAL NOT NULL,
    "company_id" INTEGER NOT NULL,
    "supplier_id" INTEGER NOT NULL,
    "entry_id" INTEGER,
    "amount" DECIMAL(15,2) NOT NULL,
    "type" VARCHAR(5) NOT NULL,
    "note" TEXT NOT NULL DEFAULT '',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "supplier_transaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inventory_session" (
    "id" SERIAL NOT NULL,
    "company_id" INTEGER NOT NULL,
    "store_id" INTEGER NOT NULL,
    "started_by_id" INTEGER,
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" VARCHAR(20) NOT NULL DEFAULT 'active',
    "snapshot_taken" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "inventory_session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inventory_snapshot" (
    "id" SERIAL NOT NULL,
    "session_id" INTEGER NOT NULL,
    "product_id" INTEGER NOT NULL,
    "store_id" INTEGER NOT NULL,
    "expected_quantity" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "inventory_snapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inventory_count" (
    "id" SERIAL NOT NULL,
    "session_id" INTEGER NOT NULL,
    "product_id" INTEGER NOT NULL,
    "counted_quantity" INTEGER NOT NULL DEFAULT 0,
    "status" VARCHAR(10) NOT NULL DEFAULT 'p',
    "is_check" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "inventory_count_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inventory_movement" (
    "id" SERIAL NOT NULL,
    "session_id" INTEGER NOT NULL,
    "product_id" INTEGER NOT NULL,
    "quantity" INTEGER NOT NULL,
    "type" VARCHAR(20) NOT NULL,
    "ref_id" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "inventory_movement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inventory_adjustment" (
    "id" SERIAL NOT NULL,
    "session_id" INTEGER NOT NULL,
    "product_id" INTEGER NOT NULL,
    "difference" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "inventory_adjustment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "low_stock_item" (
    "id" SERIAL NOT NULL,
    "company_id" INTEGER NOT NULL,
    "store_id" INTEGER NOT NULL,
    "product_id" INTEGER NOT NULL,
    "current_quantity" INTEGER NOT NULL,
    "min_stock" INTEGER NOT NULL,
    "action_type" VARCHAR(10) NOT NULL,
    "status" VARCHAR(10) NOT NULL DEFAULT 'open',
    "resolved_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "low_stock_item_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sales_sale" (
    "id" SERIAL NOT NULL,
    "company_id" INTEGER NOT NULL,
    "store_id" INTEGER NOT NULL,
    "customer_id" INTEGER,
    "seller_id" INTEGER NOT NULL,
    "total_amount" DECIMAL(20,2) NOT NULL DEFAULT 0,
    "paid_amount" DECIMAL(20,2) NOT NULL DEFAULT 0,
    "status" VARCHAR(10) NOT NULL,
    "discount_type" VARCHAR(10),
    "discount_value" DECIMAL(20,2) NOT NULL DEFAULT 0,
    "discount_amount" DECIMAL(20,2) NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sales_sale_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sales_saleitem" (
    "id" SERIAL NOT NULL,
    "sale_id" INTEGER NOT NULL,
    "product_id" INTEGER NOT NULL,
    "quantity" INTEGER NOT NULL,
    "purchase_price" DECIMAL(20,2),
    "unit_price" DECIMAL(20,2) NOT NULL,
    "total_price" DECIMAL(20,2) NOT NULL,
    "returned_quantity" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "sales_saleitem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sales_payment" (
    "id" SERIAL NOT NULL,
    "company_id" INTEGER NOT NULL,
    "sale_id" INTEGER,
    "customer_id" INTEGER,
    "amount" DECIMAL(20,2) NOT NULL,
    "type" VARCHAR(5) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sales_payment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sale_return" (
    "id" SERIAL NOT NULL,
    "company_id" INTEGER NOT NULL,
    "sale_id" INTEGER NOT NULL,
    "store_id" INTEGER NOT NULL,
    "customer_id" INTEGER,
    "seller_id" INTEGER NOT NULL,
    "total_refund" DECIMAL(20,2) NOT NULL DEFAULT 0,
    "comment" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sale_return_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sale_return_item" (
    "id" SERIAL NOT NULL,
    "sale_return_id" INTEGER NOT NULL,
    "sale_item_id" INTEGER NOT NULL,
    "product_id" INTEGER NOT NULL,
    "quantity" INTEGER NOT NULL,
    "unit_price" DECIMAL(20,2) NOT NULL,
    "total_price" DECIMAL(20,2) NOT NULL,

    CONSTRAINT "sale_return_item_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "debts_customerdebt" (
    "id" SERIAL NOT NULL,
    "company_id" INTEGER NOT NULL,
    "customer_id" INTEGER NOT NULL,
    "sale_id" INTEGER,
    "amount" DECIMAL(20,2) NOT NULL,
    "type" VARCHAR(2) NOT NULL,
    "due_date" DATE,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "debts_customerdebt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_transfer" (
    "id" SERIAL NOT NULL,
    "company_id" INTEGER NOT NULL,
    "from_store_id" INTEGER NOT NULL,
    "to_store_id" INTEGER NOT NULL,
    "status" VARCHAR(1) NOT NULL DEFAULT 'p',
    "created_by_id" INTEGER,
    "approved_by_id" INTEGER,
    "approved_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "stock_transfer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_transfer_item" (
    "id" SERIAL NOT NULL,
    "stock_transfer_id" INTEGER NOT NULL,
    "product_id" INTEGER NOT NULL,
    "quantity" INTEGER NOT NULL,
    "purchase_price" DECIMAL(12,2) NOT NULL,
    "selling_price" DECIMAL(12,2) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stock_transfer_item_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification" (
    "id" SERIAL NOT NULL,
    "company_id" INTEGER NOT NULL,
    "user_id" INTEGER NOT NULL,
    "type" VARCHAR(20) NOT NULL,
    "title" VARCHAR(255) NOT NULL,
    "message" TEXT NOT NULL,
    "is_read" BOOLEAN NOT NULL DEFAULT false,
    "transfer_id" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "notification_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "company_slug_key" ON "company"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "company_owner_id_key" ON "company"("owner_id");

-- CreateIndex
CREATE INDEX "company_category_id_idx" ON "company"("category_id");

-- CreateIndex
CREATE INDEX "company_status_idx" ON "company"("status");

-- CreateIndex
CREATE INDEX "company_country_id_region_id_district_id_idx" ON "company"("country_id", "region_id", "district_id");

-- CreateIndex
CREATE UNIQUE INDEX "company_category_name_key" ON "company_category"("name");

-- CreateIndex
CREATE UNIQUE INDEX "company_category_slug_key" ON "company_category"("slug");

-- CreateIndex
CREATE INDEX "region_country_id_idx" ON "region"("country_id");

-- CreateIndex
CREATE INDEX "district_region_id_idx" ON "district"("region_id");

-- CreateIndex
CREATE UNIQUE INDEX "permission_code_key" ON "permission"("code");

-- CreateIndex
CREATE INDEX "permission_module_idx" ON "permission"("module");

-- CreateIndex
CREATE INDEX "permission_scope_idx" ON "permission"("scope");

-- CreateIndex
CREATE INDEX "role_scope_idx" ON "role"("scope");

-- CreateIndex
CREATE UNIQUE INDEX "role_company_id_name_key" ON "role"("company_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "role_permission_role_id_permission_id_key" ON "role_permission"("role_id", "permission_id");

-- CreateIndex
CREATE INDEX "subscription_company_id_status_idx" ON "subscription"("company_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "payme_transaction_paycom_id_key" ON "payme_transaction"("paycom_id");

-- CreateIndex
CREATE UNIQUE INDEX "email_verification_token_key" ON "email_verification"("token");

-- CreateIndex
CREATE INDEX "email_verification_user_id_idx" ON "email_verification"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "users_user_phone_number_key" ON "users_user"("phone_number");

-- CreateIndex
CREATE UNIQUE INDEX "users_user_email_key" ON "users_user"("email");

-- CreateIndex
CREATE INDEX "users_user_phone_number_idx" ON "users_user"("phone_number");

-- CreateIndex
CREATE INDEX "users_user_email_idx" ON "users_user"("email");

-- CreateIndex
CREATE INDEX "users_user_company_id_idx" ON "users_user"("company_id");

-- CreateIndex
CREATE INDEX "users_customer_company_id_idx" ON "users_customer"("company_id");

-- CreateIndex
CREATE INDEX "users_userhistory_user_id_idx" ON "users_userhistory"("user_id");

-- CreateIndex
CREATE INDEX "store_company_id_idx" ON "store"("company_id");

-- CreateIndex
CREATE INDEX "store_phone_number_idx" ON "store"("phone_number");

-- CreateIndex
CREATE INDEX "store_type_idx" ON "store"("type");

-- CreateIndex
CREATE INDEX "store_is_active_idx" ON "store"("is_active");

-- CreateIndex
CREATE INDEX "store_user_user_id_idx" ON "store_user"("user_id");

-- CreateIndex
CREATE INDEX "store_user_store_id_idx" ON "store_user"("store_id");

-- CreateIndex
CREATE UNIQUE INDEX "store_user_user_id_store_id_key" ON "store_user"("user_id", "store_id");

-- CreateIndex
CREATE INDEX "category_company_id_idx" ON "category"("company_id");

-- CreateIndex
CREATE UNIQUE INDEX "category_company_id_slug_key" ON "category"("company_id", "slug");

-- CreateIndex
CREATE INDEX "brand_company_id_idx" ON "brand"("company_id");

-- CreateIndex
CREATE UNIQUE INDEX "brand_company_id_name_key" ON "brand"("company_id", "name");

-- CreateIndex
CREATE INDEX "product_company_id_idx" ON "product"("company_id");

-- CreateIndex
CREATE INDEX "product_sku_idx" ON "product"("sku");

-- CreateIndex
CREATE INDEX "product_barcode_idx" ON "product"("barcode");

-- CreateIndex
CREATE INDEX "product_name_idx" ON "product"("name");

-- CreateIndex
CREATE UNIQUE INDEX "product_company_id_sku_key" ON "product"("company_id", "sku");

-- CreateIndex
CREATE UNIQUE INDEX "product_company_id_barcode_key" ON "product"("company_id", "barcode");

-- CreateIndex
CREATE INDEX "product_batch_company_id_idx" ON "product_batch"("company_id");

-- CreateIndex
CREATE INDEX "product_batch_store_id_product_id_idx" ON "product_batch"("store_id", "product_id");

-- CreateIndex
CREATE INDEX "product_location_company_id_idx" ON "product_location"("company_id");

-- CreateIndex
CREATE INDEX "product_unit_measurement_company_id_idx" ON "product_unit_measurement"("company_id");

-- CreateIndex
CREATE INDEX "supplier_company_id_idx" ON "supplier"("company_id");

-- CreateIndex
CREATE INDEX "supplier_phone_number_idx" ON "supplier"("phone_number");

-- CreateIndex
CREATE INDEX "supplier_inn_idx" ON "supplier"("inn");

-- CreateIndex
CREATE UNIQUE INDEX "supplier_company_id_inn_key" ON "supplier"("company_id", "inn");

-- CreateIndex
CREATE INDEX "stock_entry_company_id_idx" ON "stock_entry"("company_id");

-- CreateIndex
CREATE INDEX "supplier_transaction_company_id_idx" ON "supplier_transaction"("company_id");

-- CreateIndex
CREATE INDEX "inventory_session_company_id_idx" ON "inventory_session"("company_id");

-- CreateIndex
CREATE INDEX "inventory_session_store_id_status_idx" ON "inventory_session"("store_id", "status");

-- CreateIndex
CREATE INDEX "inventory_snapshot_session_id_product_id_idx" ON "inventory_snapshot"("session_id", "product_id");

-- CreateIndex
CREATE UNIQUE INDEX "inventory_snapshot_session_id_product_id_key" ON "inventory_snapshot"("session_id", "product_id");

-- CreateIndex
CREATE UNIQUE INDEX "inventory_count_session_id_product_id_key" ON "inventory_count"("session_id", "product_id");

-- CreateIndex
CREATE INDEX "inventory_movement_session_id_product_id_idx" ON "inventory_movement"("session_id", "product_id");

-- CreateIndex
CREATE INDEX "inventory_adjustment_session_id_idx" ON "inventory_adjustment"("session_id");

-- CreateIndex
CREATE INDEX "low_stock_item_company_id_idx" ON "low_stock_item"("company_id");

-- CreateIndex
CREATE INDEX "low_stock_item_status_action_type_idx" ON "low_stock_item"("status", "action_type");

-- CreateIndex
CREATE INDEX "low_stock_item_store_id_status_idx" ON "low_stock_item"("store_id", "status");

-- CreateIndex
CREATE INDEX "low_stock_item_product_id_status_idx" ON "low_stock_item"("product_id", "status");

-- CreateIndex
CREATE INDEX "low_stock_item_status_created_at_idx" ON "low_stock_item"("status", "created_at");

-- CreateIndex
CREATE INDEX "sales_sale_company_id_idx" ON "sales_sale"("company_id");

-- CreateIndex
CREATE INDEX "sales_sale_customer_id_idx" ON "sales_sale"("customer_id");

-- CreateIndex
CREATE INDEX "sales_sale_status_idx" ON "sales_sale"("status");

-- CreateIndex
CREATE INDEX "sales_payment_company_id_idx" ON "sales_payment"("company_id");

-- CreateIndex
CREATE INDEX "sale_return_company_id_idx" ON "sale_return"("company_id");

-- CreateIndex
CREATE INDEX "debts_customerdebt_company_id_idx" ON "debts_customerdebt"("company_id");

-- CreateIndex
CREATE INDEX "stock_transfer_company_id_idx" ON "stock_transfer"("company_id");

-- CreateIndex
CREATE INDEX "notification_company_id_idx" ON "notification"("company_id");

-- CreateIndex
CREATE INDEX "notification_user_id_is_read_idx" ON "notification"("user_id", "is_read");

-- AddForeignKey
ALTER TABLE "company" ADD CONSTRAINT "company_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "users_user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "company" ADD CONSTRAINT "company_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "company_category"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "company" ADD CONSTRAINT "company_country_id_fkey" FOREIGN KEY ("country_id") REFERENCES "country"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "company" ADD CONSTRAINT "company_region_id_fkey" FOREIGN KEY ("region_id") REFERENCES "region"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "company" ADD CONSTRAINT "company_district_id_fkey" FOREIGN KEY ("district_id") REFERENCES "district"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "region" ADD CONSTRAINT "region_country_id_fkey" FOREIGN KEY ("country_id") REFERENCES "country"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "district" ADD CONSTRAINT "district_region_id_fkey" FOREIGN KEY ("region_id") REFERENCES "region"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role" ADD CONSTRAINT "role_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_permission" ADD CONSTRAINT "role_permission_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "role"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_permission" ADD CONSTRAINT "role_permission_permission_id_fkey" FOREIGN KEY ("permission_id") REFERENCES "permission"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscription" ADD CONSTRAINT "subscription_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscription" ADD CONSTRAINT "subscription_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "plan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payme_transaction" ADD CONSTRAINT "payme_transaction_subscription_id_fkey" FOREIGN KEY ("subscription_id") REFERENCES "subscription"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "email_verification" ADD CONSTRAINT "email_verification_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users_user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "users_user" ADD CONSTRAINT "users_user_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "company"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "users_user" ADD CONSTRAINT "users_user_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "role"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "users_customer" ADD CONSTRAINT "users_customer_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "users_userhistory" ADD CONSTRAINT "users_userhistory_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users_user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "store" ADD CONSTRAINT "store_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "store_user" ADD CONSTRAINT "store_user_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users_user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "store_user" ADD CONSTRAINT "store_user_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "store"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "category" ADD CONSTRAINT "category_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "brand" ADD CONSTRAINT "brand_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product" ADD CONSTRAINT "product_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product" ADD CONSTRAINT "product_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "category"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product" ADD CONSTRAINT "product_brand_id_fkey" FOREIGN KEY ("brand_id") REFERENCES "brand"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product" ADD CONSTRAINT "product_unit_measurement_id_fkey" FOREIGN KEY ("unit_measurement_id") REFERENCES "product_unit_measurement"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_image" ADD CONSTRAINT "product_image_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_batch" ADD CONSTRAINT "product_batch_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_batch" ADD CONSTRAINT "product_batch_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "product_location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_batch" ADD CONSTRAINT "product_batch_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_batch" ADD CONSTRAINT "product_batch_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "store"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_location" ADD CONSTRAINT "product_location_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_unit_measurement" ADD CONSTRAINT "product_unit_measurement_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier" ADD CONSTRAINT "supplier_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_entry" ADD CONSTRAINT "stock_entry_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_entry" ADD CONSTRAINT "stock_entry_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "supplier"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_entry" ADD CONSTRAINT "stock_entry_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "store"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_entry" ADD CONSTRAINT "stock_entry_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users_user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_entry_item" ADD CONSTRAINT "stock_entry_item_entry_id_fkey" FOREIGN KEY ("entry_id") REFERENCES "stock_entry"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_entry_item" ADD CONSTRAINT "stock_entry_item_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_transaction" ADD CONSTRAINT "supplier_transaction_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_transaction" ADD CONSTRAINT "supplier_transaction_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "supplier"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_transaction" ADD CONSTRAINT "supplier_transaction_entry_id_fkey" FOREIGN KEY ("entry_id") REFERENCES "stock_entry"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_session" ADD CONSTRAINT "inventory_session_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_session" ADD CONSTRAINT "inventory_session_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "store"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_session" ADD CONSTRAINT "inventory_session_started_by_id_fkey" FOREIGN KEY ("started_by_id") REFERENCES "users_user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_snapshot" ADD CONSTRAINT "inventory_snapshot_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "inventory_session"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_snapshot" ADD CONSTRAINT "inventory_snapshot_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_snapshot" ADD CONSTRAINT "inventory_snapshot_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "store"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_count" ADD CONSTRAINT "inventory_count_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "inventory_session"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_count" ADD CONSTRAINT "inventory_count_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_movement" ADD CONSTRAINT "inventory_movement_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "inventory_session"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_movement" ADD CONSTRAINT "inventory_movement_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_adjustment" ADD CONSTRAINT "inventory_adjustment_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "inventory_session"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_adjustment" ADD CONSTRAINT "inventory_adjustment_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "low_stock_item" ADD CONSTRAINT "low_stock_item_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "low_stock_item" ADD CONSTRAINT "low_stock_item_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "store"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "low_stock_item" ADD CONSTRAINT "low_stock_item_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_sale" ADD CONSTRAINT "sales_sale_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_sale" ADD CONSTRAINT "sales_sale_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "store"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_sale" ADD CONSTRAINT "sales_sale_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "users_customer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_sale" ADD CONSTRAINT "sales_sale_seller_id_fkey" FOREIGN KEY ("seller_id") REFERENCES "users_user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_saleitem" ADD CONSTRAINT "sales_saleitem_sale_id_fkey" FOREIGN KEY ("sale_id") REFERENCES "sales_sale"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_saleitem" ADD CONSTRAINT "sales_saleitem_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_payment" ADD CONSTRAINT "sales_payment_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_payment" ADD CONSTRAINT "sales_payment_sale_id_fkey" FOREIGN KEY ("sale_id") REFERENCES "sales_sale"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_payment" ADD CONSTRAINT "sales_payment_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "users_customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sale_return" ADD CONSTRAINT "sale_return_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sale_return" ADD CONSTRAINT "sale_return_sale_id_fkey" FOREIGN KEY ("sale_id") REFERENCES "sales_sale"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sale_return" ADD CONSTRAINT "sale_return_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "store"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sale_return" ADD CONSTRAINT "sale_return_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "users_customer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sale_return" ADD CONSTRAINT "sale_return_seller_id_fkey" FOREIGN KEY ("seller_id") REFERENCES "users_user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sale_return_item" ADD CONSTRAINT "sale_return_item_sale_return_id_fkey" FOREIGN KEY ("sale_return_id") REFERENCES "sale_return"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sale_return_item" ADD CONSTRAINT "sale_return_item_sale_item_id_fkey" FOREIGN KEY ("sale_item_id") REFERENCES "sales_saleitem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sale_return_item" ADD CONSTRAINT "sale_return_item_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "debts_customerdebt" ADD CONSTRAINT "debts_customerdebt_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "debts_customerdebt" ADD CONSTRAINT "debts_customerdebt_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "users_customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "debts_customerdebt" ADD CONSTRAINT "debts_customerdebt_sale_id_fkey" FOREIGN KEY ("sale_id") REFERENCES "sales_sale"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_transfer" ADD CONSTRAINT "stock_transfer_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_transfer" ADD CONSTRAINT "stock_transfer_from_store_id_fkey" FOREIGN KEY ("from_store_id") REFERENCES "store"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_transfer" ADD CONSTRAINT "stock_transfer_to_store_id_fkey" FOREIGN KEY ("to_store_id") REFERENCES "store"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_transfer" ADD CONSTRAINT "stock_transfer_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users_user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_transfer" ADD CONSTRAINT "stock_transfer_approved_by_id_fkey" FOREIGN KEY ("approved_by_id") REFERENCES "users_user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_transfer_item" ADD CONSTRAINT "stock_transfer_item_stock_transfer_id_fkey" FOREIGN KEY ("stock_transfer_id") REFERENCES "stock_transfer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_transfer_item" ADD CONSTRAINT "stock_transfer_item_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification" ADD CONSTRAINT "notification_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification" ADD CONSTRAINT "notification_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users_user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification" ADD CONSTRAINT "notification_transfer_id_fkey" FOREIGN KEY ("transfer_id") REFERENCES "stock_transfer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

