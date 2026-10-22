/** Panel merek di sisi kanan halaman masuk (tile gelap; disembunyikan di layar sempit). Statis, tanpa data. */
export function AuthPanel() {
  return (
    <aside className="auth-panel" aria-hidden="true">
      <span className="sb-logo">P</span>
      <h2>Pengajuan pembayaran, rapi dari awal sampai lunas.</h2>
      <p>Ajukan, setujui, verifikasi pajak, dan pantau status pembayaran dalam satu tempat.</p>
    </aside>
  );
}
