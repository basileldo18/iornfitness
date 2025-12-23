// SUPABASE CONFIG (Please fill these)
const SUPABASE_URL = 'https://gqilryoyjrihktwdrwqb.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImdxaWxyeW95anJpaGt0d2Ryd3FiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjYxNTc5MzUsImV4cCI6MjA4MTczMzkzNX0.H1n3v74Zl4YaINhL5hvPsiUaeroI1GKuv353-dEi5YM';

// Initialize Supabase
let supabaseClient = null;
if (SUPABASE_URL !== 'YOUR_SUPABASE_URL' && SUPABASE_KEY.length > 20) {
    try {
        supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
    } catch (e) {
        console.error("Supabase init error:", e);
    }
} else {
    console.warn("Supabase Keys missing. Running in Offline Mode.");
}

// State
let appState = {
    userId: null,
    selectedDate: new Date().toISOString().split('T')[0], // Defaults to today
    profile: { weight: 70, height: 175, age: 25, carbGoal: 250 },
    currentLog: { food: [], exercises: [], didWorkout: false },
    historyKeys: [],
    photos: [],
    historyKeys: [],
    photos: [],
    reelIndex: 0,
    activeVisit: null, // For gym attendance
    todayTotalTime: 0,
    gymHistory: {} // date string -> total minutes
};

// --- SILENT AUTH & INIT ---

// --- AUTH & INIT ---
let isSignup = false;

// Remove old mock ID generation
const initApp = async () => {
    // Listen for Auth State Changes
    if (supabaseClient) {
        try {
            // Check current session
            const { data: { session }, error } = await supabaseClient.auth.getSession();

            if (error) {
                console.warn("Session error:", error);
                // If session is invalid/stale, clear it
                await supabaseClient.auth.signOut();
                return;
            }

            if (session) {
                handleSessionOk(session.user.id);
            }
        } catch (e) {
            console.error("Auth init exception:", e);
        }

        supabaseClient.auth.onAuthStateChange((event, session) => {
            if (event === 'SIGNED_IN' && session) {
                handleSessionOk(session.user.id);
            } else if (event === 'SIGNED_OUT') {
                window.location.reload();
            }
        });
    } else {
        // Fallback for offline usage
        alert("Warning: Supabase keys missing. Running in Offline Mode.");
        appState.userId = 'offline_user';
        showMainApp();
    }

    // Init Date Picker
    const datePicker = document.getElementById('datePicker');
    if (datePicker) {
        datePicker.value = appState.selectedDate;
        datePicker.addEventListener('change', (e) => {
            appState.selectedDate = e.target.value;
            fetchCurrentLog().then(updateUI);
        });
    }
};

const handleSessionOk = async (userId) => {
    // Check for "Soft Deleted" account
    const { data: { session } } = await supabaseClient.auth.getSession();
    if (session && session.user.user_metadata && session.user.user_metadata.deleted_account) {
        alert("This account has been deleted and cannot be accessed.");
        await supabaseClient.auth.signOut();
        window.location.reload();
        return;
    }

    appState.userId = userId;
    showMainApp();

    await Promise.all([
        fetchProfile(),
        fetchCurrentLog(),
        fetchHistoryKeys(),
        fetchPhotos(),
        fetchLastVisit(),
        fetchGymHistory(),
        fetchCardioStats()
    ]);
    updateUI();
};

window.deleteAccount = async () => {
    if (!confirm("Are you sure you want to PERMANENTLY DELETE your account? This cannot be undone.")) return;
    if (!confirm("Really? All your data (photos, workouts, history) will be lost.")) return;

    if (!supabaseClient) {
        alert("Offline: Cannot delete cloud account.");
        return;
    }

    const userId = appState.userId;

    try {
        // Tag user as deleted in Auth Metadata (Client-side workaround since we can't fully delete Auth User without Admin API)
        await supabaseClient.auth.updateUser({ data: { deleted_account: true } });

        // Delete data from all tables manually (Cascade is safer if set up in SQL, but explicit here for safety)
        await supabaseClient.from('progress_photos').delete().eq('user_id', userId);
        await supabaseClient.from('workout_sets').delete().eq('user_id', userId);
        await supabaseClient.from('food_items').delete().eq('user_id', userId);
        await supabaseClient.from('daily_logs').delete().eq('user_id', userId);
        await supabaseClient.from('gym_visits').delete().eq('user_id', userId);
        await supabaseClient.from('profiles').delete().eq('user_id', userId);

        alert("Account deleted.");
        await supabaseClient.auth.signOut();
        window.location.reload();

    } catch (err) {
        console.error("Delete Error:", err);
        alert("Error deleting data: " + err.message);
    }
};

// Navigation with Restriction
const navigateTo = (viewId) => {
    // RESTRICTION: Can only log workout (track) if checked in (appState.activeVisit)
    if (viewId === 'track' && !appState.activeVisit) {
        alert("Please Check In to the gym before logging your workout!");
        return;
    }

    const views = document.querySelectorAll('.view');
    views.forEach(v => v.classList.add('hidden'));

    document.getElementById(viewId).classList.remove('hidden');

    // Update nav
    const navItems = document.querySelectorAll('.nav-item');
    navItems.forEach(n => n.classList.remove('active'));

    if (viewId === 'home') navItems[0].classList.add('active');
    if (viewId === 'track') navItems[1].classList.add('active');
    if (viewId === 'history') navItems[2].classList.add('active');
    if (viewId === 'photos') navItems[3].classList.add('active');
    if (viewId === 'profile') navItems[4].classList.add('active');

    if (viewId === 'history') {
        renderHistory();
    }
};
window.navigateTo = navigateTo;

const showMainApp = () => {
    document.getElementById('auth').classList.add('hidden');
    document.getElementById('mainNav').classList.remove('hidden');
    document.getElementById('mainContainer').classList.remove('hidden');
    updateUI(); // Initial render
};

// Auth Actions
window.handleAuthSubmit = async (e) => {
    e.preventDefault();
    const email = document.getElementById('email').value;
    const password = document.getElementById('password').value;
    const msg = document.getElementById('authMsg');

    if (!supabaseClient) return;

    msg.textContent = "Processing...";

    try {
        if (isSignup) {
            // 1. Try to login first! (In case account exists and password matches)
            const { data: loginData, error: loginError } = await supabaseClient.auth.signInWithPassword({
                email,
                password
            });

            if (!loginError && loginData && loginData.session) {
                alert("You already have an account! Logging you in...");
                msg.textContent = "Account exists! Logging in...";
                // Auth listener handles the rest
                return;
            }

            // 2. Proceed to Signup if login failed
            const { data, error } = await supabaseClient.auth.signUp({
                email,
                password,
                options: {
                    emailRedirectTo: window.location.href // Redirect back to this page
                }
            });
            if (error) throw error;

            if (data.session) {
                // Determine if session is active (auto-confirm enabled) or user needs to verify email
                if (data.user && !data.user.confirmed_at) {
                    msg.textContent = "Signup successful! Please verify your email to continue.";
                } else {
                    msg.textContent = "Success! Logging in...";
                    if (document.getElementById('setupBioCheck').checked) {
                        await registerBiometric();
                    }
                }
            } else if (data.user && !data.session) {
                // Typical for email confirmation required flow
                msg.textContent = "Confirmation email sent to " + email + ". Please check your inbox (and spam folder).";
                msg.style.color = "var(--success)";
            } else {
                // Fallback
                msg.textContent = "Verification email sent! Please check your inbox.";
            }
        } else {
            const { data, error } = await supabaseClient.auth.signInWithPassword({
                email,
                password
            });
            if (error) throw error;
            // Listener will handle redirect
        }
    } catch (err) {
        console.error("Auth Error:", err);

        let displayMsg = "Error: " + (err.error_description || err.message);

        // Friendly error for existing user
        if (displayMsg.toLowerCase().includes("already registered") || displayMsg.toLowerCase().includes("unique constraint")) {
            displayMsg = "This email is already registered. Please login instead.";
        }

        msg.textContent = displayMsg;
        msg.style.color = "var(--danger)";
    }
};

window.toggleAuthMode = () => {
    isSignup = !isSignup;
    document.getElementById('authBtn').textContent = isSignup ? "Sign Up" : "Login";
    document.getElementById('toggleAuthBtn').textContent = isSignup ? "Already have an account? Login" : "New here? Sign Up";
    document.getElementById('authMsg').textContent = "";

    const bioOpt = document.getElementById('bioOptIn');
    if (bioOpt) bioOpt.style.display = isSignup ? 'flex' : 'none';
};

window.handleLogout = async () => {
    // Immediate visual feedback
    const btn = document.activeElement;
    if (btn && btn.tagName === 'BUTTON') {
        const originalText = btn.innerHTML;
        btn.textContent = "Logging out...";
        btn.disabled = true;
    }

    try {
        if (supabaseClient) {
            // Force sign out, don't wait forever
            await Promise.race([
                supabaseClient.auth.signOut(),
                new Promise(resolve => setTimeout(resolve, 2000)) // 2s timeout
            ]);
        }
    } catch (e) {
        console.warn("Logout warning:", e);
    } finally {
        // Force reload to clear state and show auth screen
        window.location.reload();
    }
};

// Biometric / WebAuthn Logic
// Biometric Logic
window.registerBiometric = async () => {
    const msg = document.getElementById('authMsg') || { textContent: '' };
    try {
        if (!window.PublicKeyCredential) { alert("Biometrics not supported on this device."); return; }

        // Create Challenge
        const challenge = new Uint8Array(32);
        window.crypto.getRandomValues(challenge);

        const publicKey = {
            challenge: challenge,
            rp: { name: "IronTrack Fitness" },
            user: {
                id: Uint8Array.from("USER_ID_" + Date.now(), c => c.charCodeAt(0)),
                name: appState.email || "user@irontrack.app",
                displayName: "IronTrack User"
            },
            pubKeyCredParams: [{ alg: -7, type: "public-key" }],
            authenticatorSelection: { authenticatorAttachment: "platform" },
            timeout: 60000,
            attestation: "direct"
        };

        msg.textContent = "Please scan your fingerprint/face...";

        const credential = await navigator.credentials.create({ publicKey });

        if (credential) {
            console.log("Credential Created:", credential);
            localStorage.setItem('ironTrack_bioRegistered', 'true');
            localStorage.setItem('ironTrack_bioID', credential.id);
            // Save the current user ID to restore later
            if (appState.userId) {
                localStorage.setItem('ironTrack_bioUserID', appState.userId);
            }

            alert("Biometric Registered Successfully!");
            updateBioStatus();

            if (!appState.userId && isSignup) {
                // user is technically signed in via supabase immediately after signup usually
            }
        }
    } catch (e) {
        console.error(e);
        alert("Biometric Setup Failed: " + e.message);
    }
};

window.handleBiometricLogin = async () => {
    const msg = document.getElementById('authMsg');

    if (!localStorage.getItem('ironTrack_bioRegistered')) {
        alert("No fingerprint registered on this device. Please login with password and set it up in Profile.");
        return;
    }

    try {
        msg.textContent = "Verifying Biometrics...";

        const challenge = new Uint8Array(32);
        window.crypto.getRandomValues(challenge);

        const assertion = await navigator.credentials.get({
            publicKey: {
                challenge: challenge,
                rpId: window.location.hostname,
                userVerification: "required",
            }
        });

        if (assertion) {
            msg.textContent = "Biometric Verified!";

            if (assertion.id === localStorage.getItem('ironTrack_bioID')) {
                // Restore the specific user ID associated with this biometric
                const savedUserID = localStorage.getItem('ironTrack_bioUserID');

                if (savedUserID) {
                    alert("Welcome back!");
                    handleSessionOk(savedUserID);
                } else {
                    // Fallback if no ID was saved (legacy/edge case)
                    handleSessionOk('bio_verified_user');
                }
            } else {
                throw new Error("Credential mismatch");
            }
        }
    } catch (e) {
        console.error(e);
        msg.textContent = "Biometric Error: " + e.message;
    }
};

