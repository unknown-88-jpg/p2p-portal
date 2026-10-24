import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { hitungPajak, type PphRate } from '@/domain/tax';
import { num } from '@/domain/legacy-parse';
import { cekPlafonPO, cocokkanPrefix, gatePoSubmit, hitungPlafonSJ, type PoLookup } from '@/domain/po';
import { butuhCFO } from '@/domain/config';
import { bangunCoa, bangunKas, bangunOrg, bangunPph, cariVendor, daftarVendor, picOptions } from '@/domain/master';
import { RuleError } from '@/domain/errors';

const golden = <T>(f: string): T => JSON.parse(readFileSync(new URL(`./golden/${f}.json`, import.meta.url), 'utf8')) as T;

// Golden = keluaran kode LAMA (Calc.gs/API_PO.gs dijalankan apa adanya lewat scripts/gen-golden.mjs), bukan ekspor data produksi.
describe('golden: hitungPajak == Calc.gs lama', () => {
  const g = golden<{ rates: PphRate[]; cases: ({ input: Record<string, unknown>; ok?: unknown; err?: string })[] }>('tax');
  it(`${g.cases.length} vektor identik (hasil maupun pesan error)`, () => {
    expect(g.cases.length).toBeGreaterThanOrEqual(1000);
    expect(g.cases.some((c) => c.err)).toBe(true);
    expect(g.cases.some((c) => c.ok)).toBe(true);
    for (const c of g.cases) {
      if (c.err !== undefined) expect(() => hitungPajak(c.input, g.rates), JSON.stringify(c.input)).toThrow(c.err);
      else expect(hitungPajak(c.input, g.rates), JSON.stringify(c.input)).toEqual(c.ok);
    }
  });
  it('pesan error persis sama (bukan sekadar substring)', () => {
    for (const c of g.cases.filter((x) => x.err)) {
      try { hitungPajak(c.input, g.rates); } catch (e) { expect(e).toBeInstanceOf(RuleError); expect((e as Error).message).toBe(c.err); }
    }
  });
});

describe('golden: plafon, CFO, prefix', () => {
  it('plafon = grand total penuh pada 620 vektor (retensi 10% sistem lama SENGAJA dihapus, keputusan 2026-10-24)', () => {
    const g = golden<{ gt: unknown; qp: unknown; qs: unknown; out: number }[]>('plafon');
    let samaDenganLama = 0;
    for (const c of g) {
      const gt = num(c.gt);
      expect(hitungPlafonSJ(c.gt), JSON.stringify(c)).toBe(gt > 0 ? gt : 0);
      if (hitungPlafonSJ(c.gt) === c.out) samaDenganLama++;
      else expect(c.out, 'satu-satunya beda dari sistem lama = potongan retensi').toBe(Math.round(gt * 0.9));
    }
    expect(samaDenganLama).toBeGreaterThan(0);
  });
  it('butuhCFO identik (batas 5.000.000 inklusif)', () => {
    for (const c of golden<{ v: unknown; out: boolean }[]>('cfo')) expect(butuhCFO(Number(c.v ?? 0) || 0), JSON.stringify(c)).toBe(c.out);
    expect(butuhCFO(4_999_999)).toBe(false); expect(butuhCFO(5_000_000)).toBe(true);
  });
  it('cocok prefix PO (yang pertama menang, substring, case-insensitive)', () => {
    const g = golden<{ setting: unknown[][]; cases: { po: string; out: { company: string; brand: string } }[] }>('prefix');
    for (const c of g.cases) expect(cocokkanPrefix(g.setting.slice(1), c.po.toUpperCase()), c.po).toEqual(c.out);
  });
});

