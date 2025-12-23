-- 1. DROP EXISTING (Clean Slate)
drop table if exists public.profiles;
drop table if exists public.daily_logs;
drop table if exists public.food_items;
drop table if exists public.workout_sets;

-- 2. PROFILES (Simple ID based)
create table public.profiles (
  user_id text not null primary key, -- Just the UUID string stored in local storage
  weight numeric default 70,
  height numeric default 175,
  age integer default 25,
  carb_goal integer default 250,
  updated_at timestamp with time zone default timezone('utc'::text, now())
);

alter table public.profiles enable row level security;
create policy "Public profiles access" on profiles for all using (true) with check (true);

-- 3. DAILY LOGS
create table public.daily_logs (
  id uuid default uuid_generate_v4() primary key,
  user_id text not null,
  date date not null,
  did_workout boolean default false,
  unique(user_id, date)
);

alter table public.daily_logs enable row level security;
create policy "Public logs access" on daily_logs for all using (true) with check (true);

-- 4. FOOD ITEMS
create table public.food_items (
  id uuid default uuid_generate_v4() primary key,
  user_id text not null,
  date date not null,
  name text not null,
  carbs integer not null,
  created_at timestamp with time zone default timezone('utc'::text, now())
);

alter table public.food_items enable row level security;
create policy "Public food access" on food_items for all using (true) with check (true);

-- 5. WORKOUT SETS
create table public.workout_sets (
  id uuid default uuid_generate_v4() primary key,
  user_id text not null,
  date date not null,
  name text not null,
  equipment text not null,
  sets integer default 1,
  reps integer default 10,
  created_at timestamp with time zone default timezone('utc'::text, now())
);


-- 6. PROGRESS PHOTOS
create table public.progress_photos (
  id uuid default uuid_generate_v4() primary key,
  user_id text not null,
  date date not null,
  photo_url text not null,
  created_at timestamp with time zone default timezone('utc'::text, now())
);


alter table public.progress_photos enable row level security;
create policy "Public photos access" on progress_photos for all using (true) with check (true);

-- 7. GYM ATTENDANCE
create table public.gym_visits (
  id uuid default uuid_generate_v4() primary key,
  user_id text not null,
  check_in timestamp with time zone not null,
  check_out timestamp with time zone,
  duration_minutes integer,
  created_at timestamp with time zone default timezone('utc'::text, now())
);

alter table public.gym_visits enable row level security;
create policy "Public visits access" on gym_visits for all using (true) with check (true);

-- NOTE: You must also create a PUBLIC Storage Bucket named 'photos' in your Supabase Dashboard.
