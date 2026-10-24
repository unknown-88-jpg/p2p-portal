'use client';
import { catatanTampil } from '@/domain/approval';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { RuleError } from '@/domain/errors';
import { validasiUnggahan } from '@/domain/lampiran';
import { picOptions } from '@/domain/master';
import {
  angka, bacaDrafLokal, bisaSimpanDraft, brandBoleh, cekPoUntukTrade, dariDokumen, deptBoleh, formAdaIsi, formKosong, JUDUL_LANGKAH, keInputServer,
  LANGKAH, langkahBermasalah, peringatanBarang, pilihKunci, previewHitung, rupiah, serialDrafLokal, sidikJari, validasiLangkah,
  type DokumenDto, type FormPengajuan, type Galat, type KonteksValidasi, type KunciIdem, type Langkah,
} from '@/domain/pengajuan-form';
import type { Role } from '@/domain/roles';
import { labelStatus } from '@/domain/status-label';
import { api, errMessage, isApiError } from '../api';
import { Dialog, Pesan, Toast, type IsiToast } from '../kit';
import { kompresGambar } from '../kompres-gambar';
import { putKeDrive } from '../put-drive';
import { GalatUnggah, unggahLampiran, type TahapUnggah } from '../unggah-lampiran';
import { LangkahEntitas } from './LangkahEntitas';
import { LangkahJenis } from './LangkahJenis';
import { LangkahTagihan } from './LangkahTagihan';
import { LangkahTinjau } from './LangkahTinjau';
import { LangkahVendor } from './LangkahVendor';
import type { Staged } from './UnggahLampiranUI';
import type { DataPo, HasilAjukan, HasilSimpan, Muat, Org, VendorOpsi } from './tipe';

const kosong = <T,>(): Muat<T> => ({ status: 'idle', data: null, galat: null });
const upper = (s: string): string => s.trim().toUpperCase();
const uuid = (): string => {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  const b = new Uint8Array(16); crypto.getRandomValues(b);
  return Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
};
const tunggu = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
const kunciLokal = (email: string): string => `p2p.wiz.v1:${email.toLowerCase()}`;
const bacaLokal = (k: string) => { try { return bacaDrafLokal(sessionStorage.getItem(k)); } catch { return null; } };
const tulisLokal = (k: string, v: string | null) => { try { if (v === null) sessionStorage.removeItem(k); else sessionStorage.setItem(k, v); } catch { /* sessionStorage bisa tak tersedia: draf lokal hanya penyelamat */ } };

export interface WizardProps { roles: Role[]; email: string; nama: string; awal?: DokumenDto }

