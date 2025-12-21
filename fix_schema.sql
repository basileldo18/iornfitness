-- Run this in your Supabase SQL Editor to fix the "age column missing" error

ALTER TABLE profiles 
ADD COLUMN IF NOT EXISTS age INTEGER DEFAULT 25;

-- While we are at it, ensure other columns exist too
ALTER TABLE profiles 
ADD COLUMN IF NOT EXISTS carb_goal INTEGER DEFAULT 250;
