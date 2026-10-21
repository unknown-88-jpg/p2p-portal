import { normalizePhone } from './phone';

export interface Role { brand: string; dept: string; level: number }

/** Satu baris Master_User_TTD (sudah dipetakan oleh repo). */
export interface UserRowInput {
  row: number; // nomor baris sheet (1-based)
  brand: string; dept: string; level: unknown; jabatan: string; nama: string; email: string;
  aktif: unknown; phone: string; hash: string; salt: string;
}

export interface Account {
  phone: string;       // ternormalisasi 62...
  rows: number[];      // semua baris milik nomor ini (hash/salt harus identik di semuanya)
  nama: string; jabatan: string; email: string;
  hash: string; salt: string;
  roles: Role[];       // hanya baris aktif
  aktif: boolean;      // minimal satu baris aktif
}

const up = (v: unknown): string => String(v ?? '').trim().toUpperCase();
const GHOST = /[\s ​-‍﻿]/g;

/** Email dinormalisasi kuat: buang SEMUA whitespace & karakter tak terlihat, lowercase (penyebab #1 "sudah daftar tapi ditolak"). */
export function normEmail(v: unknown): string { return String(v ?? '').replace(GHOST, '').toLowerCase(); }

/** Aktif kecuali tertulis NO/TIDAK/NONAKTIF (persis sistem lama: kosong dianggap aktif). */
export function isAktif(v: unknown): boolean {
  const a = up(v).replace(GHOST, '');
  return !(a === 'NO' || a === 'TIDAK' || a === 'NONAKTIF');
}

/** Level tak terbaca -> 99 (tanpa wewenang), seperti `parseInt(...) || 99` lama. */
export function parseLevel(v: unknown): number {
  const n = typeof v === 'number' ? Math.trunc(v) : parseInt(String(v ?? ''), 10);
  return Number.isFinite(n) && n !== 0 ? n : 99;
}

/** Gabungkan baris per nomor HP (port cariBarisApproverByNomor_, tapi untuk semua nomor sekaligus). */
export function buildAccounts(rows: readonly UserRowInput[]): Map<string, Account> {
  const out = new Map<string, Account>();
  for (const r of rows) {
    const phone = normalizePhone(r.phone);
    if (!phone) continue;
    let a = out.get(phone);
    if (!a) { a = { phone, rows: [], nama: '', jabatan: '', email: '', hash: '', salt: '', roles: [], aktif: false }; out.set(phone, a); }
    a.rows.push(r.row);
    const aktif = isAktif(r.aktif);
    if (aktif) a.aktif = true;
    if (!a.nama) a.nama = r.nama.trim();
    if (!a.jabatan) a.jabatan = r.jabatan.trim();
    if (!a.email) a.email = r.email.trim();
    if (!a.hash && r.hash) a.hash = r.hash;
    if (!a.salt && r.salt) a.salt = r.salt;
    if (aktif) a.roles.push({ brand: up(r.brand), dept: up(r.dept), level: parseLevel(r.level) });
  }
  return out;
}

/** hasAuthority lama: level persis + brand/dept cocok atau ALL. */
export function hasAuthority(roles: readonly Role[], brand: string, dept: string, level: number): boolean {
  const b = up(brand), d = up(dept);
  return roles.some((r) => r.level === level && (r.brand === b || r.brand === 'ALL') && (r.dept === d || r.dept === 'ALL'));
}

export const hasLevel = (roles: readonly Role[], level: number): boolean => roles.some((r) => r.level === level);
