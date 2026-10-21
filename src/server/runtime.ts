import { productionAuthDeps } from './deps';
import type { AuthDeps } from './auth';

let deps: AuthDeps | null = null;
/** Klien Redis/Sheets/Google dibuat sekali per instance (hanya objek klien; TIDAK ada state bisnis di memori). */
export function authDeps(): AuthDeps { return (deps ??= productionAuthDeps()); }

/** HANYA test. */
export function __setAuthDepsForTests(d: AuthDeps | null): void { deps = d; }
