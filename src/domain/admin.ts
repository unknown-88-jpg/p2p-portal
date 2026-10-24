// F3-C: Admin — padanan auditDataIntegrity / reconcilePayments / repairNoRekening (Repair.gs) + validator master + aturan edit user.
// Murni: baris sheet masuk sebagai objek {kolom: nilai}. Tidak ada tulis di sini; service yang menulis (snapshot -> konfirmasi -> eksekusi -> laporan).
import { CONFIG, LEVEL } from './config';
import { clean, num, str, upper } from './legacy-parse';
import { normalizePhone } from './phone';
import { isAktif, parseLevel } from './roles';

type Baris = Readonly<Record<string, unknown>>;
export type LevelTemuan = 'KRITIS' | 'TINGGI' | 'SEDANG';
export interface Temuan { kategori: string; level: LevelTemuan; id: string; masalah: string; saran: string }

const rp = (n: number): string => `Rp ${Math.round(n).toLocaleString('id-ID')}`;

interface VendorMap { list: { kode: string; nama: string; bank: string; noRekening: string; npwp: string; namaRekening: string }[]; byName: Map<string, VendorMap['list'][number]> }
function petaVendor(vendor: readonly Baris[]): VendorMap {
  const list: VendorMap['list'] = [], byName = new Map<string, VendorMap['list'][number]>();
  for (const r of vendor) {
    if (!str(r['Kode Vendor'])) continue;
    const v = { kode: str(r['Kode Vendor']), nama: str(r['Nama Vendor']), npwp: clean(r.NPWP), bank: upper(r.Bank), namaRekening: str(r['Nama Pemilik Rekening']), noRekening: clean(r['No Rekening']) };
    list.push(v);
    if (!byName.has(upper(v.nama))) byName.set(upper(v.nama), v);
  }
  return { list, byName };
}

/** Total dibayar per ID transaksi dari Trx_Payment_Log (sumber kebenaran pembayaran). */
export function petaDibayar(log: readonly Baris[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const p of log) { const id = upper(p.ID_Trx); if (id) m.set(id, (m.get(id) ?? 0) + num(p.Nominal)); }
  return m;
}

/** true bila nomor di pengajuan = nomor master tanpa nol di depan (kerusakan klasik sel angka). */
export const nolDepanHilang = (rekTrx: string, rekMaster: string): boolean =>
  rekMaster.startsWith('0') && !rekTrx.startsWith('0') && rekTrx !== '' && rekMaster.replace(/^0+/, '') === rekTrx;

export interface DataIntegritas {
  pengajuan: readonly Baris[]; vendor: readonly Baris[]; pembayaran: readonly Baris[];
  poIds: readonly string[]; sjPoRefs: readonly string[]; prefixes: readonly string[]; users: readonly Baris[];
}

