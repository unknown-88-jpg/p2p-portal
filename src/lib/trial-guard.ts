// D6: trial hanya boleh menyentuh spreadsheet DUMMY. Murni (testable); infra memanggilnya dengan judul spreadsheet.
export interface TrialGuardInput { appEnv: 'trial' | 'production'; sheetId: string; title: string; prodSheetIds: string }

export function checkSheetAllowed(i: TrialGuardInput): string | null {
  if (i.appEnv !== 'trial') return null;
  const blocked = i.prodSheetIds.split(',').map((s) => s.trim()).filter(Boolean);
  if (blocked.includes(i.sheetId)) return 'Spreadsheet ini terdaftar sebagai PRODUKSI — ditolak pada APP_ENV=trial.';
  if (!/dummy/i.test(i.title)) return `Judul spreadsheet "${i.title}" tidak mengandung DUMMY — ditolak pada APP_ENV=trial.`;
  return null;
}

/** D6 untuk Drive: trial hanya boleh menulis ke Shared Drive berjudul DUMMY. */
export function checkDriveAllowed(i: { appEnv: 'trial' | 'production'; driveName: string }): string | null {
  if (i.appEnv !== 'trial') return null;
  return /dummy/i.test(i.driveName) ? null : `Shared Drive "${i.driveName}" tidak mengandung DUMMY — ditolak pada APP_ENV=trial.`;
}
