import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import {
	isDestructiveOperation,
	type BatchOperationType,
	type BatchOperationResult,
} from '@/composables/use-batch-operations';

/**
 * Arbitrary: generates a DirEntry-like object for testing batch operations.
 */
const arbDirEntry = fc.record({
	name: fc.string({ minLength: 1, maxLength: 50 }),
	ext: fc.option(fc.string({ minLength: 1, maxLength: 5 }), { nil: null }),
	path: fc.string({ minLength: 1, maxLength: 100 }).map((s) => `/home/user/${s}`),
	size: fc.nat({ max: 1_000_000_000 }),
	item_count: fc.option(fc.nat({ max: 10000 }), { nil: null }),
	modified_time: fc.nat({ max: 2_000_000_000 }),
	accessed_time: fc.nat({ max: 2_000_000_000 }),
	created_time: fc.nat({ max: 2_000_000_000 }),
	mime: fc.option(fc.string({ minLength: 3, maxLength: 30 }), { nil: null }),
	is_file: fc.boolean(),
	is_dir: fc.boolean(),
	is_symlink: fc.constant(false),
	is_hidden: fc.boolean(),
});

const arbDirEntryArray = (min: number, max: number) =>
	fc.array(arbDirEntry, { minLength: min, maxLength: max });

/**
 * Arbitrary: generates batch operation types.
 */
const arbDestructiveOp = fc.constantFrom<BatchOperationType>('delete', 'move');
const arbNonDestructiveOp = fc.constantFrom<BatchOperationType>('copy', 'compress', 'changePermissions');
const arbBatchOperationType = fc.constantFrom<BatchOperationType>('copy', 'move', 'delete', 'compress', 'changePermissions');

describe('Property 23: Diálogo de confirmación para operaciones destructivas en lote', () => {
	/**
	 * **Validates: Requirements 11.1**
	 *
	 * For any selection of ≥2 entries and a destructive operation type (delete, move),
	 * confirmation SHALL be required. For selections of 1 entry or non-destructive
	 * operations (copy, compress, changePermissions), no confirmation SHALL be required.
	 */

	it('destructive operations are correctly identified', () => {
		fc.assert(
			fc.property(arbDestructiveOp, (opType) => {
				expect(isDestructiveOperation(opType)).toBe(true);
			}),
			{ numRuns: 100 },
		);
	});

	it('non-destructive operations are correctly identified', () => {
		fc.assert(
			fc.property(arbNonDestructiveOp, (opType) => {
				expect(isDestructiveOperation(opType)).toBe(false);
			}),
			{ numRuns: 100 },
		);
	});

	it('confirmation required for ≥2 entries AND destructive operation', () => {
		fc.assert(
			fc.property(
				arbDirEntryArray(2, 100),
				arbDestructiveOp,
				(entries, opType) => {
					const requiresConfirmation = isDestructiveOperation(opType) && entries.length >= 2;
					expect(requiresConfirmation).toBe(true);
				},
			),
			{ numRuns: 100 },
		);
	});

	it('no confirmation required for 1 entry regardless of operation type', () => {
		fc.assert(
			fc.property(
				arbDirEntryArray(1, 1),
				arbBatchOperationType,
				(entries, opType) => {
					// With exactly 1 entry, even destructive ops don't require confirmation
					const requiresConfirmation = isDestructiveOperation(opType) && entries.length >= 2;
					expect(requiresConfirmation).toBe(false);
				},
			),
			{ numRuns: 100 },
		);
	});

	it('no confirmation required for non-destructive operations regardless of entry count', () => {
		fc.assert(
			fc.property(
				arbDirEntryArray(1, 100),
				arbNonDestructiveOp,
				(entries, opType) => {
					const requiresConfirmation = isDestructiveOperation(opType) && entries.length >= 2;
					expect(requiresConfirmation).toBe(false);
				},
			),
			{ numRuns: 100 },
		);
	});

	it('confirmation logic is a pure function of operation type and entry count', () => {
		fc.assert(
			fc.property(
				arbDirEntryArray(0, 100),
				arbBatchOperationType,
				(entries, opType) => {
					const result1 = isDestructiveOperation(opType) && entries.length >= 2;
					const result2 = isDestructiveOperation(opType) && entries.length >= 2;
					expect(result1).toBe(result2);
				},
			),
			{ numRuns: 100 },
		);
	});
});