/** Port auditDataIntegrity() — BACA SAJA. Urutan: KRITIS, TINGGI, SEDANG lalu kategori. */
export function auditIntegritas(d: DataIntegritas, toleransi = CONFIG.PAYMENT_TOLERANCE): Temuan[] {
  const out: Temuan[] = [];
  const add = (kategori: string, level: LevelTemuan, id: string, masalah: string, saran: string): void => { out.push({ kategori, level, id, masalah, saran }); };
  const vm = petaVendor(d.vendor);

  // A. Rekening pengajuan vs Master_Vendor (dicocokkan per NAMA vendor seperti lama)
  for (const r of d.pengajuan) {
    const id = str(r.ID_TRX);
    if (!id) continue;
    const rekTrx = clean(r.NO_REKENING), nama = upper(r.VENDOR_NAME), v = vm.byName.get(nama);
    if (!v) { add('VENDOR', 'TINGGI', id, `Vendor "${nama}" tidak ada di Master_Vendor`, 'Daftarkan vendornya, atau perbaiki nama di baris ini'); continue; }
    if (rekTrx !== v.noRekening) {
      const nol = nolDepanHilang(rekTrx, v.noRekening);
      add('REKENING', nol ? 'KRITIS' : 'TINGGI', id, `Rekening di pengajuan "${rekTrx}" ≠ Master_Vendor "${v.noRekening}"${nol ? ' — NOL DI DEPAN HILANG' : ''}`,
        nol ? 'Jalankan perbaikan "Nol di depan rekening" (Admin › Repair)' : 'Periksa manual: rekening berbeda bukan karena nol hilang (tidak diperbaiki otomatis)');
    }
  }

  // B. Pembayaran: kelebihan bayar & ringkasan tidak sinkron
  const paid = petaDibayar(d.pembayaran);
  for (const r of d.pengajuan) {
    const id = str(r.ID_TRX);
    if (!id) continue;
    const final = num(r.FINAL_AMOUNT), kolPaid = num(r.TOTAL_PAID), kolOS = num(r.OS_BALANCE), logPaid = paid.get(upper(id)) ?? 0;
    if (logPaid === 0 && kolPaid === 0) continue;
    if (logPaid > final + toleransi) add('PEMBAYARAN', 'KRITIS', id, `KELEBIHAN BAYAR ${rp(logPaid - final)}. Netto ${rp(final)}, dibayar ${rp(logPaid)}`, 'Cek fisik ke bank. Tagih balik ke vendor / jadikan uang muka invoice berikutnya');
    if (Math.abs(logPaid - kolPaid) > toleransi) add('PEMBAYARAN', 'TINGGI', id, `Ringkasan tidak sinkron. Kolom TOTAL_PAID = ${rp(kolPaid)}, payment log = ${rp(logPaid)}`, 'Jalankan "Rekonsiliasi pembayaran" (Admin › Repair)');
    const osSeharusnya = final - logPaid;
    if (Math.abs(kolOS - osSeharusnya) > toleransi) add('PEMBAYARAN', 'SEDANG', id, `OS_BALANCE = ${rp(kolOS)}, seharusnya ${rp(osSeharusnya)}`, 'Jalankan "Rekonsiliasi pembayaran" (Admin › Repair)');
  }
  const idSet = new Set(d.pengajuan.map((r) => upper(r.ID_TRX)));
  for (const p of d.pembayaran) {
    const ref = upper(p.ID_Trx);
    if (ref && !idSet.has(ref)) add('PEMBAYARAN', 'TINGGI', str(p.Log_ID), `Payment log merujuk ID "${ref}" yang tidak ada di Trx_Pengajuan`, 'Uang keluar tanpa dokumen. Investigasi manual');
  }

  // C. Nomor P.O & sambungan DB_PO ↔ DB_SJ
  const prefixes = d.prefixes.map(upper).filter(Boolean);
  const poIds = new Set<string>();
  for (const raw of d.poIds) {
    const id = upper(raw);
    if (!id) continue;
    poIds.add(id);
    if (!prefixes.some((p) => id.includes(p))) add('PURCHASE ORDER', 'TINGGI', id, 'Nomor P.O tidak mengandung prefix brand manapun — brand tidak akan terdeteksi', `Ubah jadi format PO-<PREFIX>-<tanggal>-<urut>. Prefix tersedia: ${prefixes.join(', ')}`);
  }
  const yatim = new Map<string, number>();
  for (const raw of d.sjPoRefs) { const ref = upper(raw); if (ref && !poIds.has(ref)) yatim.set(ref, (yatim.get(ref) ?? 0) + 1); }
  for (const [ref, n] of yatim) add('SURAT JALAN', 'KRITIS', ref, `${n} baris SJ merujuk P.O "${ref}" yang TIDAK ADA di DB_PO`, 'Three-way match tidak jalan — qty gudang selalu terbaca 0. Samakan nomor P.O di kedua tab');
  for (const r of d.pengajuan) {
    if (str(r.TIPE) !== 'Trade') continue;
    const poNo = upper(r.PO_NUMBER);
    if (poNo && poNo !== '-' && !poIds.has(poNo)) add('PURCHASE ORDER', 'TINGGI', str(r.ID_TRX), `Pengajuan Trade merujuk P.O "${poNo}" yang tidak ada di DB_PO`, 'Cek nomor P.O-nya');
  }

  // D. Vendor: rekening kembar, tanpa rekening
  const byRek = new Map<string, VendorMap['list']>();
  for (const v of vm.list) { if (!v.noRekening) continue; const k = `${v.bank} ${v.noRekening}`; byRek.set(k, [...(byRek.get(k) ?? []), v]); }
  for (const [k, g] of byRek) if (g.length > 1) add('VENDOR', 'KRITIS', g.map((v) => v.kode).join(' / '), `Rekening ${k} dipakai ${g.length} vendor: ${g.map((v) => `${v.kode} (${v.nama})`).join(', ')}`, 'Satu rekening = satu vendor. Gabungkan, atau perbaiki yang salah');
  for (const v of vm.list) if (!v.noRekening) add('VENDOR', 'TINGGI', v.kode, `Vendor "${v.nama}" tidak punya nomor rekening`, 'Lengkapi, atau tandai Rejected');

  // E. Master_User_TTD (sistem baru: login = nomor HP; email tetap dipakai untuk audit & jalur uang)
  let ada4 = false, ada5 = false;
  d.users.forEach((r, i) => {
    const nama = str(r.Nama);
    if (!nama) return;
    const email = str(r.Email), lvl = parseLevel(r.Level), baris = `Baris ${i + 2}`;
    if (!email || !email.includes('@')) add('USER', 'KRITIS', baris, `"${nama}" tidak punya email valid — diblokir di jalur uang & audit tanpa identitas`, 'Isi kolom Email');
    if (email.includes('@domain.com')) add('USER', 'KRITIS', baris, `"${nama}" masih pakai email placeholder "${email}"`, 'Ganti dengan email asli');
    if (!normalizePhone(r.No_HP)) add('USER', 'TINGGI', baris, `"${nama}" tidak punya nomor HP valid — tidak bisa login`, 'Isi kolom No_HP (format 08… / 628…)');
    if (isAktif(r.Aktif) && lvl === LEVEL.FINANCE_MGR) ada4 = true;
    if (isAktif(r.Aktif) && lvl === LEVEL.CFO) ada5 = true;
  });
  if (d.users.length) {
    if (!ada4) add('USER', 'KRITIS', '-', 'Tidak ada satupun user Level 4 (Manager Finance)', 'Tanpa ini, tidak ada dokumen yang bisa dibayar');
    if (!ada5) add('USER', 'TINGGI', '-', 'Tidak ada user Level 5 (CFO)', 'Transaksi ≥ Rp 5 juta akan tertahan permanen');
  }

  const urut: Record<LevelTemuan, number> = { KRITIS: 0, TINGGI: 1, SEDANG: 2 };
  return out.sort((a, b) => urut[a.level] - urut[b.level] || a.kategori.localeCompare(b.kategori));
}