describe('hitungPajak: tambahan yang SENGAJA beda dari sistem lama', () => {
  const rates: PphRate[] = [{ jenis: 'PPh 23', tarifNPWP: 0.02, tarifNon: 0.04 }, { jenis: 'BAD', tarifNPWP: 2, tarifNon: 0.5 }, { jenis: 'NEG', tarifNPWP: -0.1, tarifNon: -0.1 }, { jenis: 'NAN', tarifNPWP: NaN, tarifNon: NaN }];
  it('tarif di luar 0..1 ditolak (lama: memotong 200%)', () => {
    expect(() => hitungPajak({ invAmount: 1000, jenisPPh: 'BAD', npwpVendor: '123' }, rates)).toThrow(/tidak valid/);
    expect(hitungPajak({ invAmount: 1000, jenisPPh: 'BAD', npwpVendor: '' }, rates).pphAmount).toBe(500); // tarif Non-NPWP 0.5 sah
    expect(() => hitungPajak({ invAmount: 1000, jenisPPh: 'NEG', npwpVendor: '1' }, rates)).toThrow(/tidak valid/);
    expect(() => hitungPajak({ invAmount: 1000, jenisPPh: 'NAN', npwpVendor: '1' }, rates)).toThrow(/tidak valid/);
  });
  it('Infinity ditolak', () => {
    expect(() => hitungPajak({ invAmount: Infinity }, rates)).toThrow(RuleError);
    expect(() => hitungPajak({ invAmount: 'Infinity' }, rates)).toThrow(RuleError);
  });
  it('aturan inti: diskon tidak mengurangi DPP/PPN; final dibulatkan terpisah', () => {
    const r = hitungPajak({ invAmount: 1_000_000, diskon: 100_000, statusPPN: 'Exclude PPN', jenisPPh: 'PPh 23', npwpVendor: 'x' }, rates);
    expect(r).toEqual({ dpp: 1_000_000, ppnAmount: 110_000, pphRate: 0.02, pphAmount: 20_000, finalAmount: 990_000 });
  });
});

describe('plafon PO & gate submit (keputusan 2026-10-12: PO tak ketemu / tak terbaca -> TOLAK)', () => {
  const found = (qtySJ: number, gt = 1_000_000, qtyPO = 10): PoLookup => ({ status: 'found', qtySJ, po: { poNumber: 'PO-1', companyName: 'C', statusPPN: 'Non PPN', subtotalPO: gt, grandTotalPO: gt, description: '', qtyPO, kodeVendor: 'V1' } });
  it('PO tak ketemu -> ditolak PO_NOT_FOUND', () => {
    const d = gatePoSubmit('po-x', { status: 'notFound' }, 0);
    expect(d).toMatchObject({ ok: false, code: 'PO_NOT_FOUND' });
  });
  it('DB_PO tak terbaca -> ditolak PO_UNREADABLE, pesannya "coba lagi" (bukan "tidak ditemukan")', () => {
    const d = gatePoSubmit('PO-1', { status: 'unreadable' }, 0);
    expect(d).toMatchObject({ ok: false, code: 'PO_UNREADABLE' });
    expect((d as { message: string }).message).toMatch(/coba lagi/i);
    expect((d as { message: string }).message).not.toMatch(/tidak ditemukan/i);
  });
  it('tanpa retensi: belum ada SJ pun boleh sampai grand total penuh, lewat satu rupiah = ditolak', () => {
    expect(gatePoSubmit('PO-1', found(0), 1_000_000)).toMatchObject({ ok: true, plafon: 1_000_000, sisaBoleh: 0 });
    const d = gatePoSubmit('PO-1', found(0), 1_000_001);
    expect(d).toMatchObject({ ok: false, code: 'OVER_CEILING' });
    expect((d as { message: string }).message).not.toMatch(/retensi/i);
  });
  it('plafon tidak bergantung jumlah barang di Surat Jalan', () => {
    for (const sj of [0, 5, 9, 10]) expect(gatePoSubmit('PO-1', found(sj), 1_000_000)).toMatchObject({ ok: true, plafon: 1_000_000 });
  });
  it('jasa (qtyPO=0) bebas penuh; grandTotal<=0 -> plafon 0', () => {
    expect(gatePoSubmit('PO-1', found(0, 500_000, 0), 500_000).ok).toBe(true);
    expect(cekPlafonPO({ poNumber: 'P', grandTotal: 0, totalDiajukan: 1 }).ok).toBe(false);
  });
  it('pesan pelanggaran memakai format sistem lama', () => {
    const r = cekPlafonPO({ poNumber: 'po-1', grandTotal: 1_000_000, totalDiajukan: 1_050_000 });
    expect(r.ok).toBe(false);
    expect((r as { message: string }).message).toMatch(/^Melebihi plafon P\.O "PO-1"\. Total yang diajukan atas PO ini \(Rp 1\.050\.000, termasuk dokumen ini\) melebihi plafon saat ini \(Rp 1\.000\.000\)\./);
  });
});

