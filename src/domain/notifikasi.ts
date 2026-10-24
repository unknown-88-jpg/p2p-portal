// Lonceng "perlu tindakan" di bar atas — untuk SEMUA peran. Murni: menerima hitungan per sumber, menghasilkan daftar butir.
// Hanya hal yang bisa DITINDAKLANJUTI pengguna ini (bukan sekadar info). Angka dari tampilan ber-cache; aksi sebenarnya tetap dijaga server.

export interface ButirNotif { kunci: string; judul: string; jumlah: number; href: string; nada: 'merah' | 'kuning' | 'biru' }

export interface SumberNotif {
  pic?: { revisi: number; draft: number };
  manager?: { antrean: number };
  finance?: { pajak?: number; persetujuanFinMgr?: number; persetujuanCfo?: number; jurnal?: number; bayar?: number };
  vendor?: { menunggu: number };
  admin?: { cronBermasalah: string[] };
}

export function susunNotifikasi(s: SumberNotif): { butir: ButirNotif[]; total: number } {
  const b: ButirNotif[] = [];
  const add = (x: ButirNotif): void => { if (x.jumlah > 0) b.push(x); };
  if (s.pic) {
    add({ kunci: 'pic-revisi', judul: 'Pengajuan dikembalikan, perlu direvisi', jumlah: s.pic.revisi, href: '/pengajuan?status=perlu-tindakan', nada: 'merah' });
    add({ kunci: 'pic-draft', judul: 'Draft belum diajukan', jumlah: s.pic.draft, href: '/pengajuan?status=perlu-tindakan', nada: 'kuning' });
  }
  if (s.manager) add({ kunci: 'manager', judul: 'Menunggu persetujuan Anda', jumlah: s.manager.antrean, href: '/persetujuan', nada: 'merah' });
  const f = s.finance;
  if (f) {
    add({ kunci: 'fin-pajak', judul: 'Menunggu verifikasi pajak', jumlah: f.pajak ?? 0, href: '/finance?tahap=pajak', nada: 'merah' });
    add({ kunci: 'fin-finmgr', judul: 'Menunggu persetujuan Fin. Mgr', jumlah: f.persetujuanFinMgr ?? 0, href: '/finance?tahap=persetujuan', nada: 'merah' });
    add({ kunci: 'fin-cfo', judul: 'Menunggu persetujuan CFO', jumlah: f.persetujuanCfo ?? 0, href: '/finance?tahap=persetujuan', nada: 'merah' });
    add({ kunci: 'fin-jurnal', judul: 'Menunggu jurnal COA', jumlah: f.jurnal ?? 0, href: '/finance?tahap=jurnal', nada: 'kuning' });
    add({ kunci: 'fin-bayar', judul: 'Siap dibayar', jumlah: f.bayar ?? 0, href: '/finance?tahap=bayar', nada: 'kuning' });
  }
  if (s.vendor) add({ kunci: 'vendor', judul: 'Vendor menunggu pengesahan', jumlah: s.vendor.menunggu, href: '/vendor?tab=pengesahan', nada: 'merah' });
  if (s.admin) add({ kunci: 'admin-cron', judul: `Cron bermasalah: ${s.admin.cronBermasalah.join(', ')}`, jumlah: s.admin.cronBermasalah.length, href: '/admin?tab=kesehatan', nada: 'merah' });
  return { butir: b, total: b.reduce((a, x) => a + x.jumlah, 0) };
}

/** Cron dianggap bermasalah bila terakhir gagal / dilewati, atau tidak jalan > 25 jam (alarm F4-A). Digest hanya hari kerja -> batas 4 hari. */
export function cronBermasalah(cron: readonly { nama: string; at: number | null; hasil: string }[], now: number): string[] {
  const batas: Record<string, number> = { digest: 4 * 86_400_000 };
  return cron.filter((c) => c.hasil === 'gagal' || c.hasil === 'dilewati' || (c.at !== null && now - c.at > (batas[c.nama] ?? 25 * 3_600_000))).map((c) => c.nama);
}
