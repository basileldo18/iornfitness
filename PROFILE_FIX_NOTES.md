# Profile Data Persistence Fix

## Problem
User reported that after entering age, height, and weight in the profile and saving, the data was not persisting after page refresh.

## Changes Made

### 1. Enhanced `fetchProfile()` Function (app.js, lines 406-470)
**Improvements:**
- Added detailed console logging to track when profile data is fetched from the database
- Added automatic creation of default profile in database if none exists (prevents "not found" issues)
- Added logic to update profile form fields if the profile view is currently visible when data is fetched
- Better error handling and debugging information

**Key Changes:**
```javascript
// Now logs the raw data from database
console.log("Profile data from DB:", data);

// Now logs the parsed profile state
console.log("Profile loaded into appState:", appState.profile);

// Updates form fields if profile view is visible
if (profileView && !profileView.classList.contains('hidden')) {
    document.getElementById('profileWeight').value = appState.profile.weight;
    document.getElementById('profileHeight').value = appState.profile.height;
    document.getElementById('profileAge').value = appState.profile.age;
}
```

### 2. Enhanced Profile Navigation (app.js, lines 938-955)
**Improvements:**
- Added console logging when navigating to profile view
- Added fallback values (|| 70, || 175, || 25) to prevent empty fields
- Better logging after fetching fresh data from database

**Key Changes:**
```javascript
console.log("Navigating to profile view. Current appState.profile:", appState.profile);
// ... populate forms with fallbacks
console.log("Profile fetched. Updating form with:", appState.profile);
```

### 3. Enhanced `updateProfile()` Function (app.js, lines 864-923)
**Improvements:**
- Added logging before saving to show what values are being saved
- Added logging after updating appState
- Improved success message to show the actual saved values
- Better error messages for database schema issues

**Key Changes:**
```javascript
console.log("Saving profile with values:", { weight, height, age, carbGoal });
console.log("Updated appState.profile:", appState.profile);
console.log("Profile saved successfully to database!");
alert('Profile Saved Successfully!\n\nWeight: ' + weight + 'kg\nHeight: ' + height + 'cm\nAge: ' + age + ' years');
```

## How It Works Now

1. **First Time User:**
   - When user logs in for the first time, no profile exists in database
   - System automatically creates a default profile (weight: 70kg, height: 175cm, age: 25)
   - User can then edit and save their actual values

2. **Saving Profile:**
   - User enters age, height, weight
   - Clicks "Save Profile"
   - Data is saved to:
     - `appState.profile` (in-memory)
     - `localStorage` (for offline backup)
     - Supabase database (for persistence across devices)
   - Success message shows the saved values

3. **Loading Profile (After Refresh):**
   - When user logs in, `handleSessionOk()` calls `fetchProfile()`
   - `fetchProfile()` loads data from database into `appState.profile`
   - When user navigates to profile page:
     - Form fields are pre-filled with `appState.profile`
     - Database is re-fetched to ensure latest data
     - Form fields are updated again with fresh data

4. **Debugging:**
   - Console logs show each step of the process
   - Debug panel in profile page shows:
     - Supabase connection status
     - Number of fetch attempts
     - Current profile state as JSON

## Testing Steps

1. **Test Saving:**
   - Open the app and login
   - Navigate to Profile
   - Enter: Weight: 75, Height: 180, Age: 30
   - Click "Save Profile"
   - Verify alert shows: "Profile Saved Successfully! Weight: 75kg, Height: 180cm, Age: 30 years"

2. **Test Persistence:**
   - After saving, refresh the page (F5)
   - Login again
   - Navigate to Profile
   - Verify fields show: Weight: 75, Height: 180, Age: 30

3. **Check Console Logs:**
   - Open browser DevTools (F12) → Console tab
   - Look for logs showing:
     - "Profile data from DB: {weight: 75, height: 180, age: 30, ...}"
     - "Profile loaded into appState: {weight: 75, height: 180, age: 30, ...}"

4. **Check Debug Panel:**
   - In Profile page, scroll to bottom
   - "Debug Info" panel should show:
     - Online: Yes
     - State: {"weight":75,"height":180,"age":30,"carbGoal":250}

## Database Schema

The `profiles` table in Supabase includes:
```sql
create table public.profiles (
  user_id text not null primary key,
  weight numeric default 70,
  height numeric default 175,
  age integer default 25,
  carb_goal integer default 250,
  updated_at timestamp with time zone default timezone('utc'::text, now())
);
```

All fields are properly supported and should save/load correctly.

## Common Issues & Solutions

**Issue: Fields show default values after refresh**
- Check browser console for errors
- Verify Supabase connection (Debug panel shows "Online: Yes")
- Check if database has the data: Open Supabase dashboard → Table Editor → profiles table

**Issue: "Column 'age' does not exist" error**
- Run the schema file again: `supabase_schema.sql`
- Or add the age column manually in Supabase dashboard

**Issue: Data saves but doesn't load**
- Check if user_id is consistent (Debug panel shows User ID)
- Verify RLS policies allow SELECT on profiles table
