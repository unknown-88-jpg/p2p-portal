import { describe, expect, it } from 'vitest';
import { STATUS, STATUS_FLOW, checkTransition, isStatus } from '@/domain/status';
import { CONFIG, bolehApproveViaWA, butuhCFO } from '@/domain/config';

describe('I3 STATUS_FLOW', () => {
  it('semua status punya entri flow & tujuan valid', () => {
    for (const s of Object.values(STATUS)) {
      expect(STATUS_FLOW[s]).toBeDefined();
      STATUS_FLOW[s].forEach((t) => expect(isStatus(t)).toBe(true));
    }
  });
  it('transisi sah diterima', () => {
    expect(checkTransition(STATUS.DRAFT, STATUS.SUBMITTED)).toBeNull();
    expect(checkTransition(STATUS.SUBMITTED, STATUS.MANAGER_APPROVED)).toBeNull();
    expect(checkTransition(STATUS.PARTIALLY_PAID, STATUS.PARTIALLY_PAID)).toBeNull();
  });
  it('lompatan & transisi dari status akhir ditolak', () => {
    expect(checkTransition(STATUS.DRAFT, STATUS.PAID)).not.toBeNull();
    expect(checkTransition(STATUS.SUBMITTED, STATUS.COA_POSTED)).not.toBeNull();
    expect(checkTransition(STATUS.PAID, STATUS.PARTIALLY_PAID)).not.toBeNull();
    expect(checkTransition(STATUS.REJECTED, STATUS.SUBMITTED)).not.toBeNull();
  });
  it('status tak dikenal ditolak', () => {
    expect(checkTransition('Hacked', STATUS.PAID)).toMatch(/tidak dikenal/);
  });
});

describe('I1 / D9 ambang', () => {
  it('CFO tepat di ambang', () => {
    expect(butuhCFO(CONFIG.CFO_THRESHOLD - 1)).toBe(false);
    expect(butuhCFO(CONFIG.CFO_THRESHOLD)).toBe(true);
  });
  it('WA approval mati di/atas 5 jt', () => {
    expect(bolehApproveViaWA(4_999_999)).toBe(true);
    expect(bolehApproveViaWA(5_000_000)).toBe(false);
    expect(bolehApproveViaWA(120_000_000)).toBe(false);
  });
});
