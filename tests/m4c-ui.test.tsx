import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { formKosong } from '@/domain/pengajuan-form';
import type { DokumenDto } from '@/domain/pengajuan-form';
import { AppNav } from '@/ui/AppNav';
import { DaftarPengajuan } from '@/ui/DaftarPengajuan';
import { Chips, Dialog, Field, Pesan, StatusPill, UangInput } from '@/ui/kit';
import { PengajuanWizard } from '@/ui/wizard/PengajuanWizard';

const roles = [{ level: 1, brand: 'ALL', dept: 'ALL' }] as never;
const dok = (o: Partial<DokumenDto>): DokumenDto => ({
  id: 'TRX-1', tanggal: '2026-10-01', company: 'PT A', brand: 'B', departement: 'D', tipe: 'Non-Trade', pic: 'x', description: 'Sewa', eventProject: '-', notesUser: '',
  poNumber: '-', vendorKode: 'V1', vendorNama: 'Vendor Satu', noInvoice: 'INV-1', dateInvoice: '2026-10-01', dueDate: '2026-10-15', jenisPembayaran: 'Full', invoiceAmount: 1000,
  diskon: 0, biayaLainnya: 0, statusPPN: 'Non PPN', dpp: 1000, ppnAmount: 0, nominal: 1000, status: 'Draft', notesFinance: '', perluCFO: false, qtyPO: 0, qtySJ: 0,
  punyaLampiran: false, editable: true, submittable: true, ...o,
} as DokumenDto);

describe('M4c UI (SSR smoke)', () => {
  it('wizard baru: langkah 1, stepper, tanpa style inline (CSP)', () => {
    const html = renderToStaticMarkup(<PengajuanWizard roles={roles} email="a@b.c" nama="Citra" />);
    expect(html).toContain('Langkah 1 dari 5');
    expect(html).toContain('Jenis');
    expect(html).not.toMatch(/\sstyle="/);
  });
  it('wizard edit revisi: tampil banner catatan Finance & judul Ubah', () => {
    const html = renderToStaticMarkup(<PengajuanWizard roles={roles} email="a@b.c" nama="Citra" awal={dok({ status: 'Revision Needed', notesFinance: 'Invoice buram' })} />);
    expect(html).toContain('Invoice buram');
    expect(html).toContain('Ubah TRX-1');
  });
  it('daftar: kosong, dan teks dokumen di-escape', () => {
    expect(renderToStaticMarkup(<DaftarPengajuan data={[]} />)).toContain('Belum ada pengajuan');
    const h = renderToStaticMarkup(<DaftarPengajuan data={[dok({ vendorNama: '<script>alert(1)</script>' })]} />);
    expect(h).not.toContain('<script>');
    expect(h).toContain('/pengajuan/TRX-1/edit');
  });
  it('daftar: dokumen tak bisa diedit menaut ke detail', () => {
    expect(renderToStaticMarkup(<DaftarPengajuan data={[dok({ status: 'Submitted', editable: false })]} />)).toContain('href="/pengajuan/TRX-1"');
  });
  it('nav: menu Ajukan hanya untuk yang berhak', () => {
    expect(renderToStaticMarkup(<AppNav nama="X" bisaAjukan aktif="baru" />)).toContain('/pengajuan/baru');
    expect(renderToStaticMarkup(<AppNav nama="X" bisaAjukan={false} />)).not.toContain('/pengajuan/baru');
  });
  it('kit: field galat memberi aria-invalid & describedby; status pill', () => {
    const h = renderToStaticMarkup(<Field label="Nama" galat="Wajib"  id="n">{(p) => <input {...p} />}</Field>);
    expect(h).toContain('aria-invalid="true"'); expect(h).toContain('aria-describedby="n-err"'); expect(h).toContain('role="alert"');
    expect(renderToStaticMarkup(<StatusPill status="Submitted" />)).toContain('Menunggu Manager');
    expect(renderToStaticMarkup(<Pesan jenis="err">x</Pesan>)).toContain('role="alert"');
    expect(renderToStaticMarkup(<Chips label="L" nilai="a" pilihan={[{ nilai: 'a', teks: 'A' }, { nilai: 'b', teks: 'B' }]} onPilih={() => {}} />)).toContain('role="radiogroup"');
    expect(renderToStaticMarkup(<UangInput nilai="1.000" onUbah={() => {}} fp={{ id: 'u' }} />)).toContain('value="1.000"');
    expect(renderToStaticMarkup(<Dialog buka={false} onTutup={() => {}} judul="J">c</Dialog>)).toContain('aria-labelledby');
  });
  it('formKosong dipakai wizard: tidak ada nilai awal sembarang', () => { expect(formKosong().tipe).toBe(''); });
});