const updateBioStatus = () => {
    const el = document.getElementById('bioStatus');
    if (el) {
        if (localStorage.getItem('ironTrack_bioRegistered')) {
            el.textContent = "Fingerprint Active";
            el.style.color = "var(--success)";
        } else {
            el.textContent = "No fingerprint registered.";
            el.style.color = "var(--text-muted)";
        }
    }
};




// --- DATA FETCHING ---

const fetchProfile = async () => {
    if (!supabaseClient) return;

    console.log("Fetching profile for User:", appState.userId);

    try {
        const { data, error } = await supabaseClient.from('profiles').select('*').eq('user_id', appState.userId).maybeSingle();

        if (error) {
            console.error("Error fetching profile:", error);

        }

        if (data) {
            console.log("Profile data from DB:", data);
            appState.profile = {
                weight: data.weight ? parseFloat(data.weight) : 70,
                height: data.height ? parseFloat(data.height) : 175,
                age: data.age ? parseInt(data.age) : 25,
                carbGoal: data.carb_goal ? parseInt(data.carb_goal) : 250
            };
            console.log("Profile loaded into appState:", appState.profile);


            // Update profile form fields if profile view is currently visible
            const profileView = document.getElementById('profile');
            if (profileView && !profileView.classList.contains('hidden')) {
                document.getElementById('profileWeight').value = appState.profile.weight;
                document.getElementById('profileHeight').value = appState.profile.height;
                document.getElementById('profileAge').value = appState.profile.age;
            }
        } else {
            // No profile found, create a default profile in the database
            console.log("No profile found in DB, creating default profile.");
            appState.profile = { weight: 70, height: 175, age: 25, carbGoal: 250 };


            // Auto-create default profile
            const { error: createError } = await supabaseClient.from('profiles').insert({
                user_id: appState.userId,
                weight: 70,
                height: 175,
                age: 25,
                carb_goal: 250
            });

            if (createError) {
                console.error("Error creating default profile:", createError);
            } else {
                console.log("Default profile created successfully");
            }
        }
    } catch (e) {
        console.error("Fetch Profile Exception:", e);

    }
};




const fetchCurrentLog = async () => {
    if (!supabaseClient) return;

    const { data: foodData, error: fErr } = await supabaseClient.from('food_items').select('*')
        .eq('user_id', appState.userId).eq('date', appState.selectedDate);

    const { data: exData, error: eErr } = await supabaseClient.from('workout_sets').select('*')
        .eq('user_id', appState.userId).eq('date', appState.selectedDate);

    // Only overwrite if we got data back (i.e. we are online and sync worked)
    // If we are offline or keys are bad, keep local optimistic state so user sees it briefly (or fix Supabase keys)
    if (!fErr && foodData) {
        appState.currentLog.food = foodData;
    }

    if (!eErr && exData) {
        appState.currentLog.exercises = exData;
        appState.currentLog.didWorkout = (exData.length > 0);
    }

    // Fetch Gym Visits for this specific date (Login/Logout info)
    const { data: visitData, error: vErr } = await supabaseClient.from('gym_visits')
        .select('*')
        .eq('user_id', appState.userId)
        .gte('check_in', appState.selectedDate + 'T00:00:00')
        .lte('check_in', appState.selectedDate + 'T23:59:59')
        .order('check_in', { ascending: true });

    if (!vErr && visitData) {
        appState.currentLog.visits = visitData;
    } else {
        appState.currentLog.visits = [];
    }
};

const fetchHistoryKeys = async () => {
    if (!supabaseClient) return;
    const { data } = await supabaseClient.from('daily_logs').select('date')
        .eq('user_id', appState.userId).eq('did_workout', true);
    if (data) appState.historyKeys = data.map(d => d.date);
};

const fetchPhotos = async () => {
    if (!supabaseClient) return;
    const { data } = await supabaseClient.from('progress_photos').select('*').eq('user_id', appState.userId).order('date', { ascending: false });
    if (data) {
        appState.photos = data;
        renderPhotos();
    }
};

const fetchGymHistory = async () => {
    if (!supabaseClient) return;

    // Fetch all visits
    const { data } = await supabaseClient.from('gym_visits')
        .select('check_in, duration_minutes')
        .eq('user_id', appState.userId)
        .not('duration_minutes', 'is', null);

    if (data) {
        const history = {}; // Date -> Mins
        const now = new Date();
        const currentMonth = now.toISOString().slice(0, 7); // YYYY-MM
        const currentYear = now.getFullYear().toString();
        const today = now.toISOString().split('T')[0];

        let daySum = 0;
        let monthSum = 0;
        let yearSum = 0;

        data.forEach(v => {
            const dayStr = v.check_in.split('T')[0];
            const mins = v.duration_minutes || 0;

            if (!history[dayStr]) history[dayStr] = 0;
            history[dayStr] += mins;

            // Aggregates
            if (dayStr === today) daySum += mins;
            if (dayStr.startsWith(currentMonth)) monthSum += mins;
            if (dayStr.startsWith(currentYear)) yearSum += mins;
        });

        appState.gymHistory = history;
        appState.gymStats = { day: daySum, month: monthSum, year: yearSum };
    }
};

const fetchCardioStats = async () => {
    if (!supabaseClient) return;

    // Fetch treadmill sets
    const { data } = await supabaseClient.from('workout_sets')
        .select('date, sets') // sets = duration in mins for treadmill
        .eq('user_id', appState.userId)
        .eq('equipment', 'Treadmill');

    if (data) {
        const now = new Date();
        const currentMonth = now.toISOString().slice(0, 7);
        const currentYear = now.getFullYear().toString();
        const today = now.toISOString().split('T')[0];

        let daySum = 0;
        let monthSum = 0;
        let yearSum = 0;

        data.forEach(d => {
            const mins = parseInt(d.sets) || 0;
            if (d.date === today) daySum += mins;
            if (d.date.startsWith(currentMonth)) monthSum += mins;
            if (d.date.startsWith(currentYear)) yearSum += mins;
        });

        appState.cardioStats = { day: daySum, month: monthSum, year: yearSum };
        refreshAnalyticsUI();
    }
};

// --- ATTENDANCE LOGIC ---
const fetchLastVisit = async () => {
    if (!supabaseClient) return;
    appState.todayTotalTime = 0;

    // Get today's visits to calc total time
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);

    const { data: visits } = await supabaseClient.from('gym_visits')
        .select('*')
        .eq('user_id', appState.userId)
        .gte('check_in', startOfDay.toISOString());

    if (visits) {
        // Sum completed visits
        visits.forEach(v => {
            if (v.duration_minutes) appState.todayTotalTime += v.duration_minutes;
        });

        // Check for active visit (check_out is null)
        const active = visits.find(v => !v.check_out);
        if (active) {
            appState.activeVisit = active;
        } else {
            appState.activeVisit = null;
        }
        updateAttendanceUI();
    }
};

const handleQRScanSuccess = async (decodedText) => {
    closeQRScanner();
    console.log("QR Scanned:", decodedText);

    // Simple validation (in real app, use a secret key)
    if (!decodedText.toLowerCase().includes('gym')) {
        alert("Invalid QR Code. Please scan the official Gym Entry code.");
        return;
    }

    if (appState.activeVisit) {
        performCheckOut();
    } else {
        performCheckIn();
    }
};

const performCheckIn = async () => {
    if (!supabaseClient) { alert("Offline mode"); return; }

    // Prevent double tap
    const btn = document.getElementById('manualCheckInBtn');
    if (btn) btn.disabled = true;

    const { data, error } = await supabaseClient.from('gym_visits').insert({
        user_id: appState.userId,
        check_in: new Date().toISOString()
    }).select().single();

    if (btn) btn.disabled = false;

    if (!error && data) {
        alert("Checked In! Have a great workout!");
        appState.activeVisit = data;
        updateAttendanceUI();
    } else {
        alert(error ? error.message : "Error checking in");
    }
};

const performCheckOut = async () => {
    if (!supabaseClient) { alert("Offline mode"); return; }
    if (!appState.activeVisit) return;

    const btn = document.getElementById('manualCheckOutBtn');
    if (btn) btn.disabled = true;

    const checkOutTime = new Date();
    const checkInTime = new Date(appState.activeVisit.check_in);
    const diffMs = checkOutTime - checkInTime;
    const durationMins = Math.round(diffMs / 60000); // minutes

    const { error } = await supabaseClient.from('gym_visits').update({
        check_out: checkOutTime.toISOString(),
        duration_minutes: durationMins
    }).eq('id', appState.activeVisit.id);

    if (btn) btn.disabled = false;

    if (!error) {
        alert(`Checked Out! Session duration: ${durationMins}m`);
        appState.activeVisit = null;
        appState.todayTotalTime += durationMins;
        updateAttendanceUI();
        updateAttendanceUI();
        fetchGymHistory().then(refreshAnalyticsUI);
    } else {
        alert(error.message);
    }
};

let html5QrcodeScanner = null;

window.openQRScanner = () => {
    document.getElementById('qrModal').classList.remove('hidden');
    document.getElementById('qrModal').style.display = 'flex';

    html5QrcodeScanner = new Html5Qrcode("qr-reader");
    html5QrcodeScanner.start(
        { facingMode: "environment" },
        { fps: 10, qrbox: { width: 250, height: 250 } },
        handleQRScanSuccess,
        (errorMessage) => { /* ignore per-frame errors */ }
    ).catch(err => {
        alert("Error starting QR scanner: " + err);
        closeQRScanner();
    });
};

window.closeQRScanner = () => {
    if (html5QrcodeScanner) {
        html5QrcodeScanner.stop().then(() => {
            html5QrcodeScanner.clear();
            document.getElementById('qrModal').classList.add('hidden');
            document.getElementById('qrModal').style.display = 'none';
        }).catch(err => console.error(err));
    } else {
        document.getElementById('qrModal').classList.add('hidden');
        document.getElementById('qrModal').style.display = 'none';
    }
};

