begin;
-- Use the same parser as realtor search_vector, including hyphenated email tokens.
create or replace function private.crm_search(q text) returns tsquery
language sql immutable set search_path='' as $$
 select to_tsquery('simple',nullif(string_agg(quote_literal(word)||':*',' & '),''))
 from unnest(tsvector_to_array(to_tsvector('simple',left(coalesce(q,''),100)))) word;
$$;
commit;
