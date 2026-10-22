'use client';
import { useEffect, useState } from 'react';
import { IkonMenu } from './icons';

// Sidebar di layar sempit berupa laci. Status disimpan sebagai atribut di <html> (data-nav) supaya CSS yang menggeser laci
// dan backdrop-nya cukup satu sumber; tidak ada gaya inline (CSP).
const ATTR = 'data-nav';
const set = (buka: boolean) => { if (buka) document.documentElement.setAttribute(ATTR, 'open'); else document.documentElement.removeAttribute(ATTR); };

export function TombolMenu() {
  const [buka, setBuka] = useState(false);
  useEffect(() => {
    const baca = () => setBuka(document.documentElement.getAttribute(ATTR) === 'open');
    const mo = new MutationObserver(baca);
    mo.observe(document.documentElement, { attributes: true, attributeFilter: [ATTR] });
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') set(false); };
    window.addEventListener('keydown', esc);
    return () => { mo.disconnect(); window.removeEventListener('keydown', esc); set(false); };
  }, []);
  return (
    <button type="button" className="tb-menu" aria-label={buka ? 'Tutup menu' : 'Buka menu'} aria-expanded={buka} aria-controls="sidebar" onClick={() => set(!buka)}>
      <IkonMenu />
    </button>
  );
}

export const LatarMenu = () => <button type="button" className="sb-backdrop" tabIndex={-1} aria-hidden="true" onClick={() => set(false)} />;
