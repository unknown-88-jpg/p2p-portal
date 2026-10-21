'use client';
import { rupiah, tambahHari, type FormPengajuan, type Galat, type PreviewHitung } from '@/domain/pengajuan-form';
import { Chips, Field, Pesan, UangInput } from '../kit';
import { UnggahLampiranUI, type Staged } from './UnggahLampiranUI';
import type { DataPo } from './tipe';
import type { TahapUnggah } from '../unggah-lampiran';

export function LangkahTagihan({ form, ubah, galat, tandai, preview, po, onCekInvoice, cekInvoiceMemuat, lampiran }: {
  form: FormPengajuan; ubah: (p: Partial<FormPengajuan>) => void; galat: Galat; tandai: (k: string) => void; preview: PreviewHitung | null; po: DataPo | null;
  onCekInvoice: () => void; cekInvoiceMemuat: boolean;
  lampiran: { idTrx: string | null; punyaLampiran: boolean; staged: Staged | null; memproses: boolean; unggah: { tahap: TahapUnggah; bagian: number } | null; galat: string | null; onPilih: (f: File) => void; onHapus: () => void };
}) {
  const melebihiSisa = !!(po && preview && preview.finalAmount > po.sisaBolehTagih);
  return (
    <>
      <Field label="Nomor invoice" id="noInvoice" galat={galat.noInvoice} petunjuk={cekInvoiceMemuat ? 'Memeriksa duplikat…' : 'Persis seperti tertulis di invoice vendor.'}>
        {(p) => <input {...p} value={form.noInvoice} maxLength={60} autoComplete="off" onChange={(e) => ubah({ noInvoice: e.target.value })} onBlur={() => { tandai('noInvoice'); onCekInvoice(); }} />}
      </Field>

      <Chips label="Jenis pembayaran" nilai={form.jenisPembayaran as 'Full Payment' | 'DP' | 'Pelunasan' | ''} galat={galat.jenisPembayaran} onPilih={(jenisPembayaran) => ubah({ jenisPembayaran })}
        pilihan={[{ nilai: 'Full Payment', teks: 'Full Payment' }, { nilai: 'DP', teks: 'DP (uang muka)' }, { nilai: 'Pelunasan', teks: 'Pelunasan' }]} />

      <div className="grid2">
        <Field label="Tanggal invoice" id="dateInvoice" galat={galat.dateInvoice}>
          {(p) => <input {...p} type="date" value={form.dateInvoice} onChange={(e) => ubah({ dateInvoice: e.target.value })} onBlur={() => tandai('dateInvoice')} />}
        </Field>
        <Field label="Jatuh tempo" id="dueDate" galat={galat.dueDate}>
          {(p) => <input {...p} type="date" value={form.dueDate} min={form.dateInvoice || undefined} onChange={(e) => ubah({ dueDate: e.target.value })} onBlur={() => tandai('dueDate')} />}
        </Field>
      </div>
      {form.dateInvoice && !galat.dateInvoice && (
        <div className="chips tombol-baris" role="radiogroup" aria-label="Pintasan jatuh tempo">
          {[14, 30, 60].map((n) => (
            <button key={n} type="button" className="chip kecil" aria-checked={form.dueDate === tambahHari(form.dateInvoice, n)} role="radio" onClick={() => ubah({ dueDate: tambahHari(form.dateInvoice, n) })}>+{n} hari</button>
          ))}
        </div>
      )}

      <Field label="Nilai invoice" id="invoiceAmount" galat={galat.invoiceAmount} petunjuk={po ? `Sisa plafon P.O saat ini ${rupiah(po.sisaBolehTagih)}.` : undefined}>
        {(p) => <UangInput fp={p} nilai={form.invoiceAmount} onUbah={(v) => ubah({ invoiceAmount: v })} onBlur={() => tandai('invoiceAmount')} />}
      </Field>
      <div className="grid2">
        <Field label="Diskon" id="diskon" opsional galat={galat.diskon}>
          {(p) => <UangInput fp={p} nilai={form.diskon} onUbah={(v) => ubah({ diskon: v })} onBlur={() => tandai('diskon')} />}
        </Field>
        <Field label="Biaya lainnya" id="biayaLainnya" opsional galat={galat.biayaLainnya}>
          {(p) => <UangInput fp={p} nilai={form.biayaLainnya} onUbah={(v) => ubah({ biayaLainnya: v })} onBlur={() => tandai('biayaLainnya')} />}
        </Field>
      </div>
      <Chips label="Status PPN" nilai={form.statusPPN as 'Non PPN' | 'Include PPN' | 'Exclude PPN' | ''} galat={galat.statusPPN} onPilih={(statusPPN) => ubah({ statusPPN })}
        pilihan={[{ nilai: 'Non PPN', teks: 'Non PPN' }, { nilai: 'Include PPN', teks: 'Include PPN' }, { nilai: 'Exclude PPN', teks: 'Exclude PPN' }]} />

      {preview && (
        <div className="kartu parchment hitung" aria-live="polite">
          <div className="kartu-h">Perkiraan hitungan</div>
          <dl className="kv">
            <div><dt>DPP</dt><dd className="num">{rupiah(preview.dpp)}</dd></div>
            <div><dt>PPN 11%</dt><dd className="num">{rupiah(preview.ppnAmount)}</dd></div>
            <div><dt>Nominal akhir</dt><dd className="num">{rupiah(preview.finalAmount)}</dd></div>
          </dl>
          {preview.perluCFO && <div className="cfo-baris"><span className="badge-cfo">Butuh TTD CFO</span><span className="hint">Nominal mulai Rp 5.000.000 memerlukan persetujuan CFO.</span></div>}
          <p className="hint">PPh ditentukan Finance saat verifikasi pajak. Angka final dihitung ulang oleh server saat disimpan.</p>
        </div>
      )}
      {melebihiSisa && <Pesan jenis="warn">Nominal akhir ({rupiah(preview!.finalAmount)}) melebihi sisa plafon P.O ({rupiah(po!.sisaBolehTagih)}). Server akan menolak saat diajukan, kecuali plafon berubah.</Pesan>}

      <UnggahLampiranUI idTrx={lampiran.idTrx} punyaLampiran={lampiran.punyaLampiran} staged={lampiran.staged} memproses={lampiran.memproses} unggah={lampiran.unggah} galat={lampiran.galat ?? galat.lampiran ?? null} onPilih={lampiran.onPilih} onHapus={lampiran.onHapus} />
    </>
  );
}
