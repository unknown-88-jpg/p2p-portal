'use client';
import { angka, rupiah, samarkanRekening, type FormPengajuan, type Langkah, type PreviewHitung } from '@/domain/pengajuan-form';
import { Pesan } from '../kit';
import { KartuPo } from './KartuPo';
import type { DataPo, Muat } from './tipe';

interface VendorRingkas { kode: string; nama: string; bank: string; namaRekening: string; noRekening: string; npwp: string }

function Kartu({ judul, onUbah, children }: { judul: string; onUbah?: () => void; children: React.ReactNode }) {
  return (
    <div className="kartu">
      <div className="kartu-judul"><span className="kartu-h">{judul}</span>{onUbah && <button type="button" className="link" onClick={onUbah}>Ubah</button>}</div>
      {children}
    </div>
  );
}

export function LangkahTinjau({ form, company, namaPengaju, manager, vendor, preview, nominalServer, idTrx, punyaLampiran, stagedNama, po, poLagi, peringatan, onUbah }: {
  form: FormPengajuan; company: string; namaPengaju: string; manager: string; vendor: VendorRingkas | null; preview: PreviewHitung | null; nominalServer: number | null;
  idTrx: string | null; punyaLampiran: boolean; stagedNama: string | null; po: DataPo | null; poLagi: Muat<DataPo>; peringatan: { barang: string | null; plafon: string | null };
  onUbah: (l: Langkah) => void;
}) {
  const nominal = nominalServer ?? preview?.finalAmount ?? 0;
  return (
    <>
      {poLagi.status === 'memuat' && <Pesan jenis="info" role="status">Memeriksa ulang data P.O…</Pesan>}
      {poLagi.status === 'galat' && <Pesan jenis="warn">Data P.O belum bisa diperbarui ({poLagi.galat}). Server akan memeriksanya lagi saat Anda mengajukan.</Pesan>}
      {peringatan.plafon && <Pesan jenis="err">{peringatan.plafon}</Pesan>}
      {peringatan.barang && <Pesan jenis="info">{peringatan.barang}</Pesan>}

      <div className="kartu hero-nominal">
        <div className="cap muted">Nominal akhir</div>
        <div className="angka-besar num">{rupiah(nominal)}</div>
        {preview?.perluCFO && <div className="cfo-baris"><span className="badge-cfo">Butuh TTD CFO</span></div>}
        <div className="cap muted pt-kecil">{vendor?.nama ?? '-'} · {form.noInvoice}</div>
      </div>

      <Kartu judul="Dokumen" onUbah={() => onUbah('jenis')}>
        <dl className="kv">
          <div><dt>Jenis</dt><dd>{form.tipe}</dd></div>
          {form.tipe === 'Trade' && <div><dt>No. P.O</dt><dd>{form.poNumber.toUpperCase()}</dd></div>}
          <div><dt>Perusahaan</dt><dd>{company || '-'}</dd></div>
          <div><dt>Brand / departemen</dt><dd>{form.brand} / {form.departement}</dd></div>
          <div><dt>Pengaju</dt><dd>{namaPengaju}</dd></div>
          <div><dt>Akan disetujui oleh</dt><dd>{manager || '—'}</dd></div>
          <div><dt>Keperluan</dt><dd>{form.description}</dd></div>
          {form.eventProject && <div><dt>Event / project</dt><dd>{form.eventProject}</dd></div>}
          {form.notesUser && <div><dt>Catatan</dt><dd>{form.notesUser}</dd></div>}
        </dl>
      </Kartu>

      {vendor && (
        <Kartu judul="Vendor" onUbah={form.tipe === 'Trade' ? undefined : () => onUbah('vendor')}>
          <dl className="kv">
            <div><dt>Nama</dt><dd>{vendor.nama} <span className="muted">({vendor.kode})</span></dd></div>
            <div><dt>Bank</dt><dd>{vendor.bank || '-'}</dd></div>
            <div><dt>Nama rekening</dt><dd>{vendor.namaRekening || '-'}</dd></div>
            <div><dt>No. rekening</dt><dd className="num">{samarkanRekening(vendor.noRekening)}</dd></div>
          </dl>
        </Kartu>
      )}

      <Kartu judul="Tagihan" onUbah={() => onUbah('tagihan')}>
        <dl className="kv">
          <div><dt>No. invoice</dt><dd>{form.noInvoice}</dd></div>
          <div><dt>Tanggal invoice</dt><dd>{form.dateInvoice}</dd></div>
          <div><dt>Jatuh tempo</dt><dd>{form.dueDate}</dd></div>
          <div><dt>Jenis pembayaran</dt><dd>{form.jenisPembayaran}</dd></div>
          <div><dt>Nilai invoice</dt><dd className="num">{rupiah(angka(form.invoiceAmount))}</dd></div>
          {angka(form.diskon) > 0 && <div><dt>Diskon</dt><dd className="num">-{rupiah(angka(form.diskon))}</dd></div>}
          {angka(form.biayaLainnya) > 0 && <div><dt>Biaya lainnya</dt><dd className="num">{rupiah(angka(form.biayaLainnya))}</dd></div>}
          <div><dt>Status PPN</dt><dd>{form.statusPPN}</dd></div>
          {preview && <div><dt>DPP</dt><dd className="num">{rupiah(preview.dpp)}</dd></div>}
          {preview && <div><dt>PPN</dt><dd className="num">{rupiah(preview.ppnAmount)}</dd></div>}
          <div><dt>Nominal akhir</dt><dd className="num">{rupiah(nominal)}</dd></div>
        </dl>
        <p className="hint">PPh ditentukan Finance saat verifikasi pajak.</p>
      </Kartu>

      <Kartu judul="Lampiran" onUbah={() => onUbah('tagihan')}>
        {punyaLampiran && idTrx
          ? <p>Lampiran tersimpan. <a href={`/api/pengajuan/${encodeURIComponent(idTrx)}/lampiran`} target="_blank" rel="noopener noreferrer">Lihat</a></p>
          : <p>{stagedNama ?? 'Belum ada lampiran'}</p>}
      </Kartu>

      {po && form.tipe === 'Trade' && <KartuPo po={po} nominalIni={nominal} judul="Plafon P.O setelah pengajuan ini" />}
    </>
  );
}
