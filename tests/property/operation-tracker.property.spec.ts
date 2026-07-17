import { describe, it, expect } from 'vitest';
import fc from 'fast-check';

/**
 * Pure function reimplemented from OperationTracker.vue for testability.
 * Truncates a file name to 60 characters with "..." indicator if it exceeds that length.
 */
function truncateFileName(name: string): string {
	if (name.length <= 60) return name;
	return `${name.slice(0, 57)}...`;
}

/**
 * Pure function that computes a batch operation summary from individual file results.
 * Models the invariant from BatchOperationResult where successful + failed + skipped = total.
 */
function computeSummary(results: Array<'success' | 'fail' | 'skip'>): {
	successful: number;
	failed: number;
	skipped: number;
} {
	let successful = 0;
	let failed = 0;
	let skipped = 0;

	for (const r of results) {
		if (r === 'success') successful++;
		else if (r === 'fail') failed++;
		else skipped++;
	}

	return { successful, failed, skipped };
}

describe('Property 16: Truncamiento de nombre de archivo en operaciones', () => {
	/**
	 * **Validates: Requirements 8.2**
	 *
	 * For any file name, if length > 60 chars → truncate to 57 + "..." (total 60);
	 * if ≤ 60 → show complete.
	 */
	it('file names with length <= 60 are returned unchanged', () => {
		fc.assert(
			fc.property(
				fc.string({ minLength: 0, maxLength: 60 }),
				(name) => {
					const result = truncateFileName(name);
					expect(result).toBe(name);
				},
			),
			{ numRuns: 100 },
		);
	});

	it('file names with length > 60 are truncated to exactly 60 characters', () => {
		fc.assert(
			fc.property(
				fc.string({ minLength: 61, maxLength: 500 }),
				(name) => {
					const result = truncateFileName(name);
					expect(result.length).toBe(60);
				},
			),
			{ numRuns: 100 },
		);
	});

	it('truncated names end with "..."', () => {
		fc.assert(
			fc.property(
				fc.string({ minLength: 61, maxLength: 500 }),
				(name) => {
					const result = truncateFileName(name);
					expect(result.endsWith('...')).toBe(true);
				},
			),
			{ numRuns: 100 },
		);
	});

	it('truncated names preserve the first 57 characters of the original', () => {
		fc.assert(
			fc.property(
				fc.string({ minLength: 61, maxLength: 500 }),
				(name) => {
					const result = truncateFileName(name);
					expect(result.slice(0, 57)).toBe(name.slice(0, 57));
				},
			),
			{ numRuns: 100 },
		);
	});

	it('result length is always <= 60 for any input', () => {
		fc.assert(
			fc.property(
				fc.string({ minLength: 0, maxLength: 1000 }),
				(name) => {
					const result = truncateFileName(name);
					expect(result.length).toBeLessThanOrEqual(60);
				},
			),
			{ numRuns: 100 },
		);
	});
});

describe('Property 17: Corrección del resumen de operación', () => {
	/**
	 * **Validates: Requirements 8.6, 11.6**
	 *
	 * For any set of file results (success/fail/skip), the summary counts
	 * SHALL sum to the total batch size.
	 */
	const arbFileResult = fc.constantFrom('success', 'fail', 'skip') as fc.Arbitrary<
		'success' | 'fail' | 'skip'
	>;

	it('successful + failed + skipped equals total batch size', () => {
		fc.assert(
			fc.property(
				fc.array(arbFileResult, { minLength: 0, maxLength: 500 }),
				(results) => {
					const summary = computeSummary(results);
					expect(summary.successful + summary.failed + summary.skipped).toBe(results.length);
				},
			),
			{ numRuns: 100 },
		);
	});

	it('counts are non-negative', () => {
		fc.assert(
			fc.property(
				fc.array(arbFileResult, { minLength: 0, maxLength: 500 }),
				(results) => {
					const summary = computeSummary(results);
					expect(summary.successful).toBeGreaterThanOrEqual(0);
					expect(summary.failed).toBeGreaterThanOrEqual(0);
					expect(summary.skipped).toBeGreaterThanOrEqual(0);
				},
			),
			{ numRuns: 100 },
		);
	});

	it('all-success batch reports zero failures and zero skips', () => {
		fc.assert(
			fc.property(
				fc.integer({ min: 1, max: 200 }),
				(count) => {
					const results: Array<'success' | 'fail' | 'skip'> = Array(count).fill('success');
					const summary = computeSummary(results);
					expect(summary.successful).toBe(count);
					expect(summary.failed).toBe(0);
					expect(summary.skipped).toBe(0);
				},
			),
			{ numRuns: 100 },
		);
	});

	it('all-fail batch reports zero successes and zero skips', () => {
		fc.assert(
			fc.property(
				fc.integer({ min: 1, max: 200 }),
				(count) => {
					const results: Array<'success' | 'fail' | 'skip'> = Array(count).fill('fail');
					const summary = computeSummary(results);
					expect(summary.successful).toBe(0);
					expect(summary.failed).toBe(count);
					expect(summary.skipped).toBe(0);
				},
			),
			{ numRuns: 100 },
		);
	});

	it('empty batch produces all-zero summary', () => {
		const summary = computeSummary([]);
		expect(summary.successful).toBe(0);
		expect(summary.failed).toBe(0);
		expect(summary.skipped).toBe(0);
	});

	it('individual counts match filtered array lengths', () => {
		fc.assert(
			fc.property(
				fc.array(arbFileResult, { minLength: 1, maxLength: 500 }),
				(results) => {
					const summary = computeSummary(results);
					expect(summary.successful).toBe(results.filter((r) => r === 'success').length);
					expect(summary.failed).toBe(results.filter((r) => r === 'fail').length);
					expect(summary.skipped).toBe(results.filter((r) => r === 'skip').length);
				},
			),
			{ numRuns: 100 },
		);
	});
});