// ---------- Repair (rencana perubahan; service yang mengeksekusi) ----------
export interface UbahSel { row: number; id: string; cells: Record<string, string | number>; sebelum: Record<string, string | number> }

/**
 * Port reconcilePayments(): TOTAL_PAID / OS_BALANCE / PAY_STATUS dihitung ulang dari Payment Log.
 * Beda dari lama (tercatat): hanya baris ber-ID yang punya pembayaran (log atau TOTAL_PAID) dan nilainya BERBEDA yang ditulis (lama menulis ulang semua baris, termasuk baris kosong & dokumen belum dibayar);
 * STATUS dokumen tidak disentuh (sama seperti lama).
 */
export function rencanaRekonsiliasi(pengajuan: readonly (Baris & { _row: number })[], pembayaran: readonly Baris[], toleransi = CONFIG.PAYMENT_TOLERANCE): { ubah: UbahSel[]; lebihBayar: string[] } {
  const paid = petaDibayar(pembayaran);
  const ubah: UbahSel[] = [], lebihBayar: string[] = [];
  for (const r of pengajuan) {
    const id = str(r.ID_TRX);
    if (!id) continue;
    const final = num(r.FINAL_AMOUNT), p = paid.get(upper(id)) ?? 0;
    let os = final - p;
    if (Math.abs(os) <= toleransi) os = 0;
    let st = p === 0 ? 'Outstanding' : os <= 0 ? 'Paid' : 'Partially Paid';
    if (p > final + toleransi) { lebihBayar.push(`${id} (lebih ${rp(p - final)})`); os = 0; st = 'Paid'; }
    const sebelum = { TOTAL_PAID: num(r.TOTAL_PAID), OS_BALANCE: num(r.OS_BALANCE), PAY_STATUS: str(r.PAY_STATUS) };
    // Belum ada pembayaran di log maupun di ringkasan: tidak ada yang direkonsiliasi (sama dengan saringan auditDataIntegrity).
    if (p === 0 && sebelum.TOTAL_PAID === 0) continue;
    if (sebelum.TOTAL_PAID === p && sebelum.OS_BALANCE === os && sebelum.PAY_STATUS === st) continue;
    ubah.push({ row: r._row, id, cells: { TOTAL_PAID: p, OS_BALANCE: os, PAY_STATUS: st }, sebelum });
  }
  return { ubah, lebihBayar };
}

