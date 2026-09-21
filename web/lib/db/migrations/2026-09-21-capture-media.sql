-- The table holds audio now, not only photos, so it is named for what it holds.
--
-- A voice note is recorded on the phone and has to reach the Mac, exactly as a photo does: the app
-- posts to soma.gkos.dev and the transcriber runs here. Same gap, same answer, same table.
ALTER TABLE IF EXISTS capture_image RENAME TO capture_media;
ALTER INDEX IF EXISTS idx_capture_image_created RENAME TO idx_capture_media_created;

CREATE TABLE IF NOT EXISTS capture_media (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  mime        varchar(40) NOT NULL,
  bytes       bytea       NOT NULL,
  byte_size   integer     NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_capture_media_created ON capture_media (created_at);

-- What a voice note was heard to say, kept beside the audio so a bad reading can be compared
-- against a better one later rather than guessed at.
ALTER TABLE capture_media ADD COLUMN IF NOT EXISTS transcript text;
ALTER TABLE capture_media ADD COLUMN IF NOT EXISTS transcript_source varchar(30);
ALTER INDEX IF EXISTS capture_image_pkey RENAME TO capture_media_pkey;
