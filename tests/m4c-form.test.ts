import { describe, expect, it } from 'vitest';
import {
  angka, bacaDrafLokal, bacaKetikan, bisaSimpanDraft, brandBoleh, cekPoUntukTrade, deptBoleh, gaugePlafon, dariDokumen, formAdaIsi, formKosong, formatRibuan, keInputServer, langkahBermasalah, parseRupiah,
  peringatanBarang, pilihKunci, previewHitung, rupiah, samarkanRekening, serialDrafLokal, sidikJari, tambahHari, validasiLangkah,
  type DokumenDto, type FormPengajuan, type KonteksValidasi,
} from '@/domain/pengajuan-form';
import { KOMPRES, formatUkuran, hitungUkuranKompres, namaSetelahKompres, pilihBerkas } from '@/domain/lampiran';
import { KELOMPOK_STATUS, labelStatus } from '@/domain/status-label';
import { STATUS } from '@/domain/status';
import { pengajuanSchema } from '@/server/pengajuan-schema';

const K: KonteksValidasi = { poSiap: true, poVendorKode: 'V1', adaManager: true, duplikat: null, punyaLampiran: true };
const lengkap = (o: Partial<FormPengajuan> = {}): FormPengajuan => ({
  ...formKosong(), tipe: 'Non-Trade', brand: 'BRAND A', departement: 'DEPT X', description: 'Beli kertas', vendorKode: 'V3', noInvoice: 'INV-1',
  dateInvoice: '2026-10-01', dueDate: '2026-10-31', jenisPembayaran: 'Full Payment', invoiceAmount: '1.000.000', statusPPN: 'Non PPN', ...o,
});

describe('parseRupiah (uang: tidak boleh salah baca diam-diam)', () => {
  it.each([
    ['', 0], ['0', 0], ['1000', 1000], ['1.000', 1000], ['1.250.000', 1_250_000], ['1,250,000', 1_250_000], ['Rp 1.250.000', 1_250_000],
    ['1.250.000,00', 1_250_000], ['1,250,000.00', 1_250_000], ['1250000.0', 1_250_000], ['  5 000  '.replace(' 0', '0'), 5000],
  ])('%j -> %d', (raw, n) => { expect(parseRupiah(raw)).toEqual({ ok: true, n }); });

  it.each(['1.250.000,50', '1250.5', '10,25', 'abc', '1.2.3', '1..000', '12.34.567', '-5', '1e6', '99999999999999999'])('ditolak: %j', (raw) => {
    expect(parseRupiah(raw).ok).toBe(false);
  });
  it('"1.250" = seribu dua ratus lima puluh (ribuan), bukan 1,25', () => { expect(angka('1.250')).toBe(1250); });
  it('angka(tak valid) = 0 (validasi yang memberi pesan)', () => { expect(angka('abc')).toBe(0); });
});

describe('format', () => {
  it('formatRibuan / rupiah', () => {
    expect(formatRibuan(0)).toBe('0'); expect(formatRibuan(999)).toBe('999'); expect(formatRibuan(1000)).toBe('1.000'); expect(formatRibuan(1234567)).toBe('1.234.567');
    expect(rupiah(5_000_000)).toBe('Rp 5.000.000'); expect(rupiah(-1500)).toBe('-Rp 1.500');
  });
  it('samarkanRekening menyisakan 4 digit terakhir', () => {
    expect(samarkanRekening('1234567890')).toBe('•••••• 7890');
    expect(samarkanRekening('123')).toBe('•••'); expect(samarkanRekening('')).toBe('-');
    expect(samarkanRekening('1234567890')).not.toContain('123456');
  });
  it('tambahHari: akhir bulan, kabisat, tahun, tanggal fiktif', () => {
    expect(tambahHari('2026-10-01', 30)).toBe('2026-10-31'); expect(tambahHari('2026-10-31', 1)).toBe('2026-11-01');
    expect(tambahHari('2028-02-28', 1)).toBe('2028-02-29'); expect(tambahHari('2026-02-28', 1)).toBe('2026-03-01');
    expect(tambahHari('2026-12-31', 14)).toBe('2027-01-14'); expect(tambahHari('2026-02-31', 1)).toBe(''); expect(tambahHari('', 1)).toBe('');
  });
  it('formatUkuran', () => { expect(formatUkuran(500)).toBe('500 B'); expect(formatUkuran(1536)).toBe('1.5 KB'); expect(formatUkuran(2.5 * 1024 * 1024)).toBe('2.5 MB'); expect(formatUkuran(-1)).toBe('-'); });
});

