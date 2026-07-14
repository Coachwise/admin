-- Admin accounts. Deliberately NOT a flag on `users`.
--
-- Product login is passwordless phone + OTP. Hanging admin rights off that would
-- make a SIM swap on the right number a full takeover of the payout queue, so
-- admins get their own table, their own credentials (email + bcrypt password)
-- and their own session — the product's auth surface cannot reach admin at all.
--
-- Owned by admin/, applied by `npm run migrate`. api/ never sees this table.
CREATE TABLE IF NOT EXISTS public.admin_users (
    id            uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    email         text NOT NULL,
    password_hash text NOT NULL,
    name          text,
    role          varchar(16) NOT NULL DEFAULT 'ADMIN',
    is_active     boolean NOT NULL DEFAULT true,
    last_login_at timestamp,
    created_at    timestamp DEFAULT now() NOT NULL,
    updated_at    timestamp DEFAULT now() NOT NULL,
    CONSTRAINT admin_users_pkey PRIMARY KEY (id),
    CONSTRAINT admin_users_email_uniq UNIQUE (email),
    -- SUPERADMIN may act on money (approve/pay payouts); ADMIN may not.
    CONSTRAINT admin_users_role_chk CHECK (role IN ('SUPERADMIN', 'ADMIN'))
);

-- An append-only record of every money action taken through the panel: who
-- approved which payout, when, and what the wallet balance was at that moment.
-- A payout is real money leaving the platform; "who authorised this" must be
-- answerable months later, and the payouts row alone cannot answer it.
CREATE TABLE IF NOT EXISTS public.admin_audit_log (
    id            uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    admin_user_id uuid NOT NULL,
    action        text NOT NULL,
    resource      text NOT NULL,
    resource_id   text,
    detail        jsonb,
    created_at    timestamp DEFAULT now() NOT NULL,
    CONSTRAINT admin_audit_log_pkey PRIMARY KEY (id),
    CONSTRAINT admin_audit_log_admin_fk FOREIGN KEY (admin_user_id)
        REFERENCES public.admin_users (id) ON DELETE RESTRICT
);
CREATE INDEX IF NOT EXISTS idx_admin_audit_log_created ON public.admin_audit_log (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_admin_audit_log_resource ON public.admin_audit_log (resource, resource_id);
