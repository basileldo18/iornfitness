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
        // Check current session
        const { data: { session } } = await supabaseClient.auth.getSession();

        if (session) {
            handleSessionOk(session.user.id);
        } else {
            // Show Auth Screen (default)
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
    appState.userId = userId;
    // localStorage.setItem('ironTrack_userId', userId); // Not needed with Supabase Auth
    showMainApp();

    await Promise.all([
        fetchProfile(),
        fetchCurrentLog(),
        fetchHistoryKeys(),
        fetchHistoryKeys(),
        fetchPhotos(),
        fetchLastVisit(),
        fetchGymHistory()
    ]);
    updateUI();
};

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
            const { data, error } = await supabaseClient.auth.signUp({
                email,
                password
            });
            if (error) throw error;

            if (data.session) {
                msg.textContent = "Success! Logging in...";

                // Check if they wanted bio
                if (document.getElementById('setupBioCheck').checked) {
                    await registerBiometric();
                }
                // The onAuthStateChange listener will handle the redirection
            } else {
                msg.textContent = "Sign up successful! Please check your email for the confirmation link.";
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
        msg.textContent = "Error: " + (err.error_description || err.message);
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
            localStorage.setItem('ironTrack_bioID', credential.id); // In real app, send to server
            alert("Biometric Registered Successfully!");
            updateBioStatus();

            // If we are in the auth screen, we might want to auto-login (simulated)
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
            // In a real app, verify assertion on server to get session.
            // Here we rely on previous session or mocked 'offline' access for demo functionality if real session expired.

            // Allow access if keys match (Simplified)
            if (assertion.id === localStorage.getItem('ironTrack_bioID')) {
                alert("Identity Verified via Biometrics!");

                // If we have a cached supbase session, use it. If not, this is strictly a Client-Side verify 
                // that doesn't grant DB access without the token. 
                // We will attempt to reload which might pick up the session? 
                // Or just show app if we are treating this as an 'App Lock'

                if (supabaseClient) {
                    const { data: { session } } = await supabaseClient.auth.getSession();
                    if (session) {
                        handleSessionOk(session.user.id);
                    } else {
                        alert("Note: For full database access, please login with password once to refresh your session token.");
                        // Fallback to offline/limited
                        handleSessionOk('bio_verified_user');
                    }
                } else {
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
    const { data } = await supabaseClient.from('profiles').select('*').eq('user_id', appState.userId).single();
    if (data) {
        appState.profile = {
            weight: parseFloat(data.weight),
            height: parseFloat(data.height),
            age: data.age ? parseInt(data.age) : 25,
            carbGoal: parseInt(data.carb_goal)
        };
    } else {
        // Init profile if none
        updateProfile(70, 175, 25, 250);
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

    // Fetch all visits to aggregate (optimization: fetch only recent months if needed)
    const { data } = await supabaseClient.from('gym_visits')
        .select('check_in, duration_minutes')
        .eq('user_id', appState.userId)
        .not('duration_minutes', 'is', null);

    if (data) {
        const history = {};
        data.forEach(v => {
            const date = v.check_in.split('T')[0];
            if (!history[date]) history[date] = 0;
            history[date] += v.duration_minutes;
        });
        appState.gymHistory = history;
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
    const weight = parseFloat(w);
    const height = parseFloat(h);
    const age = parseInt(a);
    const carbGoal = parseInt(c);

    appState.profile = { weight, height, age, carbGoal };
    updateUI();

    if (supabaseClient) {
        const { error } = await supabaseClient.from('profiles').upsert({
            user_id: appState.userId,
            weight,
            height,
            age,
            carb_goal: carbGoal,
            updated_at: new Date()
        });

        if (!error) alert('Profile Saved!');
        else alert('Error: ' + error.message);
    }
};

// --- UI RENDERING ---

window.navigateTo = (viewId) => {
    console.log("Navigating to:", viewId);
    document.querySelectorAll('.view').forEach(el => el.classList.add('hidden'));
    document.getElementById(viewId).classList.remove('hidden');

    document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('active'));
    const lookup = { 'home': 0, 'track': 1, 'history': 2, 'photos': 3, 'profile': 4 };
    const navItems = document.querySelectorAll('.nav-item');
    if (navItems[lookup[viewId]]) navItems[lookup[viewId]].classList.add('active');

    if (viewId === 'history') renderHistory();
    if (viewId === 'profile') {
        // Pre-fill profile
        document.getElementById('profileWeight').value = appState.profile.weight;
        document.getElementById('profileHeight').value = appState.profile.height;
        document.getElementById('profileAge').value = appState.profile.age || 25;
        updateBioStatus();
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
    } else {
        lblSets.textContent = "Sets";
        lblReps.textContent = "Reps";
        document.getElementById('exName').placeholder = "e.g. Bicep Curl";
        if (document.getElementById('exName').value === "Cardio") document.getElementById('exName').value = "";
    }
};



const updateUI = () => {
    // Home Stats
    // Home Stats
    document.getElementById('weightDisplay').textContent = appState.profile.weight;
    document.getElementById('streakDisplay').textContent = appState.historyKeys.length;

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
                <span style="font-weight: 600;">${e.name}</span>
                ${e.id ? `<button class="delete-btn" onclick="deleteExercise('${e.id}')">&times;</button>` : ''}
            </div>
            <div class="text-sm text-primary">
                ${e.equipment === 'Treadmill'
            ? `Treadmill • ${e.sets} mins • ${e.reps} kcal`
            : `${e.equipment} • ${e.sets} sets x ${e.reps} reps`
        }
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

// Global helpers
window.deleteFood = deleteFood;
window.deleteExercise = deleteExercise;
window.jumpToDate = (date) => {
    appState.selectedDate = date;
    document.getElementById('datePicker').value = date;
    navigateTo('home'); // Go to dashboard to see that day
    fetchCurrentLog().then(updateUI);
};

window.performCheckIn = performCheckIn;
window.performCheckOut = performCheckOut;

// Photos Logic
let cameraStream = null;

window.openCamera = async () => {
    const modal = document.getElementById('cameraModal');
    const video = document.getElementById('cameraStream');

    modal.classList.remove('hidden');
    modal.style.display = 'flex';
    modal.style.zIndex = '9999';

    try {
        console.log("Requesting camera access...");
        // Try environment first, but fallback to any video source
        try {
            cameraStream = await navigator.mediaDevices.getUserMedia({
                video: { facingMode: 'environment' },
                audio: false
            });
        } catch (e) {
            console.warn("Environment camera failed, trying default...", e);
            cameraStream = await navigator.mediaDevices.getUserMedia({
                video: true,
                audio: false
            });
        }

        console.log("Camera access granted.");
        video.srcObject = cameraStream;
        // Important: Muted is often required for autoplay permission
        video.muted = true;
        await video.play();
    } catch (err) {
        console.error("Camera Error Full Object:", err);
        alert("Camera Error: " + (err.name || "Unknown") + " - " + err.message);
        closeCamera();
    }
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

// Start
initApp();
