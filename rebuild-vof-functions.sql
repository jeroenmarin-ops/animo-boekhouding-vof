-- Uitvoeren na de eerder aangemaakte tabellen en setup-pdf-upload.sql
begin;
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values('accounting-documents','accounting-documents',false,10485760,array['application/pdf']::text[]) on conflict(id) do update set public=false,file_size_limit=10485760,allowed_mime_types=array['application/pdf']::text[];
drop policy if exists "vof pdf insert" on storage.objects; drop policy if exists "vof pdf select" on storage.objects; drop policy if exists "vof pdf delete" on storage.objects;
create policy "vof pdf insert" on storage.objects for insert to authenticated with check(bucket_id='accounting-documents' and (storage.foldername(name))[1]=auth.uid()::text and lower(storage.extension(name))='pdf');
create policy "vof pdf select" on storage.objects for select to authenticated using(bucket_id='accounting-documents' and (storage.foldername(name))[1]=auth.uid()::text);
create policy "vof pdf delete" on storage.objects for delete to authenticated using(bucket_id='accounting-documents' and (storage.foldername(name))[1]=auth.uid()::text);

create or replace function public.book_invoice_pdf(p_business_id uuid,p_direction text,p_relation_name text,p_invoice_number text,p_invoice_date date,p_due_date date,p_net numeric,p_vat numeric,p_total numeric,p_vat_rate numeric,p_storage_path text,p_file_name text,p_file_size bigint) returns uuid language plpgsql security definer set search_path=public as $$
declare v_contact uuid;v_invoice uuid;v_entry uuid;v_period uuid;v_year uuid;v_journal uuid;v_control uuid;v_base uuid;v_vatacc uuid;v_num bigint;v_doc uuid;
begin
 if auth.uid() is null or not public.is_business_member(p_business_id) then raise exception 'Geen toegang'; end if;
 if p_direction not in ('sale','purchase') then raise exception 'Ongeldige richting'; end if;
 if abs((p_net+p_vat)-p_total)>0.02 then raise exception 'Bedragen sluiten niet'; end if;
 if split_part(p_storage_path,'/',1)<>auth.uid()::text then raise exception 'Ongeldig opslagpad'; end if;
 select id into v_contact from contacts where business_id=p_business_id and lower(name)=lower(trim(p_relation_name)) limit 1;
 if v_contact is null then insert into contacts(business_id,contact_type,name) values(p_business_id,case when p_direction='sale' then 'customer' else 'supplier' end,trim(p_relation_name)) returning id into v_contact; end if;
 select ap.id,ap.fiscal_year_id into v_period,v_year from accounting_periods ap join fiscal_years fy on fy.id=ap.fiscal_year_id where fy.business_id=p_business_id and ap.status='open' and p_invoice_date between ap.starts_on and ap.ends_on limit 1;
 if v_period is null then raise exception 'Geen open periode voor factuurdatum'; end if;
 select id into v_journal from journals where business_id=p_business_id and journal_type=case when p_direction='sale' then 'sales' else 'purchases' end and active limit 1;
 select id into v_control from accounts where business_id=p_business_id and code=case when p_direction='sale' then '400000' else '440000' end;
 select id into v_base from accounts where business_id=p_business_id and code=case when p_direction='sale' then '700000' else '600000' end;
 select id into v_vatacc from accounts where business_id=p_business_id and code=case when p_direction='sale' then '451000' else '411000' end;
 if v_journal is null or v_control is null or v_base is null or v_vatacc is null then raise exception 'Boekhouding niet volledig ingericht'; end if;
 insert into invoices(business_id,direction,invoice_number,contact_id,invoice_date,due_date,status,net_amount,vat_amount,paid_amount,created_by,finalized_at,finalized_by) values(p_business_id,p_direction,p_invoice_number,v_contact,p_invoice_date,p_due_date,'finalized',p_net,p_vat,0,auth.uid(),now(),auth.uid()) returning id into v_invoice;
 select coalesce(max(entry_number),0)+1 into v_num from journal_entries where business_id=p_business_id and journal_id=v_journal;
 insert into journal_entries(business_id,fiscal_year_id,accounting_period_id,journal_id,entry_number,booked_on,description,status,source_type,source_id,finalized_at,finalized_by,created_by) values(p_business_id,v_year,v_period,v_journal,v_num,p_invoice_date,case when p_direction='sale' then 'Verkoopfactuur ' else 'Aankoopfactuur ' end||p_invoice_number,'finalized','invoice',v_invoice,now(),auth.uid(),auth.uid()) returning id into v_entry;
 if p_direction='sale' then
  insert into journal_lines(entry_id,line_number,account_id,contact_id,description,debit,credit) values(v_entry,1,v_control,v_contact,p_invoice_number,p_total,0),(v_entry,2,v_base,v_contact,p_invoice_number,0,p_net),(v_entry,3,v_vatacc,v_contact,p_invoice_number,0,p_vat);
 else
  insert into journal_lines(entry_id,line_number,account_id,contact_id,description,debit,credit) values(v_entry,1,v_base,v_contact,p_invoice_number,p_net,0),(v_entry,2,v_vatacc,v_contact,p_invoice_number,p_vat,0),(v_entry,3,v_control,v_contact,p_invoice_number,0,p_total);
 end if;
 update invoices set journal_entry_id=v_entry where id=v_invoice;
 insert into documents(business_id,file_name,original_file_name,storage_path,mime_type,file_size,document_type,direction,processing_status,invoice_id,journal_entry_id,created_by,uploaded_by,document_date) values(p_business_id,p_file_name,p_file_name,p_storage_path,'application/pdf',p_file_size,'invoice',p_direction,'booked',v_invoice,v_entry,auth.uid(),auth.uid(),p_invoice_date) returning id into v_doc;
 insert into audit_logs(business_id,user_id,action,entity_type,entity_id,new_data) values(p_business_id,auth.uid(),'book_pdf_invoice','invoice',v_invoice::text,jsonb_build_object('journal_entry_id',v_entry,'document_id',v_doc));
 return v_invoice;
end$$;

create or replace function public.delete_draft_invoice(p_invoice_id uuid) returns void language plpgsql security definer set search_path=public as $$ declare b uuid;s text;begin select business_id,status into b,s from invoices where id=p_invoice_id;if b is null or not is_business_member(b) then raise exception 'Geen toegang';end if;if s<>'draft' then raise exception 'Alleen concepten kunnen worden verwijderd';end if;delete from documents where invoice_id=p_invoice_id;delete from invoices where id=p_invoice_id;end$$;
grant execute on function public.book_invoice_pdf(uuid,text,text,text,date,date,numeric,numeric,numeric,numeric,text,text,bigint) to authenticated;grant execute on function public.delete_draft_invoice(uuid) to authenticated;
commit;