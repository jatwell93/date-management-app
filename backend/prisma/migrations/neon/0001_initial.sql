-- CreateTable
CREATE TABLE "products" (
    "id" SERIAL NOT NULL,
    "barcode" TEXT NOT NULL,
    "sku" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "cost_price" DOUBLE PRECISION NOT NULL,
    "notes" TEXT NOT NULL DEFAULT '',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "products_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inventory_items" (
    "id" SERIAL NOT NULL,
    "product_id" INTEGER NOT NULL,
    "expiry_date" TIMESTAMP(3) NOT NULL,
    "location_id" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'Normal',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "inventory_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "store_areas" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "sub_department" TEXT,
    "last_checked" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "store_areas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" SERIAL NOT NULL,
    "pin" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_log" (
    "id" SERIAL NOT NULL,
    "user_id" INTEGER NOT NULL,
    "inventory_item_id" INTEGER NOT NULL,
    "change_description" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_log_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "item_transactions" (
    "id" SERIAL NOT NULL,
    "inventory_item_id" INTEGER NOT NULL,
    "user_id" INTEGER NOT NULL,
    "type" TEXT NOT NULL,
    "quantity_change" DOUBLE PRECISION NOT NULL,
    "notes" TEXT,
    "transaction_date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "item_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "expired_item_transactions" (
    "id" SERIAL NOT NULL,
    "inventory_item_id" INTEGER NOT NULL,
    "user_id" INTEGER NOT NULL,
    "action" TEXT NOT NULL,
    "units_discarded" INTEGER,
    "financial_loss" DOUBLE PRECISION,
    "transaction_date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "expired_item_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "migrations" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "applied_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "migrations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "products_barcode_key" ON "products"("barcode");

-- CreateIndex
CREATE UNIQUE INDEX "products_sku_key" ON "products"("sku");

-- CreateIndex
CREATE INDEX "products_sku_idx" ON "products"("sku");

-- CreateIndex
CREATE INDEX "products_barcode_idx" ON "products"("barcode");

-- CreateIndex
CREATE INDEX "inventory_items_product_id_idx" ON "inventory_items"("product_id");

-- CreateIndex
CREATE INDEX "inventory_items_location_id_idx" ON "inventory_items"("location_id");

-- CreateIndex
CREATE INDEX "inventory_items_expiry_date_idx" ON "inventory_items"("expiry_date");

-- CreateIndex
CREATE INDEX "inventory_items_status_idx" ON "inventory_items"("status");

-- CreateIndex
CREATE INDEX "store_areas_name_idx" ON "store_areas"("name");

-- CreateIndex
CREATE UNIQUE INDEX "store_areas_name_sub_department_key" ON "store_areas"("name", "sub_department");

-- CreateIndex
CREATE INDEX "audit_log_user_id_idx" ON "audit_log"("user_id");

-- CreateIndex
CREATE INDEX "audit_log_inventory_item_id_idx" ON "audit_log"("inventory_item_id");

-- CreateIndex
CREATE INDEX "item_transactions_inventory_item_id_idx" ON "item_transactions"("inventory_item_id");

-- CreateIndex
CREATE INDEX "item_transactions_user_id_idx" ON "item_transactions"("user_id");

-- CreateIndex
CREATE INDEX "item_transactions_type_idx" ON "item_transactions"("type");

-- CreateIndex
CREATE INDEX "item_transactions_transaction_date_idx" ON "item_transactions"("transaction_date");

-- CreateIndex
CREATE INDEX "expired_item_transactions_inventory_item_id_idx" ON "expired_item_transactions"("inventory_item_id");

-- CreateIndex
CREATE INDEX "expired_item_transactions_user_id_idx" ON "expired_item_transactions"("user_id");

-- CreateIndex
CREATE INDEX "expired_item_transactions_action_idx" ON "expired_item_transactions"("action");

-- CreateIndex
CREATE INDEX "expired_item_transactions_transaction_date_idx" ON "expired_item_transactions"("transaction_date");

-- CreateIndex
CREATE UNIQUE INDEX "migrations_name_key" ON "migrations"("name");

-- AddForeignKey
ALTER TABLE "inventory_items" ADD CONSTRAINT "inventory_items_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_items" ADD CONSTRAINT "inventory_items_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "store_areas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_inventory_item_id_fkey" FOREIGN KEY ("inventory_item_id") REFERENCES "inventory_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "item_transactions" ADD CONSTRAINT "item_transactions_inventory_item_id_fkey" FOREIGN KEY ("inventory_item_id") REFERENCES "inventory_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "item_transactions" ADD CONSTRAINT "item_transactions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expired_item_transactions" ADD CONSTRAINT "expired_item_transactions_inventory_item_id_fkey" FOREIGN KEY ("inventory_item_id") REFERENCES "inventory_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expired_item_transactions" ADD CONSTRAINT "expired_item_transactions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