describe('validasi per langkah', () => {
  it('jenis: Trade wajib PO dan harus sudah ditarik', () => {
    expect(validasiLangkah('jenis', formKosong(), K).tipe).toBeTruthy();
    expect(validasiLangkah('jenis', { ...formKosong(), tipe: 'Trade' }, K).poNumber).toMatch(/wajib/);
    expect(validasiLangkah('jenis', { ...formKosong(), tipe: 'Trade', poNumber: 'PO1' }, { ...K, poSiap: false }).poNumber).toMatch(/Tarik/);
    expect(validasiLangkah('jenis', { ...formKosong(), tipe: 'Trade', poNumber: 'PO1' }, K)).toEqual({});
    expect(validasiLangkah('jenis', { ...formKosong(), tipe: 'Non-Trade' }, K)).toEqual({});
  });
  it('entitas: divisi tanpa Manager mengunci lanjut; sedang memeriksa = belum boleh', () => {
    const f = lengkap();
    expect(validasiLangkah('entitas', f, K)).toEqual({});
    expect(validasiLangkah('entitas', f, { ...K, adaManager: false }).manager).toMatch(/belum punya Manager/);
    expect(validasiLangkah('entitas', f, { ...K, adaManager: null }).manager).toBeTruthy();
    expect(Object.keys(validasiLangkah('entitas', { ...f, brand: '', departement: '', description: ' ' }, K)).sort()).toEqual(['brand', 'departement', 'description']);
  });
  it('vendor: Trade harus vendor milik PO', () => {
    expect(validasiLangkah('vendor', lengkap({ tipe: 'Trade', vendorKode: 'v1' }), K)).toEqual({});
    expect(validasiLangkah('vendor', lengkap({ tipe: 'Trade', vendorKode: 'V9' }), K).vendorKode).toMatch(/V1/);
    expect(validasiLangkah('vendor', lengkap({ vendorKode: '' }), K).vendorKode).toBeTruthy();
    expect(validasiLangkah('vendor', lengkap({ tipe: 'Non-Trade', vendorKode: 'V9' }), K)).toEqual({});
  });
  it('tagihan: tanggal, nominal, diskon, duplikat, lampiran', () => {
    expect(validasiLangkah('tagihan', lengkap(), K)).toEqual({});
    expect(validasiLangkah('tagihan', lengkap({ dueDate: '2026-09-30' }), K).dueDate).toMatch(/sebelum/);
    expect(validasiLangkah('tagihan', lengkap({ dateInvoice: '2026-02-31' }), K).dateInvoice).toMatch(/tidak valid/);
    expect(validasiLangkah('tagihan', lengkap({ invoiceAmount: '0' }), K).invoiceAmount).toMatch(/lebih dari 0/);
    expect(validasiLangkah('tagihan', lengkap({ invoiceAmount: '1.000.000,50' }), K).invoiceAmount).toMatch(/tanpa sen/);
    expect(validasiLangkah('tagihan', lengkap({ diskon: '2.000.000' }), K).diskon).toMatch(/melebihi/);
    expect(validasiLangkah('tagihan', lengkap({ jenisPembayaran: '' }), K).jenisPembayaran).toBeTruthy();
    expect(validasiLangkah('tagihan', lengkap(), { ...K, duplikat: 'Invoice sudah ada' }).noInvoice).toBe('Invoice sudah ada');
    expect(validasiLangkah('tagihan', lengkap(), { ...K, punyaLampiran: false }).lampiran).toMatch(/Lampirkan/);
  });
  it('tagihan: biaya lain besar tidak membuat nominal akhir negatif, diskon = nilai invoice -> final = biaya lain', () => {
    expect(validasiLangkah('tagihan', lengkap({ diskon: '1.000.000', biayaLainnya: '0' }), K)).toEqual({});
  });
  it('langkahBermasalah menunjuk langkah pertama yang rusak; bisaSimpanDraft tidak menuntut lampiran', () => {
    expect(langkahBermasalah(lengkap(), K)).toBeNull();
    expect(langkahBermasalah(lengkap({ vendorKode: '', noInvoice: '' }), K)).toBe('vendor');
    const tanpaFile = { ...K, punyaLampiran: false };
    expect(langkahBermasalah(lengkap(), tanpaFile)).toBe('tagihan');
    expect(bisaSimpanDraft(lengkap(), tanpaFile)).toBe(true);
    expect(bisaSimpanDraft(lengkap({ noInvoice: '' }), tanpaFile)).toBe(false);
  });
});

