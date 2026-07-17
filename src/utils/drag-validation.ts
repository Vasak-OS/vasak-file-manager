/**
 * Drag & Drop validation utilities.
 *
 * Requirements:
 * - 13.6: Reject drop within itself or subdirectories (visual indicator)
 * - 13.7: Error when dropping in directory without write permissions
 */

/**
 * Checks if the destination path is the source itself or one of its subdirectories.
 * Used to reject recursive drops (Requirement 13.6).
 *
 * @param sourcePaths - Paths of the items being dragged
 * @param destinationPath - Path of the drop target directory
 * @returns true if the drop would be recursive (invalid)
 */
export function isRecursiveDrop(sourcePaths: string[], destinationPath: string): boolean {
	// Normalize destination with trailing separator for prefix matching
	const normalizedDest = destinationPath.endsWith('/')
		? destinationPath
		: `${destinationPath}/`;

	for (const source of sourcePaths) {
		// Case 1: Dropping into itself (destination === source)
		if (destinationPath === source) {
			return true;
		}

		// Case 2: Dropping into a subdirectory of source
		// Normalize source with trailing separator
		const normalizedSource = source.endsWith('/') ? source : `${source}/`;
		if (normalizedDest.startsWith(normalizedSource)) {
			return true;
		}
	}

	return false;
}
