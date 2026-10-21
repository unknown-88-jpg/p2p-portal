import { LEVEL } from './config';
import type { Org } from './master';
import { cekBarangDiterima, hitungDraft, isValidYmd, JENIS_PEMBAYARAN, STATUS_PPN_OPSI, TIPE, type Tipe } from './pengajuan';
import { hasAuthority, type Role } from './roles';

// Logika form wizard (M4c). MURNI & dapat dites tanpa browser. Server tetap satu-satunya penentu: semua yang ada di sini hanya
// "pagar" agar user tidak menabrak penolakan server berulang-ulang. Aturan sama dengan validatePengajuan/hitungDraft (diimpor, bukan disalin).

export const LANGKAH = ['jenis', 'entitas', 'vendor', 'tagihan', 'tinjau'] as const;
export type Langkah = (typeof LANGKAH)[number];
export const JUDUL_LANGKAH: Readonly<Record<Langkah, string>> = {
  jenis: 'Jenis & referensi', entitas: 'Entitas & keperluan', vendor: 'Vendor', tagihan: 'Tagihan & lampiran', tinjau: 'Tinjau & ajukan',
};

/** Semua isian disimpan sebagai teks mentah (apa yang diketik). Angka diurai saat dipakai. */
export interface FormPengajuan {
  tipe: Tipe | '';
  poNumber: string;
  brand: string; departement: string;
  description: string; eventProject: string; notesUser: string;
  vendorKode: string;
  noInvoice: string; dateInvoice: string; dueDate: string;
  jenisPembayaran: string;
  invoiceAmount: string; diskon: string; biayaLainnya: string;
  statusPPN: string;
}
export const formKosong = (): FormPengajuan => ({
  tipe: '', poNumber: '', brand: '', departement: '', description: '', eventProject: '', notesUser: '', vendorKode: '',
  noInvoice: '', dateInvoice: '', dueDate: '', jenisPembayaran: '', invoiceAmount: '', diskon: '', biayaLainnya: '', statusPPN: 'Non PPN',
});

// ------------------------------------------------------------------ angka
export type HasilRupiah = { ok: true; n: number } | { ok: false; pesan: string };
/**
 * Urai ketikan Rupiah. Pemisah ribuan selalu tepat 3 digit ("1.250.000", "1,250,000"); ekor 1-2 digit setelah pemisah = desimal ("1.250.000,00"
 * atau "1,250,000.00"). Desimal bukan nol DITOLAK (Rupiah utuh, design 2.4) - tidak dibulatkan diam-diam karena ini uang.
 */
export function parseRupiah(raw: string): HasilRupiah {
  let s = raw.replace(/\s+/g, '').replace(/^rp\.?/i, '');
  if (s === '') return { ok: true, n: 0 };
  if (/[^\d.,]/.test(s)) return { ok: false, pesan: 'Hanya angka. Contoh: 1.250.000' };
  const des = /[.,](\d{1,2})$/.exec(s);
  if (des) {
    if (/[1-9]/.test(des[1]!)) return { ok: false, pesan: 'Isi dalam Rupiah utuh, tanpa sen.' };
    s = s.slice(0, des.index);
  }
  if (s === '') return { ok: false, pesan: 'Angka tidak valid.' };
  if (!/^\d+$/.test(s) && !/^\d{1,3}([.,]\d{3})+$/.test(s)) return { ok: false, pesan: 'Format angka tidak valid. Contoh: 1.250.000' };
  const n = Number(s.replace(/[.,]/g, ''));
  if (!Number.isSafeInteger(n) || n > 1e13) return { ok: false, pesan: 'Angka terlalu besar.' };
  return { ok: true, n };
}
/**
 * Urai isi kolom Rupiah setelah satu peristiwa input. Kolom memformat ribuan saat mengetik ("1.500"), jadi menambah/menghapus SATU karakter
 * pada teks berformat ("1.5000") berarti pengguna sedang mengetik: titik dianggap pemisah ribuan buatan kolom itu dan dibuang dulu.
 * Perubahan lebih dari satu karakter (tempel) diurai ketat apa adanya - "1250.50" tidak pernah diam-diam menjadi 125050.
 */
