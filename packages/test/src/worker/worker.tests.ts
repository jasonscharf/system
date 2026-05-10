import { afterEach, beforeEach, describe, it, vi } from 'vitest';


describe('worker', () => {
    beforeEach(() => {
        vi.spyOn(console, 'log').mockImplementation(() => {});
        vi.resetModules();
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
        vi.restoreAllMocks();
    });

    it('fires the interval callback', async () => {
        await import('@system/worker');
        vi.advanceTimersByTime(2000);
    });
});
