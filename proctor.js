/* ============================================
   UNNES LMS — Proctoring Engine
   5 Fitur: Split Screen, Multi-Face, Tab Switch,
   Face Missing, Gaze Detection
   Uses face-api.js with time-based thresholds
   ============================================ */

const Proctor = {
  video: null,
  canvas: null,
  ctx: null,
  stream: null,
  detectionInterval: null,
  isRunning: false,
  violations: [],
  violationCount: 0,
  modelsLoaded: false,
  onViolation: null,
  onExpressionUpdate: null,
  onStatusChange: null,
  _currentStatus: 'idle',
  _currentExpression: { emoji: '😐', label: 'Netral', confidence: 0 },
  _studentNim: null,

  // ---- Time-based violation tracking ----
  // Each violation type has a sustained-time threshold in seconds
  thresholds: {
    gaze_away:        5,  // Looking away for 5 continuous seconds
    multiple_faces:   5,  // 2+ faces for 5 continuous seconds
    tab_switch:       1,  // Tab hidden/switched for 1 continuous second
    no_face:          5,  // No face for 5 continuous seconds
    split_screen:     3,  // Split screen for 3 continuous seconds
  },

  // Timers: track how long each condition has been active (in seconds)
  _timers: {
    gaze_away: 0,
    multiple_faces: 0,
    tab_switch: 0,
    no_face: 0,
    split_screen: 0,
  },

  // Whether each condition is currently active
  _activeConditions: {
    gaze_away: false,
    multiple_faces: false,
    tab_switch: false,
    no_face: false,
    split_screen: false,
  },

  // Cooldown: prevent repeat violations for 15s after triggering
  _cooldowns: {},

  // Tab hidden tracking
  _tabHiddenSince: null,

  expressionEmojis: {
    neutral: '😐', happy: '😊', sad: '😢', angry: '😠',
    fearful: '😨', disgusted: '🤢', surprised: '😮'
  },

  expressionLabels: {
    neutral: 'Netral', happy: 'Senang', sad: 'Sedih', angry: 'Marah',
    fearful: 'Takut', disgusted: 'Jijik', surprised: 'Terkejut'
  },

  // ---- Alarm Sound (Web Audio API) ----
  _alarmPlaying: false,

  playAlarm() {
    if (this._alarmPlaying) return;
    this._alarmPlaying = true;
    try {
      const audioCtx = new (window.AudioContext || window.webkitAudioContext)();

      // Create a loud warning beep pattern: beep-beep-beep
      const playBeep = (startTime, freq, duration) => {
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.connect(gain);
        gain.connect(audioCtx.destination);
        osc.type = 'square';
        osc.frequency.value = freq;
        gain.gain.value = 0.4;
        osc.start(startTime);
        osc.stop(startTime + duration);
      };

      const now = audioCtx.currentTime;
      // 3 rapid beeps
      playBeep(now, 880, 0.15);
      playBeep(now + 0.25, 880, 0.15);
      playBeep(now + 0.5, 1100, 0.3);

      setTimeout(() => {
        this._alarmPlaying = false;
        audioCtx.close();
      }, 1200);
    } catch(e) {
      this._alarmPlaying = false;
      console.warn('[Proctor] Audio alarm failed:', e);
    }
  },

  // ---- Models ----
  async loadModels() {
    if (this.modelsLoaded) return true;
    try {
      const MODEL_URL = 'https://cdn.jsdelivr.net/npm/@vladmandic/face-api@1.7.12/model/';
      await Promise.all([
        faceapi.nets.tinyFaceDetector.loadFromUri(MODEL_URL),
        faceapi.nets.faceExpressionNet.loadFromUri(MODEL_URL),
        faceapi.nets.faceLandmark68TinyNet.loadFromUri(MODEL_URL),
      ]);
      this.modelsLoaded = true;
      console.log('[Proctor] Face-API models loaded');
      return true;
    } catch (err) {
      console.error('[Proctor] Failed to load face models:', err);
      return false;
    }
  },



  // ---- Camera ----
  async startCamera(videoElement, canvasElement) {
    this.video = videoElement;
    this.canvas = canvasElement;
    this.ctx = canvasElement.getContext('2d');

    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        video: { width: 640, height: 480, facingMode: 'user' },
        audio: false
      });
      this.video.srcObject = this.stream;
      await this.video.play();
      this.canvas.width = this.video.videoWidth;
      this.canvas.height = this.video.videoHeight;
      console.log('[Proctor] Camera started');
      return true;
    } catch (err) {
      console.error('[Proctor] Camera access denied:', err);
      return false;
    }
  },

  stopCamera() {
    if (this.stream) {
      this.stream.getTracks().forEach(t => t.stop());
      this.stream = null;
    }
    if (this.video) this.video.srcObject = null;
  },

  // ---- Detection Loop ----
  async startDetection(intervalMs = 600) {
    if (!this.modelsLoaded) {
      const loaded = await this.loadModels();
      if (!loaded) return false;
    }

    this.isRunning = true;
    this._notifyStatus('active');
    this._detectionIntervalMs = intervalMs;

    // Tab visibility detection
    document.addEventListener('visibilitychange', this._handleVisibility);

    // Split screen / window resize detection
    window.addEventListener('resize', this._handleResize);
    window.addEventListener('blur', this._handleWindowBlur);
    window.addEventListener('focus', this._handleWindowFocus);
    // Check initial state
    this._checkSplitScreen();

    // Timer ticker
    this._timerTicker = setInterval(() => this._tickTimers(), 1000);

    // Face detection loop
    this.detectionInterval = setInterval(() => this._detect(), intervalMs);

    // Live frame capture for lecturer monitoring (every 2 seconds)
    this._frameInterval = setInterval(() => this._captureFrame(), 2000);

    console.log('[Proctor] Detection started (5 features)');
    return true;
  },

  stopDetection() {
    this.isRunning = false;
    if (this.detectionInterval) {
      clearInterval(this.detectionInterval);
      this.detectionInterval = null;
    }
    if (this._timerTicker) {
      clearInterval(this._timerTicker);
      this._timerTicker = null;
    }
    if (this._frameInterval) {
      clearInterval(this._frameInterval);
      this._frameInterval = null;
    }
    // Clear live frame from DB
    this._clearLiveFrame();
    document.removeEventListener('visibilitychange', this._handleVisibility);
    window.removeEventListener('resize', this._handleResize);
    window.removeEventListener('blur', this._handleWindowBlur);
    window.removeEventListener('focus', this._handleWindowFocus);
    this.stopCamera();
    console.log('[Proctor] Detection stopped');
  },

  // ---- Tab Visibility ----
  _handleVisibility: function() {
    if (document.hidden) {
      Proctor._tabHiddenSince = Date.now();
      Proctor._activeConditions.tab_switch = true;
    } else {
      Proctor._tabHiddenSince = null;
      Proctor._activeConditions.tab_switch = false;
      Proctor._timers.tab_switch = 0;
    }
  },

  // ---- Split Screen Detection ----
  _handleResize: function() {
    Proctor._checkSplitScreen();
  },

  _handleWindowBlur: function() {
    // Window lost focus — possible split screen interaction
    Proctor._checkSplitScreen();
  },

  _handleWindowFocus: function() {
    Proctor._checkSplitScreen();
  },

  _checkSplitScreen() {
    const winW = window.innerWidth || document.documentElement.clientWidth;
    const screenW = screen.availWidth || screen.width;
    const winH = window.innerHeight || document.documentElement.clientHeight;
    const screenH = screen.availHeight || screen.height;

    // If window width is less than 75% of screen width, likely split screen
    const isSplit = (winW < screenW * 0.75) || (winH < screenH * 0.75);
    this._activeConditions.split_screen = isSplit;

    if (!isSplit) {
      this._timers.split_screen = 0;
    }
  },

  // ---- Timer Ticker (runs every 1 second) ----
  _tickTimers() {
    const types = ['gaze_away', 'multiple_faces', 'tab_switch', 'no_face', 'split_screen'];

    types.forEach(type => {
      if (this._activeConditions[type]) {
        this._timers[type]++;

        // Check if threshold reached
        if (this._timers[type] >= this.thresholds[type]) {
          // Check cooldown (prevent re-trigger for 15s)
          const lastCooldown = this._cooldowns[type] || 0;
          if (Date.now() - lastCooldown > 15000) {
            this._triggerViolation(type);
            this._cooldowns[type] = Date.now();
          }
          // Reset timer to prevent instant re-trigger
          this._timers[type] = 0;
        }
      } else {
        // Condition is not active — reset timer
        this._timers[type] = 0;
      }
    });

    // Notify UI about active conditions and progress
    if (this.onTimerUpdate) {
      this.onTimerUpdate({ ...this._timers }, { ...this._activeConditions });
    }
  },

  _triggerViolation(type) {
    const descriptions = {
      gaze_away: 'Pandangan menyimpang terlalu lama (>5 detik)',
      multiple_faces: 'Terdeteksi 2+ wajah selama >5 detik',
      tab_switch: 'Meninggalkan halaman ujian selama >3 detik',
      no_face: 'Wajah tidak terdeteksi selama >5 detik',
      split_screen: 'Split layar monitor terdeteksi selama >3 detik',
    };

    const violation = {
      type,
      desc: descriptions[type] || type,
      time: new Date().toISOString()
    };
    this.violations.push(violation);
    this.violationCount++;

    // Play alarm sound
    this.playAlarm();

    if (this.onViolation) {
      this.onViolation(violation, this.violationCount);
    }
  },

  // ---- Gaze Detection using landmarks ----
  _analyzeGaze(landmarks) {
    if (!landmarks) return { looking: 'center', isAway: false };

    const pts = landmarks.positions;
    // Nose tip: point 30, Left eye center ~ avg(36-41), Right eye center ~ avg(42-47)
    const nose = pts[30];
    const leftEye = this._avgPoints(pts.slice(36, 42));
    const rightEye = this._avgPoints(pts.slice(42, 48));
    const eyeCenter = { x: (leftEye.x + rightEye.x) / 2, y: (leftEye.y + rightEye.y) / 2 };

    // Face bounding box width for normalization
    const faceWidth = Math.abs(pts[16].x - pts[0].x);
    const faceHeight = Math.abs(pts[8].y - pts[19].y);

    // Horizontal offset: nose relative to eye center
    const hOffset = (nose.x - eyeCenter.x) / faceWidth;
    // Vertical offset: nose tip relative to eye center
    const vOffset = (nose.y - eyeCenter.y) / faceHeight;

    let direction = 'center';
    let isAway = false;

    if (hOffset < -0.15) { direction = 'kiri'; isAway = true; }
    else if (hOffset > 0.15) { direction = 'kanan'; isAway = true; }
    else if (vOffset < 0.2) { direction = 'atas'; isAway = true; }
    else if (vOffset > 0.55) { direction = 'bawah'; isAway = true; }

    return { looking: direction, isAway };
  },

  _avgPoints(pts) {
    const sum = pts.reduce((acc, p) => ({ x: acc.x + p.x, y: acc.y + p.y }), { x: 0, y: 0 });
    return { x: sum.x / pts.length, y: sum.y / pts.length };
  },

  // ---- Main Detection ----
  async _detect() {
    if (!this.isRunning || !this.video || this.video.readyState < 2) return;

    try {
      const detections = await faceapi
        .detectAllFaces(this.video, new faceapi.TinyFaceDetectorOptions({ inputSize: 320, scoreThreshold: 0.4 }))
        .withFaceLandmarks(true)
        .withFaceExpressions();

      // Clear canvas
      this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

      if (detections.length === 0) {
        // ---- NO FACE ----
        this._notifyStatus('no_face');
        this._activeConditions.no_face = true;
        this._activeConditions.gaze_away = false;
        this._activeConditions.multiple_faces = false;

        if (this.onExpressionUpdate) {
          this.onExpressionUpdate({ expression: 'none', emoji: '❌', label: 'Tidak Terdeteksi', confidence: 0 });
        }

      } else if (detections.length > 1) {
        // ---- MULTIPLE FACES ----
        this._notifyStatus('multiple_faces');
        this._activeConditions.multiple_faces = true;
        this._activeConditions.no_face = false;
        this._activeConditions.gaze_away = false;

        if (this.onExpressionUpdate) {
          this.onExpressionUpdate({ expression: 'multiple', emoji: '👥', label: `${detections.length} Wajah`, confidence: 0 });
        }

      } else {
        // ---- SINGLE FACE ----
        this._activeConditions.no_face = false;
        this._activeConditions.multiple_faces = false;

        const det = detections[0];

        // Draw face box
        const box = det.detection.box;
        this.ctx.strokeStyle = '#10B981';
        this.ctx.lineWidth = 2;
        this.ctx.strokeRect(box.x, box.y, box.width, box.height);

        // Draw landmarks
        if (det.landmarks) {
          const pts = det.landmarks.positions;
          this.ctx.fillStyle = 'rgba(212, 168, 67, 0.7)';
          for (const pt of pts) {
            this.ctx.beginPath();
            this.ctx.arc(pt.x, pt.y, 1.5, 0, Math.PI * 2);
            this.ctx.fill();
          }
        }

        // ---- GAZE ANALYSIS ----
        const gaze = this._analyzeGaze(det.landmarks);
        this._activeConditions.gaze_away = gaze.isAway;

        if (gaze.isAway) {
          this._notifyStatus('gaze_away');
        } else {
          this._notifyStatus('active');
        }



        // Draw gaze direction on canvas
        this.ctx.fillStyle = gaze.isAway ? '#EF4444' : '#10B981';
        this.ctx.font = 'bold 12px Inter, sans-serif';
        this.ctx.fillText(
          gaze.isAway ? `👁 Melihat ${gaze.looking}` : '👁 Fokus',
          box.x, box.y - 8
        );

        // ---- EXPRESSION ----
        const expressions = det.expressions;
        let maxExpr = 'neutral';
        let maxVal = 0;
        for (const [expr, val] of Object.entries(expressions)) {
          if (val > maxVal) { maxExpr = expr; maxVal = val; }
        }

        if (this.onExpressionUpdate) {
          this.onExpressionUpdate({
            expression: maxExpr,
            emoji: this.expressionEmojis[maxExpr] || '😐',
            label: this.expressionLabels[maxExpr] || maxExpr,
            confidence: Math.round(maxVal * 100),
            allExpressions: expressions,
            gazeDirection: gaze.looking,
            gazeIsAway: gaze.isAway
          });
        }
      }
    } catch (err) {
      console.error('[Proctor] Detection error:', err);
    }
  },

  // ---- Legacy support ----
  _addViolation(type, desc) {
    // Legacy — now handled by timer-based system
    this._triggerViolation(type);
  },

  _notifyStatus(status) {
    this._currentStatus = status;
    if (this.onStatusChange) {
      this.onStatusChange(status);
    }
  },

  getViolationSummary() {
    const summary = {};
    this.violations.forEach(v => {
      summary[v.type] = (summary[v.type] || 0) + 1;
    });
    return summary;
  },

  // ---- Live Frame Capture for Lecturer Monitoring ----
  _captureFrame() {
    if (!this.video || this.video.readyState < 2 || !this._studentNim) return;
    try {
      const c = document.createElement('canvas');
      c.width = 320;
      c.height = 240;
      const ctx = c.getContext('2d');
      ctx.drawImage(this.video, 0, 0, 320, 240);
      const frameData = c.toDataURL('image/jpeg', 0.5);

      const data = {
        nim: this._studentNim,
        frame: frameData,
        status: this._currentStatus,
        violations: this.violationCount,
        expression: this._currentExpression,
        timestamp: Date.now()
      };

      // Store in IndexedDB
      const req = indexedDB.open('unnes_lms', 3);
      req.onupgradeneeded = (e) => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains('liveProctoring')) {
          db.createObjectStore('liveProctoring', { keyPath: 'nim' });
        }
      };
      req.onsuccess = (e) => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains('liveProctoring')) {
          db.close();
          // Need to upgrade DB version
          const req2 = indexedDB.open('unnes_lms', db.version + 1);
          req2.onupgradeneeded = (e2) => {
            const db2 = e2.target.result;
            if (!db2.objectStoreNames.contains('liveProctoring')) {
              db2.createObjectStore('liveProctoring', { keyPath: 'nim' });
            }
          };
          req2.onsuccess = (e2) => {
            const db2 = e2.target.result;
            const tx = db2.transaction('liveProctoring', 'readwrite');
            tx.objectStore('liveProctoring').put(data);
            db2.close();
          };
          return;
        }
        const tx = db.transaction('liveProctoring', 'readwrite');
        tx.objectStore('liveProctoring').put(data);
        db.close();
      };
    } catch(e) {
      console.warn('[Proctor] Frame capture error:', e);
    }
  },

  _clearLiveFrame() {
    if (!this._studentNim) return;
    try {
      const req = indexedDB.open('unnes_lms', 3);
      req.onsuccess = (e) => {
        const db = e.target.result;
        if (db.objectStoreNames.contains('liveProctoring')) {
          const tx = db.transaction('liveProctoring', 'readwrite');
          tx.objectStore('liveProctoring').delete(this._studentNim);
        }
        db.close();
      };
    } catch(e) {}
  },

  // Static method for lecturer dashboard to get all live frames
  static_getLiveFrames() {
    return new Promise((resolve) => {
      try {
        const req = indexedDB.open('unnes_lms', 3);
        req.onupgradeneeded = (e) => {
          const db = e.target.result;
          if (!db.objectStoreNames.contains('liveProctoring')) {
            db.createObjectStore('liveProctoring', { keyPath: 'nim' });
          }
        };
        req.onsuccess = (e) => {
          const db = e.target.result;
          if (!db.objectStoreNames.contains('liveProctoring')) {
            db.close();
            resolve([]);
            return;
          }
          const tx = db.transaction('liveProctoring', 'readonly');
          const store = tx.objectStore('liveProctoring');
          const all = store.getAll();
          all.onsuccess = () => {
            db.close();
            resolve(all.result || []);
          };
          all.onerror = () => {
            db.close();
            resolve([]);
          };
        };
        req.onerror = () => resolve([]);
      } catch(e) {
        resolve([]);
      }
    });
  },


};
