// Must come first: it validates and cleans DATABASE_URL before db.js constructs
// the Prisma client and before the session store opens a pool.
import { DATABASE_URL, ADMIN_COOKIE_SECRET, PORT } from './env.js';
import AdminJS from 'adminjs';
import AdminJSExpress from '@adminjs/express';
import * as AdminJSPrisma from '@adminjs/prisma';
import connectPgSimple from 'connect-pg-simple';
import express from 'express';
import session from 'express-session';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { authenticate } from './auth.js';
import { branding } from './branding.js';
import { buildResources } from './resources.js';
import { PrismaResource } from './prisma-resource.js';

// PrismaResource, not AdminJSPrisma.Resource: the stock adapter cannot open
// tables whose primary key is also a foreign key, or whose key is composite.
// See prisma-resource.js.
AdminJS.registerAdapter({
  Database: AdminJSPrisma.Database,
  Resource: PrismaResource,
});

if (!ADMIN_COOKIE_SECRET) throw new Error('ADMIN_COOKIE_SECRET is not set.');

const admin = new AdminJS({
  rootPath: '/admin',
  resources: buildResources(),
  branding,
  assets: {
    styles: ['/admin/assets/admin.css'],
  },
  locale: {
    language: 'en',
    availableLanguages: ['en'],
    translations: {
      en: {
        actions: {
          // AdminJS labels actions from their name unless translated. "Reject"
          // alone hides the important half: rejecting returns the money.
          approvePayout: 'Approve',
          markPaid: 'Mark paid',
          rejectPayout: 'Reject & refund',
        },
        components: {
          // The login copy lives under components.Login — NOT labels/messages.
          // Left alone, the page advertises AdminJS to our own staff.
          Login: {
            welcomeHeader: 'Coachwise',
            welcomeMessage:
              'Staff only. Actions taken here move real money and are recorded against your account.',
          },
        },
      },
    },
  },
});

// Sessions live in Postgres, not in memory: an admin should not be logged out
// every time the process restarts, and this has to survive running more than one
// instance.
const PgSession = connectPgSimple(session);

const router = AdminJSExpress.buildAuthenticatedRouter(
  admin,
  {
    authenticate,
    cookieName: 'coachwise-admin',
    cookiePassword: ADMIN_COOKIE_SECRET,
  },
  null,
  {
    store: new PgSession({
      conString: DATABASE_URL,
      tableName: 'admin_sessions',
      createTableIfMissing: true,
    }),
    secret: ADMIN_COOKIE_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      // The panel is served over plain HTTP in dev; require HTTPS in production.
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 1000 * 60 * 60 * 8,
    },
    name: 'coachwise-admin',
  },
);

const app = express();

// In production the session cookie is `secure`, so it is only ever sent over
// HTTPS. TLS is terminated by the reverse proxy, which means Express sees plain
// HTTP on the internal hop and — without this — would decide the connection is
// insecure and refuse to SET the cookie at all. The symptom is a login that
// silently bounces straight back to the login page, forever.
if (process.env.NODE_ENV === 'production') {
  app.set('trust proxy', 1);
}

// Brand assets, mounted BEFORE the AdminJS router — it owns /admin/* and would
// otherwise swallow these. Public on purpose: the logo is on the login page,
// which by definition nobody has authenticated for yet.
app.use(
  `${admin.options.rootPath}/assets`,
  express.static(join(dirname(fileURLToPath(import.meta.url)), '..', 'public'), {
    maxAge: '1h',
  }),
);

// Unauthenticated on purpose, and deliberately says nothing about the database:
// the deploy polls this to confirm the panel came back up, so it has to answer
// before anyone has logged in. There is no version here — the panel ships on
// every push to main, and the deploy checks the container's image instead.
app.get('/health', (_req, res) => {
  res.json({ status: 'ok' });
});

app.use(admin.options.rootPath, router);
app.get('/', (_req, res) => res.redirect(admin.options.rootPath));

app.listen(PORT, () => {
  console.log(`Coachwise admin  →  http://localhost:${PORT}${admin.options.rootPath}`);
});
