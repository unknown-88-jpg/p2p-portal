# P2P Finance Portal — Status & Roadmap

Diperbarui: 2026-10-24. Basis kode: `main` (termasuk Patch 2, PR #18, dan dokumen desain di `docs/desain/`). Trial = **DATA DUMMY saja**; Vercel Hobby, Pro saat go-live.
Stack: Next.js 16 (App Router) di Vercel, Google Sheets sebagai DB, Drive (Shared Drive) untuk file, Upstash Redis, login nomor HP + password, WA via gateway Lixus.
Dokumen lengkap (hasil UAT, desain, risiko) ada di Project "P2P Finance Portal" di claude.ai, antara lain `claude/m8-uat-hasil.md`.

## Rangkuman fase

| Fase | Isi | Status |
|---|---|---|
| 0 | Spike (Sheets/Drive/Upstash/Vercel layak) | Selesai |
| 1 | Auth, Ajukan pengajuan, Approval Manager (web + WA), voucher | M0–M7 selesai. **M8 (UAT & penutupan) berjalan** |
| 2 | Finance (verifikasi pajak, e-approve Fin. Mgr/CFO, jurnal COA, pembayaran) | **Berjalan.** F2-A (antrean & hak akses) dan F2-B (verifikasi pajak + kembalikan ke PIC, I6 blokir) dan F2-C (e-approve Fin. Mgr/CFO, step-up, urutan L4 → L5) dan F2-D (jurnal COA bulk, 1 batch tulis) dan F2-E (pembayaran: I4, I5 dari log, kembar, step-up, bulk) dan F2-F (notif PIC dari Finance, riwayat bayar, digest WA Finance) selesai 2026-10-24. F2-G: review keamanan jalur uang + perbaikan, tes kuota & matriks otorisasi, uji beban Fase C, runbook UAT selesai; **UAT Finance (`docs/desain/f2-uat-runbook.md`) menunggu dijalankan** |
| 3 | Vendor, Master, Export (Odoo), Laporan, Admin, arsip | Berjalan: F3-A (vendor: daftar, pengesahan by kode, maker-checker, I7), F3-B (export Odoo, I16, golden), F3-C (admin user/health/integritas/repair), F3-D (laporan AP + viewer audit) selesai 2026-10-24; F3-E backup harian selesai, arsip menunggu keputusan |
| 4 | Go-live (Vercel Pro, PROD_SHEET_IDS, Upstash terpisah, cutover) | Belum mulai |

## Fase 1 / M8 — sudah selesai
- Deploy Vercel trial; rotasi rahasia setelah insiden (F-10 ditutup).
- Bukti kapasitas: Sheets ±15% dari batas baca, Vercel 0% error, Upstash ±4% kuota bulanan; load test lokal & Vercel lulus.
- Patch 1 (F-01…F-09) diterapkan.
- UAT lulus: U1–U11, U12–U14 & U16 (jalur WA nyata), U15, U17–U20, U22, U24. U13 lulus **by design** (kode WA tidak diterbitkan untuk ≥ Rp 5 jt; server menolak jalur `wa`).
- Digest WA ke Manager: GitHub Actions `digest-approval` aktif (hari kerja 09/12/15/17 WIB; secret `APP_URL`, `CRON_SECRET` terpasang; run manual #5 sukses). F-15 selesai 2026-10-24: selain digest, PIC bisa menekan **Kirim WA** di beranda (maks. 1x/hari per dokumen).

## Fase 1 / M8 — belum selesai
1. **Patch 2 sudah di kode** (PR #18: F-11 durasi kunci login, F-12 cek link set-password saat halaman dibuka, F-13 voucher cetak 1 halaman di iOS, F-14 parser WA abaikan `*`/`_`/`~`). Sisa: pastikan ter-deploy; F-13 **harus diverifikasi ulang di iPhone** (hasil di sini baru simulasi Chromium).
2. **Aturan P.O. baru (#16 & #17) — FINAL** (dikonfirmasi pemilik 2026-10-24, tercatat di README M3): retensi 10% dihapus (plafon = grand total P.O. penuh) dan I11 "Trade non-DP butuh barang diterima penuh" dihapus. Sisa: **uji ulang U6** dengan ekspektasi baru (hasil U6 lama berlaku untuk kode sebelum 2026-10-24). U8 (akses dokumen) tidak terpengaruh.
3. U21 Android; U23 (unggah PDF 3–10 MB dari ponsel; ditunda); cek baris audit di sheet (U3, U18).
4. Pembersihan data dummy: kembalikan nomor Dummy 002 (2 baris) ke `08000005002`; hapus baris peran tambahan (Dummy 002 Level 1, Dummy 003 Level 2); hapus dokumen uji (NTR-00001…13, TRD-00001/3/4, draf INV-U6-B); reset password Dummy 001/003/007; cek akun Manager yang masih bernomor lama (F-16).
5. ~~Konfirmasi eksplisit O4/O5~~ — selesai 2026-10-24: O4 e-approve tanpa transisi scan, O5a ya, O5b peringatan. I6 blokir; kas list menyatu dengan Master_COA. Semua keputusan gerbang Fase 2 final.

- Next.js 16.4.0 → **16.4.2** (2026-10-24): menutup advisori kritis `npm audit` untuk next 16.0.0–16.4.0; `next build` tidak lagi kadang berhenti dengan `SecurityFatalError`.

## Temuan terbuka (tidak menghalangi Fase 1)
- F-02: invoice PDF tidak bisa dicetak gabungan dengan voucher (CSP `object-src 'none'`).
- Screenshot Master_COA produksi, rekening di Master_COA dummy terlihat nyata, folder Drive `upload-test` berisi file lain, perbandingan 5 voucher dengan sistem lama (syarat keluar M7), label data basah (stale) di UI.
- Sebelum go-live: tambah `1zau0TiAc0r9OIFuVUHpQzq5tgBUr2AepS0RfgLLAzwg` ke `PROD_SHEET_IDS`; ganti nama/pisahkan database Upstash (`p2p-spike`); hitung ulang kuota Upstash dengan jumlah user nyata; rotasi API key gateway lama bersama Script Properties.

## Aturan kerja bersama
- **Data dummy saja** selama trial. Jangan menempel `.env*`, kunci, token, atau isi secret di chat/PR/screenshot.
- Perubahan kontrol uang/keamanan (plafon, SoD, step-up, ambang Rp 5 jt, jalur WA) **dijelaskan dulu dan dikonfirmasi pemilik** sebelum merge. Commit #16 dan #17 (aturan P.O.) termasuk kategori ini dan sudah dikonfirmasi pemilik.
- Kerja lewat branch + PR; `npm run check` (typecheck + lint + test) harus hijau sebelum merge.
- Rute tanpa sesi (`session: 'none'`) dikunci oleh `tests/m8-security.test.ts`; menambahnya harus disengaja dan diberi alasan.
- Hasil UAT & keputusan dicatat di Project (bukan hanya di chat).
