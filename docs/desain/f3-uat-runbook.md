# Runbook UAT Fase 3 (F3-A … F3-E) — DATA DUMMY

Jalankan di **Production** (Preview tidak bisa login karena origin check). Semua langkah memakai salinan DUMMY.
Prasyarat Master_User_TTD dummy: 1 PIC, 1 Manager, **2 Finance Staff berbeda**, 1 Fin. Mgr, 1 CFO, **1 System Admin (Level 9)**.

## Persiapan sekali
1. Buat folder **backup** di Shared Drive DUMMY (terpisah dari folder lampiran; akses hanya admin + service account sebagai Content manager).
2. Isi env Vercel `DRIVE_BACKUP_ID` = ID folder itu (Production), lalu redeploy. Tanpa ini cron backup tercatat "dilewati".

## F3-A Vendor
| # | Langkah | Harapan |
|---|---|---|
| V1 | PIC daftar vendor baru | Kode VND-xxxx, status Menunggu pengesahan |
| V2 | PIC daftar rekening yang sama | Ditolak, pesan umum (tidak menyebut vendor lain) |
| V3 | Finance A mengesahkan vendor yang ia daftarkan sendiri | Tombol nonaktif / server 403 |
| V4 | Finance B mengesahkan | Approved; vendor muncul di wizard pengajuan |

## F3-B Export Odoo
| # | Langkah | Harapan |
|---|---|---|
| E1 | Finance Staff → Export Odoo, rentang bulan ini, Keduanya | CSV terunduh, file `Odoo_keduanya_…csv` ada di folder lampiran Drive, riwayat bertambah |
| E2 | Bandingkan dengan export Apps Script lama untuk rentang & data dummy yang sama | Isi identik (kecuali sel diawali `= + - @` yang diberi `'`) |
| E3 | Rentang tanpa transaksi | Pesan "Tidak ada transaksi…", tidak ada file/riwayat |
| E4 | Unduh ulang dari riwayat | File sama |
| E5 | PIC / CFO buka `/export` | Diarahkan ke beranda (tidak berwenang) |

## F3-C Admin
| # | Langkah | Harapan |
|---|---|---|
| A1 | Admin → Pengguna → Tambah user dummy baru | Minta password (step-up); baris baru di Master_User_TTD, "belum punya password" |
| A2 | Kirim link password ke user itu | WA diterima (nomor allowlist trial) |
| A3 | Ubah level user yang sedang login di perangkat lain | Sesi user itu berakhir (harus login ulang) |
| A4 | Coba nonaktifkan satu-satunya Admin | Ditolak |
| A5 | Kesehatan | Redis/Sheets/Drive OK; WA sesuai konfigurasi; cron digest/lampiran-yatim/backup punya waktu terakhir |
| A6 | Integritas data → Jalankan audit | Daftar temuan; bandingkan dengan `auditDataIntegrity()` lama (tab `_REPAIR_REPORT`) |
| A7 | Ubah manual satu TOTAL_PAID dummy di Sheet → Repair → Rekonsiliasi → pratinjau → jalankan | Pratinjau menunjukkan baris itu; setelah dijalankan kolom kembali sesuai payment log; Audit_Log berisi REPAIR + REPAIR_ROW (nilai sebelum/sesudah) |
| A8 | Buat pratinjau, ubah Sheet lagi, lalu jalankan | Ditolak "Data berubah sejak pratinjau" |

## F3-D Laporan
| # | Langkah | Harapan |
|---|---|---|
| L1 | Aging AP | Total sisa = Σ(nominal akhir − pembayaran log) dokumen lolos Manager & belum lunas; cocokkan 3 dokumen manual |
| L2 | Per periode (brand, COA) | Total = jumlah dokumen bertanggal invoice di rentang |
| L3 | Log pembayaran | Sama dengan Trx_Payment_Log di rentang |
| L4 | Fin. Mgr → Audit log, filter ID dokumen | Riwayat aksi dokumen itu, terbaru dulu |
| L5 | Finance Staff | Tab Audit log tidak ada; API 403 |

## F3-E Backup & restore (exit: restore dicoba sekali)
1. Setelah malam pertama (01:30 WIB) cek folder backup: ada `BACKUP_P2P_YYYY-MM-DD`. Admin → Kesehatan: cron backup "ok".
   Untuk mencoba segera: panggil `/api/cron/backup` dengan header `Authorization: Bearer <CRON_SECRET>` (jangan tempel secret di chat/log).
2. **Uji restore** (di luar jam kerja): ganti judul salinan backup menjadi berawalan `DUMMY` bila perlu, bagikan ke service account (Editor),
   ubah env `SHEET_ID` Production ke ID salinan → redeploy → login, buka 3 dokumen & voucher → kembalikan `SHEET_ID` ke semula → redeploy.
   Catat hasil di `docs/STATUS-DAN-ROADMAP.md`.
3. Retensi terlihat setelah > 7 hari: 7 harian + 4 mingguan; file lain di folder tidak pernah dihapus.
