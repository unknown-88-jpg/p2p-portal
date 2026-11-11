import { bangunVendor } from '@/domain/master';
import { cekPlafonPO, vendorUntukPo } from '@/domain/po';
import { MASTER_VENDOR } from '@/repo/schema';
import { AppError } from '@/lib/errors';
import { upper } from '@/domain/legacy-parse';
import { cocokkanPrefix, lookupPo, readBilling, readSettingRows } from './po-read';
import type { UowDeps } from './uow';

/** searchPODetails (versi baru). Urutan & pesan sama dengan sistem lama; DB_PO error -> UPSTREAM_BUSY (503), BUKAN "tidak ditemukan". */
export async function getPoDetails(d: UowDeps, poNumber: string, excludeIdTrx?: string) {
  const poClean = upper(poNumber);
  if (!poClean) throw new AppError('VALIDATION', 'Nomor P.O kosong.');

  const [lk, setting] = await Promise.all([lookupPo(d.store, poClean), readSettingRows(d.store)]);
  if (lk.status === 'unreadable') throw new AppError('UPSTREAM_BUSY', 'Data P.O sedang disinkronkan dari sistem sumber. Coba lagi sebentar.', undefined, 3);
  if (lk.status === 'notFound') throw new AppError('NOT_FOUND', `Nomor P.O "${poClean}" tidak ditemukan di DB_PO.`);

  const m = cocokkanPrefix(setting, poClean);
  const po = { ...lk.po, companyName: m.company || lk.po.companyName, brandName: m.brand || '-' };

  const billing = await readBilling(d.store, poClean, excludeIdTrx);
  // Vendor P.O: lewat Kode Vendor bila DB_PO membawanya, selain itu lewat nama. > 1 kandidat (satu vendor, beberapa rekening) -> PIC memilih.
  const hasil = vendorUntukPo(po, (await d.store.readRows(MASTER_VENDOR)).map(bangunVendor));
  if (!hasil.ok) throw new AppError('RULE_VIOLATION', hasil.pesan);
  const vendor = hasil.kandidat.length === 1 ? hasil.kandidat[0]! : null;
  const vendorPilihan = hasil.kandidat.length > 1 ? hasil.kandidat : [];

  const c = cekPlafonPO({ poNumber: poClean, grandTotal: po.grandTotalPO, totalDiajukan: billing.totalDiajukan });
  const plafonSJ = c.plafon;
  const sisaBolehTagih = Math.max(plafonSJ - billing.totalDiajukan, 0);
  return { ...po, qtySJ: lk.qtySJ, qtyKurang: Math.max(po.qtyPO - lk.qtySJ, 0), plafonSJ, sisaBolehTagih, billing, vendor, vendorPilihan };
}
