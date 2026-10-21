'use client';
import type { Galat, FormPengajuan } from '@/domain/pengajuan-form';
import { Chips, Field, Pesan } from '../kit';
import { KartuPo } from './KartuPo';
import type { DataPo, Muat } from './tipe';

export function LangkahJenis({ form, ubah, galat, po, onTarikPo }: {
  form: FormPengajuan; ubah: (p: Partial<FormPengajuan>) => void; galat: Galat; po: Muat<DataPo>; onTarikPo: () => void;
}) {
  return (
    <>
      <Chips label="Jenis pengajuan" besar nilai={form.tipe} galat={galat.tipe} onPilih={(tipe) => ubah({ tipe })}
        pilihan={[
          { nilai: 'Trade', teks: 'Trade', deskripsi: 'Pembelian berdasarkan P.O. Vendor dan plafon mengikuti P.O.' },
          { nilai: 'Non-Trade', teks: 'Non-Trade', deskripsi: 'Biaya operasional atau jasa tanpa P.O.' },
        ]} />

      {form.tipe === 'Trade' && (
        <>
          <Field label="Nomor P.O" id="poNumber" galat={galat.poNumber} petunjuk="Ketik nomor P.O lalu tarik datanya. Vendor akan terisi otomatis dari P.O.">
            {(p) => (
              <div className="po-baris">
                <input {...p} value={form.poNumber} autoComplete="off" autoCapitalize="characters" spellCheck={false} placeholder="mis. PO/2026/10/0001"
                  onChange={(e) => ubah({ poNumber: e.target.value })}
                  onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); onTarikPo(); } }} />
                <button type="button" className="btn btn-secondary" onClick={onTarikPo} disabled={!form.poNumber.trim() || po.status === 'memuat'}>
                  {po.status === 'memuat' ? 'Menarik…' : 'Tarik data P.O'}
                </button>
              </div>
            )}
          </Field>
          {po.status === 'galat' && po.galat && (
            <Pesan jenis="err">{po.galat}<button type="button" className="link" onClick={onTarikPo}>Coba lagi</button></Pesan>
          )}
          {po.status === 'memuat' && <div className="skel baris" aria-busy="true" aria-label="Memuat data P.O" />}
          {po.status === 'siap' && po.data && <div className="kartu-wrap"><KartuPo po={po.data} /></div>}
        </>
      )}
      {form.tipe === 'Non-Trade' && <p className="hint pt">Pengajuan Non-Trade tidak memakai P.O. Lanjut untuk mengisi entitas dan keperluan.</p>}
    </>
  );
}
