# Dokumen desain & riwayat keputusan

Salinan dokumen dari Project claude.ai "P2P Finance Portal", diambil 2026-10-24. **Repo ini sekarang sumber utama**: bila ada keputusan baru, perbarui file di sini (lewat PR), bukan hanya di Project.

| File | Isi | Kapan dibaca |
|---|---|---|
| `vercel-migration-design.md` | Design doc: parity matrix fungsi lama → route baru, **invarian I1–I17**, data layer, auth, UI/UX, fase 0–4, keputusan O1–O12 | Sebelum menyentuh logika bisnis / mulai milestone baru |
| `phase1-implementation-plan.md` | Rencana Fase 1 (M0–M8), peta invarian → test | Referensi pola kerja & definition of done |
| `vercel-migration-risk-register.md` | Risiko R-01…R-34 + cacat laten sistem lama (R-17, R-18, R-19, R-21 penting untuk Fase 2/3) | Sebelum Fase 2 dan 3 |
| `adr-001-vercel-sheets-drive.md` | Keputusan arsitektur Sheets+Drive+Redis, opsi alternatif, kapan revisit ke Postgres | Bila ada pertanyaan "kenapa Sheets?" |
| `spike-results.md` | Hasil ukur nyata: kuota Sheets, atomisitas, latensi, upload/stream, webhook Lixus (S6) | Bila menyentuh kuota, lock, upload, WA |
| `konteks-sistem-p2p-portal.md` | Konteks & keputusan sistem Apps Script lama (alasan tiap kontrol uang) | Sebelum "memperbaiki" aturan yang tampak aneh |
| `code-review-2026-09-18.md` | Review sistem lama (celah yang sudah ditutup) | Referensi |
| `m8-uat-hasil.md`, `m8-uat-runbook.md`, `phase1-status.md` | Hasil UAT M8, temuan F-01…F-16, runbook | Status Fase 1 |
| `f2-uat-runbook.md` | Runbook UAT Fase 2 / Finance (F1–F21) | Sebelum UAT Finance |

Catatan: hasil per milestone M3–M8 yang lebih rinci ada di bagian milestone `README.md` repo ini. Dokumen `m3…m7-hasil.md` dan spike kit tidak disalin.
Status keputusan terbaru ada di `docs/STATUS-DAN-ROADMAP.md` dan `docs/ROADMAP-FASE-2-4.md` (bila berbeda dengan dokumen lama di sini, yang terbaru menang).
