# Bot Reminder WhatsApp Pribadi

Bot ini mengirim pengingat jadwal ke satu nomor pemilik dan menerima perintah hanya dari nomor tersebut. Bot memakai Node.js 20+, Baileys, node-cron, dotenv, pino, dan renderer QR terminal.

## Instalasi

Pastikan Node.js versi 20 atau lebih baru dan npm tersedia pada server.

```bash
node --version
npm install
cp .env.example .env
chmod 600 .env
```

Isi `.env` sebelum menjalankan bot:

```dotenv
OWNER_NUMBER=62xxxxxxxxxx
TZ=Asia/Makassar
REMIND_BEFORE_MIN=15
```

`OWNER_NUMBER` harus berupa angka dengan kode negara 62, tanpa `+`, spasi, atau tanda baca. `TZ` harus zona waktu IANA yang valid. `REMIND_BEFORE_MIN` adalah bilangan bulat non-negatif dan default-nya 15.

## Menjalankan dan scan QR pertama

```bash
npm start
```

Pada koneksi pertama, QR akan ditampilkan di terminal. Di WhatsApp ponsel, buka **Perangkat tertaut** lalu pindai QR. Kredensial disimpan di folder `sesi/`; proses berikutnya akan memakainya kembali tanpa scan ulang. Jangan bagikan isi folder sesi.

Jika akun logout, bot berhenti dan meminta folder `sesi/` dihapus secara manual sebelum QR dipindai ulang. Folder tersebut tidak dihapus otomatis.

## Jadwal dan perintah

Jadwal disimpan di `tasks.json`. Jika file belum ada atau isinya rusak/tidak valid, bot mencatat peringatan dan membuat jadwal kosong.

Contoh item jadwal:

```json
[
  {
    "id": 1,
    "time": "09:30",
    "text": "Kirim laporan",
    "days": "daily"
  },
  {
    "id": 2,
    "time": "14:00",
    "text": "Pertemuan",
    "days": [1, 3, 5]
  },
  {
    "id": 3,
    "time": "08:00",
    "text": "Janji dokter",
    "days": "daily",
    "date": "2026-10-20"
  }
]
```

`days` memakai 0 untuk Minggu sampai 6 untuk Sabtu. Jika `date` ada, jadwal hanya berlaku pada tanggal tersebut dan `days` diabaikan.

Kirim perintah berikut dari nomor pemilik:

- `/daftar` — tampilkan semua jadwal menurut waktu.
- `/hari` — tampilkan jadwal hari ini.
- `/tambah HH:MM teks` — tambah jadwal harian, misalnya `/tambah 09:30 Kirim laporan`.
- `/tambah YYYY-MM-DD HH:MM teks` — tambah acara sekali, misalnya `/tambah 2026-10-20 08:00 Janji dokter`.
- `/hapus id` — hapus jadwal, misalnya `/hapus 2`.

## Deploy 24/7 dengan PM2

Pasang PM2 secara global pada server, lalu dari folder proyek jalankan:

```bash
npm install -g pm2
npm install
pm2 start ecosystem.config.cjs
pm2 save
pm2 startup
```

Ikuti perintah yang dicetak `pm2 startup` untuk mengaktifkan start otomatis saat server reboot. Pantau log dengan `pm2 logs whatsapp-personal-reminder` dan status dengan `pm2 status`.

## Backup dan pemulihan

Hentikan bot sebelum membuat salinan konsisten. Backup folder `sesi/` secara privat dan terenkripsi karena berisi kredensial akun, serta backup `tasks.json` bila jadwal ingin dipulihkan. Simpan backup di lokasi aman di luar repositori dan jangan unggah ke Git. Saat memulihkan, kembalikan folder `sesi/` dan `tasks.json` ke folder proyek dengan pemilik/izin akses yang benar.
