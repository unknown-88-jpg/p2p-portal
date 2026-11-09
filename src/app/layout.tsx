import type { ReactNode } from 'react';
import './globals.css';
import './theme-hybrid.css'; // tema hybrid shadcn + Apple; hapus baris ini untuk kembali ke tema lama

export const metadata = { title: { default: 'P2P Finance Portal', template: '%s · P2P Finance' } };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="id">
      <body>
        <a className="skip" href="#isi">Lewati ke konten</a>
        <div id="isi">{children}</div>
      </body>
    </html>
  );
}
