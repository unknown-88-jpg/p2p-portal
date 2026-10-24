# Source Apps Script lama (acuan perilaku — BACA SAJA)

Salinan file `.gs` dari sistem Apps Script produksi lama (export 2026-09-18). Dipakai sebagai **acuan perilaku** saat memigrasi Fase 2 dan 3. **Jangan dijalankan, jangan diedit, jangan disalin mentah** ke sistem baru: beberapa file memuat cacat laten yang sudah dicatat di `docs/desain/vercel-migration-risk-register.md` (mis. R-17 TTD L4/L5 atas nama pengunggah, R-21 `approveVendor(rowIdx)`, R-19 satu Finance memegang seluruh rantai, R-03 tulis sel-per-sel, R-32 `writeAudit` menelan error).

ID spreadsheet dan folder Drive di `Config.gs` sudah diganti `<REDACTED-…>`.

| File | Dipakai untuk |
|---|---|
| `API_Finance.gs` | **Fase 2**: antrean 4 tahap, `verifyTax`, `submitWetSignature`, `postJournalBulk`, `executePayment(Bulk)`, `financeReject` |
| `Calc.gs` | `hitungPajak`, `butuhCFO`, **`bolehDibayar`** (gate pembayaran I4) — sudah ada padanannya di `src/domain` untuk pajak |
| `Approval.gs` | `recordApproval`, `getApprovalMap`, `buildSignatureBlocks` |
| `Config.gs` | `STATUS`, `STATUS_FLOW`, `LEVEL`, peta kolom `COL`, konstanta (CFO 5 jt, PPN 11%, toleransi bayar 1000) |
| `Utils.gs` | `transitionStatus`, `writeAudit`, helper |
| `WA_Digest.gs` | Digest Manager dan **digest Finance (Fase 2)** |
| `CRUD_Vendor.gs`, `API_Master.gs` | **Fase 3**: vendor register/approve (maker-checker), `validateStruktur`, kas/COA/PPh |
| `Export_Odoo.gs` | **Fase 3**: export jurnal Odoo (pembelian + pembayaran) |
| `Repair.gs`, `Diagnostics.gs` | **Fase 3**: `auditDataIntegrity`, `reconcilePayments`, `cekBarisHantu` → `/admin/health` |

File lain (Auth, CRUD_Pengajuan, API_PO, API_Print, WA_Approval, Notif_WA, Code, Setup, HTML) sudah dimigrasi di Fase 1 dan tidak disalin; minta user menambahkannya bila perlu.
