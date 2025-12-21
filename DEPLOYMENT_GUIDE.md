# Deployment Guide

Since accessing specific hosting accounts requires personal authentication, here are the steps to deploy your `iornfitness` repository to other popular free hosting platforms.

## Option 1: Netlify (Recommended for ease of use)
1.  **Log in**: Go to [app.netlify.com](https://app.netlify.com/) and log in with your GitHub account.
2.  **Add New Site**: Click **"Add new site"** -> **"Import from existing project"**.
3.  **Connect GitHub**: Select **GitHub**.
4.  **Select Repo**: Choose `iornfitness` from the list.
5.  **Deploy**: 
    -   **Build command**: (Leave blank)
    -   **Publish directory**: (Leave blank or `.`)
    -   Click **Deploy `iornfitness`**.
6.  **Done**: Netlify will give you a URL (e.g., `golden-sunflower-123456.netlify.app`), which you can change in "Site Settings".

## Option 2: Vercel (Fast and popular)
1.  **Log in**: Go to [vercel.com](https://vercel.com/) and log in with GitHub.
2.  **Add New**: Click **"Add New..."** -> **"Project"**.
3.  **Import**: Find `iornfitness` in the list and click **Import**.
4.  **Deploy**: 
    -   Framework Preset: **Other**
    -   Root Directory: `./`
    -   Click **Deploy**.
5.  **Done**: You will get a live URL immediately.

## Option 3: GitHub Pages (Built-in)
1.  Go to your repository settings on GitHub: [https://github.com/basileldo18/iornfitness/settings](https://github.com/basileldo18/iornfitness/settings).
2.  On the left sidebar, click **Pages**.
3.  Under **Build and deployment** > **Source**, select **Deploy from a branch**.
4.  Under **Branch**, select `main` and `/ (root)`.
5.  Click **Save**.
6.  Wait a minute, and your site will be live at `https://basileldo18.github.io/iornfitness/`.