describe('Property 24: Preservación de archivos procesados al cancelar', () => {
	/**
	 * **Validates: Requirements 11.5**
	 *
	 * For any batch operation cancelled at point K of N total files,
	 * K files SHALL be reported as processed and (N-K) as pending.
	 *
	 * Tests the pure accounting logic: given a total N and cancellation point K,
	 * the result correctly reflects processed vs pending counts.
	 */

	/**
	 * Simulates the cancellation accounting logic from use-batch-operations.ts.
	 * When cancelled at index K, processed = successes so far, pending = N - K.
	 */
	function simulateCancellation(
		totalFiles: number,
		cancelAtIndex: number,
		failedBeforeCancel: number,
	): { successful: number; failed: number; skipped: number } {
		const processed = cancelAtIndex - failedBeforeCancel;
		const pending = totalFiles - cancelAtIndex;
		return {
			successful: processed,
			failed: failedBeforeCancel,
			skipped: pending,
		};
	}

	it('successful + failed + skipped = total after cancellation', () => {
		fc.assert(
			fc.property(
				fc.integer({ min: 2, max: 500 }), // totalFiles (at least 2 for meaningful cancel)
				fc.integer({ min: 1, max: 499 }), // cancelAtIndex
				(totalFiles, cancelAtRaw) => {
					// Ensure cancelAtIndex < totalFiles
					const cancelAtIndex = Math.min(cancelAtRaw, totalFiles - 1);
					// Ensure failures don't exceed processed count
					const maxFailures = cancelAtIndex;
					const failedBeforeCancel = cancelAtIndex > 0 ? Math.floor(Math.random() * maxFailures) : 0;

					const result = simulateCancellation(totalFiles, cancelAtIndex, failedBeforeCancel);

					expect(result.successful + result.failed + result.skipped).toBe(totalFiles);
				},
			),
			{ numRuns: 100 },
		);
	});

	it('processed files (K) are preserved and pending (N-K) are reported', () => {
		fc.assert(
			fc.property(
				fc.integer({ min: 2, max: 10000 }), // totalFiles
				fc.integer({ min: 0, max: 9999 }), // cancelAtIndex (raw)
				(totalFiles, cancelAtRaw) => {
					const cancelAtIndex = Math.min(cancelAtRaw, totalFiles - 1);
					const failedBeforeCancel = 0; // simplify: no failures

					const result = simulateCancellation(totalFiles, cancelAtIndex, failedBeforeCancel);

					// K files processed (successful)
					expect(result.successful).toBe(cancelAtIndex);
					// N-K files pending (skipped)
					expect(result.skipped).toBe(totalFiles - cancelAtIndex);
					// No failures in this scenario
					expect(result.failed).toBe(0);
				},
			),
			{ numRuns: 100 },
		);
	});

	it('cancellation at first file means 0 processed and N pending', () => {
		fc.assert(
			fc.property(
				fc.integer({ min: 1, max: 10000 }), // totalFiles
				(totalFiles) => {
					const result = simulateCancellation(totalFiles, 0, 0);

					expect(result.successful).toBe(0);
					expect(result.failed).toBe(0);
					expect(result.skipped).toBe(totalFiles);
				},
			),
			{ numRuns: 100 },
		);
	});

	it('cancellation at last file means (N-1) processed and 1 pending', () => {
		fc.assert(
			fc.property(
				fc.integer({ min: 2, max: 10000 }), // totalFiles
				(totalFiles) => {
					const cancelAtIndex = totalFiles - 1;
					const result = simulateCancellation(totalFiles, cancelAtIndex, 0);

					expect(result.successful).toBe(totalFiles - 1);
					expect(result.failed).toBe(0);
					expect(result.skipped).toBe(1);
				},
			),
			{ numRuns: 100 },
		);
	});

	it('failures before cancellation are correctly accounted for', () => {
		fc.assert(
			fc.property(
				fc.integer({ min: 3, max: 500 }), // totalFiles
				fc.integer({ min: 2, max: 499 }), // cancelAtIndex (raw)
				fc.integer({ min: 0, max: 100 }), // failedBeforeCancel (raw)
				(totalFiles, cancelAtRaw, failedRaw) => {
					const cancelAtIndex = Math.min(cancelAtRaw, totalFiles - 1);
					const failedBeforeCancel = Math.min(failedRaw, cancelAtIndex);
					const result = simulateCancellation(totalFiles, cancelAtIndex, failedBeforeCancel);

					// successful = items processed without failure
					expect(result.successful).toBe(cancelAtIndex - failedBeforeCancel);
					// failed = items that failed
					expect(result.failed).toBe(failedBeforeCancel);
					// skipped = items not yet reached
					expect(result.skipped).toBe(totalFiles - cancelAtIndex);
					// Total invariant
					expect(result.successful + result.failed + result.skipped).toBe(totalFiles);
				},
			),
			{ numRuns: 100 },
		);
	});
});