const updateAttendanceUI = () => {
    const statusEl = document.getElementById('attendanceStatus');
    const timeEl = document.getElementById('attendanceTime');

    if (statusEl) {
        if (appState.activeVisit) {
            const checkInTime = new Date(appState.activeVisit.check_in).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
            // Using innerHTML to support <br>
            statusEl.innerHTML = `ACTIVE <br> NOW <br> <span style="font-size:0.55rem; opacity:0.8;">${checkInTime}</span>`;
            statusEl.style.color = "var(--success)";
        } else {
            statusEl.innerHTML = "NOT <br> CHECKED <br> IN";
            statusEl.style.color = "var(--primary)";
        }
    }

    if (timeEl) {
        const h = Math.floor(appState.todayTotalTime / 60);
        const m = appState.todayTotalTime % 60;
        timeEl.textContent = `${h}h ${m}m`;
    }

    // Toggle Buttons
    const inBtn = document.getElementById('manualCheckInBtn');
    const outBtn = document.getElementById('manualCheckOutBtn');

    if (inBtn && outBtn) {
        if (appState.activeVisit) {
            inBtn.classList.add('hidden');
            inBtn.style.display = 'none';
            outBtn.classList.remove('hidden');
            outBtn.style.display = 'block';
        } else {
            inBtn.classList.remove('hidden');
            inBtn.style.display = 'block';
            outBtn.classList.add('hidden');
            outBtn.style.display = 'none';
        }
    }

    // Update Dashboard Login Time

    // Update Dashboard Login Time
    const dashTime = document.getElementById('totalLoginTime');
    if (dashTime) {
        const h = Math.floor(appState.todayTotalTime / 60);
        const m = appState.todayTotalTime % 60;
        dashTime.textContent = `${h}h ${m}m`;
    }

    // Disable/Enable Log Tab based on attendance
    const logBtn = document.getElementById('navLogBtn');
    if (logBtn) {
        if (appState.activeVisit) {
            logBtn.disabled = false;
            logBtn.style.opacity = '1';
            logBtn.style.filter = 'none';
        } else {
            logBtn.disabled = true;
            logBtn.style.opacity = '0.3';
            logBtn.style.filter = 'grayscale(100%)';
        }
    }
};

// --- ACTIONS ---

const addFood = async (name, carbs) => {
    // Optimistic
    const tempId = 'temp-' + Date.now();
    appState.currentLog.food.push({ id: tempId, name, carbs: parseInt(carbs) });
    updateUI();

    if (supabaseClient) {
        await supabaseClient.from('food_items').insert({
            user_id: appState.userId,
            date: appState.selectedDate,
            name,
            carbs: parseInt(carbs)
        });
        fetchCurrentLog().then(updateUI); // Refresh for real ID
    }
};

const deleteFood = async (id) => {
    if (!supabaseClient) return;
    if (confirm("Delete this item?")) {
        await supabaseClient.from('food_items').delete().eq('id', id);
        fetchCurrentLog().then(updateUI);
    }
};

const addExercise = async (name, equipmentVal, sets, reps) => {
    let equipLabel = 'Bodyweight';
    if (equipmentVal == '5') equipLabel = '5kg Dumbbell';
    if (equipmentVal == '7.5') equipLabel = '7.5kg Dumbbell';

    // Optimistic
    appState.currentLog.exercises.push({ name, equipment: equipLabel, sets, reps });
    appState.currentLog.didWorkout = true;
    updateUI();

    if (supabaseClient) {
        const { error } = await supabaseClient.from('workout_sets').insert({
            user_id: appState.userId,
            date: appState.selectedDate,
            name,
            equipment: equipLabel,
            sets,
            reps
        });

        if (!error) {
            await supabaseClient.from('daily_logs').upsert({
                user_id: appState.userId,
                date: appState.selectedDate,
                did_workout: true
            }, { onConflict: 'user_id, date' });

            fetchHistoryKeys();
            fetchCurrentLog().then(updateUI);
            if (equipmentVal === 'Treadmill' || equipmentVal == 'Treadmill') fetchCardioStats(); // Refresh stats
        }
    }
};

const deleteExercise = async (id) => {
    if (!supabaseClient) return;
    if (confirm("Delete this set?")) {
        await supabaseClient.from('workout_sets').delete().eq('id', id);
        // We technically need to check if day still has other workouts to update daily_logs, 
        // but for simplicity we leave daily_log as true (history remains).
        fetchCurrentLog().then(updateUI);
    }
};

const updateProfile = async (w, h, a, c) => {
    const weight = w ? parseFloat(w) : 70;
    const height = h ? parseFloat(h) : 175;
    const age = a ? parseInt(a) : 25;
    const carbGoal = c ? parseInt(c) : 250;

    console.log("Saving profile with values:", { weight, height, age, carbGoal });

    // Safety check for NaNs
    if (isNaN(weight) || isNaN(height) || isNaN(age)) {
        alert("Please enter valid numbers for your profile.");
        return;
    }

    appState.profile = { weight, height, age, carbGoal };
    console.log("Updated appState.profile:", appState.profile);

    // Save locally immediately
    localStorage.setItem('ironTrack_profile_' + appState.userId, JSON.stringify(appState.profile));

    updateUI();

    if (supabaseClient) {
        console.log("Saving profile to database for User:", appState.userId);

        // Try full save first
        const { error } = await supabaseClient.from('profiles').upsert({
            user_id: appState.userId,
            weight,
            height,
            age,
            carb_goal: carbGoal,
            updated_at: new Date()
        });

        if (error) {
            console.warn("First save attempt failed:", error.message);

            // If error is about the 'age' column missing, try saving without it
            if (error.message.includes("age") || error.message.includes("column")) {
                const { error: error2 } = await supabaseClient.from('profiles').upsert({
                    user_id: appState.userId,
                    weight,
                    height,
                    // age omitted
                    carb_goal: carbGoal,
                    updated_at: new Date()
                });

                if (error2) {
                    alert('SAVE FAILED (Retry also failed): ' + error2.message + "\n\nPlease check your internet connection.");
                } else {
                    alert('Profile Saved! (Note: Age field could not be saved due to database schema)');
                }
            } else {
                alert('SAVE FAILED: ' + error.message);
            }
        } else {
            console.log("Profile saved successfully to database!");
            alert('Profile Saved Successfully!\n\nWeight: ' + weight + 'kg\nHeight: ' + height + 'cm\nAge: ' + age + ' years');
        }
    } else {
        alert("Offline Mode: Profile saved locally only.");
    }
};

// --- UI RENDERING ---

window.navigateTo = (viewId) => {
    console.log("Navigating to:", viewId);
    document.querySelectorAll('.view').forEach(el => el.classList.add('hidden'));
    document.getElementById(viewId).classList.remove('hidden');

    document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('active'));
    const lookup = { 'home': 0, 'track': 1, 'tutorials': 2, 'history': 3, 'photos': 4, 'profile': 5 };
    const navItems = document.querySelectorAll('.nav-item');
    if (navItems[lookup[viewId]]) navItems[lookup[viewId]].classList.add('active');

    if (viewId === 'tutorials') {
        console.log('🧭 Navigating to tutorials, calling renderTutorialLibrary...');
        window.renderTutorialLibrary();
    }
    if (viewId === 'history') renderHistory();
    if (viewId === 'profile') {
        console.log("Navigating to profile view. Current appState.profile:", appState.profile);

        // Pre-fill profile with current state
        document.getElementById('profileWeight').value = appState.profile.weight || 70;
        document.getElementById('profileHeight').value = appState.profile.height || 175;
        document.getElementById('profileAge').value = appState.profile.age || 25;
        updateBioStatus();

        // Refresh from DB to ensure we have latest data
        fetchProfile().then(() => {
            // Update inputs if still on profile view
            if (!document.getElementById('profile').classList.contains('hidden')) {
                console.log("Profile fetched. Updating form with:", appState.profile);
                document.getElementById('profileWeight').value = appState.profile.weight || 70;
                document.getElementById('profileHeight').value = appState.profile.height || 175;
                document.getElementById('profileAge').value = appState.profile.age || 25;
            }
        });
    }
};

window.toggleExerciseFields = () => {
    const equip = document.getElementById('exDumbbell').value;
    const lblSets = document.getElementById('lblSets');
    const lblReps = document.getElementById('lblReps');

    if (equip === 'Treadmill') {
        lblSets.textContent = "Time (mins)";
        lblReps.textContent = "Calories (kcal)";
        document.getElementById('exName').placeholder = "e.g. Running, Walking";
        document.getElementById('exName').value = "Cardio"; // Default
    } else if (equip === 'PushUp') {
        lblSets.textContent = "Sets";
        lblReps.textContent = "Reps";
        document.getElementById('exName').value = "Push Up";
    } else {
        lblSets.textContent = "Sets";
        lblReps.textContent = "Reps";
        document.getElementById('exName').placeholder = "e.g. Bicep Curl";
        const currentName = document.getElementById('exName').value;
        if (currentName === "Cardio" || currentName === "Push Up") document.getElementById('exName').value = "";
    }
};



