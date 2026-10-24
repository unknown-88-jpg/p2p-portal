# F2-G — Runbook UAT Fase 2 / Finance (data DUMMY, deploy Vercel trial)

Tujuan: membuktikan exit Fase 2 (design doc bagian 10, roadmap F2-G) di aplikasi nyata — **2 Finance Staff + Fin. Mgr + CFO** memproses dokumen yang sama dari Submit sampai **Lunas**, termasuk cicilan, pengembalian ke PIC, dan dokumen ≥ Rp 5 jt. Tes otomatis sudah menutup logika (F2-A…F2-G, `tests/f2*.test.ts`); runbook ini untuk yang hanya terbukti di Sheets/Redis/WA/perangkat sungguhan.

## 0. Prasyarat
- [ ] PR Fase 2 (F2-A…F2-G) sudah di `main` dan ter-deploy; `/api/health` hijau; banner trial tampil.
- [ ] Master_User_TTD (DUMMY): **FIN-1** & **FIN-2** (Level 3, ALL/ALL), **FM** (Level 4), **CFO** (Level 5) — semua punya password (`issue-setpass`). FM ≠ CFO (orang berbeda). Nomor WA salah satu Finance + PIC-1 = nomor uji di `WA_TRIAL_ALLOWLIST`.
- [ ] Master_COA (DUMMY) punya: minimal satu cabang beban 5 level dan satu akun di bawah **KAS DAN SETARA KAS** (untuk rekening sumber bayar).
- [ ] Master_PPh punya minimal "PPh 23" (tarif NPWP & non-NPWP, format 0.02 bukan 2).
- [ ] Siapkan dokumen lewat alur Fase 1 (PIC submit → Manager setujui): **D1** Non-Trade Rp 1–4 jt (vendor ber-NPWP), **D2** ≥ Rp 5 jt, **D3** < Rp 5 jt diajukan oleh akun yang juga FIN-1 (untuk I6; bila tidak ada akun ganda, beri FIN-1 baris tambahan Level 1), **D4** dan **D5** < Rp 5 jt (untuk bulk).

## 1. Skenario (isi Hasil: ✅ / ❌ + catatan)

| # | Pelaku | Langkah | Yang harus terjadi | Invarian | Hasil |
|---|---|---|---|---|---|
| F1 | PIC-1, Manager | Buka `/finance` | Diarahkan ke beranda; `GET /api/finance/queues` = 403. Menu "Finance" tidak ada | F2-A | |
| F2 | FIN-1 | Buka `/finance` | 4 tab (pajak, persetujuan, jurnal, bayar) dengan jumlah & total; D1–D5 di Verifikasi pajak; antrean tidak memuat NPWP/rekening | F2-A | |
| F3 | FIN-1 | D3 (ajuan sendiri): buka panel | Badge "Ajuan Anda", tombol Loloskan nonaktif; paksa lewat API → 422 "tidak boleh memverifikasi pajaknya sendiri"; audit `TAX_VERIFY_BLOCKED_SOD` | I6 | |
| F4 | FIN-2 | D3: verifikasi | Berhasil (rekan lain boleh) | I6 | |
| F5 | FIN-1 | D1: ubah ke Exclude PPN + PPh 23, Loloskan | Pratinjau = hasil server; status Menunggu Fin. Mgr / CFO; sheet: DPP/PPN/PPh/FINAL_AMOUNT/OS_BALANCE/REQUIRE_CFO terisi; audit `TAX_ADJUST` bila nominal berubah; approval L3 atas nama FIN-1 | I1 I2 | |
| F6 | FIN-1 & FIN-2 | D4: buka di dua sesi, Loloskan hampir bersamaan | Tepat satu berhasil; yang lain "berubah / muat ulang"; satu baris approval L3 | race | |
| F7 | FIN-1 | D5: Kembalikan ke PIC (alasan) | Status Perlu Revisi; PIC melihat "Dikembalikan Finance: …"; WA ke PIC "dikembalikan oleh Finance" | F2-B F2-F I15 | |
| F8 | FM | D1 (< 5 jt): Setujui sebagai Fin. Mgr → password | Status Menunggu Jurnal COA; approval L4 E-SIGN atas nama FM; tanpa password = diminta password | O4 R-17 | |
| F9 | CFO | D2 (≥ 5 jt) sebelum FM | Tidak ada tombol CFO ("dibuka setelah Fin. Mgr"); API → 422 | O4 | |
| F10 | FM lalu CFO | D2: FM setujui → kartu "Menunggu CFO" → CFO setujui | Setelah CFO: Menunggu Jurnal COA; voucher: kotak L4 & L5 "E-Signed" | O4 I1 | |
| F11 | CFO | D2 (lain): Kembalikan ke PIC dari tahap persetujuan; PIC revisi & ajukan; Manager setujui; FIN verifikasi ulang | FM harus menyetujui LAGI (persetujuan lama tidak terbawa) | siklus | |
| F12 | FIN-1 | Jurnal: centang D1 + D2, pilih COA 5 level + budget, Posting | Keduanya Siap Dibayar; sheet CATEGORY/HEAD/SUB_COA/BUDGET terisi; satu batch | F2-D | |
| F13 | FIN-1 | D1: bayar sebagian (mis. 40%) dari akun kas, ref | Dibayar Sebagian; Trx_Payment_Log 1 baris; detail dokumen: bagian Pembayaran total & sisa | I5 | |
| F14 | FIN-1 | D1: bayar lagi melebihi sisa + Rp 1.000 | Ditolak "Melebihi sisa tagihan" | I5 | |
| F15 | FIN-1 | D1: ulangi pembayaran yang persis sama (tanggal, nominal, ref) dalam 10 menit | Dialog "Pembayaran kembar?"; Batal = tidak tercatat; Ya = tercatat | R-04 | |
| F16 | FIN-1 | D1: lunasi sisanya | Lunas; PAY_STATUS Paid; OS_BALANCE 0; riwayat 2–3 baris | I5 | |
| F17 | FIN-1 | Bulk bayar: centang D2 + satu dokumen yang belum boleh dibayar | Yang belum boleh dibayar ber-badge + alasan dan dilewati; D2 lunas | I4 | |
| F18 | FIN yang juga verifikator | Bayar dokumen yang pajaknya ia verifikasi | Peringatan kuning O5b; pembayaran tetap jalan; audit memuat "Penanda SoD O5b" | O5b | |
| F19 | — | Picu digest (`GET /api/cron/digest` + Bearer) | WA "Ringkasan Finance" ke nomor Finance di allowlist sesuai peran; tanpa kode SETUJU; respons memuat `finance` | F2-F | |
| F20 | — | Uji beban: `LOAD_FINANCE=… npm run load-test` (Fase A), lalu Fase C pada 1 dokumen Siap Dibayar dummy (`LOAD_PAY_DOCS`, `LOAD_PAY_REK`) | Fase A tanpa 5xx (selain 503 anggun); Fase C: ≤ 1 sukses, total dibayar ≤ nominal + Rp 1.000 | I5 kuota | |
| F21 | — | Grafik Sheets/Vercel/Upstash pada jendela uji | Tidak ada 429 Google; error rate 0% | kuota | |

## 2. Sesudah UAT
- Catat hasil & temuan di `docs/desain/f2-uat-hasil.md` (format seperti `m8-uat-hasil.md`), perbarui `docs/STATUS-DAN-ROADMAP.md`.
- Bereskan data uji (dokumen F*, baris approval/payment log uji) atau tandai sebagai data uji.
