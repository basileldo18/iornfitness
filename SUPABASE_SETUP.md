# Setup Instructions for Supabase

To make the app work with a fresh user database, you need to set up a Supabase project.

1.  **Go to [Supabase](https://supabase.com/)** and create a free project.
2.  **Go to the SQL Editor** (in the left sidebar) in your new project.
3.  **Copy the contents of `supabase_schema.sql`** (included in this folder) and paste it into the SQL Editor. **Run** the script.
    -   This creates the necessary tables (`profiles`, `daily_logs`, `food_items`, `workout_sets`) and security policies.

4.  **Get your API Keys**:
    -   Go to **Project Settings** -> **API**.
    -   Copy the `URL` and the `anon` / `public` key.

5.  **Edit `app.js`**:
    -   Open `app.js`.
    -   Replace `'YOUR_SUPABASE_URL'` with your actual URL.
    -   Replace `'YOUR_SUPABASE_ANON_KEY'` with your actual Key.

6.  **Setup Storage for Photos**:
    -   Go to **Storage** (left sidebar).
    -   Create a new **bucket** named `photos`.
    -   Make sure it is **Public**.
    -   (Optional but recommended) Add a policy to allow uploads if you want to restrict it, but for this demo, public access is assumed.

7.  **Run the App**:
    -   Refresh `index.html`.
    -   The app will generate a random User ID and start tracking locally and in the cloud.