describe('kontrak dengan server', () => {
  it('body klien LOLOS skema strict server (Non-Trade & Trade), tanpa kunci turunan', () => {
    const nt = keInputServer(lengkap({ eventProject: 'Launch', notesUser: 'Catatan\nbaris 2', diskon: '10.000', biayaLainnya: '5.000' }));
    expect(pengajuanSchema.safeParse(nt).success).toBe(true);
    const tr = keInputServer(lengkap({ tipe: 'Trade', poNumber: ' po-001 ', statusPPN: 'Exclude PPN' }));
    expect(pengajuanSchema.safeParse(tr).success).toBe(true);
    expect(tr.poNumber).toBe('PO-001');
    for (const dilarang of ['dpp', 'finalAmount', 'requireCfo', 'company', 'pic', 'createdBy', 'ppnAmount']) expect(nt).not.toHaveProperty(dilarang);
  });
  it('Non-Trade tidak pernah mengirim poNumber (walau field sisa terisi); opsional kosong tidak dikirim', () => {
    const b = keInputServer(lengkap({ poNumber: 'SISA-PO', eventProject: '  ', notesUser: '' }));
    expect(b).not.toHaveProperty('poNumber'); expect(b).not.toHaveProperty('eventProject'); expect(b).not.toHaveProperty('notesUser');
  });
  it('tipe kosong tidak bisa dikirim', () => { expect(() => keInputServer(lengkap({ tipe: '' }))).toThrow(); });
  it('sidik jari stabil untuk isi sama, berubah bila ada yang beda', () => {
    expect(sidikJari(keInputServer(lengkap()))).toBe(sidikJari(keInputServer(lengkap())));
    expect(sidikJari(keInputServer(lengkap()))).not.toBe(sidikJari(keInputServer(lengkap({ invoiceAmount: '1.000.001' }))));
  });
  it('dariDokumen: "-" jadi kosong, angka diformat, tipe asing dibuang', () => {
    const d: DokumenDto = {
      id: 'NTR-00001', tanggal: '2026-10-01', company: 'PT A', brand: 'BRAND A', departement: 'DEPT X', tipe: 'Non-Trade', pic: 'Citra', description: 'x', eventProject: '-',
      notesUser: '', poNumber: '-', vendorKode: 'V3', vendorNama: 'Gama', noInvoice: 'INV-1', dateInvoice: '2026-10-01', dueDate: '2026-10-31', jenisPembayaran: 'Full Payment',
      invoiceAmount: 1_250_000, diskon: 0, biayaLainnya: 0, statusPPN: 'Non PPN', dpp: 1, ppnAmount: 0, nominal: 1_250_000, status: 'Draft', notesFinance: '', perluCFO: false,
      qtyPO: 0, qtySJ: 0, punyaLampiran: false, editable: true, submittable: true,
    };
    const f = dariDokumen(d);
    expect(f).toMatchObject({ eventProject: '', poNumber: '', invoiceAmount: '1.250.000', diskon: '', tipe: 'Non-Trade' });
    expect(angka(f.invoiceAmount)).toBe(1_250_000);
    expect(dariDokumen({ ...d, tipe: 'Aneh' }).tipe).toBe('');
    expect(pengajuanSchema.safeParse(keInputServer(f)).success).toBe(true); // putaran penuh: dokumen -> form -> body yang diterima server
  });
});

