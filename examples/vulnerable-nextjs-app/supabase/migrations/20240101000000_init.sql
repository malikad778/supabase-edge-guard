-- Demo schema with deliberate mistakes.

create table public.orders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users (id),
  total numeric not null default 0
);

create table public.profiles (
  id uuid primary key references auth.users (id),
  display_name text
);
alter table public.profiles enable row level security;

create policy "profiles are visible to their owner" on public.profiles
  for select using (id = auth.uid());

create table public.notes (
  id uuid primary key default gen_random_uuid(),
  body text
);
alter table public.notes enable row level security;

create table public.posts (
  id uuid primary key default gen_random_uuid(),
  author_id uuid,
  title text
);
alter table public.posts enable row level security;
create index posts_author_idx on public.posts (author_id);

create policy "posts anonymous or owner" on public.posts
  for select using (auth.uid() is null or author_id = (select auth.uid()));
create policy "anyone updates posts" on public.posts
  for update to anon using (true);

create table public.admin_secrets (
  id uuid primary key default gen_random_uuid(),
  secret text
);
alter table public.admin_secrets enable row level security;
create policy "admins read secrets" on public.admin_secrets
  for select using ((auth.jwt() -> 'user_metadata' ->> 'role') = 'admin');

create table public.docs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid,
  body text
);
alter table public.docs enable row level security;
create index docs_user_idx on public.docs (user_id);
create policy "owners update docs" on public.docs
  for update using (user_id = (select auth.uid()));

create view public.profile_view as select * from public.profiles;

create function public.delete_account(p_id uuid) returns void
language sql security definer as $$
  delete from public.profiles where id = p_id;
$$;

insert into storage.buckets (id, name, public) values ('public-assets', 'public-assets', true);
create policy "upload avatars" on storage.objects
  for insert to authenticated with check (bucket_id = 'avatars');
create policy "anyone uploads assets" on storage.objects
  for insert to anon with check (bucket_id = 'public-assets');
