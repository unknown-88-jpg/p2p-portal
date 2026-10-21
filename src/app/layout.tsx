import type { ReactNode } from 'react';
import './globals.css';

export const metadata = { title: { default: 'P2P Finance Portal', template: '%s · P2P Finance' } };

export default function RootLayout({ children }: { children: ReactNode }) {
  const trial = process.env.APP_ENV !== 'production';
  return (
    <html lang="id">
      <body>
        {trial && <div role="alert" className="trial-banner">ENVIRONMENT TRIAL — DATA DUMMY</div>}
        <a className="skip" href="#isi">Lewati ke konten</a>
        <div id="isi">{children}</div>
      </body>
    </html>
  );
}
