'use client';
import { useMemo, useState } from 'react';
import { samarkanRekening, type Galat, type FormPengajuan } from '@/domain/pengajuan-form';
import { Field, Pesan, Skeleton } from '../kit';
import type { DataPo, Muat, VendorOpsi } from './tipe';

export function KartuVendor({ v }: { v: { kode: string; nama: string; npwp: string; bank: string; namaRekening: string; noRekening: string } }) {
  return (
    <div className="kartu parchment">
      <div className="kartu-h">Vendor terpilih</div>
      <dl className="kv">
        <div><dt>Nama</dt><dd>{v.nama} <span className="muted">({v.kode})</span></dd></div>
        <div><dt>Bank</dt><dd>{v.bank || '-'}</dd></div>
        <div><dt>Nama rekening</dt><dd>{v.namaRekening || '-'}</dd></div>
        <div><dt>No. rekening</dt><dd className="num">{samarkanRekening(v.noRekening)}</dd></div>
        <div><dt>NPWP</dt><dd className="num">{v.npwp && v.npwp !== '-' ? v.npwp : 'Tidak ada'}</dd></div>
      </dl>
      <p className="hint">Nomor rekening disamarkan di layar; data lengkap tersimpan di pengajuan dan dipakai Finance saat pembayaran.</p>
    </div>
  );
}

export function LangkahVendor({ form, ubah, galat, vendors, po, onCobaLagi }: {
  form: FormPengajuan; ubah: (p: Partial<FormPengajuan>) => void; galat: Galat; vendors: Muat<VendorOpsi[]>; po: Muat<DataPo>; onCobaLagi: () => void;
}) {
  const [q, setQ] = useState('');
  const daftar = useMemo(() => {
    const t = q.trim().toLowerCase();
    const semua = vendors.data ?? [];
    return (t ? semua.filter((v) => v.namaLengkap.toLowerCase().includes(t)) : semua).slice(0, 60);
  }, [vendors.data, q]);

  if (form.tipe === 'Trade') {
    const v = po.data?.vendor;
    return (
      <>
        {v ? <KartuVendor v={v} /> : <Pesan jenis="warn">Tarik data P.O di langkah pertama dulu — vendor mengikuti P.O.</Pesan>}
        <p className="hint pt">Pada pengajuan Trade, vendor ditentukan oleh P.O dan tidak bisa diganti di sini.</p>
        {galat.vendorKode && <Pesan jenis="err">{galat.vendorKode}</Pesan>}
      </>
    );
  }
  if (vendors.status === 'memuat' || vendors.status === 'idle') return <Skeleton baris={4} />;
  if (vendors.status === 'galat') return <Pesan jenis="err">{vendors.galat}<button type="button" className="link" onClick={onCobaLagi}>Coba lagi</button></Pesan>;
  const terpilih = (vendors.data ?? []).find((v) => v.kode === form.vendorKode);
  return (
    <>
      {terpilih && <KartuVendor v={{ ...terpilih, nama: terpilih.namaAsli }} />}
      <Field label={terpilih ? 'Ganti vendor' : 'Cari vendor'} id="cariVendor" galat={galat.vendorKode} petunjuk={<>Hanya vendor yang sudah disahkan Finance. Ketik sebagian nama atau kode. Belum terdaftar? <a className="link" href="/vendor" target="_blank" rel="noopener">Daftarkan vendor baru</a>.</>}>
        {(p) => <input {...p} type="search" value={q} autoComplete="off" placeholder="mis. Gama" onChange={(e) => setQ(e.target.value)} />}
      </Field>
      <div className="pilihan" role="listbox" aria-label="Daftar vendor">
        {daftar.length === 0
          ? <div className="kosong">{(vendors.data ?? []).length === 0 ? 'Belum ada vendor Non-Trade yang disahkan.' : 'Tidak ada vendor yang cocok.'}</div>
          : daftar.map((v) => (
            <button key={v.kode} type="button" role="option" aria-selected={v.kode === form.vendorKode} onClick={() => { ubah({ vendorKode: v.kode }); setQ(''); }}>
              <span className="kode">{v.kode}</span>{v.namaAsli}
            </button>
          ))}
      </div>
    </>
  );
}