/**
 * Port repairNoRekening() yang DIPERSEMPIT (keputusan default F3-C, tercatat): hanya baris yang rekeningnya = rekening Master_Vendor
 * tanpa nol di depan. Lama menimpa rekening/bank/NPWP/nama/kode SEMUA baris dari master per NAMA vendor — itu bisa mengalihkan
 * tujuan bayar dokumen yang belum dibayar ke rekening lain, jadi tidak dilakukan otomatis (temuan lain tetap dilaporkan audit).
 */
export function rencanaNolRekening(pengajuan: readonly (Baris & { _row: number })[], vendor: readonly Baris[]): { ubah: UbahSel[] } {
  const vm = petaVendor(vendor);
  const ubah: UbahSel[] = [];
  for (const r of pengajuan) {
    const id = str(r.ID_TRX);
    if (!id) continue;
    const v = vm.byName.get(upper(r.VENDOR_NAME));
    const rek = clean(r.NO_REKENING);
    if (!v || !nolDepanHilang(rek, v.noRekening)) continue;
    ubah.push({ row: r._row, id, cells: { NO_REKENING: v.noRekening }, sebelum: { NO_REKENING: rek } });
  }
  return { ubah };
}

// ---------- Validator master (baca saja; edit tetap di Sheet) ----------
export function validasiMaster(m: { setting: readonly (readonly unknown[])[]; coa: readonly (readonly unknown[])[]; pph: readonly (readonly unknown[])[] }): Temuan[] {
  const out: Temuan[] = [];
  const add = (kategori: string, level: LevelTemuan, id: string, masalah: string, saran: string): void => { out.push({ kategori, level, id, masalah, saran }); };
  const pref = new Map<string, number>();
  m.setting.forEach((r, i) => {
    const brand = upper(r[1]), company = str(r[0]), prefix = upper(r[4]), b = `Master_Setting baris ${i + 2}`;
    if (!brand && !company && !prefix) return;
    if (!brand) add('MASTER', 'TINGGI', b, 'Brand kosong', 'Isi kolom Brand');
    if (brand && !company) add('MASTER', 'SEDANG', b, `Brand ${brand} tanpa Company`, 'Isi kolom Company (dipakai voucher & PO)');
    if (prefix) { if (pref.has(prefix)) add('MASTER', 'KRITIS', b, `Prefix PO "${prefix}" ganda (juga baris ${pref.get(prefix)})`, 'Satu prefix = satu brand'); else pref.set(prefix, i + 2); }
  });
  const jalur = new Map<string, number>();
  m.coa.forEach((r, i) => {
    const lv = [0, 1, 2, 3, 4].map((k) => str(r[k]));
    if (lv.every((x) => !x)) return;
    const b = `Master_COA baris ${i + 2}`;
    if (!lv[0]) add('MASTER', 'TINGGI', b, 'Level 1 kosong tetapi level di bawahnya terisi', 'Lengkapi Level 1 (baris diabaikan sistem)');
    const k = lv.map((x) => upper(x) || '-').join(' > ');
    if (jalur.has(k)) add('MASTER', 'SEDANG', b, `Akun ganda: ${k} (juga baris ${jalur.get(k)})`, 'Hapus salah satu'); else jalur.set(k, i + 2);
    const kosongDiTengah = lv.findIndex((x, j) => j > 0 && (!x || x === '-') && lv.slice(j + 1).some((y) => y && y !== '-'));
    if (kosongDiTengah > 0) add('MASTER', 'SEDANG', b, `Level ${kosongDiTengah + 1} kosong di antara level terisi`, 'Isi berurutan dari Level 1');
  });
  const jenis = new Set<string>();
  m.pph.forEach((r, i) => {
    const j = str(r[0]);
    if (!j) return;
    const b = `Master_PPh baris ${i + 2}`;
    for (const [k, label] of [[1, 'Tarif NPWP'], [2, 'Tarif non-NPWP']] as const) {
      const t = parseFloat(String(r[k] ?? ''));
      if (!Number.isFinite(t) || t < 0 || t > 1) add('MASTER', 'KRITIS', b, `${j}: ${label} "${str(r[k])}" bukan desimal 0–1`, 'Tulis tarif sebagai desimal, mis. 0.02 untuk 2%');
    }
    if (jenis.has(upper(j))) add('MASTER', 'SEDANG', b, `Jenis PPh "${j}" ganda`, 'Hapus salah satu'); else jenis.add(upper(j));
  });
  return out;
}