const updateUI = () => {
    // Home Stats
    // Home Stats
    document.getElementById('weightDisplay').textContent = appState.profile.weight;
    document.getElementById('streakDisplay').textContent = appState.historyKeys.length;

    // Update Profile Form Fields - ALWAYS sync with appState.profile
    const profileWeightField = document.getElementById('profileWeight');
    const profileHeightField = document.getElementById('profileHeight');
    const profileAgeField = document.getElementById('profileAge');

    if (profileWeightField && profileHeightField && profileAgeField) {
        // Always update fields to keep them in sync with appState.profile
        profileWeightField.value = appState.profile.weight || 70;
        profileHeightField.value = appState.profile.height || 175;
        profileAgeField.value = appState.profile.age || 25;
        console.log("✓ Profile fields synced:", appState.profile);
    }

    // Day Summary Log (Login/Logout)
    const daySummaryCard = document.getElementById('daySummaryCard');
    const daySummaryList = document.getElementById('daySummaryList');
    // If we have visits or if we are viewing a past date, show summary instead of live attendance
    const todayStr = new Date().toISOString().split('T')[0];
    const isToday = appState.selectedDate === todayStr;

    // Logic: If it's today, show "Attendance Card" (Active Controls). 
    // If it's history OR we want to see details, show Summary Card.
    // Actually, user requested "In recent log when clicking view...", which implies viewing history.
    // Let's show Summary Card if there are visits to show, OR if it's not today.

    // Always clear list first
    if (daySummaryList) daySummaryList.innerHTML = '';

    if (appState.currentLog.visits && appState.currentLog.visits.length > 0) {
        if (daySummaryCard) daySummaryCard.style.display = 'block';

        daySummaryList.innerHTML = appState.currentLog.visits.map(v => {
            const inTime = new Date(v.check_in).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
            const outTime = v.check_out ? new Date(v.check_out).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'Active';
            const dur = v.duration_minutes ? `${v.duration_minutes}m` : '-';

            return `
            <div style="display: flex; justify-content: space-between; align-items: center; background: rgba(255,255,255,0.05); padding: 10px; border-radius: 8px;">
                <div style="display: flex; flex-direction: column;">
                    <span style="color: var(--text-muted); font-size: 0.75rem;">LOGIN</span>
                    <span style="font-weight: bold;">${inTime}</span>
                </div>
                <div style="display: flex; flex-direction: column; align-items: center;">
                     <span style="font-size: 0.8rem; color: var(--primary);">${dur}</span>
                     <span style="font-size: 1.2rem;">&rarr;</span>
                </div>
                <div style="display: flex; flex-direction: column; align-items: flex-end;">
                    <span style="color: var(--text-muted); font-size: 0.75rem;">LOGOUT</span>
                    <span style="font-weight: bold;">${outTime}</span>
                </div>
            </div>`;
        }).join('');
    } else {
        if (daySummaryCard) daySummaryCard.style.display = 'none';
        // If not today and no visits, explicitly hide Summary
        if (!isToday && daySummaryCard) daySummaryCard.style.display = 'none';
    }

    // Toggle Live Attendance Card visibility based on date
    const liveCard = document.getElementById('attendanceStatus')?.closest('.card');
    if (liveCard) {
        if (isToday) {
            liveCard.style.display = 'flex'; // Restore flex for this specific card
        } else {
            liveCard.style.display = 'none';
        }
    }

    // --- POPULATE DASHBOARD WORKOUT LIST (Requested Feature) ---
    const homeLogCard = document.getElementById('dailyWorkoutLogCard');
    const homeLogList = document.getElementById('dailyWorkoutList');

    if (homeLogCard && homeLogList) {
        if (appState.currentLog.exercises && appState.currentLog.exercises.length > 0) {
            homeLogCard.style.display = 'block';
            homeLogList.innerHTML = appState.currentLog.exercises.map(e => `
                <div style="background: rgba(255,255,255,0.05); padding: 12px; border-radius: 8px;">
                     <div style="display: flex; justify-content: space-between; align-items: center;">
                        <div style="flex: 1;">
                            <span style="font-weight: 600;">${e.name}</span>
                            <div class="text-sm text-primary" style="margin-top: 4px;">
                                ${e.equipment === 'Treadmill'
                    ? `${e.sets} mins • ${e.reps} kcal`
                    : `${e.sets} sets x ${e.reps} reps`}
                            </div>
                        </div>
                        <button onclick="openTutorial('${e.name}')" 
                            style="background: rgba(204, 254, 30, 0.15); border: 1px solid var(--primary); color: var(--primary); padding: 8px 12px; border-radius: 8px; font-size: 0.75rem; font-weight: 600; cursor: pointer; white-space: nowrap; margin-left: 10px; transition: all 0.2s;" 
                            onmouseover="this.style.background='var(--primary)'; this.style.color='black';" 
                            onmouseout="this.style.background='rgba(204, 254, 30, 0.15)'; this.style.color='var(--primary)';">
                            📖 Tutorial
                        </button>
                     </div>
                </div>
            `).join('');
        } else {
            homeLogCard.style.display = 'none';
        }
    }

    // Status
    const statusIcon = document.getElementById('workoutCheckIcon');
    if (statusIcon && appState.currentLog.didWorkout) {
        statusIcon.style.background = 'var(--primary)';
        statusIcon.innerHTML = `<svg viewBox="0 0 24 24" fill="black" width="20" height="20"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/></svg>`;
    } else if (statusIcon) {
        statusIcon.style.background = 'transparent';
        statusIcon.innerHTML = '';
    }

    // Lists with Delete


    document.getElementById('exerciseList').innerHTML = appState.currentLog.exercises.map(e => `
        <div class="workout-item">
            <div class="flex justify-between">
                <div style="flex: 1;">
                    <span style="font-weight: 600;">${e.name}</span>
                    <div class="text-sm text-primary">
                        ${e.equipment === 'Treadmill'
            ? `Treadmill • ${e.sets} mins • ${e.reps} kcal`
            : `${e.equipment} • ${e.sets} sets x ${e.reps} reps`
        }
                    </div>
                </div>
                <div style="display: flex; gap: 8px; align-items: center;">
                    <button onclick="openTutorial('${e.name}')" 
                        style="background: rgba(204, 254, 30, 0.15); border: 1px solid var(--primary); color: var(--primary); padding: 6px 10px; border-radius: 6px; font-size: 0.7rem; font-weight: 600; cursor: pointer; transition: all 0.2s;" 
                        onmouseover="this.style.background='var(--primary)'; this.style.color='black';" 
                        onmouseout="this.style.background='rgba(204, 254, 30, 0.15)'; this.style.color='var(--primary)';">
                        📖
                    </button>
                    ${e.id ? `<button class="delete-btn" onclick="deleteExercise('${e.id}')">&times;</button>` : ''}
                </div>
            </div>
        </div>
    `).join('');

    const workoutCard = document.getElementById('workoutStatusCard');
    if (workoutCard) {
        workoutCard.style.display = appState.currentLog.didWorkout ? 'none' : 'block';
    }
};

