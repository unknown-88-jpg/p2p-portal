'use client';
import { useState } from 'react';
import { api } from './api';
import { IkonKeluar } from './icons';

export function LogoutButton() {
  const [busy, setBusy] = useState(false);
  return (
    <button className="link" disabled={busy} onClick={async () => { setBusy(true); try { await api('/api/auth/logout'); } finally { window.location.assign('/login'); } }}>
      <IkonKeluar />Keluar
    </button>
  );
}