export function bacaKetikan(sebelum: string, mentah: string): HasilRupiah {
  const mengetik = Math.abs(mentah.length - sebelum.length) === 1 && /^[\d.,]*$/.test(mentah) && /^\d{1,3}(\.\d{3})*$/.test(sebelum);
  const sumber = mengetik ? mentah.replace(/\./g, '') : mentah;
  return parseRupiah(sumber.replace(/[.,\s]+$/, ''));
}
/** Angka dari ketikan; tak valid -> 0 (validasi memberi pesan terpisah). */
export const angka = (raw: string): number => { const r = parseRupiah(raw); return r.ok ? r.n : 0; };
/** 1234567 -> "1.234.567" (deterministik, tanpa bergantung ICU peramban). */
export const formatRibuan = (n: number): string => String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
export const rupiah = (n: number): string => `${n < 0 ? '-' : ''}Rp ${formatRibuan(Math.abs(n))}`;

/** Nomor rekening disamarkan sebagian (design 7.4.C): hanya 4 digit terakhir. */
export function samarkanRekening(no: string): string {
  const d = no.replace(/\s+/g, '');
  if (d.length <= 4) return d ? '•'.repeat(d.length) : '-';
  return `${'•'.repeat(Math.min(d.length - 4, 8))} ${d.slice(-4)}`;
}