export function PengajuanWizard({ roles, email, nama, awal }: WizardProps) {
  const awalForm = useMemo(() => (awal ? dariDokumen(awal) : formKosong()), [awal]);
  const [form, setForm] = useState<FormPengajuan>(awalForm);
  const [langkah, setLangkah] = useState<Langkah>(awal ? (awal.punyaLampiran ? 'tinjau' : 'tagihan') : 'jenis');
  const [idTrx, setIdTrx] = useState<string | null>(awal?.id ?? null);
  const [punyaLampiran, setPunyaLampiran] = useState(!!awal?.punyaLampiran);
  const [nominalServer, setNominalServer] = useState<number | null>(awal ? awal.nominal : null);

  const [org, setOrg] = useState<Muat<Org>>(kosong());
  const [vendors, setVendors] = useState<Muat<VendorOpsi[]>>(kosong());
  const [po, setPo] = useState<Muat<DataPo>>(kosong());
  const [poLagi, setPoLagi] = useState<Muat<DataPo>>(kosong());
  const [dup, setDup] = useState<{ kunci: string; pesan: string | null } | null>(null);
  const [dupMemuat, setDupMemuat] = useState(false);

  const [staged, setStaged] = useState<Staged | null>(null);
  const [memproses, setMemproses] = useState(false);
  const [unggah, setUnggah] = useState<{ tahap: TahapUnggah; bagian: number } | null>(null);
  const [galatUnggah, setGalatUnggah] = useState<string | null>(null);

  const [busy, setBusy] = useState<null | 'simpan' | 'ajukan'>(null);
  const [galatServer, setGalatServer] = useState<string | null>(null);
  const [infoSimpan, setInfoSimpan] = useState<string | null>(null);
  const toastSimpan = useMemo<IsiToast | null>(() => (infoSimpan ? { jenis: infoSimpan.startsWith('Draft ') ? 'ok' : 'warn', teks: infoSimpan } : null), [infoSimpan]);
  const [touched, setTouched] = useState<ReadonlySet<string>>(new Set());
  const [dicoba, setDicoba] = useState<ReadonlySet<Langkah>>(new Set());
  const [konfirmasi, setKonfirmasi] = useState(false);
  const [galatAjukan, setGalatAjukan] = useState<string | null>(null);
  const [sukses, setSukses] = useState<HasilAjukan | null>(null);
  const [pulih, setPulih] = useState<ReturnType<typeof bacaDrafLokal>>(null);

  const formRef = useRef(form); formRef.current = form;
  const idRef = useRef(idTrx); idRef.current = idTrx;
  const stagedRef = useRef(staged); stagedRef.current = staged;
  const savedSidik = useRef<string | null>(null);
  const kunciBuat = useRef<KunciIdem | null>(null);
  const kunciAjukan = useRef<string | null>(null);
  const antrean = useRef<Promise<unknown>>(Promise.resolve());
  const dupSeq = useRef(0);
  const judulRef = useRef<HTMLHeadingElement>(null);
  const sudahMount = useRef(false);
  const lk = kunciLokal(email);

  // ---------------------------------------------------------------- memuat data referensi
  const muatOrg = useCallback(async () => {
    setOrg((m) => ({ ...m, status: 'memuat', galat: null }));
    try { setOrg({ status: 'siap', data: (await api<{ org: Org }>('/api/master/org', { method: 'GET' })).org, galat: null }); }
    catch (e) { setOrg({ status: 'galat', data: null, galat: errMessage(e) }); }
  }, []);
  useEffect(() => { void muatOrg(); }, [muatOrg]);

  const muatVendors = useCallback(async () => {
    setVendors((m) => ({ ...m, status: 'memuat', galat: null }));
    try { setVendors({ status: 'siap', data: (await api<{ vendors: VendorOpsi[] }>('/api/master/vendors?tipe=Non-Trade', { method: 'GET' })).vendors, galat: null }); }
    catch (e) { setVendors({ status: 'galat', data: null, galat: errMessage(e) }); }
  }, []);
  useEffect(() => { if (form.tipe === 'Non-Trade' && vendors.status === 'idle') void muatVendors(); }, [form.tipe, vendors.status, muatVendors]);

  /** Tarik data P.O. `lagi` = pemeriksaan ulang senyap di layar tinjau (tidak mengubah isian). */
  const tarikPo = useCallback(async (nomor: string, lagi = false) => {
    const set = lagi ? setPoLagi : setPo;
    set((m) => ({ ...m, status: 'memuat', galat: null }));
    try {
      const qs = idRef.current ? `?excludeIdTrx=${encodeURIComponent(idRef.current)}` : '';
      const data = (await api<{ po: DataPo }>(`/api/po/${encodeURIComponent(nomor.trim())}${qs}`, { method: 'GET' })).po;
      const masalah = cekPoUntukTrade(data);
      if (masalah) { set({ status: 'galat', data: null, galat: masalah }); if (!lagi) setPo({ status: 'galat', data: null, galat: masalah }); return; }
      set({ status: 'siap', data, galat: null });
      setPo({ status: 'siap', data, galat: null });
      if (!lagi) setForm((f) => ({ ...f, poNumber: data.poNumber, vendorKode: data.vendor.kode }));
    } catch (e) { set({ status: 'galat', data: null, galat: errMessage(e) }); if (!lagi) setPo({ status: 'galat', data: null, galat: errMessage(e) }); }
  }, []);
  // Edit dokumen Trade: tarik P.O diam-diam agar gauge & validasi vendor siap.
  useEffect(() => { if (awal?.tipe === 'Trade' && awal.poNumber && awal.poNumber !== '-') void tarikPo(awal.poNumber); }, [awal, tarikPo]);

  // ---------------------------------------------------------------- turunan
  const brands = useMemo(() => (org.data ? brandBoleh(roles, org.data) : []), [org.data, roles]);
  const depts = useMemo(() => (org.data && form.brand ? deptBoleh(roles, org.data, form.brand) : []), [org.data, roles, form.brand]);
  const pic = useMemo(() => (org.data && form.brand && form.departement ? picOptions(org.data, form.brand, form.departement, nama) : null), [org.data, form.brand, form.departement, nama]);
  const company = org.data && form.brand ? org.data.brandCompanyMap[upper(form.brand)] ?? '' : '';
  const kunciDup = `${upper(form.vendorKode)}|${upper(form.noInvoice)}`;
  const dupAktif = dup && dup.kunci === kunciDup ? dup.pesan : null;
  const poData = po.status === 'siap' && po.data && upper(po.data.poNumber) === upper(form.poNumber) ? po.data : null;
  const vendorTerpilih = form.tipe === 'Trade'
    ? poData?.vendor ? { kode: poData.vendor.kode, nama: poData.vendor.nama, bank: poData.vendor.bank, namaRekening: poData.vendor.namaRekening, noRekening: poData.vendor.noRekening, npwp: poData.vendor.npwp } : null
    : (() => { const v = vendors.data?.find((x) => x.kode === form.vendorKode); return v ? { kode: v.kode, nama: v.namaAsli, bank: v.bank, namaRekening: v.namaRekening, noRekening: v.noRekening, npwp: v.npwp } : null; })();
  const ctx: KonteksValidasi = {
    poSiap: !!poData, poVendorKode: poData?.vendor.kode ?? '', adaManager: pic ? pic.adaManager : null,
    duplikat: dupAktif, punyaLampiran: punyaLampiran || !!staged,
  };
  const preview = useMemo(() => previewHitung(form, vendorTerpilih?.npwp ?? ''), [form, vendorTerpilih?.npwp]);
  const nominal = nominalServer !== null && idTrx && savedSidik.current === sidikBody(form) ? nominalServer : preview?.finalAmount ?? nominalServer ?? 0;
  const semuaGalat = validasiLangkah(langkah, form, ctx);
  const galat: Galat = Object.fromEntries(Object.entries(semuaGalat).filter(([k]) => k === 'manager' || (k === 'noInvoice' && dupAktif) || dicoba.has(langkah) || touched.has(k)));
  const idx = LANGKAH.indexOf(langkah);
  const peringatan = {
    barang: poData ? peringatanBarang(form, poData.qtyPO, poData.qtySJ) : null,
    plafon: poData && nominal > poData.plafonSJ - poData.billing.totalDiajukan
      ? `Nominal ${rupiah(nominal)} melebihi sisa plafon P.O (${rupiah(Math.max(0, poData.plafonSJ - poData.billing.totalDiajukan))}). Kurangi nominal.` : null,
  };

  // ---------------------------------------------------------------- mengubah isian
  const tandai = useCallback((k: string) => setTouched((s) => (s.has(k) ? s : new Set(s).add(k))), []);
  const ubah = useCallback((p: Partial<FormPengajuan>) => {
    setTouched((s) => new Set([...s, ...Object.keys(p)]));
    setForm((f) => {
      const n = { ...f, ...p };
      if (p.tipe && p.tipe !== f.tipe) { n.vendorKode = ''; n.poNumber = ''; setPo(kosong()); setPoLagi(kosong()); }
      else if (p.poNumber !== undefined && po.data && upper(p.poNumber) !== upper(po.data.poNumber)) { n.vendorKode = ''; setPo(kosong()); }
      return n;
    });
  }, [po.data]);

  // ---------------------------------------------------------------- cek duplikat invoice (saran inline)
  const cekInvoice = useCallback(async () => {
    const f = formRef.current;
    if (!f.vendorKode || !f.noInvoice.trim()) return;
    const k = `${upper(f.vendorKode)}|${upper(f.noInvoice)}`; const n = ++dupSeq.current;
    setDupMemuat(true);
    try {
      const qs = new URLSearchParams({ vendorKode: f.vendorKode, noInvoice: f.noInvoice.trim(), ...(idRef.current ? { excludeId: idRef.current } : {}) });
      const r = await api<{ duplikat: { id: string; pesan: string } | null }>(`/api/pengajuan/cek-invoice?${qs}`, { method: 'GET' });
      if (n === dupSeq.current) setDup({ kunci: k, pesan: r.duplikat?.pesan ?? null });
    } catch { /* hanya saran; penjaga sebenarnya di server saat simpan/ajukan */ }
    finally { if (n === dupSeq.current) setDupMemuat(false); }
  }, []);
  useEffect(() => { if (langkah === 'tagihan' && form.vendorKode && form.noInvoice.trim() && dup?.kunci !== kunciDup) void cekInvoice(); }, [langkah]);

  // ---------------------------------------------------------------- lampiran: pilih (kompres + validasi), simpan ke staged
  const pilihBerkas = useCallback(async (f: File) => {
    setGalatUnggah(null); setMemproses(true);
    try {
      const hasil = await kompresGambar(f);
      validasiUnggahan({ namaAsli: hasil.name, size: hasil.size, mimeType: hasil.type });
      setStaged((prev) => { if (prev?.previewUrl) URL.revokeObjectURL(prev.previewUrl); return { file: hasil, previewUrl: hasil.type.startsWith('image/') ? URL.createObjectURL(hasil) : null, ukuranAsli: f.size }; });
    } catch (e) { setGalatUnggah(e instanceof RuleError ? e.message : 'File tidak dapat dibaca. Coba file lain.'); }
    finally { setMemproses(false); }
  }, []);
  const hapusStaged = useCallback(() => setStaged((prev) => { if (prev?.previewUrl) URL.revokeObjectURL(prev.previewUrl); return null; }), []);
  useEffect(() => () => { const p = stagedRef.current?.previewUrl; if (p) URL.revokeObjectURL(p); }, []);

  // ---------------------------------------------------------------- simpan ke server (serial: tidak pernah dua simpan berbarengan)
  const serial = useCallback(<T,>(fn: () => Promise<T>): Promise<T> => { const p = antrean.current.then(fn, fn); antrean.current = p.catch(() => undefined); return p; }, []);
  const simpanServer = useCallback((): Promise<string> => serial(async () => {
    const body = keInputServer(formRef.current); const sidik = sidikJari(body);
    const sudah = idRef.current;
    if (sudah && sidik === savedSidik.current) return sudah;
    if (!sudah) {
      kunciBuat.current = pilihKunci(kunciBuat.current, sidik, uuid);
      const r = await api<{ hasil: HasilSimpan }>('/api/pengajuan', { body, headers: { 'Idempotency-Key': kunciBuat.current.key } });
      kunciBuat.current = null;
      idRef.current = r.hasil.id; setIdTrx(r.hasil.id); savedSidik.current = sidik; setNominalServer(r.hasil.finalAmount);
      try { window.history.replaceState(null, '', `/pengajuan/${r.hasil.id}/edit`); } catch { /* tidak kritis */ }
      return r.hasil.id;
    }
    const r = await api<{ hasil: HasilSimpan }>(`/api/pengajuan/${encodeURIComponent(sudah)}/update`, { body });
    savedSidik.current = sidik; setNominalServer(r.hasil.finalAmount);
    return sudah;
  }), [serial]);
  useEffect(() => { if (awal) { try { savedSidik.current = sidikBody(awalForm); } catch { /* tipe kosong */ } } }, [awal, awalForm]);

  // ---------------------------------------------------------------- navigasi
  const kLangkah = useCallback((l: Langkah) => { setGalatServer(null); setInfoSimpan(null); setLangkah(l); }, []);
  const fokusGalatPertama = () => { requestAnimationFrame(() => { (document.querySelector('[aria-invalid="true"], .msg.err') as HTMLElement | null)?.focus?.(); }); };

  async function unggahStaged(id: string): Promise<boolean> {
    const s = stagedRef.current; if (!s) return true;
    setGalatUnggah(null);
    try {
      await unggahLampiran({ api, put: putKeDrive, tunggu }, id, s.file, { onTahap: (tahap) => setUnggah({ tahap, bagian: tahap === 'mengunggah' ? 0 : 1 }), onProgress: (bagian) => setUnggah((u) => (u ? { ...u, bagian } : u)) });
      setPunyaLampiran(true); hapusStaged();
      return true;
    } catch (e) {
      setGalatUnggah(e instanceof GalatUnggah ? e.message : errMessage(e));
      if (e instanceof GalatUnggah && !e.bisaCobaLagi) hapusStaged();
      return false;
    } finally { setUnggah(null); }
  }

  async function lanjut() {
    const g = validasiLangkah(langkah, formRef.current, ctx);
    if (Object.keys(g).length) { setDicoba((s) => new Set(s).add(langkah)); fokusGalatPertama(); return; }
    setGalatServer(null);
    if (langkah === 'tagihan') {
      setBusy('simpan');
      try {
        const id = await simpanServer();
        if (!(await unggahStaged(id))) return;
        kLangkah('tinjau');
      } catch (e) { setGalatServer(errMessage(e)); }
      finally { setBusy(null); }
      return;
    }
    if (langkah === 'tinjau') { setGalatAjukan(null); setKonfirmasi(true); return; }
    const berikut = LANGKAH[idx + 1]!;
    kLangkah(berikut);
    // Draf yang sudah ada diperbarui senyap saat pindah langkah (gagal tidak menghalangi).
    if (idRef.current && bisaSimpanDraft(formRef.current, ctx)) simpanServer().catch(() => setInfoSimpan('Perubahan belum tersimpan ke server; akan dicoba lagi saat Anda lanjut.'));
  }

  async function simpanDraft() {
    setBusy('simpan'); setGalatServer(null); setInfoSimpan(null);
    try {
      const g = validasiLangkah('tagihan', formRef.current, { ...ctx, punyaLampiran: true });
      if (Object.keys(g).length) { setDicoba((s) => new Set(s).add('tagihan')); if (langkah !== 'tagihan') kLangkah('tagihan'); fokusGalatPertama(); return; }
      const id = await simpanServer();
      if (staged && !(await unggahStaged(id))) return;
      setInfoSimpan(`Draft ${id} tersimpan.`);
    } catch (e) { setGalatServer(errMessage(e)); }
    finally { setBusy(null); }
  }

  async function ajukan() {
    const masalah = langkahBermasalah(formRef.current, ctx);
    if (masalah) { setKonfirmasi(false); setDicoba((s) => new Set(s).add(masalah)); kLangkah(masalah); return; }
    setBusy('ajukan'); setGalatAjukan(null);
    try {
      const id = await simpanServer();
      kunciAjukan.current ??= uuid();
      const r = await api<{ hasil: HasilAjukan }>(`/api/pengajuan/${encodeURIComponent(id)}/submit`, { headers: { 'Idempotency-Key': kunciAjukan.current } });
      kunciAjukan.current = null;
      tulisLokal(lk, null);
      setKonfirmasi(false); setSukses(r.hasil);
    } catch (e) {
      // Jaringan putus / 503 = hasil belum pasti: pakai kunci yang sama saat dicoba lagi (server membaca-ulang). Penolakan tegas: kunci baru.
      if (isApiError(e) && e.code !== 'UPSTREAM_BUSY') kunciAjukan.current = null;
      setGalatAjukan(errMessage(e));
    } finally { setBusy(null); }
  }

  // ---------------------------------------------------------------- draf lokal, fokus, peringatan tinggalkan halaman
  useEffect(() => {
    const d = bacaLokal(lk);
    if (!d || !formAdaIsi(d.form)) return;
    if (awal ? d.idTrx === awal.id && sidikBody(d.form) !== sidikBody(awalForm) : true) setPulih(d);
  }, [lk, awal, awalForm]);
  useEffect(() => {
    if (pulih || sukses) return;
    const t = setTimeout(() => { if (formAdaIsi(form)) tulisLokal(lk, serialDrafLokal({ langkah, form, idTrx })); }, 400);
    return () => clearTimeout(t);
  }, [form, langkah, idTrx, lk, pulih, sukses]);
  useEffect(() => {
    if (!sudahMount.current) { sudahMount.current = true; return; }
    judulRef.current?.focus(); window.scrollTo({ top: 0 });
  }, [langkah]);
  const kotor = !sukses && formAdaIsi(form) && (!idTrx || sidikBodyAman(form) !== savedSidik.current);
  useEffect(() => {
    if (!kotor) return;
    const h = (e: BeforeUnloadEvent) => { e.preventDefault(); };
    window.addEventListener('beforeunload', h);
    return () => window.removeEventListener('beforeunload', h);
  }, [kotor]);
  // Periksa ulang P.O saat tiba di layar tinjau (plafon bisa berubah sejak langkah 1).
  useEffect(() => { if (langkah === 'tinjau' && form.tipe === 'Trade' && form.poNumber.trim()) void tarikPo(form.poNumber, true); }, [langkah]);

  async function pulihkan() {
    const d = pulih; setPulih(null); if (!d) return;
    setForm(d.form); kLangkah(d.langkah);
    if (d.form.tipe === 'Trade' && d.form.poNumber) void tarikPo(d.form.poNumber);
    if (d.idTrx && !awal) {
      try {
        const doc = (await api<{ pengajuan: DokumenDto }>(`/api/pengajuan/${encodeURIComponent(d.idTrx)}`, { method: 'GET' })).pengajuan;
        if (doc.editable) { setIdTrx(doc.id); idRef.current = doc.id; setPunyaLampiran(doc.punyaLampiran); setNominalServer(doc.nominal); savedSidik.current = sidikBody(dariDokumen(doc)); }
      } catch { /* draf server tak bisa dibuka: lanjut sebagai isian lokal baru */ }
    }
  }
  function buang() { setPulih(null); tulisLokal(lk, null); }

  // ---------------------------------------------------------------- tampilan
  if (sukses) return <Sukses hasil={sukses} manager={pic?.manager ?? ''} />;

  const bisaKe = (i: number): boolean => i <= idx || LANGKAH.slice(0, i).every((l) => l === 'tinjau' || Object.keys(validasiLangkah(l, form, ctx)).length === 0);
  const sibuk = busy !== null || memproses || !!unggah;
  const teksLanjut = langkah === 'tinjau' ? 'Ajukan ke Manager' : langkah === 'tagihan' ? (staged ? 'Simpan & lanjut' : 'Lanjut') : 'Lanjut';
  const terkunciAjukan = langkah === 'tinjau' && (!!peringatan.plafon || poLagi.status === 'memuat');
  const judul = awal ? `Ubah ${awal.id}` : 'Pengajuan baru';

  return (
    <main className="wrap wrap-form">
      <h1 className="sr-only">{judul}</h1>
      <div className="stepper">
        <div className="seg" aria-hidden="true">{LANGKAH.map((l, i) => <span key={l} className={i <= idx ? 'on' : ''} />)}</div>
        <div className="judul">{judul} · Langkah {idx + 1} dari {LANGKAH.length}</div>
        <ol aria-label="Langkah pengajuan">
          {LANGKAH.map((l, i) => (
            <li key={l} className={i === idx ? 'on' : i < idx ? 'done' : ''} aria-current={i === idx ? 'step' : undefined}>
              <button type="button" disabled={!bisaKe(i) || i === idx} onClick={() => kLangkah(l)}>{i + 1}. {JUDUL_LANGKAH[l]}</button>
            </li>
          ))}
        </ol>
      </div>

      {pulih && (
        <Pesan jenis="info" role="status">
          {awal ? 'Ada perubahan di perangkat ini yang belum tersimpan.' : 'Ada isian yang belum selesai dari sesi sebelumnya.'}
          <button type="button" className="link" onClick={pulihkan}>Lanjutkan</button>
          <button type="button" className="link" onClick={buang}>Buang</button>
        </Pesan>
      )}
      {awal?.status === 'Revision Needed' && <Pesan jenis="warn"><b>Dikembalikan untuk revisi.</b>{awal.notesFinance ? ` ${catatanTampil(awal.notesFinance)}` : ' Perbaiki data lalu ajukan kembali.'}</Pesan>}

      <h2 className="langkah-h" tabIndex={-1} ref={judulRef}>{JUDUL_LANGKAH[langkah]}</h2>
      <p className="langkah-sub">{SUB[langkah]}</p>

      {langkah === 'jenis' && <LangkahJenis form={form} ubah={ubah} galat={galat} po={po} onTarikPo={() => { tandai('poNumber'); if (form.poNumber.trim()) void tarikPo(form.poNumber); }} />}
      {langkah === 'entitas' && <LangkahEntitas form={form} ubah={ubah} galat={galat} org={org} brands={brands} depts={depts} pic={pic} company={company} namaPengaju={nama} onCobaLagiOrg={() => void muatOrg()} />}
      {langkah === 'vendor' && <LangkahVendor form={form} ubah={ubah} galat={galat} vendors={vendors} po={po} onCobaLagi={() => void muatVendors()} />}
      {langkah === 'tagihan' && (
        <LangkahTagihan form={form} ubah={ubah} galat={galat} tandai={tandai} preview={preview} po={poData} onCekInvoice={() => void cekInvoice()} cekInvoiceMemuat={dupMemuat}
          lampiran={{ idTrx, punyaLampiran, staged, memproses, unggah, galat: galatUnggah, onPilih: (f) => void pilihBerkas(f), onHapus: hapusStaged }} />
      )}
      {langkah === 'tinjau' && (
        <div className="tinjau-wrap">
          <LangkahTinjau form={form} company={company} namaPengaju={nama} manager={pic?.manager ?? ''} vendor={vendorTerpilih} preview={preview} nominalServer={nominalServer !== null && idTrx && savedSidik.current === sidikBodyAman(form) ? nominalServer : null}
            idTrx={idTrx} punyaLampiran={punyaLampiran} stagedNama={staged?.file.name ?? null} po={poData} poLagi={poLagi} peringatan={peringatan} onUbah={kLangkah} />
        </div>
      )}

      {galatServer && <Pesan jenis="err">{galatServer}</Pesan>}
      <div className="toast-wadah"><Toast isi={toastSimpan} onTutup={() => setInfoSimpan(null)} /></div>
      {(langkah === 'tagihan' || langkah === 'tinjau') && (
        <div className="tombol-baris pt"><button type="button" className="link" onClick={() => void simpanDraft()} disabled={sibuk}>{busy === 'simpan' && !unggah ? 'Menyimpan…' : 'Simpan sebagai draft'}</button></div>
      )}

      <div className="aksi-spacer" />
      <div className="aksi-bar">
        <div className="aksi-in">
          <div className="ringkas">
            {preview ? <><div className="v num">{rupiah(nominal)}</div><div className="l">Nominal akhir{preview.perluCFO ? ' · butuh CFO' : ''}</div></> : <div className="l">{angka(form.invoiceAmount) ? '' : `${idx + 1} / ${LANGKAH.length}`}</div>}
          </div>
          {idx > 0 && <button type="button" className="btn btn-secondary" onClick={() => kLangkah(LANGKAH[idx - 1]!)} disabled={sibuk}>Kembali</button>}
          <button type="button" className="btn btn-primary" onClick={() => void lanjut()} disabled={sibuk || terkunciAjukan || (langkah === 'entitas' && galat.manager !== undefined && !!pic && !pic.adaManager)}>
            {busy === 'simpan' ? (unggah ? 'Mengunggah…' : 'Menyimpan…') : teksLanjut}
          </button>
        </div>
      </div>

      <Dialog buka={konfirmasi} onTutup={() => { if (busy !== 'ajukan') setKonfirmasi(false); }} judul="Ajukan ke Manager?">
        <p className="muted">Setelah dikirim, pengajuan <b>dikunci dan tidak bisa diedit</b> kecuali dikembalikan untuk revisi.</p>
        <dl className="kv dlg-kv">
          <div><dt>Vendor</dt><dd>{vendorTerpilih?.nama ?? '-'}</dd></div>
          <div><dt>Invoice</dt><dd>{form.noInvoice}</dd></div>
          <div><dt>Nominal</dt><dd className="num">{rupiah(nominal)}</dd></div>
          <div><dt>Penyetuju</dt><dd>{pic?.manager || '—'}{preview?.perluCFO ? ' + CFO' : ''}</dd></div>
        </dl>
        {galatAjukan && <Pesan jenis="err">{galatAjukan}</Pesan>}
        <div className="dlg-aksi">
          <button type="button" className="btn btn-secondary" onClick={() => setKonfirmasi(false)} disabled={busy === 'ajukan'}>Batal</button>
          <button type="button" className="btn btn-primary" onClick={() => void ajukan()} disabled={busy === 'ajukan'}>{busy === 'ajukan' ? 'Mengajukan…' : galatAjukan ? 'Coba lagi' : 'Ya, ajukan'}</button>
        </div>
      </Dialog>
    </main>
  );
}

