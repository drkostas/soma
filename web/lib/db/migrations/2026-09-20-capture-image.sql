-- A meal photo, kept where both sides can reach it.
--
-- The phone posts to soma.gkos.dev and the agent runs on the Mac, so a photo written to
-- os.tmpdir() on a Vercel instance is a path to nothing. Same gap as the capture queue itself:
-- what has to cross it goes in the database. The worker writes the bytes to a local file just
-- before the run, because the agent reads a file.
CREATE TABLE IF NOT EXISTS capture_image (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  mime        varchar(40) NOT NULL,
  bytes       bytea       NOT NULL,
  byte_size   integer     NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- Photos are referenced from meal_capture.messages, which is jsonb, so there is no foreign key to
-- hang this from. An age index is enough to find the ones nothing will ever read again.
CREATE INDEX IF NOT EXISTS idx_capture_image_created ON capture_image (created_at);
