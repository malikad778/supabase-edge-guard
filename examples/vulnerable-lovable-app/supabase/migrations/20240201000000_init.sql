create table public.todos (
  id bigint generated always as identity primary key,
  user_id uuid not null,
  title text not null
);
create table public.settings (
  id bigint generated always as identity primary key,
  theme text
);
alter table public.todos enable row level security;
create index todos_user_idx on public.todos (user_id);
create policy "own todos" on public.todos using (user_id = auth.uid()) with check (user_id = (select auth.uid()));
