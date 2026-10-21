// Seed data uji pada salinan DUMMY (murni; I/O di scripts/seed-dummy.ts).
// Tujuan: salinan hasil anonimisasi bisa dipakai uji (user punya nomor HP, vendor Approved cocok dengan DB_PO).
// Nomor HP uji = 0800000NNNN (bukan rentang seluler nyata). Ganti manual dengan nomor WA uji milik sendiri (P4).

const pad = (n: number, w: number): string => String(n).padStart(w, '0');
const s = (v: unknown): string => String(v ?? '').trim();

export interface UserRow { nama: unknown; email: unknown; noHp: unknown }
export interface UserFill { phones: string[]; emails: string[]; filledPhones: number; filledEmails: number }

/** Satu orang = satu nama (baris brand/dept berbeda memakai nomor yang sama, seperti sistem lama). Isi hanya yang kosong. */
export function planUserFill(rows: readonly UserRow[]): UserFill {
  const phoneByPerson = new Map<string, string>();
  const emailByPerson = new Map<string, string>();
  const usedPhones = new Set(rows.map((r) => s(r.noHp)).filter(Boolean));
  let np = 5000, ne = 1;
  const nextPhone = (): string => { let p: string; do { p = `0800000${pad(np++, 4)}`; } while (usedPhones.has(p)); usedPhones.add(p); return p; };

  const phones: string[] = [], emails: string[] = [];
  let filledPhones = 0, filledEmails = 0;
  for (const r of rows) {
    const nama = s(r.nama).toLowerCase();
    if (!nama || nama === '-') { phones.push(s(r.noHp)); emails.push(s(r.email)); continue; }
    let hp = s(r.noHp), em = s(r.email);
    if (hp) phoneByPerson.set(nama, phoneByPerson.get(nama) ?? hp);
    if (em) emailByPerson.set(nama, emailByPerson.get(nama) ?? em);
    if (!hp) { if (!phoneByPerson.has(nama)) { phoneByPerson.set(nama, nextPhone()); } hp = phoneByPerson.get(nama)!; filledPhones++; }
    if (!em) { if (!emailByPerson.has(nama)) { emailByPerson.set(nama, `seed${pad(ne++, 3)}@dummy.test`); } em = emailByPerson.get(nama)!; filledEmails++; }
    phones.push(hp); emails.push(em);
  }
  return { phones, emails, filledPhones, filledEmails };
}

export interface VendorRow { kode: string; nama: string; tipe: string; status: string; noRek: string }
const VENDOR_ID = /^VND-(\d+)$/i;

/** Vendor Approved untuk tiap nama vendor di DB_PO yang belum ada (cocok persis, case-insensitive) + beberapa Non-Trade bila belum ada. */
export function planVendors(poVendorNames: readonly string[], existing: readonly VendorRow[], todaySerial: number): { rows: (string | number)[][]; codeByName: Map<string, string> } {
  const byName = new Map<string, string>();
  for (const v of existing) if (v.nama) byName.set(v.nama.toUpperCase(), v.kode);
  let seq = existing.reduce((m, v) => Math.max(m, Number(VENDOR_ID.exec(v.kode)?.[1] ?? 0)), 0);
  const usedRek = new Set(existing.map((v) => v.noRek).filter(Boolean));
  let rek = 1;
  const nextRek = (): string => { let r: string; do { r = `9${pad(rek++, 9)}`; } while (usedRek.has(r)); usedRek.add(r); return r; };

  const rows: (string | number)[][] = [];
  const add = (nama: string, tipe: string): void => {
    const kode = `VND-${pad(++seq, 4)}`;
    byName.set(nama.toUpperCase(), kode);
    // urutan kolom = MASTER_VENDOR (A..J); tanggal sebagai serial (sel tanggal)
    rows.push([kode, nama, tipe, `99${pad(seq, 13)}`, 'BCA', nama, nextRek(), 'Approved', 'seed-register@dummy.test', todaySerial]);
  };

  for (const raw of poVendorNames) {
    const nama = s(raw);
    if (nama && !SHEET_ERR.test(nama) && !byName.has(nama.toUpperCase())) add(nama.toUpperCase(), 'Trade');
  }
  const hasNonTrade = existing.some((v) => v.tipe.toLowerCase() === 'non-trade' && v.status.toLowerCase() === 'approved');
  if (!hasNonTrade) for (let i = 1; i <= 3; i++) add(`VENDOR DUMMY NT ${pad(i, 3)}`, 'Non-Trade');
  return { rows, codeByName: byName };
}
const SHEET_ERR = /^#/;

/** Isi kolom Kode Vendor DB_PO yang kosong/error berdasar nama vendor. Nilai valid dipertahankan. */
export function fillPoVendorCodes(poVendorNames: readonly unknown[], currentCodes: readonly unknown[], codeByName: ReadonlyMap<string, string>): { codes: string[]; filled: number } {
  let filled = 0;
  const codes = poVendorNames.map((n, i) => {
    const cur = s(currentCodes[i]);
    if (cur && !SHEET_ERR.test(cur)) return cur;
    const k = codeByName.get(s(n).toUpperCase());
    if (k) { filled++; return k; }
    return cur && !SHEET_ERR.test(cur) ? cur : '';
  });
  return { codes, filled };
}

/** Tanggal -> serial Google Sheets (hari sejak 1899-12-30, zona WIB tidak relevan untuk seed). */
export function toSerial(d: Date): number {
  return Math.floor((Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) - Date.UTC(1899, 11, 30)) / 86_400_000);
}
