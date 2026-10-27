-- Extra beveiliging voor facturen
-- Plak dit EENMALIG in Supabase SQL Editor en klik Run.

create or replace function public.protect_finalized_invoice()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.status <> 'draft' then
    if tg_op = 'DELETE' then
      raise exception 'Alleen conceptfacturen kunnen worden verwijderd.';
    end if;
    if new.invoice_number <> old.invoice_number
       or new.contact_id is distinct from old.contact_id
       or new.invoice_date <> old.invoice_date
       or new.net_amount <> old.net_amount
       or new.vat_amount <> old.vat_amount then
      raise exception 'Een niet-conceptfactuur kan inhoudelijk niet meer worden gewijzigd.';
    end if;
  end if;
  return coalesce(new, old);
end;
$$;

drop trigger if exists protect_finalized_invoice_trigger on public.invoices;
create trigger protect_finalized_invoice_trigger
before update or delete on public.invoices
for each row execute function public.protect_finalized_invoice();