describe('preview hitung = fungsi domain yang sama dengan server (I1 batas CFO)', () => {
  it('4.999.999 tidak CFO, 5.000.000 CFO (Non PPN)', () => {
    expect(previewHitung(lengkap({ invoiceAmount: '4.999.999' }), '')!.perluCFO).toBe(false);
    expect(previewHitung(lengkap({ invoiceAmount: '5.000.000' }), '')!.perluCFO).toBe(true);
  });
  it('Exclude PPN menaikkan final di atas ambang; Include PPN tidak', () => {
    expect(previewHitung(lengkap({ invoiceAmount: '4.600.000', statusPPN: 'Exclude PPN' }), '')).toMatchObject({ ppnAmount: 506000, finalAmount: 5_106_000, perluCFO: true });
    expect(previewHitung(lengkap({ invoiceAmount: '5.000.000', statusPPN: 'Include PPN' }), '')!.finalAmount).toBe(5_000_000);
  });
  it('tanpa nilai / tak valid -> null (panel tersembunyi, tidak crash)', () => {
    expect(previewHitung(lengkap({ invoiceAmount: '' }), '')).toBeNull();
    expect(previewHitung(lengkap({ invoiceAmount: '1.000', diskon: '2.000' }), '')).toBeNull();
  });
  it('peringatan I11 hanya Trade non-DP dengan SJ < PO', () => {
    expect(peringatanBarang(lengkap({ tipe: 'Trade', jenisPembayaran: 'Full Payment' }), 10, 4)).toMatch(/belum diterima penuh/);
    expect(peringatanBarang(lengkap({ tipe: 'Trade', jenisPembayaran: 'DP' }), 10, 4)).toBeNull();
    expect(peringatanBarang(lengkap({ tipe: 'Trade', jenisPembayaran: 'Full Payment' }), 10, 10)).toBeNull();
    expect(peringatanBarang(lengkap({ tipe: 'Non-Trade' }), 10, 0)).toBeNull();
  });
});

describe('kunci idempotensi', () => {
  it('sama isi -> kunci sama (retry setelah jaringan putus); beda isi -> kunci baru', () => {
    let n = 0; const buat = () => `K${++n}`;
    const a = pilihKunci(null, 's1', buat);
    expect(pilihKunci(a, 's1', buat)).toBe(a);
    const b = pilihKunci(a, 's2', buat);
    expect(b.key).not.toBe(a.key); expect(n).toBe(2);
  });
});

describe('draf lokal', () => {
  it('putaran serialisasi', () => {
    const f = lengkap();
    expect(bacaDrafLokal(serialDrafLokal({ langkah: 'vendor', form: f, idTrx: 'NTR-00007' }))).toEqual({ v: 1, langkah: 'vendor', form: f, idTrx: 'NTR-00007' });
  });
  it.each([null, '', 'bukan json', '{}', '{"v":2}', '{"v":1,"form":null}', '[]', '"x"'])('input rusak %j -> null', (t) => { expect(bacaDrafLokal(t)).toBeNull(); });
  it('isi bermusuhan dibersihkan: kunci asing dibuang, tipe non-string dibuang, idTrx tak valid dibuang, panjang dibatasi', () => {
    const t = JSON.stringify({ v: 1, langkah: 'hack', idTrx: '../etc', form: { tipe: 'Aneh', brand: 123, description: 'x'.repeat(5000), __proto__: { admin: true }, evil: 'y', noInvoice: 'OK' } });
    const d = bacaDrafLokal(t)!;
    expect(d.langkah).toBe('jenis'); expect(d.idTrx).toBeNull();
    expect(d.form.tipe).toBe(''); expect(d.form.brand).toBe(''); expect(d.form.description).toBe(''); expect(d.form.noInvoice).toBe('OK');
    expect(d.form).not.toHaveProperty('evil');
  });
  it('formAdaIsi: form kosong (hanya default PPN) bukan "ada isi"', () => {
    expect(formAdaIsi(formKosong())).toBe(false);
    expect(formAdaIsi({ ...formKosong(), noInvoice: 'A' })).toBe(true);
  });
});

