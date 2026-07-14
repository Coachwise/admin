import 'dotenv/config';

// Read and sanity-check the environment BEFORE anything opens a connection.
//
// The trap this exists for: `dotenv` strips surrounding quotes from a .env file,
// but `docker run --env-file` does NOT — it takes the line literally. So a value
// written as
//
//     DATABASE_URL="postgres://user:pw@localhost:5432/coachwise"
//
// works perfectly in dev and arrives in the container with a leading `"` still
// attached. That is not a valid absolute URL, so pg-connection-string falls back
// to resolving it against its own dummy base (`new URL(str, 'postgres://base')`,
// pg-connection-string:27) and the app dies with
//
//     Error: getaddrinfo EAI_AGAIN base
//
// which says nothing whatsoever about quotes. Strip them, and fail loudly and
// specifically if the URL still isn't one.

function clean(value) {
  if (!value) return value;
  const trimmed = value.trim();
  // Only strip quotes that actually wrap the whole value.
  const wrapped = /^(["'])(.*)\1$/s.exec(trimmed);
  return wrapped ? wrapped[2] : trimmed;
}

const url = clean(process.env.DATABASE_URL);

if (!url) {
  throw new Error('DATABASE_URL is not set (copy .env.example to .env, or check /etc/coachwise/admin.env).');
}

if (!/^postgres(ql)?:\/\//.test(url)) {
  throw new Error(
    `DATABASE_URL must start with postgres:// — got "${url.slice(0, 12)}…".\n` +
      'If this came from an --env-file, remove the surrounding quotes: docker does not strip them.',
  );
}

// Hand the cleaned value back, so pg and Prisma both read the same fixed string.
process.env.DATABASE_URL = url;

const secret = clean(process.env.ADMIN_COOKIE_SECRET);
if (secret) process.env.ADMIN_COOKIE_SECRET = secret;

export const DATABASE_URL = url;
export const ADMIN_COOKIE_SECRET = secret;
export const PORT = clean(process.env.PORT) || 8100;