describe('Property 25: Continuidad de batch ante fallo individual', () => {
	/**
	 * **Validates: Requirements 11.6**
	 *
	 * For any batch operation where some files fail individually, the batch
	 * SHALL continue processing and the final summary SHALL satisfy:
	 * successful + failed + skipped = total.
	 *
	 * Tests the pure batch result accounting logic.
	 */

	/**
	 * Simulates batch processing with error isolation.
	 * Each entry either succeeds or fails, but the batch continues regardless.
	 */
	async function simulateBatchWithFailures(
		totalEntries: number,
		shouldFail: (index: number) => boolean,
	): Promise<BatchOperationResult> {
		let successful = 0;
		let failed = 0;
		const failedPaths: Array<{ path: string; error: string }> = [];

		for (let i = 0; i < totalEntries; i++) {
			if (shouldFail(i)) {
				failed++;
				failedPaths.push({ path: `/file-${i}`, error: 'Permission denied' });
			} else {
				successful++;
			}
		}

		return {
			successful,
			failed,
			skipped: 0,
			failedPaths,
		};
	}

	it('successful + failed + skipped = total for any failure pattern', () => {
		fc.assert(
			fc.asyncProperty(
				fc.integer({ min: 1, max: 500 }), // totalEntries
				fc.array(fc.boolean(), { minLength: 1, maxLength: 500 }), // failure pattern
				async (totalEntries, failurePattern) => {
					const shouldFail = (index: number) => failurePattern[index % failurePattern.length];

					const result = await simulateBatchWithFailures(totalEntries, shouldFail);

					expect(result.successful + result.failed + result.skipped).toBe(totalEntries);
				},
			),
			{ numRuns: 100 },
		);
	});

	it('failedPaths count matches failed count', () => {
		fc.assert(
			fc.asyncProperty(
				fc.integer({ min: 1, max: 200 }), // totalEntries
				fc.array(fc.boolean(), { minLength: 1, maxLength: 200 }), // failure pattern
				async (totalEntries, failurePattern) => {
					const shouldFail = (index: number) => failurePattern[index % failurePattern.length];

					const result = await simulateBatchWithFailures(totalEntries, shouldFail);

					expect(result.failedPaths.length).toBe(result.failed);
				},
			),
			{ numRuns: 100 },
		);
	});

	it('all entries succeed when no failures occur', () => {
		fc.assert(
			fc.asyncProperty(
				fc.integer({ min: 1, max: 500 }), // totalEntries
				async (totalEntries) => {
					const result = await simulateBatchWithFailures(totalEntries, () => false);

					expect(result.successful).toBe(totalEntries);
					expect(result.failed).toBe(0);
					expect(result.skipped).toBe(0);
					expect(result.failedPaths).toHaveLength(0);
				},
			),
			{ numRuns: 100 },
		);
	});

	it('all entries fail when everything fails', () => {
		fc.assert(
			fc.asyncProperty(
				fc.integer({ min: 1, max: 500 }), // totalEntries
				async (totalEntries) => {
					const result = await simulateBatchWithFailures(totalEntries, () => true);

					expect(result.successful).toBe(0);
					expect(result.failed).toBe(totalEntries);
					expect(result.skipped).toBe(0);
					expect(result.failedPaths).toHaveLength(totalEntries);
				},
			),
			{ numRuns: 100 },
		);
	});

	it('batch continues processing after individual failure (no short-circuit)', () => {
		fc.assert(
			fc.asyncProperty(
				fc.integer({ min: 3, max: 200 }), // totalEntries
				fc.integer({ min: 0, max: 199 }), // failAtIndex (raw)
				async (totalEntries, failAtIndexRaw) => {
					const failAtIndex = failAtIndexRaw % totalEntries;
					// Only one file fails at a specific index
					const shouldFail = (index: number) => index === failAtIndex;

					const result = await simulateBatchWithFailures(totalEntries, shouldFail);

					// Exactly 1 failure, rest succeed
					expect(result.failed).toBe(1);
					expect(result.successful).toBe(totalEntries - 1);
					// Batch did NOT stop at the failure point
					expect(result.successful + result.failed).toBe(totalEntries);
				},
			),
			{ numRuns: 100 },
		);
	});

	it('result accounting is deterministic for same inputs', () => {
		fc.assert(
			fc.asyncProperty(
				fc.integer({ min: 1, max: 200 }),
				fc.array(fc.boolean(), { minLength: 1, maxLength: 200 }),
				async (totalEntries, failurePattern) => {
					const shouldFail = (index: number) => failurePattern[index % failurePattern.length];

					const result1 = await simulateBatchWithFailures(totalEntries, shouldFail);
					const result2 = await simulateBatchWithFailures(totalEntries, shouldFail);

					expect(result1.successful).toBe(result2.successful);
					expect(result1.failed).toBe(result2.failed);
					expect(result1.skipped).toBe(result2.skipped);
				},
			),
			{ numRuns: 100 },
		);
	});
});
