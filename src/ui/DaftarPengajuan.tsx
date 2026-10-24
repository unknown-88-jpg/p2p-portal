'use client';
import { useMemo, useState } from 'react';
import { rupiah, type DokumenDto } from '@/domain/pengajuan-form';
import { KELOMPOK_STATUS, type KunciKelompok } from '@/domain/status-label';
import { Chips, StatusPill } from './kit';

// Warna filter selaras dengan kartu statistik beranda (merah = perlu tindakan, biru = diproses, hijau = selesai).
const NADA = { semua: 'netral', 'perlu-tindakan': 'merah', diproses: 'biru', selesai: 'hijau' } as const satisfies Record<KunciKelompok, 'netral' | 'merah' | 'biru' | 'hijau'>;

const href = (d: DokumenDto): string => (d.editable ? `/pengajuan/${encodeURIComponent(d.id)}/edit` : `/pengajuan/${encodeURIComponent(d.id)}`);

export function DaftarPengajuan({ data, kelompokAwal = 'semua' }: { data: DokumenDto[]; kelompokAwal?: KunciKelompok }) {
  const [kel, setKel] = useState<KunciKelompok>(kelompokAwal);
  const [q, setQ] = useState('');
  const hitung = useMemo(() => Object.fromEntries(KELOMPOK_STATUS.map((k) => [k.kunci, data.filter((d) => k.cocok(d.status)).length])), [data]);
  const tampil = useMemo(() => {
    const k = KELOMPOK_STATUS.find((x) => x.kunci === kel)!;
    const t = q.trim().toLowerCase();
    return data.filter((d) => k.cocok(d.status) && (!t || [d.id, d.vendorNama, d.noInvoice, d.poNumber, d.description].some((s) => s.toLowerCase().includes(t))));
  }, [data, kel, q]);
  return (
    <>
      <div className="toolbar">
        <Chips label="Filter status" labelTersembunyi kecil segmen nilai={kel} onPilih={setKel}
          pilihan={KELOMPOK_STATUS.map((k) => ({ nilai: k.kunci, teks: k.label, nada: NADA[k.kunci], jumlah: hitung[k.kunci] ?? 0 }))} />
        <div className="cari"><input type="search" aria-label="Cari pengajuan" placeholder="Cari ID, vendor, invoice, P.O" value={q} onChange={(e) => setQ(e.target.value)} /></div>
      </div>
      {tampil.length === 0 ? (
        <div className="kosong" role="status">{data.length === 0 ? <><p>Belum ada pengajuan.</p><div className="cta-row cta-tengah"><a className="btn btn-primary" href="/pengajuan/baru">Buat pengajuan pertama</a></div></> : <p>Tidak ada pengajuan yang cocok dengan filter atau kata kunci.</p>}</div>
      ) : (
        <div className="daftar-wrap">
        {/* Kepala kolom hanya tampilan (layar lebar); tiap baris tetap membawa label <dt> sendiri untuk pembaca layar. */}
        <div className="daftar-head" aria-hidden="true"><span>Vendor</span><span>ID</span><span>Tanggal</span><span>Referensi</span><span>Status</span><span className="kanan">Nominal</span></div>
        <ul className="daftar">
          {tampil.map((d) => (
            <li key={d.id}>
              <a className="dok" href={href(d)}>
                <div className="dok-h">
                  <span className="dok-v">{d.vendorNama || '—'}</span>
                  <span className="dok-id num">{d.id}</span>
                  <span className="dok-st"><StatusPill status={d.status} /></span>
                </div>
                <dl className="dok-b">
                  <div><dt>Tanggal</dt><dd className="num">{d.tanggal}</dd></div>
                  <div className="dok-ref"><dt>Referensi</dt><dd>{[d.noInvoice, d.poNumber !== '-' ? d.poNumber : '', d.description].filter(Boolean).join(' · ') || '—'}</dd></div>
                  <div className="dok-n"><dt>Nominal</dt><dd className="num">{rupiah(d.nominal)}</dd></div>
                </dl>
              </a>
            </li>
          ))}
        </ul>
        </div>
      )}
    </>
  );
}
