'use client';
import { useEffect, useState } from 'react';

type Mode = 'voucher' | 'invoice' | 'keduanya';
/**
 * Tombol cetak (paritas Print_Form lama: voucher / invoice / voucher + invoice). Invoice gambar dimuat sebagai blob lewat proxy ber-otorisasi
 * dan dicetak di halaman yang sama. PDF tidak bisa disematkan (CSP object-src 'none') -> dibuka di tab baru.
 */
export function VoucherAksi({ id, punyaLampiran }: { id: string; punyaLampiran: boolean }) {
  const [gambar, setGambar] = useState<string | null>(null);
  const [jenis, setJenis] = useState<'gambar' | 'pdf' | 'tidak' | 'gagal' | 'muat'>(punyaLampiran ? 'muat' : 'tidak');
  const url = `/api/pengajuan/${encodeURIComponent(id)}/lampiran`;

  useEffect(() => {
    if (!punyaLampiran) return;
    let u: string | null = null; let batal = false;
    fetch(url, { credentials: 'same-origin' }).then(async (r) => {
      if (!r.ok) { if (!batal) setJenis('gagal'); return; }
      const t = r.headers.get('content-type') ?? '';
      if (t.startsWith('image/')) { u = URL.createObjectURL(await r.blob()); if (!batal) { setGambar(u); setJenis('gambar'); } }
      else if (!batal) setJenis(t === 'application/pdf' ? 'pdf' : 'gagal');
    }).catch(() => { if (!batal) setJenis('gagal'); });
    return () => { batal = true; if (u) URL.revokeObjectURL(u); };
  }, [url, punyaLampiran]);

  const cetak = (m: Mode) => {
    document.body.dataset.cetak = m;
    const bersih = () => { delete document.body.dataset.cetak; window.removeEventListener('afterprint', bersih); };
    window.addEventListener('afterprint', bersih);
    window.print();
  };
  const bisaInv = jenis === 'gambar';
  return (
    <>
      <div className="vc-aksi no-print">
        <button className="btn btn-primary" onClick={() => cetak('voucher')}>Cetak voucher</button>
        <button className="btn btn-secondary" disabled={!bisaInv} onClick={() => cetak('invoice')}>Cetak invoice</button>
        <button className="btn btn-secondary" disabled={!bisaInv} onClick={() => cetak('keduanya')}>Voucher + invoice</button>
        {jenis === 'pdf' && <a className="btn btn-secondary" href={url} target="_blank" rel="noopener noreferrer">Buka invoice PDF</a>}
        <a className="link" href={`/pengajuan/${encodeURIComponent(id)}`}>← Kembali</a>
      </div>
      <p className="muted no-print">{jenis === 'muat' ? 'Memuat invoice…' : jenis === 'tidak' ? 'Dokumen ini tidak punya lampiran invoice.' : jenis === 'gagal' ? 'Invoice tidak dapat dimuat.' : jenis === 'pdf' ? 'Invoice berupa PDF: buka di tab baru, cetak dari sana.' : ''}</p>
      {gambar && <section className="vc-invoice"><img src={gambar} alt={`Invoice ${id}`} /></section>}
    </>
  );
}