/** ymd + n hari (kalender UTC murni, tanpa zona waktu). Tak valid -> ''. */
export function tambahHari(ymd: string, n: number): string {
  if (!isValidYmd(ymd)) return '';
  const [y, m, d] = ymd.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

// ------------------------------------------------------------------ validasi per langkah
export interface KonteksValidasi {
  /** Trade: PO sudah ditarik & lolos (vendor Approved dsb.). */
  poSiap: boolean;
  /** Vendor milik PO yang ditarik (Trade). */
  poVendorKode: string;
  /** Divisi punya Manager L2 (design: tombol lanjut dikunci bila tidak). null = belum diketahui/memuat. */
  adaManager: boolean | null;
  /** Pesan duplikat invoice dari cek inline; null = tidak duplikat / belum dicek. */
  duplikat: string | null;
  /** Lampiran sudah ada di server ATAU sudah dipilih dan menunggu diunggah. */
  punyaLampiran: boolean;
}
export type Galat = Record<string, string>;

const WAJIB = 'Wajib diisi.';
export function validasiLangkah(langkah: Langkah, f: FormPengajuan, k: KonteksValidasi): Galat {
  const g: Galat = {};
  switch (langkah) {
    case 'jenis':
      if (!f.tipe) g.tipe = 'Pilih jenis pengajuan.';
      if (f.tipe === 'Trade') {
        if (!f.poNumber.trim()) g.poNumber = 'Nomor P.O wajib untuk pengajuan Trade.';
        else if (!k.poSiap) g.poNumber = 'Tarik data P.O dulu (tombol "Tarik data P.O").';
      }
      break;
    case 'entitas':
      if (!f.brand) g.brand = 'Pilih brand.';
      if (!f.departement) g.departement = 'Pilih departemen.';
      if (!f.description.trim()) g.description = WAJIB;
      if (f.brand && f.departement && k.adaManager === false) g.manager = 'Divisi ini belum punya Manager (Level 2), jadi pengajuan belum bisa dilanjutkan. Hubungi admin.';
      if (f.brand && f.departement && k.adaManager === null) g.manager = 'Memeriksa Manager divisi…';
      break;
    case 'vendor':
      if (!f.vendorKode) g.vendorKode = 'Pilih vendor.';
      else if (f.tipe === 'Trade' && k.poVendorKode && f.vendorKode.toUpperCase() !== k.poVendorKode.toUpperCase()) g.vendorKode = `Vendor harus sama dengan vendor di P.O (${k.poVendorKode}).`;
      break;
    case 'tagihan': {
      if (!f.noInvoice.trim()) g.noInvoice = WAJIB;
      else if (k.duplikat) g.noInvoice = k.duplikat;
      if (!f.dateInvoice) g.dateInvoice = WAJIB; else if (!isValidYmd(f.dateInvoice)) g.dateInvoice = 'Tanggal tidak valid.';
      if (!f.dueDate) g.dueDate = WAJIB; else if (!isValidYmd(f.dueDate)) g.dueDate = 'Tanggal tidak valid.';
      else if (isValidYmd(f.dateInvoice) && f.dueDate < f.dateInvoice) g.dueDate = 'Jatuh tempo tidak boleh sebelum tanggal invoice.';
      if (!f.jenisPembayaran) g.jenisPembayaran = 'Pilih jenis pembayaran.';
      else if (!(JENIS_PEMBAYARAN as readonly string[]).includes(f.jenisPembayaran)) g.jenisPembayaran = 'Jenis pembayaran tidak dikenal.';
      if (!(STATUS_PPN_OPSI as readonly string[]).includes(f.statusPPN)) g.statusPPN = 'Pilih status PPN.';
      for (const [kunci, label] of [['invoiceAmount', 'Nilai invoice'], ['diskon', 'Diskon'], ['biayaLainnya', 'Biaya lainnya']] as const) {
        const r = parseRupiah(f[kunci]);
        if (!r.ok) g[kunci] = r.pesan;
        else if (kunci === 'invoiceAmount' && r.n <= 0) g[kunci] = `${label} harus lebih dari 0.`;
      }
      if (!g.invoiceAmount && !g.diskon && angka(f.diskon) > angka(f.invoiceAmount)) g.diskon = 'Diskon tidak boleh melebihi nilai invoice.';
      if (!g.invoiceAmount && !g.diskon && !g.biayaLainnya && !hitungAman(f, '')) g.invoiceAmount = 'Nominal akhir tidak valid. Cek nilai, diskon, dan biaya lainnya.';
      if (!k.punyaLampiran) g.lampiran = 'Lampirkan file invoice (PDF, JPG, atau PNG).';
      break;
    }
    case 'tinjau':
      break;
  }
  return g;
}
export const langkahValid = (l: Langkah, f: FormPengajuan, k: KonteksValidasi): boolean => Object.keys(validasiLangkah(l, f, k)).length === 0;
/** Langkah pertama yang belum valid (untuk melompat balik saat ada yang kurang); null = semua valid. */
export function langkahBermasalah(f: FormPengajuan, k: KonteksValidasi): Langkah | null {
  for (const l of LANGKAH) if (l !== 'tinjau' && !langkahValid(l, f, k)) return l;
  return null;
}
/** Draft boleh disimpan ke server bila langkah 1-4 valid KECUALI lampiran (lampiran diunggah setelah draft ada). */
export function bisaSimpanDraft(f: FormPengajuan, k: KonteksValidasi): boolean {
  return LANGKAH.filter((l) => l !== 'tinjau').every((l) => {
    const g = validasiLangkah(l, f, k);
    delete g.lampiran;
    return Object.keys(g).length === 0;
  });
}

// ------------------------------------------------------------------ preview hitung (fungsi yang SAMA dengan server; hanya tampilan)
export interface PreviewHitung { dpp: number; ppnAmount: number; finalAmount: number; perluCFO: boolean }
function hitungAman(f: FormPengajuan, npwp: string): PreviewHitung | null {
  try {
    const r = hitungDraft({ invoiceAmount: angka(f.invoiceAmount), diskon: angka(f.diskon), biayaLainnya: angka(f.biayaLainnya), statusPPN: f.statusPPN, npwpVendor: npwp });
    return { dpp: r.dpp, ppnAmount: r.ppnAmount, finalAmount: r.finalAmount, perluCFO: r.perluCFO };
  } catch { return null; }
}
export const previewHitung = (f: FormPengajuan, npwpVendor: string): PreviewHitung | null => (angka(f.invoiceAmount) > 0 ? hitungAman(f, npwpVendor) : null);

/** I11 (peringatan dini di layar tinjau; server tetap menolak saat submit). */
export const peringatanBarang = (f: FormPengajuan, qtyPO: number, qtySJ: number): string | null =>
  f.tipe === 'Trade' ? cekBarangDiterima('Trade', f.jenisPembayaran, qtyPO, qtySJ) : null;

// ------------------------------------------------------------------ ke/dari server
/** Body POST create/update. Urutan kunci TETAP (dipakai sebagai sidik jari idempotensi). Tidak ada angka turunan: server menghitung semuanya. */
export function keInputServer(f: FormPengajuan): Record<string, string | number> {
  if (!f.tipe) throw new Error('tipe belum dipilih');
  const o: Record<string, string | number> = {
    tipe: f.tipe, brand: f.brand, departement: f.departement, description: f.description.trim(),
  };
  if (f.eventProject.trim()) o.eventProject = f.eventProject.trim();
  if (f.notesUser.trim()) o.notesUser = f.notesUser.trim();
  if (f.tipe === 'Trade') o.poNumber = f.poNumber.trim().toUpperCase();
  Object.assign(o, {
    vendorKode: f.vendorKode, noInvoice: f.noInvoice.trim(), dateInvoice: f.dateInvoice, dueDate: f.dueDate, jenisPembayaran: f.jenisPembayaran,
    invoiceAmount: angka(f.invoiceAmount), diskon: angka(f.diskon), biayaLainnya: angka(f.biayaLainnya), statusPPN: f.statusPPN,
  });
  return o;
}
export const sidikJari = (body: Record<string, unknown>): string => JSON.stringify(body);

/** Bentuk dokumen dari GET /api/pengajuan(/id) (lihat dto di server/pengajuan.ts). */
export interface DokumenDto {
  id: string; tanggal: string; company: string; brand: string; departement: string; tipe: string; pic: string; description: string;
  eventProject: string; notesUser: string; poNumber: string; vendorKode: string; vendorNama: string; noInvoice: string;
  dateInvoice: string; dueDate: string; jenisPembayaran: string; invoiceAmount: number; diskon: number; biayaLainnya: number; statusPPN: string;
  dpp: number; ppnAmount: number; nominal: number; status: string; notesFinance: string; perluCFO: boolean; qtyPO: number; qtySJ: number;
  punyaLampiran: boolean; editable: boolean; submittable: boolean;
}
const tanpaStrip = (v: string): string => (v === '-' ? '' : v);
const angkaTeks = (n: number): string => (n > 0 ? formatRibuan(n) : '');
export function dariDokumen(d: DokumenDto): FormPengajuan {
  return {
    tipe: (TIPE as readonly string[]).includes(d.tipe) ? (d.tipe as Tipe) : '', poNumber: tanpaStrip(d.poNumber),
    brand: d.brand, departement: d.departement, description: d.description, eventProject: tanpaStrip(d.eventProject), notesUser: d.notesUser,
    vendorKode: d.vendorKode, noInvoice: d.noInvoice, dateInvoice: d.dateInvoice, dueDate: d.dueDate, jenisPembayaran: d.jenisPembayaran,
    invoiceAmount: angkaTeks(d.invoiceAmount), diskon: angkaTeks(d.diskon), biayaLainnya: angkaTeks(d.biayaLainnya), statusPPN: d.statusPPN || 'Non PPN',
  };
}

// ------------------------------------------------------------------ idempotensi
export interface KunciIdem { key: string; sidik: string }
/** Kunci dipakai ulang HANYA untuk percobaan ulang dengan isi yang sama (jaringan putus = hasil ambigu). Isi berubah -> kunci baru. */
export function pilihKunci(prev: KunciIdem | null, sidik: string, buat: () => string): KunciIdem {
  return prev && prev.sidik === sidik ? prev : { key: buat(), sidik };
}

// ------------------------------------------------------------------ draf lokal (sessionStorage) - bukan sumber kebenaran, hanya penyelamat isian
export interface DrafLokal { v: 1; langkah: Langkah; form: FormPengajuan; idTrx: string | null }
export const serialDrafLokal = (d: Omit<DrafLokal, 'v'>): string => JSON.stringify({ v: 1, ...d });
export function bacaDrafLokal(teks: string | null): DrafLokal | null {
  if (!teks) return null;
  try {
    const o = JSON.parse(teks) as Partial<DrafLokal> | null;
    if (!o || typeof o !== 'object' || o.v !== 1 || typeof o.form !== 'object' || !o.form) return null;
    const dasar = formKosong();
    const form = { ...dasar };
    for (const kunci of Object.keys(dasar) as (keyof FormPengajuan)[]) {
      const v = (o.form as unknown as Record<string, unknown>)[kunci];
      if (typeof v === 'string' && v.length <= 2000) (form as Record<string, string>)[kunci] = v;
    }
    if (form.tipe && !(TIPE as readonly string[]).includes(form.tipe)) form.tipe = '';
    const langkah = (LANGKAH as readonly string[]).includes(o.langkah as string) ? (o.langkah as Langkah) : 'jenis';
    const idTrx = typeof o.idTrx === 'string' && /^(TRD|NTR)-\d{5,}$/.test(o.idTrx) ? o.idTrx : null;
    return { v: 1, langkah, form, idTrx };
  } catch { return null; }
}
/** Ada isi yang layak diselamatkan? (hindari menawarkan "lanjutkan" untuk form kosong). */
export const formAdaIsi = (f: FormPengajuan): boolean => Object.entries(f).some(([k, v]) => k !== 'statusPPN' && String(v).trim() !== '');

// ------------------------------------------------------------------ pilihan entitas sesuai peran (padanan cekHakPengaju per kombinasi)

/** Brand yang boleh dipilih = ada minimal satu divisi di brand itu yang pengguna berwenang sebagai PIC (Level 1; ALL cocok semua). */
export function brandBoleh(roles: readonly Role[], org: Pick<Org, 'brands' | 'tree'>): string[] {
  return org.brands.filter((b) => Object.keys(org.tree[b] ?? {}).some((d) => hasAuthority(roles, b, d, LEVEL.PIC)));
}
export function deptBoleh(roles: readonly Role[], org: Pick<Org, 'brands' | 'tree'>, brand: string): string[] {
  return Object.keys(org.tree[brand] ?? {}).filter((d) => hasAuthority(roles, brand, d, LEVEL.PIC)).sort();
}

/** Trade: vendor di PO harus bertipe Trade (server menolak lainnya saat simpan draft) - tampilkan lebih awal. null = aman. */
export function cekPoUntukTrade(po: { vendor: { tipe: string; nama: string } }): string | null {
  return po.vendor.tipe.trim().toLowerCase() === 'trade' ? null : `Vendor pada P.O ini ("${po.vendor.nama}") bertipe ${po.vendor.tipe || '-'}, bukan Trade, sehingga tidak bisa diajukan sebagai pengajuan Trade.`;
}

/** Gauge plafon PO: 0..1 + nada. Nada hanya penanda visual; keputusan tetap di server. */
export function gaugePlafon(totalDiajukan: number, plafon: number, nominalIni: number): { bagian: number; bagianTermasukIni: number; nada: 'normal' | 'rawan' | 'lewat'; sisaSetelahIni: number } {
  const p = plafon > 0 ? plafon : 0;
  const bagian = p ? Math.min(1, totalDiajukan / p) : 0;
  const total = totalDiajukan + nominalIni;
  const bagianTermasukIni = p ? Math.min(1, total / p) : 0;
  const sisaSetelahIni = p - total;
  return { bagian, bagianTermasukIni, nada: sisaSetelahIni < 0 ? 'lewat' : bagianTermasukIni >= 0.9 ? 'rawan' : 'normal', sisaSetelahIni };
}
