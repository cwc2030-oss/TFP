create table if not exists public.user_stand_journal (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references auth.users(id) on delete cascade not null,
  sit_pin_id uuid references public.user_sit_pins(id) on delete cascade not null,
  entry_date date not null,
  wind_direction text,
  temp_f integer,
  sightings text,
  notes text,
  created_at timestamptz default now()
);

alter table public.user_stand_journal enable row level security;

create policy "Users manage own journal entries"
  on public.user_stand_journal
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create index on public.user_stand_journal(sit_pin_id);
create index on public.user_stand_journal(user_id);
