// Kirim webhook WA BERTANDA TANGAN ke deploy/dev sendiri (tanpa gateway). Memakai nomor & teks dari argumen.
// Pakai: npm run wa-webhook-test -- 6281200000001 "SETUJU 4821"   (butuh WA_WEBHOOK_SECRET & APP_BASE_URL di .env.local)
import { createHmac, randomUUID } from 'node:crypto';

const [nomor, ...rest] = process.argv.slice(2);
const teks = rest.join(' ');
const secret = process.env.WA_WEBHOOK_SECRET, base = process.env.APP_BASE_URL;
if (!nomor || !teks || !secret || !base) { console.error('Argumen: <nomor 62...> "<teks>"; env: WA_WEBHOOK_SECRET, APP_BASE_URL'); process.exit(1); }
const raw = JSON.stringify({ event: 'message.received', sessionId: 'uji', message: { key: { id: `UJI-${randomUUID()}`, remoteJid: `${nomor}@s.whatsapp.net`, fromMe: false }, messageTimestamp: Math.floor(Date.now() / 1000), message: { conversation: teks } } });
const res = await fetch(`${base.replace(/\/+$/, '')}/api/webhooks/wa`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-gateway-signature': createHmac('sha256', secret).update(raw).digest('hex') }, body: raw });
console.log(res.status, await res.text());
