import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createBatchAccumulator } from '@/utils/event-throttle';

/**
 * Tests for the watcher batch integration logic.
 *
 * The `useWatcherBatch` composable depends on Tauri APIs (invoke, listen) and Vue lifecycle hooks,
 * making it difficult to unit-test directly. Instead, we test the core batch accumulator behavior
 * as used by the watcher integration: 500ms interval, max 200 per batch, and cancel semantics.
 */

const WATCHER_BATCH_INTERVAL = 500;
const WATCHER_MAX_BATCH_SIZE = 200;

interface DirChangePayload {
	watchedPath: string;
	changedPath: string;
	kind: string;
}

function makeEvent(changedPath: string, watchedPath = '/home/user/'): DirChangePayload {
	return { watchedPath, changedPath, kind: 'modify' };
}

describe('Watcher batch accumulator integration', () => {
	beforeEach(() => {
		vi.useFakeTimers();
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it('should group events within a 500ms window into a single batch', () => {
		const batches: DirChangePayload[][] = [];
		const accumulator = createBatchAccumulator<DirChangePayload>(
			(events) => batches.push([...events]),
			WATCHER_BATCH_INTERVAL,
			WATCHER_MAX_BATCH_SIZE
		);

		accumulator.push(makeEvent('/home/user/file1.txt'));
		accumulator.push(makeEvent('/home/user/file2.txt'));
		accumulator.push(makeEvent('/home/user/file3.txt'));

		// No batch emitted yet
		expect(batches).toHaveLength(0);

		// Advance time by 500ms
		vi.advanceTimersByTime(500);

		// All 3 events should be in a single batch
		expect(batches).toHaveLength(1);
		expect(batches[0]).toHaveLength(3);
		expect(batches[0][0].changedPath).toBe('/home/user/file1.txt');
		expect(batches[0][1].changedPath).toBe('/home/user/file2.txt');
		expect(batches[0][2].changedPath).toBe('/home/user/file3.txt');
	});

	it('should emit immediately when maxBatchSize (200) is reached', () => {
		const batches: DirChangePayload[][] = [];
		const accumulator = createBatchAccumulator<DirChangePayload>(
			(events) => batches.push([...events]),
			WATCHER_BATCH_INTERVAL,
			WATCHER_MAX_BATCH_SIZE
		);

		// Push exactly 200 events
		for (let i = 0; i < 200; i++) {
			accumulator.push(makeEvent(`/home/user/file${i}.txt`));
		}

		// Batch should have been emitted immediately (no timer needed)
		expect(batches).toHaveLength(1);
		expect(batches[0]).toHaveLength(200);
	});

	it('should split events into multiple batches when exceeding maxBatchSize', () => {
		const batches: DirChangePayload[][] = [];
		const accumulator = createBatchAccumulator<DirChangePayload>(
			(events) => batches.push([...events]),
			WATCHER_BATCH_INTERVAL,
			WATCHER_MAX_BATCH_SIZE
		);

		// Push 250 events rapidly
		for (let i = 0; i < 250; i++) {
			accumulator.push(makeEvent(`/home/user/file${i}.txt`));
		}

		// First batch emitted at 200
		expect(batches).toHaveLength(1);
		expect(batches[0]).toHaveLength(200);

		// Remaining 50 will be flushed after interval
		vi.advanceTimersByTime(500);
		expect(batches).toHaveLength(2);
		expect(batches[1]).toHaveLength(50);
	});

	it('should cancel pending events when cancel is called (directory change)', () => {
		const batches: DirChangePayload[][] = [];
		const accumulator = createBatchAccumulator<DirChangePayload>(
			(events) => batches.push([...events]),
			WATCHER_BATCH_INTERVAL,
			WATCHER_MAX_BATCH_SIZE
		);

		accumulator.push(makeEvent('/home/user/file1.txt'));
		accumulator.push(makeEvent('/home/user/file2.txt'));

		// Simulate navigating away — cancel pending
		accumulator.cancel();

		// Advance time past the interval
		vi.advanceTimersByTime(1000);

		// No batch should have been emitted
		expect(batches).toHaveLength(0);
	});

	it('should allow new events after cancel', () => {
		const batches: DirChangePayload[][] = [];
		const accumulator = createBatchAccumulator<DirChangePayload>(
			(events) => batches.push([...events]),
			WATCHER_BATCH_INTERVAL,
			WATCHER_MAX_BATCH_SIZE
		);

		accumulator.push(makeEvent('/home/user/old-file.txt'));
		accumulator.cancel();

		// Push new events (new directory)
		accumulator.push(makeEvent('/home/other/new-file.txt'));
		vi.advanceTimersByTime(500);

		expect(batches).toHaveLength(1);
		expect(batches[0]).toHaveLength(1);
		expect(batches[0][0].changedPath).toBe('/home/other/new-file.txt');
	});

	it('should flush pending events immediately when flush is called', () => {
		const batches: DirChangePayload[][] = [];
		const accumulator = createBatchAccumulator<DirChangePayload>(
			(events) => batches.push([...events]),
			WATCHER_BATCH_INTERVAL,
			WATCHER_MAX_BATCH_SIZE
		);

		accumulator.push(makeEvent('/home/user/file1.txt'));
		accumulator.push(makeEvent('/home/user/file2.txt'));

		accumulator.flush();

		expect(batches).toHaveLength(1);
		expect(batches[0]).toHaveLength(2);
	});

	it('should not emit empty batch on flush when buffer is empty', () => {
		const batches: DirChangePayload[][] = [];
		const accumulator = createBatchAccumulator<DirChangePayload>(
			(events) => batches.push([...events]),
			WATCHER_BATCH_INTERVAL,
			WATCHER_MAX_BATCH_SIZE
		);

		accumulator.flush();

		expect(batches).toHaveLength(0);
	});

	it('should batch events arriving in quick succession within interval', () => {
		const batches: DirChangePayload[][] = [];
		const accumulator = createBatchAccumulator<DirChangePayload>(
			(events) => batches.push([...events]),
			WATCHER_BATCH_INTERVAL,
			WATCHER_MAX_BATCH_SIZE
		);

		// Simulate rapid watcher events over 300ms
		accumulator.push(makeEvent('/home/user/a.txt'));
		vi.advanceTimersByTime(100);
		accumulator.push(makeEvent('/home/user/b.txt'));
		vi.advanceTimersByTime(100);
		accumulator.push(makeEvent('/home/user/c.txt'));
		vi.advanceTimersByTime(100);

		// 300ms elapsed — not yet at 500ms threshold
		expect(batches).toHaveLength(0);

		// Advance to 500ms from first push
		vi.advanceTimersByTime(200);

		expect(batches).toHaveLength(1);
		expect(batches[0]).toHaveLength(3);
	});
});
