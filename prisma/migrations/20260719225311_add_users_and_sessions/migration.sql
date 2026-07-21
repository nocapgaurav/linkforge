-- CreateTable
CREATE TABLE "users" (
    "id" BIGSERIAL NOT NULL,
    "email" VARCHAR(255) NOT NULL,
    "display_name" VARCHAR(80) NOT NULL,
    "password_hash" VARCHAR(255) NOT NULL,
    "email_verified_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sessions" (
    "id" BIGSERIAL NOT NULL,
    "user_id" BIGINT NOT NULL,
    "token_hash" CHAR(64) NOT NULL,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_used_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revoked_at" TIMESTAMPTZ(6),

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "sessions_token_hash_key" ON "sessions"("token_hash");

-- CreateIndex
CREATE INDEX "sessions_user_id_idx" ON "sessions"("user_id");

-- AddForeignKey
ALTER TABLE "urls" ADD CONSTRAINT "urls_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Seed the demo user and adopt all legacy anonymous links, so created_by
-- can become NOT NULL without data loss. Demo credentials (documented):
-- demo@linkforge.local / demo-password
INSERT INTO "users" ("email", "display_name", "password_hash", "updated_at")
VALUES ('demo@linkforge.local', 'Demo User', '$2b$12$5vwJXE9Umgi5Fm2gITC8.O4Bwac4ePOjAc9gC2vJI6vLlICcbpVeS', CURRENT_TIMESTAMP);

-- Backfill: every pre-auth link belongs to the demo user.
UPDATE "urls" SET "created_by" = (SELECT "id" FROM "users" WHERE "email" = 'demo@linkforge.local')
WHERE "created_by" IS NULL;

-- Ownership becomes mandatory only after the backfill.
ALTER TABLE "urls" ALTER COLUMN "created_by" SET NOT NULL;
