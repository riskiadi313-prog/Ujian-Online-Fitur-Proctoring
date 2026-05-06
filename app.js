/* ============================================
   UNNES LMS — Shared App Utilities
   Database: IndexedDB (UNNES_LMS_DB)
   ============================================ */

const DB_NAME = 'UNNES_LMS_DB';
const DB_VERSION = 3;

// ---- IndexedDB Setup ----
function openDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains('users')) {
        db.createObjectStore('users', { keyPath: 'nim' });
      }
      if (!db.objectStoreNames.contains('exams')) {
        db.createObjectStore('exams', { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('results')) {
        db.createObjectStore('results', { keyPath: 'id' });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function dbGetAll(storeName) {
  return openDB().then(db => {
    return new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, 'readonly');
      const store = tx.objectStore(storeName);
      const req = store.getAll();
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  });
}

function dbPut(storeName, data) {
  return openDB().then(db => {
    return new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, 'readwrite');
      const store = tx.objectStore(storeName);
      const req = store.put(data);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  });
}

function dbPutAll(storeName, items) {
  return openDB().then(db => {
    return new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, 'readwrite');
      const store = tx.objectStore(storeName);
      items.forEach(item => store.put(item));
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  });
}

function dbGet(storeName, key) {
  return openDB().then(db => {
    return new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, 'readonly');
      const store = tx.objectStore(storeName);
      const req = store.get(key);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  });
}

function dbDelete(storeName, key) {
  return openDB().then(db => {
    return new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, 'readwrite');
      const store = tx.objectStore(storeName);
      const req = store.delete(key);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  });
}