const renderHistory = () => {
    const now = new Date();
    // Use the selected date year/month if we want to browse history properly? 
    // For now stick to current month heatmap for simplicity
    const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    const mapEl = document.getElementById('monthHeatmap');
    document.getElementById('historyMonthName').textContent = now.toLocaleDateString('en-US', { month: 'long' });

    let html = '';
    const activeDates = new Set(appState.historyKeys);

    for (let i = 1; i <= daysInMonth; i++) {
        const dayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(i).padStart(2, '0')}`;
        const isActive = activeDates.has(dayStr);
        // On click history day, jump to it?
        html += `<div class="day-dot ${isActive ? 'active' : ''}" title="${dayStr}" onclick="jumpToDate('${dayStr}')">${i}</div>`;
    }
    mapEl.innerHTML = html;
    document.getElementById('daysWorkedOutCount').textContent = activeDates.size;

    // Recent logs
    const historyList = document.getElementById('historyLogList');
    // Merge historyKeys (workouts) and gymHistory keys
    const allDates = new Set([...appState.historyKeys, ...Object.keys(appState.gymHistory)]);
    const recent = [...allDates].sort().reverse().slice(0, 7);

    historyList.innerHTML = recent.map(date => {
        const gymTime = appState.gymHistory[date] ? `${Math.floor(appState.gymHistory[date] / 60)}h ${appState.gymHistory[date] % 60}m` : null;
        const workedOut = appState.historyKeys.includes(date);

        return `
         <div class="card" style="padding: 16px; cursor: pointer; display: flex; flex-direction: column; gap: 5px;" onclick="jumpToDate('${date}')">
            <div class="flex justify-between items-center">
                <span style="font-weight: bold;">${date}</span>
                <span class="text-primary text-sm">View &rarr;</span>
            </div>
            <div class="flex gap-4 text-sm text-muted">
                ${workedOut ? '<span>✓ Workout Logged</span>' : ''}
                ${gymTime ? `<span style="color: var(--accent);">Time: ${gymTime}</span>` : ''}
                ${!workedOut && !gymTime ? '<span>No activity</span>' : ''}
            </div>
        </div>
    `}).join('');
};

// Analytics UI
const formatTimeStats = (mins) => {
    if (!mins) return '0m';
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    if (h > 0) return `${h}h ${m}m`;
    return `${m}m`;
};

const refreshAnalyticsUI = () => {
    // Safety check for elements
    const dGym = document.getElementById('statDayGym');
    const mGym = document.getElementById('statMonthGym');
    const yGym = document.getElementById('statYearGym');
    const dCardio = document.getElementById('statDayCardio');
    const mCardio = document.getElementById('statMonthCardio');
    const yCardio = document.getElementById('statYearCardio');

    if (appState.gymStats && dGym) {
        dGym.textContent = formatTimeStats(appState.gymStats.day);
        mGym.textContent = formatTimeStats(appState.gymStats.month);
        yGym.textContent = formatTimeStats(appState.gymStats.year);
    }

    if (appState.cardioStats && dCardio) {
        dCardio.textContent = formatTimeStats(appState.cardioStats.day);
        mCardio.textContent = formatTimeStats(appState.cardioStats.month);
        yCardio.textContent = formatTimeStats(appState.cardioStats.year);
    }
};

window.refreshAnalyticsUI = refreshAnalyticsUI; // Expose if needed
window.deleteFood = deleteFood;
window.deleteExercise = deleteExercise;
// This function renders the Day Detail view content
const renderDayDetail = () => {
    document.getElementById('detailDateHeader').textContent = appState.selectedDate;

    // 1. Session Info
    const sessionList = document.getElementById('detailSessionList');
    if (sessionList) {
        if (appState.currentLog.visits && appState.currentLog.visits.length > 0) {
            sessionList.innerHTML = appState.currentLog.visits.map(v => {
                const inTime = new Date(v.check_in).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
                const outTime = v.check_out ? new Date(v.check_out).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'Active';
                const dur = v.duration_minutes ? `${v.duration_minutes}m` : '-';
                return `
                <div style="display: flex; justify-content: space-between; align-items: center; background: rgba(255,255,255,0.05); padding: 12px; border-radius: 8px;">
                    <div class="flex-col">
                        <span class="text-xs text-muted">LOGIN</span>
                        <span class="font-bold">${inTime}</span>
                    </div>
                    <div class="flex-col items-center">
                         <span class="text-primary text-sm">${dur}</span>
                         <span>&rarr;</span>
                    </div>
                    <div class="flex-col items-end">
                        <span class="text-xs text-muted">LOGOUT</span>
                        <span class="font-bold">${outTime}</span>
                    </div>
                </div>`;
            }).join('');
        } else {
            sessionList.innerHTML = '<p class="text-muted text-sm">No gym sessions recorded for this day.</p>';
        }
    }

    // 2. Workout Log
    const workoutList = document.getElementById('detailWorkoutList');
    if (workoutList) {
        if (appState.currentLog.exercises && appState.currentLog.exercises.length > 0) {
            workoutList.innerHTML = appState.currentLog.exercises.map(e => `
                <div style="background: rgba(255,255,255,0.05); padding: 12px; border-radius: 8px;">
                     <div style="display: flex; justify-content: space-between; align-items: center;">
                        <div style="flex: 1;">
                            <span style="font-weight: 600;">${e.name}</span>
                            <div class="text-sm text-primary" style="margin-top: 4px;">
                                ${e.equipment === 'Treadmill'
                    ? `${e.sets} mins • ${e.reps} kcal`
                    : `${e.sets} sets x ${e.reps} reps`}
                            </div>
                        </div>
                        <button onclick="openTutorial('${e.name}')" 
                            style="background: rgba(204, 254, 30, 0.15); border: 1px solid var(--primary); color: var(--primary); padding: 8px 12px; border-radius: 8px; font-size: 0.75rem; font-weight: 600; cursor: pointer; white-space: nowrap; margin-left: 10px; transition: all 0.2s;" 
                            onmouseover="this.style.background='var(--primary)'; this.style.color='black';" 
                            onmouseout="this.style.background='rgba(204, 254, 30, 0.15)'; this.style.color='var(--primary)';">
                            📖 Tutorial
                        </button>
                     </div>
                </div>
            `).join('');
        } else {
            workoutList.innerHTML = '<p class="text-muted text-sm">No exercises logged.</p>';
        }
    }
};

window.jumpToDate = (date) => {
    appState.selectedDate = date;
    navigateTo('day-detail'); // Go to new Detail View
    window.scrollTo(0, 0);
    fetchCurrentLog().then(() => {
        updateUI();
        renderDayDetail(); // Explicitly render detail view
    });
};

window.performCheckIn = performCheckIn;
window.performCheckOut = performCheckOut;

// Photos Logic
let cameraStream = null;
let currentFacingMode = 'environment'; // Default to back camera

const startCameraStream = async () => {
    const video = document.getElementById('cameraStream');

    // Stop any existing stream first
    if (cameraStream) {
        cameraStream.getTracks().forEach(track => track.stop());
    }

    try {
        console.log(`Starting camera with mode: ${currentFacingMode}`);

        // CONSTRAINTS: strict facingMode if possible, falling back is handled by browser usually,
        // but explicit error handling is safer.
        const constraints = {
            video: {
                facingMode: currentFacingMode,
                width: { ideal: 1920 }, // Try for high res
                height: { ideal: 1080 }
            },
            audio: false
        };

        cameraStream = await navigator.mediaDevices.getUserMedia(constraints);

        video.srcObject = cameraStream;
        video.muted = true; // Required for autoplay on some mobile browsers
        // Use Promise to catch play errors
        await video.play().catch(e => console.error("Video play error:", e));

    } catch (err) {
        console.warn(`Failed to access ${currentFacingMode} camera:`, err);
        // Fallback: If 'environment' fails, try 'user' (and vice-versa) or just any camera
        if (currentFacingMode === 'environment') {
            try {
                console.log("Falling back to default/user camera...");
                cameraStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
                video.srcObject = cameraStream;
                video.muted = true;
                await video.play();
                // Update state to match reality if possible (though we don't know for sure)
                currentFacingMode = 'user';
            } catch (fallbackErr) {
                alert("Unable to access camera: " + fallbackErr.message);
                closeCamera();
            }
        } else {
            alert("Error accessing camera: " + err.message);
            closeCamera();
        }
    }
};

window.openCamera = async () => {
    const modal = document.getElementById('cameraModal');
    modal.classList.remove('hidden');
    modal.style.display = 'flex';
    modal.style.zIndex = '9999';

    // Reset to environment (back) by default for fitness photos
    currentFacingMode = 'environment';
    await startCameraStream();
};

window.switchCamera = async () => {
    // Toggle Mode
    currentFacingMode = (currentFacingMode === 'environment') ? 'user' : 'environment';
    await startCameraStream();
};

window.closeCamera = () => {
    const modal = document.getElementById('cameraModal');
    const video = document.getElementById('cameraStream');

    modal.style.display = 'none';
    modal.classList.add('hidden');

    if (cameraStream) {
        cameraStream.getTracks().forEach(track => track.stop());
        cameraStream = null;
    }
    video.srcObject = null;
};

window.takePicture = () => {
    const video = document.getElementById('cameraStream');
    const canvas = document.getElementById('cameraCanvas');

    if (!video.videoWidth) return; // Video not ready

    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;

    const ctx = canvas.getContext('2d');
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

    // Stop camera immediately for UX
    closeCamera();

    // Convert to blob and upload
    canvas.toBlob(async (blob) => {
        if (!blob) return;

        await uploadPhotoBlob(blob);
    }, 'image/jpeg', 0.8);
};

const uploadPhotoBlob = async (blob) => {
    const fileName = `${appState.userId}/${Date.now()}.jpg`;

    if (!supabaseClient) { alert("Offline mode: Cannot upload."); return; }

    // Upload to Storage
    const { data, error } = await supabaseClient.storage.from('photos').upload(fileName, blob);

    if (error) {
        alert('Upload failed: ' + error.message);
        return;
    }

    // Get Public URL
    const { data: { publicUrl } } = supabaseClient.storage.from('photos').getPublicUrl(fileName);

    // Save to DB
    const { error: dbError } = await supabaseClient.from('progress_photos').insert({
        user_id: appState.userId,
        date: new Date().toISOString().split('T')[0],
        photo_url: publicUrl
    });

    if (dbError) {
        alert('DB Error: ' + dbError.message);
    } else {
        alert('Photo Saved for Progress Reel!');
        fetchPhotos();
    }
};

window.handlePhotoUpload = async (input) => {
    if (input.files && input.files[0]) {
        await uploadPhotoBlob(input.files[0]);
    }
};

const deletePhoto = async (photoId, photoUrl) => {
    if (!confirm("Are you sure you want to delete this photo?")) return;

    // 1. Delete from DB
    const { error: dbError } = await supabaseClient.from('progress_photos').delete().eq('id', photoId);

    if (dbError) {
        alert("Error deleting from DB: " + dbError.message);
        return;
    }

    // 2. Delete from Storage
    // Extract path from URL: .../photos/user_id/filename.jpg
    const path = photoUrl.split('/photos/')[1];
    if (path) {
        const { error: storageError } = await supabaseClient.storage.from('photos').remove([path]);
        if (storageError) console.error("Storage delete warning:", storageError);
    }

    // 3. Refresh
    fetchPhotos();
};

window.deletePhoto = deletePhoto;

const renderPhotos = () => {
    const grid = document.getElementById('photoGrid');
    if (grid) {
        grid.innerHTML = appState.photos.map(p => `
            <div style="position: relative; aspect-ratio: 1; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.3); overflow: hidden;">
                <div onclick="openPhotoReel()" style="width: 100%; height: 100%; background-image: url('${p.photo_url}'); background-size: cover; cursor: pointer;"></div>
                <button onclick="deletePhoto('${p.id}', '${p.photo_url}')" style="position: absolute; top: 5px; right: 5px; background: rgba(0,0,0,0.6); color: white; border: none; border-radius: 50%; width: 24px; height: 24px; display: flex; align-items: center; justify-content: center; cursor: pointer;">&times;</button>
            </div>
        `).join('');
    }
};

window.openPhotoReel = () => {
    if (appState.photos.length === 0) { alert("No photos yet!"); return; }
    appState.reelIndex = 0;
    document.getElementById('reelModal').style.display = 'flex';
    updateReelView();
};

window.closeReel = () => {
    document.getElementById('reelModal').style.display = 'none';
};

window.finishWorkout = () => {
    if (appState.currentLog.exercises.length === 0) {
        alert("Log some exercises first!");
        return;
    }
    // Logic to 'finalize' could go here (e.g. calc total volume)
    // For now, we just give feedback and go home
    alert("Great job! Workout logged for today.");
    navigateTo('home');
};

window.nextReel = () => {
    const sortedPhotos = [...appState.photos].sort((a, b) => new Date(a.date) - new Date(b.date));
    if (appState.reelIndex < sortedPhotos.length - 1) {
        appState.reelIndex++;
        updateReelView();
    }
};

window.prevReel = () => {
    if (appState.reelIndex > 0) {
        appState.reelIndex--;
        updateReelView();
    }
};

const updateReelView = () => {
    const sortedPhotos = [...appState.photos].sort((a, b) => new Date(a.date) - new Date(b.date));
    const photo = sortedPhotos[appState.reelIndex];
    if (photo) {
        document.getElementById('reelImage').src = photo.photo_url;
        document.getElementById('reelDate').textContent = photo.date;
        document.getElementById('reelCounter').textContent = `${appState.reelIndex + 1} of ${sortedPhotos.length}`;
    }
};

const resetApp = async () => {
    if (confirm("Reset local app state?")) {
        localStorage.clear();
        window.location.reload();
    }
};
window.resetApp = resetApp;

window.deleteAccount = async () => {
    if (!confirm("Are you sure you want to PERMANENTLY DELETE your account? This cannot be undone.")) return;
    if (!confirm("Really? All your data (photos, workouts, history) will be lost.")) return;

    if (!supabaseClient) {
        alert("Offline: Cannot delete cloud account.");
        return;
    }

    const userId = appState.userId;

    try {
        // Delete data from all tables manually (Cascade is safer if set up in SQL, but explicit here for safety)
        await supabaseClient.from('progress_photos').delete().eq('user_id', userId);
        await supabaseClient.from('workout_sets').delete().eq('user_id', userId);
        await supabaseClient.from('food_items').delete().eq('user_id', userId);
        await supabaseClient.from('daily_logs').delete().eq('user_id', userId);
        await supabaseClient.from('gym_visits').delete().eq('user_id', userId);
        await supabaseClient.from('profiles').delete().eq('user_id', userId);

        alert("Account data deleted. logging out...");
        await supabaseClient.auth.signOut();
        window.location.reload();

    } catch (err) {
        console.error("Delete Error:", err);
        alert("Error deleting data: " + err.message);
    }
};

// Events


document.getElementById('exerciseForm').addEventListener('submit', (e) => {
    e.preventDefault();
    addExercise(document.getElementById('exName').value, document.getElementById('exDumbbell').value, document.getElementById('exSets').value, document.getElementById('exReps').value);
    alert('Set logged!');
});

// Video Generation Logic
window.downloadReelVideo = async () => {
    if (appState.photos.length === 0) {
        alert("No photos to generate a reel!");
        return;
    }

    const statusMsg = document.createElement('div');
    statusMsg.style.cssText = "position:fixed; top:50%; left:50%; transform:translate(-50%, -50%); background:rgba(0,0,0,0.9); color:white; padding:20px; border-radius:10px; z-index:9999; text-align:center;";
    statusMsg.innerHTML = "<h3>Generating Reel...</h3><p>Please wait while we stitch your photos.</p>";
    document.body.appendChild(statusMsg);

    try {
        const sortedPhotos = [...appState.photos].sort((a, b) => new Date(a.date) - new Date(b.date));

        // Setup Canvas
        const canvas = document.createElement('canvas');
        canvas.width = 1080; // Shorts/Reel resolution vertical
        canvas.height = 1920;
        const ctx = canvas.getContext('2d');

        // Setup Recorder
        const stream = canvas.captureStream(30); // 30 FPS
        const recorder = new MediaRecorder(stream, { mimeType: 'video/webm;codecs=vp9' });
        const chunks = [];

        recorder.ondataavailable = (e) => {
            if (e.data.size > 0) chunks.push(e.data);
        };

        recorder.start();

        // Helper to load image
        const loadImage = (url) => {
            return new Promise((resolve, reject) => {
                const img = new Image();
                img.crossOrigin = "anonymous"; // Important for canvas export
                img.onload = () => resolve(img);
                img.onerror = (e) => reject(e);
                img.src = url;
            });
        };

        // Draw Loop
        for (let i = 0; i < sortedPhotos.length; i++) {
            const photo = sortedPhotos[i];

            try {
                // Load Image
                // Note: If using Supabase storage, ensure CORS is configured or this might fail depending on bucket settings
                // We use the proxy URL if needed, but standard public URLs often work if CORS is set "*"
                const img = await loadImage(photo.photo_url);

                // Draw duration (e.g., 2 seconds per photo = 60 frames)
                const durationFrames = 60;

                for (let f = 0; f < durationFrames; f++) {
                    ctx.fillStyle = "#000";
                    ctx.fillRect(0, 0, canvas.width, canvas.height);

                    // Draw Image (Cover style)
                    const scale = Math.max(canvas.width / img.width, canvas.height / img.height);
                    const x = (canvas.width / 2) - (img.width / 2) * scale;
                    const y = (canvas.height / 2) - (img.height / 2) * scale;
                    ctx.drawImage(img, x, y, img.width * scale, img.height * scale);

                    // Overlay Text
                    ctx.fillStyle = "rgba(0,0,0,0.5)";
                    ctx.fillRect(0, canvas.height - 300, canvas.width, 300);
                    ctx.fillStyle = "white";
                    ctx.font = "bold 80px sans-serif";
                    ctx.textAlign = "center";
                    ctx.fillText(photo.date, canvas.width / 2, canvas.height - 150);

                    // Watermark
                    ctx.font = "40px sans-serif";
                    ctx.fillStyle = "#ccfe1e";
                    ctx.fillText("IronTrack Fitness", canvas.width / 2, 100);

                    await new Promise(r => requestAnimationFrame(r));
                }
            } catch (err) {
                console.error("Error loading image for reel:", err);
                // Skip broken images
            }
        }

        recorder.stop();

        // Wait for stop
        await new Promise(r => recorder.onstop = r);

        // Download
        const blob = new Blob(chunks, { type: 'video/webm' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `irontrack_reel_${Date.now()}.webm`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);

        statusMsg.innerHTML = "<h3>Done!</h3><p>Downloading video...</p>";
        setTimeout(() => document.body.removeChild(statusMsg), 2000);

    } catch (e) {
        console.error(e);
        statusMsg.innerHTML = "<h3>Error</h3><p>" + e.message + "</p>";
        setTimeout(() => document.body.removeChild(statusMsg), 3000);
    }
};

document.getElementById('profileForm').addEventListener('submit', (e) => {
    e.preventDefault();
    updateProfile(
        document.getElementById('profileWeight').value,
        document.getElementById('profileHeight').value,
        document.getElementById('profileAge').value,
        250
    );
});

// --- TUTORIAL LIBRARY SYSTEM ---

// Enhanced tutorial database with categories and images
const tutorialDatabase = {
    'Bicep Curl': {
        title: 'Bicep Curl',
        category: 'arms',
        difficulty: 'Beginner',
        steps: [
            'Stand with feet shoulder-width apart, holding dumbbells at your sides with palms facing forward',
            'Keep your elbows close to your torso and shoulders stable',
            'Curl the weights upward by contracting your biceps, exhaling as you lift',
            'Continue until dumbbells are at shoulder level and biceps are fully contracted',
            'Pause briefly at the top, squeezing your biceps',
            'Slowly lower the dumbbells back to starting position while inhaling'
        ],
        tips: [
            'Keep your elbows stationary - only your forearms should move',
            'Avoid swinging or using momentum - control the weight throughout',
            'Don\'t lean back - maintain an upright posture',
            'Focus on the mind-muscle connection with your biceps'
        ],
        muscles: ['Biceps Brachii', 'Brachialis', 'Forearms'],
        image: null
    },
    'Tricep Extension': {
        title: 'Overhead Tricep Extension',
        category: 'arms',
        difficulty: 'Intermediate',
        steps: [
            'Stand or sit with one dumbbell held overhead with both hands',
            'Position the dumbbell so your palms are pressed against the underside of the top plate',
            'Keep your elbows close to your head and perpendicular to the floor',
            'Lower the dumbbell behind your head by bending at the elbows',
            'Lower until your forearms touch your biceps',
            'Extend arms back to starting position, contracting triceps'
        ],
        tips: [
            'Keep your elbows in - don\'t let them flare out',
            'Maintain an upright posture throughout',
            'Go slowly on the eccentric (lowering) phase',
            'Don\'t arch your back - engage your core'
        ],
        muscles: ['Triceps (all three heads)', 'Anconeus'],
        image: 'C:/Users/basil/.gemini/antigravity/brain/f4153126-6b24-4925-9f0c-ce7ca2ad7c74/tricep_extension_demo_1766513472248.png'
    },
    'Push Up': {
        title: 'Push Up',
        category: 'chest',
        difficulty: 'Beginner',
        steps: [
            'Start in a high plank position with hands shoulder-width apart',
            'Keep your body in a straight line from head to heels',
            'Engage your core and glutes',
            'Lower your body by bending elbows to about 45 degrees from your torso',
            'Go down until chest nearly touches the floor',
            'Push back up to starting position, fully extending arms'
        ],
        tips: [
            'Don\'t let your hips sag or pike up',
            'Look slightly ahead, not straight down',
            'Keep elbows at 45° angle, not flared out to 90°',
            'Breathe in going down, out going up',
            'Start with knee push-ups if needed'
        ],
        muscles: ['Pectoralis Major', 'Anterior Deltoid', 'Triceps', 'Core'],
        image: 'C:/Users/basil/.gemini/antigravity/brain/f4153126-6b24-4925-9f0c-ce7ca2ad7c74/pushup_demo_1766513439998.png'
    },
    'Shoulder Press': {
        title: 'Dumbbell Shoulder Press',
        category: 'shoulders',
        difficulty: 'Intermediate',
        steps: [
            'Sit or stand with dumbbells at shoulder height, palms facing forward',
            'Keep your core engaged and back straight',
            'Press dumbbells upward and slightly inward',
            'Extend arms fully overhead without locking elbows',
            'Pause briefly at the top',
            'Lower weights slowly back to shoulder height'
        ],
        tips: [
            'Don\'t arch your back excessively',
            'Press in a slight arc - dumbbells should come together at top',
            'Breathe out as you press up',
            'Keep core tight to protect lower back'
        ],
        muscles: ['Anterior Deltoid', 'Lateral Deltoid', 'Triceps', 'Upper Chest'],
        image: 'C:/Users/basil/.gemini/antigravity/brain/f4153126-6b24-4925-9f0c-ce7ca2ad7c74/shoulder_press_tutorial_1766513039079.png'
    },
    'Lateral Raise': {
        title: 'Lateral Raise',
        category: 'shoulders',
        difficulty: 'Beginner',
        steps: [
            'Stand with dumbbells at your sides, palms facing inward',
            'Keep a slight bend in your elbows',
            'Raise arms out to the sides until parallel with the floor',
            'Keep your pinky finger slightly higher than your thumb',
            'Pause at the top',
            'Lower slowly back to starting position'
        ],
        tips: [
            'Don\'t use momentum - keep it slow and controlled',
            'Think of pouring water from a pitcher at the top',
            'Keep shoulders down - don\'t shrug',
            'Use lighter weights than you think you need'
        ],
        muscles: ['Lateral Deltoid', 'Anterior Deltoid', 'Supraspinatus'],
        image: null
    },
    'Bent Over Row': {
        title: 'Bent Over Row',
        category: 'back',
        difficulty: 'Intermediate',
        steps: [
            'Bend forward at the waist with dumbbells hanging straight down',
            'Keep your back straight and core engaged',
            'Pull dumbbells up to your sides, keeping elbows close to body',
            'Squeeze shoulder blades together at the top',
            'Pause briefly',
            'Lower dumbbells slowly back to starting position'
        ],
        tips: [
            'Don\'t round your back',
            'Pull with your back muscles, not just your arms',
            'Keep your head in neutral position',
            'Think of pulling your elbows back, not the weights up'
        ],
        muscles: ['Latissimus Dorsi', 'Rhomboids', 'Rear Deltoids', 'Biceps'],
        image: null
    },
    'Treadmill': {
        title: 'Treadmill Workout',
        category: 'cardio',
        difficulty: 'Beginner',
        steps: [
            'Step onto the treadmill and start at a slow walking pace',
            'Maintain an upright posture with shoulders back',
            'Look straight ahead, not down at your feet',
            'Land midfoot and roll through to your toes',
            'Swing arms naturally at your sides (90° bend at elbows)',
            'Gradually increase speed to your target pace',
            'Maintain steady breathing throughout'
        ],
        tips: [
            'Start with 5-minute warm-up at low intensity',
            'Don\'t hold onto the handrails - affects your form',
            'Stay centered on the belt, not too far forward or back',
            'Use a slight incline (1-2%) to simulate outdoor running',
            'Cool down with 5 minutes of walking',
            'Stay hydrated before, during, and after'
        ],
        muscles: ['Quadriceps', 'Hamstrings', 'Glutes', 'Calves', 'Core'],
        image: 'C:/Users/basil/.gemini/antigravity/brain/f4153126-6b24-4925-9f0c-ce7ca2ad7c74/running_demo_1766513488196.png'
    },
    'Chest Press': {
        title: 'Dumbbell Chest Press',
        category: 'chest',
        difficulty: 'Beginner',
        steps: [
            'Lie on a bench or floor with dumbbells at chest level',
            'Position dumbbells to the sides of chest with elbows bent',
            'Press dumbbells up until arms are extended',
            'Dumbbells should follow a slight arc inward',
            'Pause at the top',
            'Lower slowly back to starting position'
        ],
        tips: [
            'Keep shoulder blades retracted (squeezed together)',
            'Don\'t let dumbbells drift too far apart',
            'Maintain control throughout the movement',
            'Press dumbbells slightly toward each other at top'
        ],
        muscles: ['Pectoralis Major', 'Anterior Deltoid', 'Triceps'],
        image: null
    }
};

// --- EXERCISE TUTORIAL SYSTEM ---

const exerciseTutorials = {
    // Bicep Exercises
    'Bicep Curl': {
        title: 'Bicep Curl',
        steps: [
            'Stand with feet shoulder-width apart, holding dumbbells at your sides with palms facing forward',
            'Keep your elbows close to your torso and shoulders stable',
            'Curl the weights upward by contracting your biceps, exhaling as you lift',
            'Continue until dumbbells are at shoulder level and biceps are fully contracted',
            'Pause briefly at the top, squeezing your biceps',
            'Slowly lower the dumbbells back to starting position while inhaling'
        ],
        tips: [
            'Keep your elbows stationary - only your forearms should move',
            'Avoid swinging or using momentum - control the weight throughout',
            'Don\'t lean back - maintain an upright posture',
            'Focus on the mind-muscle connection with your biceps'
        ],
        muscles: ['Biceps Brachii', 'Brachialis', 'Forearms'],
        image: null
    },
    'Hammer Curl': {
        title: 'Hammer Curl',
        steps: [
            'Stand with feet shoulder-width apart, holding dumbbells at your sides with palms facing your body (neutral grip)',
            'Keep your elbows close to your torso',
            'Curl the weights upward while maintaining the neutral grip position',
            'Continue until dumbbells reach shoulder height',
            'Pause and squeeze at the top',
            'Slowly lower back to starting position'
        ],
        tips: [
            'This variation targets the brachialis muscle more effectively',
            'Maintain neutral grip throughout - don\'t rotate your wrists',
            'Keep wrists straight to protect joints',
            'Great for overall arm thickness'
        ],
        muscles: ['Brachialis', 'Biceps Brachii', 'Brachioradialis', 'Forearms']
    },

    // Tricep Exercises
    'Tricep Extension': {
        title: 'Overhead Tricep Extension',
        steps: [
            'Stand or sit with one dumbbell held overhead with both hands',
            'Position the dumbbell so your palms are pressed against the underside of the top plate',
            'Keep your elbows close to your head and perpendicular to the floor',
            'Lower the dumbbell behind your head by bending at the elbows',
            'Lower until your forearms touch your biceps',
            'Extend arms back to starting position, contracting triceps'
        ],
        tips: [
            'Keep your elbows in - don\'t let them flare out',
            'Maintain an upright posture throughout',
            'Go slowly on the eccentric (lowering) phase',
            'Don\'t arch your back - engage your core'
        ],
        muscles: ['Triceps (all three heads)', 'Anconeus']
    },
    'Tricep Kickback': {
        title: 'Tricep Kickback',
        steps: [
            'Bend forward at the waist, keeping your back straight',
            'Hold dumbbells with palms facing your torso',
            'Keep upper arms parallel to your torso and stationary',
            'Extend forearms back by contracting triceps',
            'Fully extend until arms are straight',
            'Slowly return to starting position'
        ],
        tips: [
            'Keep upper arm completely still - only forearm moves',
            'Focus on squeezing triceps at full extension',
            'Use lighter weights for perfect form',
            'Avoid swinging - use controlled movements'
        ],
        muscles: ['Triceps (long head)', 'Posterior Deltoid']
    },

    // Shoulder Exercises
    'Shoulder Press': {
        title: 'Dumbbell Shoulder Press',
        steps: [
            'Sit or stand with dumbbells at shoulder height, palms facing forward',
            'Keep your core engaged and back straight',
            'Press dumbbells upward and slightly inward',
            'Extend arms fully overhead without locking elbows',
            'Pause briefly at the top',
            'Lower weights slowly back to shoulder height'
        ],
        tips: [
            'Don\'t arch your back excessively',
            'Press in a slight arc - dumbbells should come together at top',
            'Breathe out as you press up',
            'Keep core tight to protect lower back'
        ],
        muscles: ['Anterior Deltoid', 'Lateral Deltoid', 'Triceps', 'Upper Chest']
    },
    'Lateral Raise': {
        title: 'Lateral Raise',
        steps: [
            'Stand with dumbbells at your sides, palms facing inward',
            'Keep a slight bend in your elbows',
            'Raise arms out to the sides until parallel with the floor',
            'Keep your pinky finger slightly higher than your thumb',
            'Pause at the top',
            'Lower slowly back to starting position'
        ],
        tips: [
            'Don\'t use momentum - keep it slow and controlled',
            'Think of pouring water from a pitcher at the top',
            'Keep shoulders down - don\'t shrug',
            'Use lighter weights than you think you need'
        ],
        muscles: ['Lateral Deltoid', 'Anterior Deltoid', 'Supraspinatus']
    },

    // Chest Exercises
    'Push Up': {
        title: 'Push Up',
        steps: [
            'Start in a high plank position with hands shoulder-width apart',
            'Keep your body in a straight line from head to heels',
            'Engage your core and glutes',
            'Lower your body by bending elbows to about 45 degrees from your torso',
            'Go down until chest nearly touches the floor',
            'Push back up to starting position, fully extending arms'
        ],
        tips: [
            'Don\'t let your hips sag or pike up',
            'Look slightly ahead, not straight down',
            'Keep elbows at 45° angle, not flared out to 90°',
            'Breathe in going down, out going up',
            'Start with knee push-ups if needed'
        ],
        muscles: ['Pectoralis Major', 'Anterior Deltoid', 'Triceps', 'Core']
    },
    'Chest Press': {
        title: 'Dumbbell Chest Press',
        steps: [
            'Lie on a bench or floor with dumbbells at chest level',
            'Position dumbbells to the sides of chest with elbows bent',
            'Press dumbbells up until arms are extended',
            'Dumbbells should follow a slight arc inward',
            'Pause at the top',
            'Lower slowly back to starting position'
        ],
        tips: [
            'Keep shoulder blades retracted (squeezed together)',
            'Don\'t let dumbbells drift too far apart',
            'Maintain control throughout the movement',
            'Press dumbbells slightly toward each other at top'
        ],
        muscles: ['Pectoralis Major', 'Anterior Deltoid', 'Triceps']
    },

    // Back Exercises
    'Bent Over Row': {
        title: 'Bent Over Row',
        steps: [
            'Bend forward at the waist with dumbbells hanging straight down',
            'Keep your back straight and core engaged',
            'Pull dumbbells up to your sides, keeping elbows close to body',
            'Squeeze shoulder blades together at the top',
            'Pause briefly',
            'Lower dumbbells slowly back to starting position'
        ],
        tips: [
            'Don\'t round your back',
            'Pull with your back muscles, not just your arms',
            'Keep your head in neutral position',
            'Think of pulling your elbows back, not the weights up'
        ],
        muscles: ['Latissimus Dorsi', 'Rhomboids', 'Rear Deltoids', 'Biceps']
    },

    // Cardio
    'Cardio': {
        title: 'Treadmill Running/Walking',
        steps: [
            'Step onto the treadmill and start at a slow walking pace',
            'Maintain an upright posture with shoulders back',
            'Look straight ahead, not down at your feet',
            'Land midfoot and roll through to your toes',
            'Swing arms naturally at your sides (90° bend at elbows)',
            'Gradually increase speed to your target pace',
            'Maintain steady breathing throughout'
        ],
        tips: [
            'Start with 5-minute warm-up at low intensity',
            'Don\'t hold onto the handrails - affects your form',
            'Stay centered on the belt, not too far forward or back',
            'Use a slight incline (1-2%) to simulate outdoor running',
            'Cool down with 5 minutes of walking',
            'Stay hydrated before, during, and after'
        ],
        muscles: ['Quadriceps', 'Hamstrings', 'Glutes', 'Calves', 'Core', 'Cardiovascular System']
    },
    'Running': {
        title: 'Treadmill Running',
        steps: [
            'Step onto the treadmill and start at a slow walking pace',
            'Maintain an upright posture with shoulders back',
            'Look straight ahead, not down at your feet',
            'Land midfoot and roll through to your toes',
            'Swing arms naturally at your sides (90° bend at elbows)',
            'Gradually increase speed to your target pace',
            'Maintain steady breathing throughout'
        ],
        tips: [
            'Start with 5-minute warm-up at low intensity',
            'Don\'t hold onto the handrails - affects your form',
            'Stay centered on the belt, not too far forward or back',
            'Use a slight incline (1-2%) to simulate outdoor running',
            'Cool down with 5 minutes of walking',
            'Stay hydrated before, during, and after'
        ],
        muscles: ['Quadriceps', 'Hamstrings', 'Glutes', 'Calves', 'Core', 'Cardiovascular System']
    },
    'Treadmill': {
        title: 'Treadmill Workout',
        steps: [
            'Step onto the treadmill and start at a slow walking pace',
            'Maintain an upright posture with shoulders back',
            'Look straight ahead, not down at your feet',
            'Land midfoot and roll through to your toes',
            'Swing arms naturally at your sides (90° bend at elbows)',
            'Gradually increase speed to your target pace',
            'Maintain steady breathing throughout'
        ],
        tips: [
            'Start with 5-minute warm-up at low intensity',
            'Don\'t hold onto the handrails - affects your form',
            'Stay centered on the belt, not too far forward or back',
            'Use a slight incline (1-2%) to simulate outdoor running',
            'Cool down with 5 minutes of walking',
            'Stay hydrated before, during, and after'
        ],
        muscles: ['Quadriceps', 'Hamstrings', 'Glutes', 'Calves', 'Core', 'Cardiovascular System']
    }
};

// Generic fallback for exercises not in database
const getGenericTutorial = (exerciseName) => {
    // Detect exercise type from name
    const name = exerciseName.toLowerCase();

    if (name.includes('curl') && (name.includes('bicep') || name.includes('arm'))) {
        return exerciseTutorials['Bicep Curl'];
    } else if (name.includes('tricep') || name.includes('extension')) {
        return exerciseTutorials['Tricep Extension'];
    } else if (name.includes('shoulder') || name.includes('press')) {
        return exerciseTutorials['Shoulder Press'];
    } else if (name.includes('push') && name.includes('up')) {
        return exerciseTutorials['Push Up'];
    } else if (name.includes('row')) {
        return exerciseTutorials['Bent Over Row'];
    } else if (name.includes('raise')) {
        return exerciseTutorials['Lateral Raise'];
    } else if (name.includes('treadmill') || name.includes('running') || name.includes('cardio')) {
        return exerciseTutorials['Cardio'];
    }

    // Ultimate fallback
    return {
        title: exerciseName,
        steps: [
            'Position yourself with proper form and alignment',
            'Engage your core and maintain good posture',
            'Perform the movement with control',
            'Focus on the target muscle group',
            'Complete the full range of motion',
            'Return to starting position with control'
        ],
        tips: [
            'Start with lighter weights to master form',
            'Breathe consistently - don\'t hold your breath',
            'Focus on quality over quantity',
            'Rest adequately between sets',
            'Stop if you feel sharp pain'
        ],
        muscles: ['Primary Muscle Groups'],
        image: null
    };
};

window.openTutorial = (exerciseName) => {
    const tutorial = exerciseTutorials[exerciseName] || getGenericTutorial(exerciseName);

    const modal = document.getElementById('tutorialModal');
    const title = document.getElementById('tutorialTitle');
    const steps = document.getElementById('tutorialSteps');
    const tips = document.getElementById('tutorialTips');
    const muscles = document.getElementById('tutorialMuscles');
    const img = document.getElementById('tutorialImg');
    const placeholder = document.getElementById('tutorialPlaceholder');

    // Set title
    title.textContent = tutorial.title;

    // Set steps
    steps.innerHTML = tutorial.steps.map(step => `<li style="margin-bottom: 8px;">${step}</li>`).join('');

    // Set tips
    tips.innerHTML = tutorial.tips.map(tip => `<li style="margin-bottom: 6px;">${tip}</li>`).join('');

    // Set muscles
    muscles.innerHTML = tutorial.muscles.map(muscle =>
        `<span style="background: rgba(255,255,255,0.1); padding: 6px 12px; border-radius: 20px; font-size: 0.85rem; color: var(--accent);">${muscle}</span>`
    ).join('');

    // Handle image
    if (tutorial.image) {
        img.src = tutorial.image;
        img.style.display = 'block';
        placeholder.style.display = 'none';
    } else {
        img.style.display = 'none';
        placeholder.style.display = 'block';
    }

    // Show modal
    modal.classList.remove('hidden');
    modal.style.display = 'flex';

    // Prevent body scroll
    document.body.style.overflow = 'hidden';
};

window.closeTutorial = () => {
    const modal = document.getElementById('tutorialModal');
    modal.classList.add('hidden');
    modal.style.display = 'none';

    // Restore body scroll
    document.body.style.overflow = '';
};

// Close modal on background click
document.addEventListener('DOMContentLoaded', () => {
    const modal = document.getElementById('tutorialModal');
    if (modal) {
        modal.addEventListener('click', (e) => {
            if (e.target === modal) {
                closeTutorial();
            }
        });
    }
});

// --- TUTORIAL LIBRARY RENDERING SYSTEM ---

// Complete tutorial database with categories - standalone without spread operator
const tutorialDatabaseWithCategories = {
    'Bicep Curl': {
        title: 'Bicep Curl',
        category: 'arms',
        difficulty: 'Beginner',
        image: 'pics/bicep_curl.png',
        steps: [
            'Stand with feet shoulder-width apart, holding dumbbells at your sides with palms facing forward',
            'Keep your elbows close to your torso and shoulders stable',
            'Curl the weights upward by contracting your biceps, exhaling as you lift',
            'Continue until dumbbells are at shoulder level and biceps are fully contracted',
            'Pause briefly at the top, squeezing your biceps',
            'Slowly lower the dumbbells back to starting position while inhaling'
        ],
        tips: [
            'Keep your elbows stationary - only your forearms should move',
            'Avoid swinging or using momentum - control the weight throughout',
            'Don\'t lean back - maintain an upright posture',
            'Focus on the mind-muscle connection with your biceps'
        ],
        muscles: ['Biceps Brachii', 'Brachialis', 'Forearms']
    },
    'Tricep Extension': {
        title: 'Overhead Tricep Extension',
        category: 'arms',
        difficulty: 'Intermediate',
        image: 'pics/tricep_extension.png',
        steps: [
            'Stand or sit with one dumbbell held overhead with both hands',
            'Position the dumbbell so your palms are pressed against the underside of the top plate',
            'Keep your elbows close to your head and perpendicular to the floor',
            'Lower the dumbbell behind your head by bending at the elbows',
            'Lower until your forearms touch your biceps',
            'Extend arms back to starting position, contracting triceps'
        ],
        tips: [
            'Keep your elbows in - don\'t let them flare out',
            'Maintain an upright posture throughout',
            'Go slowly on the eccentric (lowering) phase',
            'Don\'t arch your back - engage your core'
        ],
        muscles: ['Triceps (all three heads)', 'Anconeus']
    },
    'Push Up': {
        title: 'Push Up',
        category: 'chest',
        difficulty: 'Beginner',
        image: 'pics/pushup.png',
        steps: [
            'Start in a high plank position with hands shoulder-width apart',
            'Keep your body in a straight line from head to heels',
            'Engage your core and glutes',
            'Lower your body by bending elbows to about 45 degrees from your torso',
            'Go down until chest nearly touches the floor',
            'Push back up to starting position, fully extending arms'
        ],
        tips: [
            'Don\'t let your hips sag or pike up',
            'Look slightly ahead, not straight down',
            'Keep elbows at 45° angle, not flared out to 90°',
            'Breathe in going down, out going up',
            'Start with knee push-ups if needed'
        ],
        muscles: ['Pectoralis Major', 'Anterior Deltoid', 'Triceps', 'Core']
    },
    'Shoulder Press': {
        title: 'Dumbbell Shoulder Press',
        category: 'shoulders',
        difficulty: 'Intermediate',
        image: 'pics/shoulder_press.png',
        steps: [
            'Sit or stand with dumbbells at shoulder height, palms facing forward',
            'Keep your core engaged and back straight',
            'Press dumbbells upward and slightly inward',
            'Extend arms fully overhead without locking elbows',
            'Pause briefly at the top',
            'Lower weights slowly back to shoulder height'
        ],
        tips: [
            'Don\'t arch your back excessively',
            'Press in a slight arc - dumbbells should come together at top',
            'Breathe out as you press up',
            'Keep core tight to protect lower back'
        ],
        muscles: ['Anterior Deltoid', 'Lateral Deltoid', 'Triceps', 'Upper Chest']
    },
    'Lateral Raise': {
        title: 'Lateral Raise',
        category: 'shoulders',
        difficulty: 'Beginner',
        image: 'pics/lateral_raise.png',
        steps: [
            'Stand with dumbbells at your sides, palms facing inward',
            'Keep a slight bend in your elbows',
            'Raise arms out to the sides until parallel with the floor',
            'Keep your pinky finger slightly higher than your thumb',
            'Pause at the top',
            'Lower slowly back to starting position'
        ],
        tips: [
            'Don\'t use momentum - keep it slow and controlled',
            'Think of pouring water from a pitcher at the top',
            'Keep shoulders down - don\'t shrug',
            'Use lighter weights than you think you need'
        ],
        muscles: ['Lateral Deltoid', 'Anterior Deltoid', 'Supraspinatus']
    },
    'Bent Over Row': {
        title: 'Bent Over Row',
        category: 'back',
        difficulty: 'Intermediate',
        image: 'pics/bent_over_row.png',
        steps: [
            'Bend forward at the waist with dumbbells hanging straight down',
            'Keep your back straight and core engaged',
            'Pull dumbbells up to your sides, keeping elbows close to body',
            'Squeeze shoulder blades together at the top',
            'Pause briefly',
            'Lower dumbbells slowly back to starting position'
        ],
        tips: [
            'Don\'t round your back',
            'Pull with your back muscles, not just your arms',
            'Keep your head in neutral position',
            'Think of pulling your elbows back, not the weights up'
        ],
        muscles: ['Latissimus Dorsi', 'Rhomboids', 'Rear Deltoids', 'Biceps']
    },
    'Treadmill': {
        title: 'Treadmill Workout',
        category: 'cardio',
        difficulty: 'Beginner',
        image: 'pics/treadmill.png',
        steps: [
            'Step onto the treadmill and start at a slow walking pace',
            'Maintain an upright posture with shoulders back',
            'Look straight ahead, not down at your feet',
            'Land midfoot and roll through to your toes',
            'Swing arms naturally at your sides (90° bend at elbows)',
            'Gradually increase speed to your target pace',
            'Maintain steady breathing throughout'
        ],
        tips: [
            'Start with 5-minute warm-up at low intensity',
            'Don\'t hold onto the handrails - affects your form',
            'Stay centered on the belt, not too far forward or back',
            'Use a slight incline (1-2%) to simulate outdoor running',
            'Cool down with 5 minutes of walking',
            'Stay hydrated before, during, and after'
        ],
        muscles: ['Quadriceps', 'Hamstrings', 'Glutes', 'Calves', 'Core']
    },
    'Chest Press': {
        title: 'Dumbbell Chest Press',
        category: 'chest',
        difficulty: 'Beginner',
        image: 'pics/chest_press.png',
        steps: [
            'Lie on a bench or floor with dumbbells at chest level',
            'Position dumbbells to the sides of chest with elbows bent',
            'Press dumbbells up until arms are extended',
            'Dumbbells should follow a slight arc inward',
            'Pause at the top',
            'Lower slowly back to starting position'
        ],
        tips: [
            'Keep shoulder blades retracted (squeezed together)',
            'Don\'t let dumbbells drift too far apart',
            'Maintain control throughout the movement',
            'Press dumbbells slightly toward each other at top'
        ],
        muscles: ['Pectoralis Major', 'Anterior Deltoid', 'Triceps']
    }
};

let currentTutorialFilter = 'all';

window.renderTutorialLibrary = () => {
    try {
        console.log('🎯 renderTutorialLibrary called!');
        const grid = document.getElementById('tutorialGrid');
        console.log('Grid element:', grid);

        if (!grid) {
            console.error('❌ Tutorial grid not found!');
            return;
        }

        const tutorials = Object.entries(tutorialDatabaseWithCategories);
        console.log(`📚 Rendering ${tutorials.length} tutorials...`);
        console.log('Tutorial database:', tutorialDatabaseWithCategories);

        grid.innerHTML = tutorials.map(([key, tutorial]) => {
            console.log(`Processing: ${key}, category: ${tutorial.category}, image: ${tutorial.image}`);

            // Use actual image if available, otherwise use gradient placeholder
            let imageHtml;
            if (tutorial.image) {
                imageHtml = `<img src="${tutorial.image}" alt="${tutorial.title}" style="width: 100%; height: 100%; object-fit: cover; border-radius: 12px 12px 0 0;" onerror="this.style.display='none';">`;
            } else {
                // Fallback gradient
                const categoryColors = {
                    arms: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
                    chest: 'linear-gradient(135deg, #f093fb 0%, #f5576c 100%)',
                    back: 'linear-gradient(135deg, #4facfe 0%, #00f2fe 100%)',
                    shoulders: 'linear-gradient(135deg, #43e97b 0%, #38f9d7 100%)',
                    cardio: 'linear-gradient(135deg, #fa709a 0%, #fee140 100%)'
                };
                const gradient = categoryColors[tutorial.category] || 'linear-gradient(135deg, rgba(204, 254, 30, 0.3), rgba(0, 0, 0, 0.5))';

                const categoryIcons = {
                    arms: '💪',
                    chest: '🏋️',
                    back: '🦾',
                    shoulders: '🤸',
                    cardio: '🏃'
                };
                const icon = categoryIcons[tutorial.category] || '⚡';

                imageHtml = `<div style="width: 100%; height: 100%; background: ${gradient}; display: flex; align-items: center; justify-content: center; font-size: 4rem;">${icon}</div>`;
            }

            return `
                <div class="tutorial-card" data-category="${tutorial.category}" data-name="${tutorial.title.toLowerCase()}" onclick="openTutorialFromLibrary('${key}')">
                    <div class="tutorial-card-image">
                        ${imageHtml}
                    </div>
                    <div class="tutorial-card-content">
                        <div class="tutorial-card-title">${tutorial.title}</div>
                        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
                            <span class="text-xs text-muted">${tutorial.difficulty}</span>
                            <span class="text-xs" style="color: var(--primary);">${tutorial.steps.length} steps</span>
                        </div>
                        <div class="tutorial-card-muscles">
                            ${tutorial.muscles.slice(0, 2).map(m => `<span class="muscle-tag">${m}</span>`).join('')}
                            ${tutorial.muscles.length > 2 ? `<span class="muscle-tag">+${tutorial.muscles.length - 2}</span>` : ''}
                        </div>
                    </div>
                </div>
            `;
        }).join('');

        console.log(`✅ Successfully rendered ${tutorials.length} tutorial cards`);
        console.log('Grid HTML length:', grid.innerHTML.length);
    } catch (error) {
        console.error('❌ Error in renderTutorialLibrary:', error);
    }
};

window.filterByCategory = (category) => {
    currentTutorialFilter = category;
    console.log(`Filtering by category: ${category}`);

    // Update active button
    document.querySelectorAll('.filter-btn').forEach(btn => {
        btn.classList.remove('active');
        if (btn.dataset.category === category) {
            btn.classList.add('active');
        }
    });

    // Filter cards
    const cards = document.querySelectorAll('.tutorial-card');
    let visibleCount = 0;
    cards.forEach(card => {
        if (category === 'all' || card.dataset.category === category) {
            card.style.display = 'block';
            visibleCount++;
        } else {
            card.style.display = 'none';
        }
    });

    console.log(`Showing ${visibleCount} cards for category: ${category}`);
};

window.filterTutorials = () => {
    const searchTerm = document.getElementById('tutorialSearch').value.toLowerCase();
    const cards = document.querySelectorAll('.tutorial-card');
    let visibleCount = 0;

    cards.forEach(card => {
        const name = card.dataset.name;
        const matchesSearch = name.includes(searchTerm);
        const matchesCategory = currentTutorialFilter === 'all' || card.dataset.category === currentTutorialFilter;

        if (matchesSearch && matchesCategory) {
            card.style.display = 'block';
            visibleCount++;
        } else {
            card.style.display = 'none';
        }
    });

    console.log(`Search: "${searchTerm}" - Showing ${visibleCount} cards`);
};

window.openTutorialFromLibrary = (exerciseKey) => {
    console.log(`Opening tutorial: ${exerciseKey}`);
    const tutorial = tutorialDatabaseWithCategories[exerciseKey] || exerciseTutorials[exerciseKey];
    if (tutorial) {
        openTutorialModal(tutorial);
    } else {
        console.error(`Tutorial not found: ${exerciseKey}`);
    }
};

const openTutorialModal = (tutorial) => {
    const modal = document.getElementById('tutorialModal');
    const title = document.getElementById('tutorialTitle');
    const steps = document.getElementById('tutorialSteps');
    const tips = document.getElementById('tutorialTips');
    const muscles = document.getElementById('tutorialMuscles');
    const img = document.getElementById('tutorialImg');
    const placeholder = document.getElementById('tutorialPlaceholder');

    // Set title
    title.textContent = tutorial.title;

    // Set steps
    steps.innerHTML = tutorial.steps.map(step => `<li style="margin-bottom: 8px;">${step}</li>`).join('');

    // Set tips
    tips.innerHTML = tutorial.tips.map(tip => `<li style="margin-bottom: 6px;">${tip}</li>`).join('');

    // Set muscles
    muscles.innerHTML = tutorial.muscles.map(muscle =>
        `<span style="background: rgba(255,255,255,0.1); padding: 6px 12px; border-radius: 20px; font-size: 0.85rem; color: var(--accent);">${muscle}</span>`
    ).join('');

    // Handle image from pics folder
    if (tutorial.image) {
        img.src = tutorial.image;
        img.style.display = 'block';
        placeholder.style.display = 'none';
        img.onerror = () => {
            img.style.display = 'none';
            placeholder.style.display = 'block';
        };
    } else {
        img.style.display = 'none';
        placeholder.style.display = 'block';
    }

    // Show modal
    modal.classList.remove('hidden');
    modal.style.display = 'flex';

    // Prevent body scroll
    document.body.style.overflow = 'hidden';
};

// Start
initApp();

// Check if we're on the tutorials view after initialization
setTimeout(() => {
    const tutorialsView = document.getElementById('tutorials');
    if (tutorialsView && !tutorialsView.classList.contains('hidden')) {
        console.log('⚡ Tutorials view is visible on load, rendering library...');
        window.renderTutorialLibrary();
    }
}, 500);