describe('label status (design 7.3)', () => {
  it('semua status dikenal punya label; tak dikenal ditampilkan apa adanya', () => {
    for (const s of Object.values(STATUS)) expect(labelStatus(s).label.length, s).toBeGreaterThan(0);
    expect(labelStatus(STATUS.SUBMITTED)).toEqual({ label: 'Menunggu Manager', nada: 'biru' });
    expect(labelStatus(STATUS.REVISION).nada).toBe('merah');
    expect(labelStatus('Aneh')).toEqual({ label: 'Aneh', nada: 'abu' });
    expect(labelStatus('')).toEqual({ label: '-', nada: 'abu' });
  });
  it('kelompok filter: setiap status masuk tepat satu kelompok selain "semua"', () => {
    for (const s of Object.values(STATUS)) {
      const n = KELOMPOK_STATUS.filter((k) => k.kunci !== 'semua' && k.cocok(s)).length;
      expect(n, s).toBe(1);
    }
  });
});

describe('kompresi gambar (hitung ukuran)', () => {
  it('sisi terpanjang dibatasi 1800, rasio tetap, tidak membesarkan', () => {
    expect(hitungUkuranKompres(4000, 3000)).toEqual({ w: 1800, h: 1350 });
    expect(hitungUkuranKompres(3000, 4000)).toEqual({ w: 1350, h: 1800 });
    expect(hitungUkuranKompres(1000, 500)).toEqual({ w: 1000, h: 500 });
    expect(hitungUkuranKompres(1800, 1800)).toEqual({ w: 1800, h: 1800 });
    expect(hitungUkuranKompres(100000, 10)).toEqual({ w: 1800, h: 1 });
  });
  it('dimensi tak valid -> null', () => { for (const [w, h] of [[0, 5], [5, 0], [NaN, 5], [Infinity, 5], [-1, 5]]) expect(hitungUkuranKompres(w!, h!)).toBeNull(); });
  it('konstanta = sistem lama', () => { expect(KOMPRES).toEqual({ MAX_SISI: 1800, KUALITAS: 0.82 }); });
  it('pilihBerkas: hasil dipakai hanya bila lebih kecil', () => {
    const asli = { size: 1000, id: 'a' }; const kecil = { size: 400, id: 'k' }; const besar = { size: 1500, id: 'b' };
    expect(pilihBerkas(asli, kecil)).toBe(kecil); expect(pilihBerkas(asli, besar)).toBe(asli); expect(pilihBerkas(asli, null)).toBe(asli); expect(pilihBerkas(asli, { size: 0, id: 'n' })).toBe(asli);
    expect(pilihBerkas(asli, { size: 1000, id: 's' })).toBe(asli);
  });
  it('namaSetelahKompres', () => { expect(namaSetelahKompres('Foto Invoice.PNG')).toBe('Foto Invoice.jpg'); expect(namaSetelahKompres('C:\\x\\a.b.png')).toBe('a.b.jpg'); expect(namaSetelahKompres('')).toBe('foto.jpg'); });
});

