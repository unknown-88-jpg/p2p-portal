'use client';
import { useMemo, useState } from 'react';
import { rupiah, type DokumenDto } from '@/domain/pengajuan-form';
import { KELOMPOK_STATUS, type KunciKelompok } from '@/domain/status-label';
import { Chips, StatusPill } from './kit';

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
        <Chips label="Filter status" kecil nilai={kel} onPilih={setKel}
          pilihan={KELOMPOK_STATUS.map((k) => ({ nilai: k.kunci, teks: `${k.label} (${hitung[k.kunci]})` }))} />
        <div className="cari"><input type="search" aria-label="Cari pengajuan" placeholder="Cari ID, vendor, invoice, P.O" value={q} onChange={(e) => setQ(e.target.value)} /></div>
      </div>
      {tampil.length === 0 ? (
        <div className="kosong" role="status">{data.length === 0 ? <><p>Belum ada pengajuan.</p><div className="cta-row cta-tengah"><a className="btn btn-primary" href="/pengajuan/baru">Buat pengajuan pertama</a></div></> : <p>Tidak ada pengajuan yang cocok dengan filter atau kata kunci.</p>}</div>
      ) : (
        <ul className="daftar">
          {tampil.map((d) => (
            <li key={d.id}>
              <a className="doc" href={href(d)}>
                <span className="id"><span>{d.id}</span> · <span>{d.tanggal}</span></span>
                <span className="kanan"><span className="nominal num">{rupiah(d.nominal)}</span><StatusPill status={d.status} /></span>
                <span className="vendor">{d.vendorNama || '—'}</span>
                <span className="desk">{[d.noInvoice, d.poNumber !== '-' ? d.poNumber : '', d.description].filter(Boolean).join(' · ')}</span>
              </a>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
