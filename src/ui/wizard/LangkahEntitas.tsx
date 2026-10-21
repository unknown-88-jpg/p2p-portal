'use client';
import type { Galat, FormPengajuan } from '@/domain/pengajuan-form';
import type { PicOptions } from '@/domain/master';
import { Field, Pesan, Skeleton } from '../kit';
import type { Muat, Org } from './tipe';

export function LangkahEntitas({ form, ubah, galat, org, brands, depts, pic, company, namaPengaju, onCobaLagiOrg }: {
  form: FormPengajuan; ubah: (p: Partial<FormPengajuan>) => void; galat: Galat; org: Muat<Org>; brands: string[]; depts: string[];
  pic: PicOptions | null; company: string; namaPengaju: string; onCobaLagiOrg: () => void;
}) {
  if (org.status === 'memuat' || org.status === 'idle') return <Skeleton baris={3} />;
  if (org.status === 'galat') return <Pesan jenis="err">{org.galat}<button type="button" className="link" onClick={onCobaLagiOrg}>Coba lagi</button></Pesan>;
  if (!brands.length) return <Pesan jenis="warn">Akun Anda belum terdaftar sebagai pengaju (Level 1) di brand/departemen mana pun. Hubungi admin.</Pesan>;
  return (
    <>
      <div className="grid2">
        <Field label="Brand" id="brand" galat={galat.brand}>
          {(p) => (
            <select {...p} value={form.brand} onChange={(e) => ubah({ brand: e.target.value, departement: '' })}>
              <option value="">Pilih brand…</option>
              {brands.map((b) => <option key={b} value={b}>{b}</option>)}
            </select>
          )}
        </Field>
        <Field label="Departemen" id="departement" galat={galat.departement}>
          {(p) => (
            <select {...p} value={form.departement} disabled={!form.brand} onChange={(e) => ubah({ departement: e.target.value })}>
              <option value="">{form.brand ? 'Pilih departemen…' : 'Pilih brand dulu'}</option>
              {depts.map((d) => <option key={d} value={d}>{d}</option>)}
            </select>
          )}
        </Field>
      </div>

      {form.brand && form.departement && (
        <div className="kartu parchment info-divisi">
          <dl className="kv">
            <div><dt>Perusahaan</dt><dd>{company || '-'}</dd></div>
            <div><dt>Pengaju</dt><dd>{namaPengaju}</dd></div>
            <div><dt>Akan disetujui oleh</dt><dd>{pic?.adaManager ? pic.manager : '—'}</dd></div>
          </dl>
        </div>
      )}
      {galat.manager && <Pesan jenis={pic && !pic.adaManager ? 'err' : 'info'}>{galat.manager}</Pesan>}

      <Field label="Keperluan / deskripsi" id="description" galat={galat.description} petunjuk="Jelaskan singkat untuk apa pembayaran ini.">
        {(p) => <textarea {...p} value={form.description} maxLength={500} onChange={(e) => ubah({ description: e.target.value })} placeholder="mis. Cetak banner event peluncuran produk" />}
      </Field>
      <div className="grid2">
        <Field label="Event / project" id="eventProject" opsional>
          {(p) => <input {...p} value={form.eventProject} maxLength={200} autoComplete="off" onChange={(e) => ubah({ eventProject: e.target.value })} />}
        </Field>
        <Field label="Catatan untuk approver" id="notesUser" opsional>
          {(p) => <input {...p} value={form.notesUser} maxLength={1000} autoComplete="off" onChange={(e) => ubah({ notesUser: e.target.value })} />}
        </Field>
      </div>
    </>
  );
}
