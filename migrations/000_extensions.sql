-- admin_users defaults its id to uuid_generate_v4(), which lives in uuid-ossp.
--
-- On the real database that extension is already there — api/ created it long
-- ago. But admin/ should not silently depend on that: CI applies these
-- migrations to a bare Postgres, and a fresh database would fail on 001 with
-- "function uuid_generate_v4() does not exist". Idempotent, so it is a no-op
-- everywhere the extension already exists.
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