// ============================================
// App Object — main API
// ============================================
const App = {
  // ---- Auth (session uses localStorage, OK for session) ----
  getUser() {
    const u = localStorage.getItem('unnes_user');
    return u ? JSON.parse(u) : null;
  },

  setUser(user) {
    localStorage.setItem('unnes_user', JSON.stringify(user));
  },

  logout() {
    localStorage.removeItem('unnes_user');
    window.location.href = 'index.html';
  },

  requireAuth(role) {
    const user = this.getUser();
    if (!user) { window.location.href = 'index.html'; return null; }
    if (role && user.role !== role) {
      window.location.href = user.role === 'student' ? 'student-dashboard.html' : 'lecturer-dashboard.html';
      return null;
    }
    return user;
  },

  // ---- Users (IndexedDB) ----
  async getUsers() {
    return await dbGetAll('users');
  },

  async getStudents() {
    const users = await dbGetAll('users');
    return users.filter(u => u.role === 'student');
  },

  async registerUser(userData) {
    const existing = await dbGet('users', userData.nim);
    if (existing) return { error: 'NIM/NIP sudah terdaftar' };
    await dbPut('users', userData);
    return { success: true };
  },

  async loginUser(nim, password) {
    const user = await dbGet('users', nim);
    if (!user || user.password !== password) return { error: 'NIM/NIP atau password salah' };
    this.setUser(user);
    return { success: true, user };
  },

  // ---- Exams (IndexedDB) ----
  async getExams() {
    return await dbGetAll('exams');
  },

  async addExam(exam) {
    exam.id = 'exam_' + Date.now();
    exam.createdAt = new Date().toISOString();
    await dbPut('exams', exam);
    return exam;
  },

  async updateExam(exam) {
    await dbPut('exams', exam);
    return exam;
  },

  async getExamById(id) {
    return await dbGet('exams', id);
  },

  async deleteExam(id) {
    return openDB().then(db => {
      return new Promise((resolve, reject) => {
        const tx = db.transaction('exams', 'readwrite');
        const store = tx.objectStore('exams');
        const req = store.delete(id);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
    });
  },

  // ---- Results (IndexedDB) ----
  async getResults() {
    return await dbGetAll('results');
  },

  async addResult(result) {
    result.id = 'result_' + Date.now();
    result.submittedAt = new Date().toISOString();
    await dbPut('results', result);
    return result;
  },

  async updateResult(result) {
    await dbPut('results', result);
    return result;
  },

  // ---- Toast ----
  toast(message, type = 'info') {
    let container = document.querySelector('.toast-container');
    if (!container) {
      container = document.createElement('div');
      container.className = 'toast-container';
      document.body.appendChild(container);
    }
    const icons = { success: '✓', warning: '⚠', danger: '✕', info: 'ℹ' };
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.innerHTML = `<span>${icons[type] || 'ℹ'}</span> ${message}`;
    container.appendChild(toast);
    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateX(100%)';
      toast.style.transition = 'all 0.3s ease';
      setTimeout(() => toast.remove(), 300);
    }, 4000);
  },

  // ---- Utilities ----
  formatDate(dateStr) {
    const d = new Date(dateStr);
    return d.toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' });
  },

  formatTime(dateStr) {
    const d = new Date(dateStr);
    return d.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });
  },

  formatDuration(minutes) {
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    if (h === 0) return `${m} menit`;
    return `${h} jam ${m > 0 ? m + ' menit' : ''}`;
  },

  // ---- Init Navbar User ----
  initNavUser() {
    const user = this.getUser();
    if (!user) return;
    const avatar = document.querySelector('.nav-user-avatar');
    const name = document.querySelector('.nav-user-name');
    if (avatar) avatar.textContent = user.name.charAt(0).toUpperCase();
    if (name) name.textContent = user.name;
  },

  // ---- Migrate old localStorage data to IndexedDB ----
  async migrateFromLocalStorage() {
    const oldUsers = localStorage.getItem('unnes_users');
    const oldExams = localStorage.getItem('unnes_exams');
    const oldResults = localStorage.getItem('unnes_results');

    if (oldUsers || oldExams || oldResults) {
      console.log('[App] Migrating localStorage data to IndexedDB...');

      if (oldUsers) {
        const users = JSON.parse(oldUsers);
        for (const u of users) {
          const existing = await dbGet('users', u.nim);
          if (!existing) await dbPut('users', u);
        }
        localStorage.removeItem('unnes_users');
      }

      if (oldExams) {
        const exams = JSON.parse(oldExams);
        for (const e of exams) {
          const existing = await dbGet('exams', e.id);
          if (!existing) await dbPut('exams', e);
        }
        localStorage.removeItem('unnes_exams');
      }

      if (oldResults) {
        const results = JSON.parse(oldResults);
        for (const r of results) {
          const existing = await dbGet('results', r.id);
          if (!existing) await dbPut('results', r);
        }
        localStorage.removeItem('unnes_results');
      }

      // Clean old seed flags
      localStorage.removeItem('unnes_seeded');
      localStorage.removeItem('unnes_seeded_v2');

      console.log('[App] Migration complete');
    }
  },

  // ---- Seed Demo Data (into IndexedDB) ----
  async seedDemoData() {
    // First migrate any old localStorage data
    await this.migrateFromLocalStorage();

    // Check if lecturer exists (key seed indicator)
    const lecturer = await dbGet('users', '123');

    // Clean up old demo students (from previous versions)
    const oldDemoStudents = ['0102521001', '0102521002'];
    for (const nim of oldDemoStudents) {
      const existing = await dbGet('users', nim);
      if (existing) {
        await dbDelete('users', nim);
        console.log(`[App] Removed old demo student: ${nim}`);
      }
    }
    // Clean up old demo results
    const oldResult = await dbGet('results', 'result_1');
    if (oldResult) {
      await dbDelete('results', 'result_1');
      console.log('[App] Removed old demo result');
    }

    if (lecturer) return; // Already seeded

    // Demo users (hanya dosen, tanpa mahasiswa demo)
    await dbPutAll('users', [
      { nim: '123', name: 'Dr. Budi Santoso', email: 'budi@mail.unnes.ac.id', role: 'lecturer', prodi: 'Teknologi Pendidikan', password: '123', phone: '081298765432', registeredAt: '2026-01-15T08:00:00' },
    ]);

    // Demo exams
    await dbPutAll('exams', [
      {
        id: 'exam_1',
        title: 'UTS Algoritma & Pemrograman',
        course: 'Algoritma & Pemrograman',
        lecturer: 'Dr. Budi Santoso',
        lecturerId: '123',
        duration: 90,
        date: '2026-03-05T08:00:00',
        endDate: '2026-03-05T09:30:00',
        proctoring: true,
        status: 'upcoming',
        createdAt: '2026-02-20T10:00:00',
        questions: [
          { id: 'q1', type: 'multiple', text: 'Apa output dari kode berikut?\n\nfor i in range(5):\n    print(i, end=" ")', options: ['0 1 2 3 4', '1 2 3 4 5', '0 1 2 3 4 5', '1 2 3 4'], answer: 0, points: 10 },
          { id: 'q2', type: 'multiple', text: 'Kompleksitas waktu dari algoritma Binary Search adalah...', options: ['O(n)', 'O(log n)', 'O(n²)', 'O(n log n)'], answer: 1, points: 10 },
          { id: 'q3', type: 'multiple', text: 'Manakah yang bukan merupakan tipe data primitif di Python?', options: ['int', 'float', 'array', 'bool'], answer: 2, points: 10 },
          { id: 'q4', type: 'multiple', text: 'Apa perbedaan utama antara list dan tuple di Python?', options: ['List menggunakan kurung siku, tuple kurung biasa', 'List bisa diubah (mutable), tuple tidak', 'Kedua jawaban benar', 'Tidak ada perbedaan'], answer: 2, points: 10 },
          { id: 'q5', type: 'essay', text: 'Jelaskan konsep rekursi dan berikan contoh implementasinya dalam Python untuk menghitung faktorial!', answer: '', points: 20 },
        ]
      },
      {
        id: 'exam_demo_10q',
        title: 'Ujian Uji Coba Lintas Platform (10 Soal)',
        course: 'Sistem Informasi',
        lecturer: 'Panel Admin Dosen',
        lecturerId: '123',
        duration: 60,
        date: '2026-03-02T08:00:00',
        endDate: '2026-03-02T22:00:00',
        proctoring: true,
        status: 'upcoming',
        createdAt: '2026-03-01T10:00:00',
        questions: [
          { id: 'q1', type: 'multiple', text: 'Elemen HTML mana yang digunakan untuk membuat paragraf?', options: ['<p>', '<h1>', '<div>', '<span>'], answer: 0, points: 10 },
          { id: 'q2', type: 'multiple', text: 'Apa fungsi dari CSS?', options: ['Mengelola database', 'Mengatur tampilan halaman web', 'Memberi logika pemrograman', 'Menjalankan server'], answer: 1, points: 10 },
          { id: 'q3', type: 'multiple', text: 'Di mana sebaiknya file CSS eksternal di-link ke dalam dokumen HTML?', options: ['Di dalam <body>', 'Di akhir dokumen', 'Di dalam <head>', 'Tidak perlu di-link'], answer: 2, points: 10 },
          { id: 'q4', type: 'multiple', text: 'Sintaks JavaScript yang benar untuk mengubah isi elemen HTML dengan id="demo" adalah:', options: ['document.getElementByName("demo").innerHTML = "Hello";', '#demo.innerHTML = "Hello";', 'document.getElementById("demo").innerHTML = "Hello";', 'document.getElementById("demo").value = "Hello";'], answer: 2, points: 10 },
          { id: 'q5', type: 'multiple', text: 'Bagaimana cara mendeklarasikan variabel di JavaScript (ES6)?', options: ['v', 'var, let, const', 'variable', 'define'], answer: 1, points: 10 },
          { id: 'q6', type: 'multiple', text: 'Fungsi JSON.stringify() digunakan untuk...', options: ['Mengubah JSON ke objek JavaScript', 'Menghapus key dari objek JSON', 'Membaca file JSON', 'Mengubah objek JavaScript menjadi string JSON'], answer: 3, points: 10 },
          { id: 'q7', type: 'multiple', text: 'Manakah dari berikut ini yang merupakan framework/library JavaScript untuk antarmuka pengguna?', options: ['Laravel', 'Django', 'React', 'Flask'], answer: 2, points: 10 },
          { id: 'q8', type: 'multiple', text: 'Apa tipe database dari IndexedDB yang ada pada browser?', options: ['Relational Database (SQL)', 'Graph Database', 'NoSQL Key-Value Store', 'Document Store'], answer: 2, points: 10 },
          { id: 'q9', type: 'multiple', text: 'Aturan CSS mana yang membuat sebuah grid menjadi flexbox?', options: ['display: flex;', 'display: grid;', 'float: left;', 'position: absolute;'], answer: 0, points: 10 },
          { id: 'q10', type: 'essay', text: 'Coba jelaskan alur bagaimana fitur Live Proctoring mendeteksi wajah mahasiswa menggunakan kamera secara singkat!', answer: '', points: 10 }
        ]
      },
      {
        id: 'exam_2',
        title: 'UTS Basis Data',
        course: 'Basis Data',
        lecturer: 'Dr. Budi Santoso',
        lecturerId: '123',
        duration: 120,
        date: '2026-03-10T10:00:00',
        endDate: '2026-03-10T12:00:00',
        proctoring: true,
        status: 'upcoming',
        createdAt: '2026-02-22T10:00:00',
        questions: [
          { id: 'q1', type: 'multiple', text: 'SQL merupakan singkatan dari...', options: ['Structured Query Language', 'Simple Query Language', 'Standard Query Logic', 'System Query Language'], answer: 0, points: 10 },
          { id: 'q2', type: 'multiple', text: 'Perintah SQL untuk menampilkan semua data dari tabel mahasiswa adalah...', options: ['GET * FROM mahasiswa', 'SELECT * FROM mahasiswa', 'SHOW * FROM mahasiswa', 'DISPLAY * FROM mahasiswa'], answer: 1, points: 10 },
          { id: 'q3', type: 'multiple', text: 'Normalisasi bertujuan untuk...', options: ['Mempercepat query', 'Mengurangi redundansi data', 'Menambah kolom', 'Menghapus tabel'], answer: 1, points: 10 },
          { id: 'q4', type: 'essay', text: 'Jelaskan perbedaan antara INNER JOIN, LEFT JOIN, dan RIGHT JOIN beserta contoh kasus penggunaannya!', answer: '', points: 30 },
        ]
      },
      {
        id: 'exam_3',
        title: 'Kuis Jaringan Komputer',
        course: 'Jaringan Komputer',
        lecturer: 'Dr. Budi Santoso',
        lecturerId: '123',
        duration: 45,
        date: '2026-02-25T13:00:00',
        endDate: '2026-02-25T13:45:00',
        proctoring: false,
        status: 'completed',
        createdAt: '2026-02-18T10:00:00',
        questions: [
          { id: 'q1', type: 'multiple', text: 'Layer ke-3 pada model OSI adalah...', options: ['Transport', 'Network', 'Data Link', 'Session'], answer: 1, points: 25 },
          { id: 'q2', type: 'multiple', text: 'Protokol yang digunakan untuk mengirim email adalah...', options: ['HTTP', 'FTP', 'SMTP', 'DNS'], answer: 2, points: 25 },
        ]
      }
    ]);

    console.log('[App] Demo data seeded into IndexedDB');
  },

  // ---- Delete All Students (keeps lecturers) ----
  async deleteAllStudents() {
    const users = await dbGetAll('users');
    const students = users.filter(u => u.role === 'student');
    const db = await openDB();
    const tx = db.transaction('users', 'readwrite');
    const store = tx.objectStore('users');
    for (const s of students) {
      store.delete(s.nim);
    }
    await new Promise((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    // Also delete all results
    const tx2 = db.transaction('results', 'readwrite');
    tx2.objectStore('results').clear();
    await new Promise((resolve, reject) => {
      tx2.oncomplete = () => resolve();
      tx2.onerror = () => reject(tx2.error);
    });
    console.log(`[App] Deleted ${students.length} student(s) and all results`);
    return students.length;
  },

  // ---- Clear ALL data and re-seed ----
  async clearAllData() {
    const db = await openDB();
    const stores = ['users', 'exams', 'results'];
    for (const name of stores) {
      const tx = db.transaction(name, 'readwrite');
      tx.objectStore(name).clear();
      await new Promise((resolve) => { tx.oncomplete = resolve; });
    }
    console.log('[App] All data cleared');
    await this.seedDemoData();
  }
};

// Auto-seed on load
App.initPromise = App.seedDemoData();

