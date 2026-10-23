import type { ReactNode } from 'react';

// Ikon garis 24px (currentColor). Dekoratif: disembunyikan dari pembaca layar, label selalu ada di teks sebelahnya.
const Ikon = ({ children }: { children: ReactNode }) => (
  <svg className="ikon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">{children}</svg>
);

export const IkonBeranda = () => <Ikon><path d="M3 11.5 12 4l9 7.5" /><path d="M5 10v10h14V10" /><path d="M10 20v-5h4v5" /></Ikon>;
export const IkonDokumen = () => <Ikon><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" /><path d="M14 3v5h5" /><path d="M9 13h6M9 17h6" /></Ikon>;
export const IkonSetuju = () => <Ikon><circle cx="12" cy="12" r="9" /><path d="m8 12.5 2.8 2.8L16.5 9.5" /></Ikon>;
export const IkonTambah = () => <Ikon><path d="M12 5v14M5 12h14" /></Ikon>;
export const IkonCari = () => <Ikon><circle cx="11" cy="11" r="6.5" /><path d="m16 16 4 4" /></Ikon>;
export const IkonMenu = () => <Ikon><path d="M4 7h16M4 12h16M4 17h10" /></Ikon>;
export const IkonKeluar = () => <Ikon><path d="M10 4H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h4" /><path d="M15 8l4 4-4 4M19 12H9" /></Ikon>;
export const IkonProses = () => <Ikon><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></Ikon>;
export const IkonPerhatian = () => <Ikon><path d="M12 3 2.5 20h19z" /><path d="M12 10v4M12 17.2v.1" /></Ikon>;
export const IkonUang = () => <Ikon><rect x="3" y="6" width="18" height="12" rx="2" /><circle cx="12" cy="12" r="2.5" /></Ikon>;
export const IkonSelesai = () => <Ikon><path d="M5 12.5 10 17.5 19 7" /></Ikon>;
export const IkonPanah = () => <Ikon><path d="m9 6 6 6-6 6" /></Ikon>;
export const IkonInfo = () => <Ikon><circle cx="12" cy="12" r="9" /><path d="M12 11v5M12 7.8v.1" /></Ikon>;
export const IkonSilang = () => <Ikon><circle cx="12" cy="12" r="9" /><path d="m9 9 6 6M15 9l-6 6" /></Ikon>;
export const IkonKunci = () => <Ikon><rect x="5" y="11" width="14" height="9" rx="2" /><path d="M8 11V8a4 4 0 0 1 8 0v3" /></Ikon>;
export const IkonKlip = () => <Ikon><path d="m20 11.5-7.8 7.8a5 5 0 0 1-7-7l8-8a3.4 3.4 0 0 1 4.8 4.8l-8 8a1.8 1.8 0 0 1-2.5-2.5l7.3-7.3" /></Ikon>;
export const IkonTutup = () => <Ikon><path d="M6 6l12 12M18 6 6 18" /></Ikon>;
export const IkonMata = () => <Ikon><path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z" /><circle cx="12" cy="12" r="3" /></Ikon>;
export const IkonMataCoret = () => <Ikon><path d="M4 4l16 16" /><path d="M9.9 5.8A9.7 9.7 0 0 1 12 5.5c6 0 9.5 6.5 9.5 6.5a16 16 0 0 1-3.2 3.9M6.6 7.7A16 16 0 0 0 2.5 12S6 18.5 12 18.5c1.5 0 2.8-.4 4-.9" /><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2" /></Ikon>;
