import { after } from 'next/server';
import { forgotPasswordPrepare, forgotSchema } from '@/server/auth';
import { authDeps } from '@/server/runtime';
import { route } from '../../_lib/handler';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Balasan SELALU sama & secepat sama (tidak membocorkan apakah nomor terdaftar, termasuk lewat timing). */
export const POST = route({ method: 'POST', session: 'none', schema: forgotSchema }, async ({ body, ip }) => {
  const deliver = await forgotPasswordPrepare(authDeps(), body, ip);
  after(deliver); // kerja khusus nomor terdaftar jalan SETELAH respons terkirim
  return { body: { ok: true, message: 'Jika nomor terdaftar, link atur password dikirim via WhatsApp (berlaku 60 menit).' } };
});