describe('builder master (paritas API_Master.gs)', () => {
  const U = (brand: string, dept: string, level: unknown, jab: string, nama: string, aktif: unknown = 'YES') => [brand, dept, level, jab, nama, `${nama}@x.id`, aktif];
  const rows = [
    U('heylocal', 'brand', 1, 'PIC', 'Cindy'), U('HEYLOCAL', 'BRAND', 1, 'PIC', 'Anto'), U('HEYLOCAL', 'BRAND', 1, 'PIC', 'Cindy'), U('HEYLOCAL', 'BRAND', 2, '', 'Mira'),
    U('HEYLOCAL', 'HCCA', 1, 'PIC', 'Rina'), U('ALL', 'ALL', 3, 'Fin', 'Dani'), U('HEYMALE', 'ALL', 4, 'x', 'Eko'), U('HEYMALE', 'OPS', 1, 'PIC', 'Gita', 'NO'),
    U('HEYMALE', 'OPS', 1, 'PIC', '-', 'YES'), U('', 'OPS', 1, 'PIC', 'Tanpa Brand'), U('HEYMALE', 'OPS', 'abc', 'PIC', 'Level Aneh'),
  ];
  const org = bangunOrg(rows, { HEYLOCAL: 'PT Hemas' });
  it('tree: dedupe PIC, urut, baris ALL/nonaktif/tanpa nama dilewati, level aneh -> 99', () => {
    expect(org.brands).toEqual(['HEYLOCAL', 'HEYMALE']);
    expect(Object.keys(org.tree.HEYLOCAL!)).toEqual(['BRAND', 'HCCA']);
    expect(org.tree.HEYLOCAL!.BRAND!.pics).toEqual(['Anto', 'Cindy']);
    expect(org.tree.HEYLOCAL!.BRAND!.levels['2']).toEqual([{ nama: 'Mira', jabatan: 'Staff' }]);
    expect(org.tree.HEYMALE!.OPS!.levels['99']).toEqual([{ nama: 'Level Aneh', jabatan: 'PIC' }]);
    expect(org.tree.HEYMALE!.OPS!.pics).toEqual([]);
  });
  it('TIDAK membocorkan email', () => { expect(JSON.stringify(org)).not.toMatch(/@x\.id|email/i); });
  it('opsi PIC + peringatan', () => {
    expect(picOptions(org, 'heylocal', 'brand')).toMatchObject({ adaManager: true, manager: 'Mira', peringatan: '' });
    expect(picOptions(org, 'HEYLOCAL', 'HCCA').peringatan).toMatch(/belum punya Manager/);
    expect(picOptions(org, 'X', 'Y').peringatan).toBe('Divisi tidak ditemukan.');
  });
  it('M8 F-04: Manager yang sama dengan pengaju dilewati; bila hanya dia, tidak ada manager', () => {
    expect(picOptions(org, 'HEYLOCAL', 'BRAND', 'mira ')).toMatchObject({ adaManager: false, manager: '' });
    expect(picOptions(org, 'HEYLOCAL', 'BRAND', 'mira ').peringatan).toMatch(/selain Anda sendiri/);
    expect(picOptions(org, 'HEYLOCAL', 'BRAND', 'Anto')).toMatchObject({ adaManager: true, manager: 'Mira' });
    const dua = bangunOrg([['A', 'D', 2, 'Mgr', 'Rani', 'r@x.id', 'YES', '', '', ''], ['A', 'D', 2, 'Mgr', 'Sari', 's@x.id', 'YES', '', '', ''], ['A', 'D', 1, 'PIC', 'Tia', 't@x.id', 'YES', '', '', '']], {});
    expect(picOptions(dua, 'A', 'D', 'Rani').manager).toBe('Sari');
    expect(picOptions(dua, 'A', 'D').manager).toBe('Rani');
  });
  it('kas: Level 3 penanda, akun terdalam, unik; nama "constructor" tidak bentrok', () => {
    const coa = bangunCoa([['ASET', 'LANCAR', 'KAS DAN SETARA KAS', 'BANK', 'BCA 123'], ['ASET', 'LANCAR', 'kas dan setara kas', 'BANK', 'BCA 123'],
      ['ASET', 'LANCAR', 'KAS DAN SETARA KAS', 'KAS KECIL', ''], ['ASET', 'LANCAR', 'KAS DAN SETARA KAS', '', ''], ['ASET', 'LANCAR', 'KAS DAN SETARA KAS', 'constructor', ''],
      ['BEBAN', 'X', 'Y', 'Z', 'W'], ['', 'a', 'b', 'c', 'd']]);
    expect(coa).toHaveLength(6);
    const kas = bangunKas(coa);
    expect(kas.map((k) => k.akun)).toEqual(['BCA 123', 'KAS KECIL', 'KAS DAN SETARA KAS', 'constructor']);
    expect(kas[1]).toMatchObject({ grup: 'KAS KECIL', lvl5: '-' });
  });
  it('kas: struktur COA SEKARANG (penanda di Level 2: ASET > KAS DAN SETARA KAS > BANK > akun)', () => {
    const coa = bangunCoa([['ASET', 'KAS DAN SETARA KAS', 'KAS KECIL', '-', '-'], ['ASET', 'KAS DAN SETARA KAS', 'BANK', 'BANK BCA - 1111111111 (X)', '-'],
      ['ASET', 'KAS DAN SETARA KAS', 'BANK', 'BANK BCA - 1111111111 (X)', '-'], ['ASET', 'KAS DAN SETARA KAS', 'E-WALLET', 'E-WALLET A', '-'],
      ['ASET', 'PIUTANG USAHA', 'KAS DAN SETARA KAS', 'X', '-'], ['ASET', 'PIUTANG USAHA', 'PIUTANG LAINNYA', '-', '-']]);
    const kas = bangunKas(coa);
    expect(kas.map((k) => k.akun)).toEqual(['KAS KECIL', 'BANK BCA - 1111111111 (X)', 'E-WALLET A', 'X']);
    expect(kas[0]).toMatchObject({ grup: 'KAS KECIL' });
    expect(kas[1]).toMatchObject({ grup: 'BANK', lvl2: 'KAS DAN SETARA KAS', lvl4: 'BANK BCA - 1111111111 (X)' });
  });
  it('PPh & vendor', () => {
    expect(bangunPph([['PPh 23', 0.02, 0.04], ['', 1, 1], ['PPh 21', 'abc', null]])).toEqual([{ jenis: 'PPh 23', tarifNPWP: 0.02, tarifNon: 0.04 }, { jenis: 'PPh 21', tarifNPWP: 0, tarifNon: 0 }]);
    const v = [['V1', 'Alfa', 'Trade', "'0123", 'BCA', 'Alfa PT', "'999", 'Approved'], ['V2', 'Beta', 'Trade', '', '', '', '', 'Pending'], ['V3', 'Gama', 'Non-Trade', '', '', '', '', 'APPROVED'], [null, null, null, null, null, null, null, null]];
    expect(cariVendor(v, 'v1')).toMatchObject({ kode: 'V1', npwp: '0123', noRekening: '999', status: 'Approved' });
    expect(cariVendor(v, '')).toBeNull();
    expect(cariVendor(v, 'V9')).toBeNull();
    expect(daftarVendor(v, 'trade').map((x) => x.kode)).toEqual(['V1']);
    expect(daftarVendor(v, 'Trade')[0]!.namaLengkap).toBe('[V1] Alfa');
  });
});
