/** Panel merek di sisi kanan halaman masuk (tile gelap; disembunyikan di layar sempit). Statis, tanpa data. */
export function AuthPanel() {
  return (
    <aside className="auth-panel" aria-hidden="true">
      <span className="sb-logo">P</span>
      <h2>P2P</h2>
      <p>Procure to Payment</p>
    </aside>
  );
}
