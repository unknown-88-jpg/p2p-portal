'use client';
import { useEffect, useState } from 'react';
import { IkonMenu } from './icons';

// Sidebar: di layar lebar bisa ditutup/dibuka (html[data-sb="tutup"], diingat di localStorage); di layar sempit berupa laci
// (html[data-nav="open"]). CSS yang menggeser sidebar dan menyesuaikan lebar isi; tidak ada gaya inline (CSP).
const LACI = 'data-nav';
const TUTUP = 'data-sb';
const KUNCI = 'p2p.sidebar';
const LEBAR = '(min-width: 1024px)';
const html = () => document.documentElement;
const setAttr = (a: string, v: string | null) => { if (v === null) html().removeAttribute(a); else html().setAttribute(a, v); };
const baca = () => { try { return localStorage.getItem(KUNCI); } catch { return null; } };
const tulis = (v: string | null) => { try { if (v === null) localStorage.removeItem(KUNCI); else localStorage.setItem(KUNCI, v); } catch { /* penyimpanan tak tersedia: pilihan hanya berlaku di sesi ini */ } };

export function TombolMenu() {
  const [lebar, setLebar] = useState(true);
  const [buka, setBuka] = useState(true);
  useEffect(() => {
    const mq = window.matchMedia(LEBAR);
    const sinkron = () => { setLebar(mq.matches); setBuka(mq.matches ? html().getAttribute(TUTUP) !== 'tutup' : html().getAttribute(LACI) === 'open'); };
    if (baca() === 'tutup') setAttr(TUTUP, 'tutup');
    sinkron();
    const mo = new MutationObserver(sinkron);
    mo.observe(html(), { attributes: true, attributeFilter: [LACI, TUTUP] });
    mq.addEventListener('change', sinkron);
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setAttr(LACI, null); };
    window.addEventListener('keydown', esc);
    return () => { mo.disconnect(); mq.removeEventListener('change', sinkron); window.removeEventListener('keydown', esc); setAttr(LACI, null); };
  }, []);
  const klik = () => {
    if (lebar) { const tutup = html().getAttribute(TUTUP) !== 'tutup'; setAttr(TUTUP, tutup ? 'tutup' : null); tulis(tutup ? 'tutup' : null); }
    else setAttr(LACI, html().getAttribute(LACI) === 'open' ? null : 'open');
  };
  return (
    <button type="button" className="tb-menu" aria-label={buka ? 'Tutup menu' : 'Buka menu'} aria-expanded={buka} aria-controls="sidebar" onClick={klik}>
      <IkonMenu />
    </button>
  );
}

export const LatarMenu = () => <button type="button" className="sb-backdrop" tabIndex={-1} aria-hidden="true" onClick={() => setAttr(LACI, null)} />;
