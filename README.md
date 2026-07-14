# Coachwise admin

AdminJS over the Coachwise Postgres database. It talks to the database directly —
it does not call `api/`, and `api/` does not know it exists.

## Run it

```bash
cp .env.example .env      # point DATABASE_URL at your database
npm install
npm run migrate           # creates admin_users + admin_audit_log
npm run pull              # introspects the database into prisma/schema.prisma
npm run create-admin -- you@example.com 'a-long-password' SUPERADMIN 'Your Name'
npm run dev               # http://localhost:8100/admin
```

There is no self-signup. An admin exists only because someone with shell access
ran `create-admin`.

## Keeping up with api/

The schema is owned by `api/` (golang-migrate). Prisma here only ever *reads* it:

```bash
npm run pull              # after any api/ migration
```

Never run `prisma migrate` against this database. Prisma has no history for the
50 tables `api/` created, would treat them as drift, and would offer to reset —
i.e. drop — the database. `admin/` owns exactly two tables of its own, created by
plain SQL in `migrations/` and tracked in `admin_migrations`, deliberately
separate from api's `schema_migrations`.

## Deploy

**Push to `main`.** `.github/workflows/deploy.yml` checks it, builds a GHCR image
pinned to the commit, then SSHes to the server, migrates, seeds the first admin
if there isn't one, and restarts the container. It only goes green once the
running container is the image that was just built *and* is answering `/health`.

The image is built from the **committed** `prisma/schema.prisma` — the build runs
`prisma generate`, never `db pull` and never `prisma migrate`. See the Dockerfile
for why that matters.

### Repository secrets

| secret | what it's for |
|---|---|
| `SERVER_HOST`, `SERVER_USER`, `SERVER_SSH_KEY` | the deploy SSH, same as the api repo |
| `ADMIN_BOOTSTRAP_EMAIL` | login for the first admin |
| `ADMIN_BOOTSTRAP_PASSWORD` | its password (min 10 chars) |
| `ADMIN_BOOTSTRAP_NAME` | optional display name |

`GITHUB_TOKEN` is provided automatically.

The bootstrap secrets seed `admin_users` **only when it is empty**
(`scripts/bootstrap-admin.js`). Every deploy runs it, and every deploy after the
first does nothing — so changing your password in the panel sticks, rather than
being silently reverted to the GitHub secret on the next release. Rotate the
secret if you like; it won't take effect on an existing admin. To actually change
a password, edit the row in the panel, or run `create-admin`, which overwrites on
purpose.

The password is handed to the container with `docker run -e VAR` (no `=value`),
so it comes through the environment rather than the command line — otherwise
`ps` on the server would print it in full.

### One-time server setup

The workflow fails loudly if this is missing.

```bash
# Runtime config lives on the server, next to api's config.yml — never in the
# workflow, never on the docker command line.
sudo mkdir -p /etc/coachwise
sudo tee /etc/coachwise/admin.env >/dev/null <<EOF
DATABASE_URL=postgres://coachwise:<password>@localhost:5432/coachwise
ADMIN_COOKIE_SECRET=$(openssl rand -hex 32)
PORT=8100
EOF
sudo chmod 600 /etc/coachwise/admin.env
```

`ADMIN_COOKIE_SECRET` must be **stable across restarts** — changing it logs
everyone out.

### It must be served over HTTPS

The session cookie is `secure` in production, so a plain-HTTP deployment can log
**nobody** in: the cookie is set, never sent back, and the login page just bounces
with no error. Terminate TLS at the reverse proxy and point it at `:8100`. The
app sets `trust proxy`, so it will trust the proxy's `X-Forwarded-Proto` — without
that it would refuse to set the cookie at all.

### After an api/ migration

`api/` owns the product schema. When it changes, this repo must catch up:

```bash
npm run pull          # re-introspect into prisma/schema.prisma
git commit prisma/schema.prisma
```

Then rebuild. Skipping this is mostly harmless for reads (Prisma selects the
columns it knows about, so new ones are ignored) but a new `NOT NULL` column with
no default will break inserts from the panel until you re-pull.

## What you can and can't edit

Most tables are ordinary CRUD: users, exercises, plans, coaches, packages, tags,
notifications, and so on. Edit them freely.

**The money tables are list/show only** — `payouts`, `wallets`,
`wallet_transactions`, `orders`, `payments`, `package_subscriptions`. This is the
one real constraint in the panel, and it isn't caution for its own sake:

Wallet balances are **derived** from `wallet_transactions`. There is no cached
balance column, so a row is only ever correct in company with its ledger entry. A
free-text CRUD form lets you break that pairing, and nothing anywhere will tell
you that you did.

The sharp edge is `payouts`. `api/`'s `RequestPayout` **debits the wallet at
request time** — the moment a coach asks for money, the `-amount` PAYOUT row is
written. So:

| transition | ledger |
|---|---|
| `REQUESTED → APPROVED` | nothing. Already debited. |
| `APPROVED → PAID` | nothing. Already debited. |
| `* → REJECTED` | **must credit the money back** |

Rejecting a payout by changing a dropdown would therefore delete a coach's money,
silently and permanently. So payouts move via three record actions instead —
**Approve**, **Mark paid**, **Reject & refund** — each of which writes the status
change, the ledger entry (when there is one) and the audit row in a single
transaction, and refuses to run if someone else already actioned the payout.

Only a `SUPERADMIN` can use them. Both restrictions are enforced server-side, not
just hidden in the UI.

## Deleting

Tables that have a `deleted_at` column get a soft delete: the row is stamped, not
removed, because `api/` expects it to still be there for refunds, audits and
disputes. This is detected from the schema, so it starts applying to a table the
moment that column exists — just re-run `npm run pull`.

## Audit log

Every money action and every soft delete appends to `admin_audit_log`: which
admin, which record, from and to, the amount, and whether money moved. It is
append-only from the panel (no new/edit/delete) and it commits inside the same
transaction as the change it describes, so it can't record an approval that
rolled back.

## Layout

```
migrations/     admin's own SQL (admin_users, admin_audit_log)
prisma/         schema.prisma — GENERATED by `npm run pull`, don't hand-edit
scripts/        migrate.js, create-admin.js
src/
  index.js      express + adminjs + postgres-backed sessions
  auth.js       login against admin_users (not the product's users table)
  resources.js  builds all resources from the Prisma schema; the policy lives here
  actions/
    payouts.js      approve / mark paid / reject+refund, transactional
    soft-delete.js  deleted_at instead of DELETE
    audit.js        append to admin_audit_log
    admin-users.js  bcrypt the password on save
```

## Notes

- Admin login is email + bcrypt password against `admin_users`, deliberately *not*
  a flag on the product's `users`. Product login is passwordless phone + OTP; if
  admin rights hung off that, a SIM swap on the right number would be a takeover
  of the payout queue.
- Sessions are stored in Postgres (`admin_sessions`), so restarts don't log
  everyone out.
- The i18n JSONB fields (`exercises.name_i18n` and friends) render as raw JSON
  editors. Workable, but easy to corrupt — a proper `{en, fa}` editor is the
  obvious next improvement.
- Postgres CHECK constraints aren't modelled by Prisma. Writing a value that
  violates one is rejected by the database, but the error surfaces raw.
