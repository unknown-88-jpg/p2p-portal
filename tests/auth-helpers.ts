import { LinkTokens } from '@/infra/link-tokens';
import { SessionStore } from '@/infra/session';
import { __setScryptCostForTests, legacyHash } from '@/infra/password';
import { AUDIT_LOG, MASTER_USER_TTD } from '@/repo/schema';
import type { LinkSender } from '@/ports/link-sender';
import type { AuthDeps } from '@/server/auth';
import type { WaResult, WaSender } from '@/ports/wa-sender';
import { MemoryDrive } from '@/testing/memory-drive';
import { world } from './helpers';

export class FakeSender implements LinkSender {
  sent: { phone: string; nama: string; link: string }[] = [];
  async sendSetPasswordLink(phone: string, nama: string, link: string): Promise<void> { this.sent.push({ phone, nama, link }); }
}

export class FakeWa implements WaSender {
  sent: { to: string; text: string }[] = [];
  failNext = false;
  async send(to: string, text: string): Promise<WaResult> {
    if (this.failNext) { this.failNext = false; return { ok: false, info: 'gagal (tes)' }; }
    this.sent.push({ to, text }); return { ok: true, info: 'terkirim' };
  }
}

__setScryptCostForTests(1024); // suite auth: biaya rendah agar cepat (password.test.ts menguji parameter produksi)
export const LEGACY_PW = 'rahasia-lama-1';
type R = (string | number | null)[];
// Brand, Departement, Level, Jabatan, Nama, Email, Aktif, No_HP, Password_Hash, Password_Salt
export const USERS: R[] = [
  ['BRAND A', 'DEPT X', 2, 'Manager', 'Budi', 'budi@x.id', 'YES', '081200000001', null, null],       // baris 2: belum punya password
  ['BRAND A', 'DEPT X', 1, 'PIC', 'Citra', 'citra@x.id', 'YES', '081200000002', null, null],         // baris 3 & 4: nomor sama
  ['BRAND B', 'DEPT Y', 1, 'PIC', 'Citra', 'citra@x.id', 'YES', '0812-0000-0002', null, null],
  ['ALL', 'ALL', 3, 'Fin Staff', 'Dani', 'dani@x.id', 'YES', '081200000003', legacyHash(LEGACY_PW, 'salt123'), 'salt123'], // baris 5: hash lama
  ['BRAND A', 'DEPT X', 1, 'PIC', 'Eko', 'eko@x.id', 'NO', '081200000004', null, null],               // baris 6: nonaktif
];
export const P = { budi: '6281200000001', citra: '6281200000002', dani: '6281200000003', eko: '6281200000004' };

export function authWorld(latencyMs = 5) {
  const w = world(latencyMs);
  w.store.seed(MASTER_USER_TTD, USERS);
  w.store.seed(AUDIT_LOG, []);
  const sender = new FakeSender();
  const wa = new FakeWa();
  const drive = new MemoryDrive(w.clock);
  const deps: AuthDeps = {
    ...w.deps,
    drive,
    sessions: new SessionStore(w.redis, w.clock, 'test-pepper-0123456789abcdef0123456789'),
    tokens: new LinkTokens(w.redis, w.clock, 'test-pepper-0123456789abcdef0123456789'),
    sender, wa, baseUrl: 'http://localhost:3000',
  };
  const users = () => w.store.rowsOf(MASTER_USER_TTD);
  const audit = () => w.store.rowsOf(AUDIT_LOG).map((r) => ({ action: String(r[4]), actor: String(r[2]), notes: String(r[8]) }));
  return { ...w, deps, sender, wa, drive, users, audit };
}
export const tokenOf = (link: string): string => new URL(link).searchParams.get('t')!;
