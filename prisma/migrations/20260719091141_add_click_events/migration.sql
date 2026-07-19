-- CreateTable
CREATE TABLE "click_events" (
    "id" BIGSERIAL NOT NULL,
    "event_id" UUID NOT NULL,
    "url_id" BIGINT NOT NULL,
    "occurred_at" TIMESTAMPTZ(6) NOT NULL,
    "ip_hash" BYTEA,
    "country" CHAR(2),
    "city" VARCHAR(80),
    "browser" VARCHAR(32),
    "browser_version" VARCHAR(16),
    "os" VARCHAR(32),
    "device" VARCHAR(32),
    "referrer_host" VARCHAR(255),
    "request_id" UUID,

    CONSTRAINT "click_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "click_events_event_id_key" ON "click_events"("event_id");

-- CreateIndex
CREATE INDEX "click_events_url_id_occurred_at_idx" ON "click_events"("url_id", "occurred_at" DESC);

-- AddForeignKey
ALTER TABLE "click_events" ADD CONSTRAINT "click_events_url_id_fkey" FOREIGN KEY ("url_id") REFERENCES "urls"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