describe('pilihan entitas sesuai peran', () => {
  const org = { brands: ['BRAND A', 'BRAND B', 'BRAND C'], tree: { 'BRAND A': { 'DEPT X': {}, 'DEPT Y': {} }, 'BRAND B': { 'DEPT Y': {} }, 'BRAND C': { 'DEPT Z': {} } } } as never;
  it('hanya kombinasi brand/divisi tempat pengguna PIC (Level 1) - sama dengan cekHakPengaju', () => {
    const roles = [{ brand: 'BRAND A', dept: 'DEPT X', level: 1 }, { brand: 'BRAND B', dept: 'DEPT Y', level: 1 }, { brand: 'BRAND C', dept: 'DEPT Z', level: 2 }];
    expect(brandBoleh(roles, org)).toEqual(['BRAND A', 'BRAND B']);
    expect(deptBoleh(roles, org, 'BRAND A')).toEqual(['DEPT X']);
    expect(deptBoleh(roles, org, 'BRAND C')).toEqual([]);
    expect(deptBoleh(roles, org, 'TAK ADA')).toEqual([]);
  });
  it('ALL = semua divisi; level selain 1 tidak memberi hak', () => {
    expect(brandBoleh([{ brand: 'ALL', dept: 'ALL', level: 1 }], org)).toEqual(['BRAND A', 'BRAND B', 'BRAND C']);
    expect(deptBoleh([{ brand: 'BRAND A', dept: 'ALL', level: 1 }], org, 'BRAND A')).toEqual(['DEPT X', 'DEPT Y']);
    expect(brandBoleh([{ brand: 'ALL', dept: 'ALL', level: 3 }], org)).toEqual([]);
  });
});

describe('PO untuk Trade & gauge plafon', () => {
  it('vendor PO non-Trade ditolak lebih awal', () => {
    expect(cekPoUntukTrade({ vendor: { tipe: 'Trade', nama: 'X' } })).toBeNull();
    expect(cekPoUntukTrade({ vendor: { tipe: ' trade ', nama: 'X' } })).toBeNull();
    expect(cekPoUntukTrade({ vendor: { tipe: 'Non-Trade', nama: 'Gama' } })).toMatch(/Gama.*Non-Trade/);
  });
  it('gauge: normal / rawan (>=90%) / lewat plafon', () => {
    expect(gaugePlafon(0, 1000, 500)).toMatchObject({ bagian: 0, bagianTermasukIni: 0.5, nada: 'normal', sisaSetelahIni: 500 });
    expect(gaugePlafon(400, 1000, 500)).toMatchObject({ nada: 'rawan', sisaSetelahIni: 100 });
    expect(gaugePlafon(400, 1000, 600)).toMatchObject({ nada: 'rawan', sisaSetelahIni: 0 });
    expect(gaugePlafon(400, 1000, 601)).toMatchObject({ nada: 'lewat', sisaSetelahIni: -1, bagianTermasukIni: 1 });
    expect(gaugePlafon(0, 0, 10)).toMatchObject({ nada: 'lewat', bagian: 0 });
  });
});

describe('bacaKetikan (ketik angka satu per satu)', () => {
  const ketik = (s: string): string => { let v = ''; for (const ch of s) { const r = bacaKetikan(v, v + ch); if (!r.ok) return `ERR:${v + ch}`; v = r.n === 0 ? '' : formatRibuan(r.n); } return v; };
  it('1500000 diketik berurutan -> 1.500.000 (regresi: dulu macet di "1.5000")', () => {
    expect(ketik('1500000')).toBe('1.500.000');
    expect(ketik('12345678901')).toBe('12.345.678.901');
  });
  it('hapus satu karakter dari teks berformat tetap valid', () => {
    expect(bacaKetikan('1.500', '1.50')).toEqual({ ok: true, n: 150 });
    expect(bacaKetikan('1.500.000', '1.50.000')).toEqual({ ok: true, n: 150000 });
  });
  it('tempel (banyak karakter) diurai ketat: desimal en-US tidak diam-diam jadi ribuan', () => {
    expect(bacaKetikan('', '1250.50')).toMatchObject({ ok: false });
    expect(bacaKetikan('', '1.250.000')).toEqual({ ok: true, n: 1250000 });
    expect(bacaKetikan('', '1250.00')).toEqual({ ok: true, n: 1250 });
  });
  it('huruf ditolak; kosong = 0', () => {
    expect(bacaKetikan('1.500', '1.500a')).toMatchObject({ ok: false });
    expect(bacaKetikan('1', '')).toEqual({ ok: true, n: 0 });
  });
});