const SUB: Record<Langkah, string> = {
  jenis: 'Pilih jenis pengajuan. Untuk Trade, tarik data P.O terlebih dulu.',
  entitas: 'Brand, departemen, dan keperluan pembayaran.',
  vendor: 'Siapa yang akan dibayar.',
  tagihan: 'Isi tagihan sesuai invoice dan lampirkan filenya.',
  tinjau: 'Periksa sekali lagi. Angka final dihitung oleh server.',
};

function sidikBodyAman(f: FormPengajuan): string | null { try { return sidikJari(keInputServer(f)); } catch { return null; } }
function sidikBody(f: FormPengajuan): string { return sidikJari(keInputServer(f)); }

function Sukses({ hasil, manager }: { hasil: HasilAjukan; manager: string }) {
  const st = labelStatus(hasil.status);
  return (
    <main className="wrap wrap-form sukses">
      <div role="status">
        <div className="centang" aria-hidden="true">✓</div>
        <h1 className="page-h">Pengajuan terkirim</h1>
        <p className="hero-sub">{hasil.id} · <span className="num">{rupiah(hasil.finalAmount)}</span></p>
        <p className="hint pt"><span className={`pill-st ${st.nada}`}>{st.label}</span>{manager ? ` · menunggu persetujuan ${manager}` : ''}</p>
        {hasil.perluCFO && <p className="pt"><span className="badge-cfo">Butuh TTD CFO</span></p>}
        <div className="cta-row cta-tengah">
          <a className="btn btn-primary" href="/pengajuan">Lihat pengajuan saya</a>
          <a className="btn btn-secondary" href="/pengajuan/baru">Buat pengajuan lain</a>
        </div>
      </div>
    </main>
  );
}
