import { cekPlafonPO } from '@/domain/po';
import { AppError } from '@/lib/errors';
import { upper } from '@/domain/legacy-parse';
import { readVendorByCode } from './master-read';
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
  const vendor = await readVendorByCode(d.store, po.kodeVendor);
  if (!vendor) throw new AppError('RULE_VIOLATION', `Vendor "${po.kodeVendor}" di PO ini tidak ada di Master_Vendor.`);
  if (upper(vendor.status) !== 'APPROVED') throw new AppError('RULE_VIOLATION', `Vendor "${vendor.nama}" masih berstatus ${vendor.status}. Minta Finance sahkan rekeningnya dulu sebelum mengajukan.`);

  const c = cekPlafonPO({ poNumber: poClean, grandTotal: po.grandTotalPO, qtyPO: po.qtyPO, qtySJ: lk.qtySJ, totalDiajukan: billing.totalDiajukan });
  const plafonSJ = c.plafon;
  const sisaBolehTagih = Math.max(plafonSJ - billing.totalDiajukan, 0);
  return { ...po, qtySJ: lk.qtySJ, qtyKurang: Math.max(po.qtyPO - lk.qtySJ, 0), plafonSJ, sisaBolehTagih, billing, vendor };
}
