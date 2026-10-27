-- ANIMO Boekhouding VOF - startschema
-- Voer dit uit in een nieuw Supabase-project.
create extension if not exists pgcrypto;

create table public.businesses (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  enterprise_number text,
  vat_number text,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id)
);
create table public.business_users (
  business_id uuid references public.businesses(id) on delete cascade,
  user_id uuid references auth.users(id) on delete cascade,
  role text not null check (role in ('owner','partner','accountant','staff','viewer')),
  created_at timestamptz not null default now(),
  primary key (business_id,user_id)
);
create table public.partners (
  id uuid primary key default gen_random_uuid(), business_id uuid not null references public.businesses(id) on delete cascade,
  name text not null, profit_share numeric(5,2) not null default 0 check(profit_share between 0 and 100),
  current_account numeric(14,2) not null default 0, active boolean not null default true, created_at timestamptz not null default now()
);
create table public.contacts (
  id uuid primary key default gen_random_uuid(), business_id uuid not null references public.businesses(id) on delete cascade,
  type text not null check(type in ('customer','supplier','both')), name text not null, enterprise_number text, vat_number text,
  email text, iban text, payment_term integer default 30, created_at timestamptz not null default now()
);
create table public.invoices (
  id uuid primary key default gen_random_uuid(), business_id uuid not null references public.businesses(id) on delete cascade,
  direction text not null check(direction in ('sale','purchase')), number text not null, contact_id uuid references public.contacts(id),
  invoice_date date not null, due_date date, status text not null default 'draft', currency char(3) not null default 'EUR',
  net_amount numeric(14,2) not null default 0, vat_amount numeric(14,2) not null default 0, total_amount numeric(14,2) generated always as (net_amount+vat_amount) stored,
  external_einvoice_status text, external_reference text, finalized_at timestamptz, created_at timestamptz not null default now(), created_by uuid references auth.users(id),
  unique(business_id,direction,number)
);
create table public.invoice_lines (
  id uuid primary key default gen_random_uuid(), invoice_id uuid not null references public.invoices(id) on delete cascade,
  description text not null, quantity numeric(14,3) not null default 1, unit_price numeric(14,4) not null default 0,
  vat_rate numeric(5,2) not null default 21, account_code text, created_at timestamptz not null default now()
);
create table public.financial_transactions (
  id uuid primary key default gen_random_uuid(), business_id uuid not null references public.businesses(id) on delete cascade,
  booked_on date not null, label text not null, amount numeric(14,2) not null, iban text, matched_invoice_id uuid references public.invoices(id),
  status text not null default 'unmatched', created_at timestamptz not null default now()
);
create table public.journal_entries (
  id uuid primary key default gen_random_uuid(), business_id uuid not null references public.businesses(id) on delete cascade,
  journal text not null, entry_number bigint not null, booked_on date not null, description text, status text not null default 'draft',
  source_type text, source_id uuid, finalized_at timestamptz, created_at timestamptz not null default now(), created_by uuid references auth.users(id),
  unique(business_id,journal,entry_number)
);
create table public.journal_lines (
  id uuid primary key default gen_random_uuid(), entry_id uuid not null references public.journal_entries(id) on delete cascade,
  account_code text not null, debit numeric(14,2) not null default 0 check(debit>=0), credit numeric(14,2) not null default 0 check(credit>=0),
  vat_code text, partner_id uuid references public.partners(id), description text, check(not(debit>0 and credit>0))
);
create table public.audit_logs (
  id bigint generated always as identity primary key, business_id uuid not null references public.businesses(id) on delete cascade,
  user_id uuid references auth.users(id), action text not null, entity_type text not null, entity_id text, old_data jsonb, new_data jsonb,
  created_at timestamptz not null default now()
);

create or replace function public.is_business_member(target uuid)
returns boolean language sql stable security definer set search_path=public as $$
  select exists(select 1 from public.business_users bu where bu.business_id=target and bu.user_id=auth.uid());
$$;

alter table public.businesses enable row level security;
alter table public.business_users enable row level security;
alter table public.partners enable row level security;
alter table public.contacts enable row level security;
alter table public.invoices enable row level security;
alter table public.invoice_lines enable row level security;
alter table public.financial_transactions enable row level security;
alter table public.journal_entries enable row level security;
alter table public.journal_lines enable row level security;
alter table public.audit_logs enable row level security;

create policy "members read businesses" on public.businesses for select using (public.is_business_member(id));
create policy "users read memberships" on public.business_users for select using (user_id=auth.uid() or public.is_business_member(business_id));
create policy "members manage partners" on public.partners for all using (public.is_business_member(business_id)) with check (public.is_business_member(business_id));
create policy "members manage contacts" on public.contacts for all using (public.is_business_member(business_id)) with check (public.is_business_member(business_id));
create policy "members manage invoices" on public.invoices for all using (public.is_business_member(business_id)) with check (public.is_business_member(business_id));
create policy "members manage invoice lines" on public.invoice_lines for all using (exists(select 1 from public.invoices i where i.id=invoice_id and public.is_business_member(i.business_id))) with check (exists(select 1 from public.invoices i where i.id=invoice_id and public.is_business_member(i.business_id)));
create policy "members manage transactions" on public.financial_transactions for all using (public.is_business_member(business_id)) with check (public.is_business_member(business_id));
create policy "members manage entries" on public.journal_entries for all using (public.is_business_member(business_id)) with check (public.is_business_member(business_id));
create policy "members manage journal lines" on public.journal_lines for all using (exists(select 1 from public.journal_entries j where j.id=entry_id and public.is_business_member(j.business_id))) with check (exists(select 1 from public.journal_entries j where j.id=entry_id and public.is_business_member(j.business_id)));
create policy "members read audit" on public.audit_logs for select using (public.is_business_member(business_id));
