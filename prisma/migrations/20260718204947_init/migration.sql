-- CreateTable
CREATE TABLE "urls" (
    "id" BIGSERIAL NOT NULL,
    "short_code" VARCHAR(32) NOT NULL,
    "is_custom_alias" BOOLEAN NOT NULL DEFAULT false,
    "original_url" TEXT NOT NULL,
    "url_hash" CHAR(64) NOT NULL,
    "click_count" BIGINT NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "expires_at" TIMESTAMPTZ(6),
    "created_by" BIGINT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "urls_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "urls_short_code_key" ON "urls"("short_code");

-- CreateIndex
CREATE INDEX "urls_url_hash_idx" ON "urls"("url_hash");

-- CreateIndex
CREATE INDEX "urls_expires_at_idx" ON "urls"("expires_at");

-- CreateIndex
CREATE INDEX "urls_created_by_created_at_idx" ON "urls"("created_by", "created_at" DESC);