// ---------- Edit user (Master_User_TTD) ----------
export const LEVEL_SAH = [LEVEL.PIC, LEVEL.MANAGER, LEVEL.FINANCE_STAFF, LEVEL.FINANCE_MGR, LEVEL.CFO, LEVEL.ADMIN] as const;
export interface IsianUser { brand: string; dept: string; level: number; jabatan: string; nama: string; email: string; aktif: boolean; noHp: string }
export type HasilValidasiUser = { ok: true; v: IsianUser & { phone: string } } | { ok: false; galat: Record<string, string> };

export function validasiUser(i: IsianUser): HasilValidasiUser {
  const galat: Record<string, string> = {};
  const phone = normalizePhone(i.noHp);
  if (!phone) galat.noHp = 'Nomor HP tidak valid (08… / 628…).';
  if (!(LEVEL_SAH as readonly number[]).includes(i.level)) galat.level = 'Level harus 1, 2, 3, 4, 5, atau 9.';
  if (!i.nama.trim()) galat.nama = 'Nama wajib diisi.';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(i.email.trim())) galat.email = 'Email tidak valid.';
  else if (i.email.includes('@domain.com')) galat.email = 'Email placeholder tidak boleh dipakai.';
  if (!i.brand.trim()) galat.brand = 'Brand wajib (pakai ALL untuk Finance/CFO/Admin).';
  if (!i.dept.trim()) galat.dept = 'Departemen wajib (pakai ALL untuk Finance/CFO/Admin).';
  if (Object.keys(galat).length) return { ok: false, galat };
  return { ok: true, v: { ...i, brand: upper(i.brand), dept: upper(i.dept), jabatan: i.jabatan.trim(), nama: i.nama.trim(), email: i.email.trim().toLowerCase(), phone } };
}
