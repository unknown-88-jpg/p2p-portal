/** Unduh teks (CSV) yang sudah ada di memori browser sebagai file. */
export function unduhTeks(namaFile: string, isi: string, mime = 'text/csv;charset=utf-8'): void {
  const url = URL.createObjectURL(new Blob([isi], { type: mime }));
  const a = document.createElement('a');
  a.href = url; a.download = namaFile; a.rel = 'noopener';
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
