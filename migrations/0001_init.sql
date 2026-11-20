-- 0001_init.sql
-- Supabase PostgreSQL + pgvector schema for Multi-Modal-RAG (ESG reports)
-- Embedding model: BAAI/bge-m3 (1024 dimensions)

create extension if not exists vector;

create table if not exists public.reports (
  id text primary key,
  company text not null check (char_length(trim(company)) > 0),
  report_year integer not null check (report_year >= 2000 and report_year <= 2100),
  title text not null check (char_length(trim(title)) > 0),
  source_url text not null check (source_url ~ '^https?://'),
  dataset_version text not null check (char_length(trim(dataset_version)) > 0),
  total_indexed_pages integer not null check (total_indexed_pages >= 0),
  created_at timestamptz not null default now()
);

create table if not exists public.report_pages (
  id uuid primary key default gen_random_uuid(),
  report_id text not null references public.reports(id) on delete cascade,
  page_number integer not null check (page_number >= 1),
  section_title text,
  raw_text text not null default '',
  visual_summary text not null check (char_length(trim(visual_summary)) > 0),
  has_chart boolean not null default false,
  image_path text not null check (char_length(trim(image_path)) > 0),
  embedding vector(1024) not null,
  search_tsv tsvector generated always as (
    to_tsvector('simple', coalesce(section_title, '') || ' ' || coalesce(visual_summary, '') || ' ' || coalesce(raw_text, ''))
  ) stored,
  created_at timestamptz not null default now(),
  unique (report_id, page_number)
);

create index if not exists idx_report_pages_report_id
  on public.report_pages (report_id);

create index if not exists idx_report_pages_embedding_hnsw
  on public.report_pages
  using hnsw (embedding vector_cosine_ops);

create index if not exists idx_report_pages_search_tsv
  on public.report_pages
  using gin (search_tsv);

-- Enable Row Level Security: public read-only; writes require service_role (offline Colab indexer)
alter table public.reports enable row level security;
alter table public.report_pages enable row level security;

drop policy if exists "reports_read_only" on public.reports;
create policy "reports_read_only"
  on public.reports
  for select
  to anon, authenticated
  using (true);

drop policy if exists "report_pages_read_only" on public.report_pages;
create policy "report_pages_read_only"
  on public.report_pages
  for select
  to anon, authenticated
  using (true);

-- Hybrid search (dense vector cosine + full-text RRF)
create or replace function public.match_report_pages(
  query_embedding vector(1024),
  query_text text,
  filter_company text default null,
  filter_year integer default null,
  filter_dataset_version text default null,
  match_count integer default 5,
  rrf_k integer default 60
)
returns table (
  report_id text,
  company text,
  report_year integer,
  report_title text,
  source_url text,
  dataset_version text,
  page_number integer,
  section_title text,
  visual_summary text,
  has_chart boolean,
  image_path text,
  cosine_similarity double precision,
  rrf_score double precision
)
language sql
stable
as $$
  with filtered_pages as (
    select
      rp.id,
      rp.report_id,
      r.company,
      r.report_year,
      r.title as report_title,
      r.source_url,
      r.dataset_version,
      rp.page_number,
      rp.section_title,
      rp.visual_summary,
      rp.has_chart,
      rp.image_path,
      rp.embedding,
      rp.search_tsv
    from public.report_pages rp
    join public.reports r on r.id = rp.report_id
    where (filter_company is null or r.company = filter_company)
      and (filter_year is null or r.report_year = filter_year)
      and (filter_dataset_version is null or r.dataset_version = filter_dataset_version)
  ),
  dense_ranked as (
    select
      fp.id,
      (1 - (fp.embedding <=> query_embedding))::double precision as cosine_similarity,
      row_number() over (order by fp.embedding <=> query_embedding asc) as dense_rank
    from filtered_pages fp
    order by fp.embedding <=> query_embedding asc
    limit greatest(match_count * 4, 20)
  ),
  fts_ranked as (
    select
      fp.id,
      row_number() over (
        order by ts_rank_cd(fp.search_tsv, plainto_tsquery('simple', coalesce(query_text, ''))) desc
      ) as fts_rank
    from filtered_pages fp
    where coalesce(trim(query_text), '') <> ''
      and fp.search_tsv @@ plainto_tsquery('simple', query_text)
    limit greatest(match_count * 4, 20)
  ),
  combined as (
    select
      coalesce(d.id, f.id) as id,
      coalesce(d.cosine_similarity, 0.0) as cosine_similarity,
      (
        coalesce(1.0 / (rrf_k + d.dense_rank), 0.0) +
        coalesce(1.0 / (rrf_k + f.fts_rank), 0.0)
      )::double precision as rrf_score
    from dense_ranked d
    full outer join fts_ranked f on d.id = f.id
  )
  select
    fp.report_id,
    fp.company,
    fp.report_year,
    fp.report_title,
    fp.source_url,
    fp.dataset_version,
    fp.page_number,
    fp.section_title,
    fp.visual_summary,
    fp.has_chart,
    fp.image_path,
    c.cosine_similarity,
    c.rrf_score
  from combined c
  join filtered_pages fp on fp.id = c.id
  order by c.rrf_score desc, c.cosine_similarity desc
  limit greatest(match_count, 1);
$$;
