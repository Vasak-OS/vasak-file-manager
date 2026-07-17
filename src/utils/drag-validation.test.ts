import { describe, it, expect } from 'vitest';
import { isRecursiveDrop } from './drag-validation';

/**
 * Unit tests for drag validation utilities.
 * Validates Requirement 13.6: Reject drop within itself or subdirectories.
 */

describe('isRecursiveDrop', () => {
	describe('dropping directory into itself', () => {
		it('should reject when destination equals source path', () => {
			const result = isRecursiveDrop(['/home/user/Documents'], '/home/user/Documents');
			expect(result).toBe(true);
		});

		it('should reject when destination equals source with trailing slash', () => {
			const result = isRecursiveDrop(['/home/user/Documents/'], '/home/user/Documents');
			expect(result).toBe(true);
		});
	});

	describe('dropping directory into its subdirectory', () => {
		it('should reject when destination is a direct subdirectory', () => {
			const result = isRecursiveDrop(
				['/home/user/Documents'],
				'/home/user/Documents/subfolder'
			);
			expect(result).toBe(true);
		});

		it('should reject when destination is a deeply nested subdirectory', () => {
			const result = isRecursiveDrop(
				['/home/user/Documents'],
				'/home/user/Documents/a/b/c/d'
			);
			expect(result).toBe(true);
		});

		it('should reject when any source would be recursive', () => {
			const result = isRecursiveDrop(
				['/home/user/file.txt', '/home/user/Documents'],
				'/home/user/Documents/target'
			);
			expect(result).toBe(true);
		});
	});

	describe('valid drops (not recursive)', () => {
		it('should allow dropping into a sibling directory', () => {
			const result = isRecursiveDrop(
				['/home/user/Documents'],
				'/home/user/Downloads'
			);
			expect(result).toBe(false);
		});

		it('should allow dropping into parent directory', () => {
			const result = isRecursiveDrop(
				['/home/user/Documents/subfolder'],
				'/home/user/Documents'
			);
			expect(result).toBe(false);
		});

		it('should allow dropping files into any directory', () => {
			const result = isRecursiveDrop(
				['/home/user/file.txt'],
				'/home/user/Documents'
			);
			expect(result).toBe(false);
		});

		it('should not be tricked by similar path prefixes', () => {
			// "/home/user/Doc" is NOT a parent of "/home/user/Documents"
			const result = isRecursiveDrop(
				['/home/user/Doc'],
				'/home/user/Documents'
			);
			expect(result).toBe(false);
		});

		it('should not be tricked by path that starts with same chars', () => {
			// "/home/user/Documents-old" is NOT under "/home/user/Documents"
			const result = isRecursiveDrop(
				['/home/user/Documents'],
				'/home/user/Documents-old'
			);
			expect(result).toBe(false);
		});

		it('should allow empty source paths', () => {
			const result = isRecursiveDrop([], '/home/user/Documents');
			expect(result).toBe(false);
		});
	});
});
