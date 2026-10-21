/**
 * M4b integration check — dijalankan user SATU kali terhadap Shared Drive DUMMY sungguhan (DRIVE_ROOT_ID di .env.local).
 * Membuktikan adapter GoogleDrive bekerja di dunia nyata: guard folder (Shared Drive + DUMMY), sesi resumable + PUT langsung,
 * metadata, magic bytes (Range), stream unduh, daftar file (query pembersihan yatim), trash.
 *
 *   npm run m4b-integration
 *
 * Membuat 1 file kecil bernama invoice_NTR-99999_...; file itu di-trash di akhir (bila gagal, hapus manual).
 */
import { GoogleDrive } from '../src/infra/drive';
import { cocokMagic, namaFileServer, POLA_NAMA_SERVER } from '../src/domain/lampiran';
import { env } from '../src/lib/env';

let fail = 0;
const ok = (name: string, cond: boolean, detail = ''): void => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`); if (!cond) fail++; };

async function main(): Promise<void> {
  const drive = new GoogleDrive(env().DRIVE_ROOT_ID);
  const bytes = new Uint8Array(2048).fill(0x20);
  bytes.set(new TextEncoder().encode('%PDF-1.4\n% m4b integration\n'));
  const name = namaFileServer({ idTrx: 'NTR-99999', nowMs: Date.now(), acak: 'zz9999', namaAsli: 'm4b-integration.pdf', mimeType: 'application/pdf' });
  ok('nama cocok pola server', POLA_NAMA_SERVER.test(name), name);

  const { sessionUrl } = await drive.createUploadSession({ name, size: bytes.length, mimeType: 'application/pdf', origin: new URL(env().APP_BASE_URL).origin });
  ok('sesi upload dibuat (guard Shared Drive + DUMMY lolos)', sessionUrl.startsWith('https://www.googleapis.com/upload/'));

  const put = await fetch(sessionUrl, { method: 'PUT', headers: { 'content-type': 'application/pdf', 'content-length': String(bytes.length) }, body: bytes });
  const created = (await put.json()) as { id?: string };
  ok('PUT langsung ke sesi', put.ok && !!created.id, `HTTP ${put.status}`);
  const fileId = created.id!;

  try {
    const m = await drive.getMeta(fileId);
    ok('metadata: nama persis', m?.name === name);
    ok('metadata: ukuran persis', m?.size === bytes.length, String(m?.size));
    ok('metadata: induk = folder lampiran', m?.parents.length === 1 && m.parents[0] === drive.folderId);
    ok('metadata: tipe', m?.mimeType === 'application/pdf', m?.mimeType);
    ok('metadata: createdTime terbaca', (m?.createdMs ?? 0) > 0);
    ok('getMeta file tak ada => null', (await drive.getMeta('TIDAKADA1234567890')) === null);

    const head = await drive.readHead(fileId, 16);
    ok('readHead 16 byte + magic PDF', head.length === 16 && cocokMagic('application/pdf', head), `${head.length} byte`);

    const st = await drive.open(fileId);
    const got = new Uint8Array(await new Response(st.body).arrayBuffer());
    ok('stream unduh utuh', got.length === bytes.length && got[0] === 0x25, `${got.length} byte, ${st.mimeType}`);

    const list = await drive.listOld({ namePrefix: 'invoice_', createdBeforeMs: Date.now() + 3_600_000, limit: 200 });
    ok('listOld menemukan file uji (query pembersihan yatim valid)', list.some((x) => x.id === fileId), `${list.length} file bernama invoice_*`);
  } finally {
    await drive.trash(fileId);
    const after = await drive.getMeta(fileId);
    ok('trash berhasil', after === null || after.trashed);
  }
  console.log(fail ? `\n${fail} GAGAL` : '\nSemua lolos.');
  process.exit(fail ? 1 : 0);
}
main().catch((e: unknown) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
