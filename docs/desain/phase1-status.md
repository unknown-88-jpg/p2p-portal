# Status Fase 1 (ringkas) — diperbarui 2026-10-24

| Milestone | Status | Dokumen hasil |
|---|---|---|
| M0 Fondasi | ✅ | plan §M0 |
| M1 Data layer | ✅ (integrasi nyata lolos) | plan §M1 |
| M2 Auth | ✅ (uji manual lolos) | plan §M2 |
| M3 Master/PO/kalkulasi | ✅ kode. **Keputusan pemilik 2026-10-24 (final):** retensi 10% dihapus (plafon = grand total P.O penuh); golden plafon sengaja berbeda dari sistem lama | claude/m3-hasil-uji-manual.md, README §M3 |
| M4a/b/c Pengajuan, lampiran | ✅ kode + UAT. PUT browser→Drive terbukti dari Vercel (NTR-00009/10). **I11 dihapus 2026-10-24**; Full Payment mengisi nilai invoice = sisa tagihan P.O. Belum terbukti: resume putus jaringan (U23, ditunda) | claude/m4a-hasil.md, m4b-hasil.md, m4c-hasil.md |
| M5 Approval web | ✅ kode + UAT (U9–U11, U15–U19) | claude/m5-hasil.md |
| M6 WhatsApp | ✅ kode + gateway nyata (U12–U14, U16). Digest terjadwal via GitHub Actions aktif | claude/m6-hasil.md |
| M7 Detail/voucher/dashboard | ✅ kode; menunggu perbandingan 5 voucher vs sistem lama | claude/m7-hasil.md |
| M8 Hardening & UAT | 🟡 Patch 1 & Patch 2 di kode; uji beban lokal + Vercel lulus. Sisa: verifikasi F-13 di iPhone, uji ulang U6 (aturan baru), U21 Android, U23, cek audit U3/U18, pembersihan data dummy, konfirmasi O4/O5 | m8-uat-hasil.md, m8-uat-runbook.md, `docs/STATUS-DAN-ROADMAP.md` |

Catatan: `phase1-implementation-plan.md` masih berisi status lama (✅ hanya sampai M2/M3); tabel ini yang terbaru.
