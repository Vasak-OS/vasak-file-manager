/**
 * Lightweight syntax highlighter for file preview.
 * Provides basic highlighting for keywords, strings, and comments
 * without external dependencies.
 */

export interface HighlightToken {
	text: string;
	type: 'keyword' | 'string' | 'comment' | 'number' | 'operator' | 'text';
}

export interface HighlightedLine {
	tokens: HighlightToken[];
}

interface LanguageRules {
	keywords: string[];
	lineComment: string;
	blockCommentStart: string;
	blockCommentEnd: string;
	stringDelimiters: string[];
}

const LANGUAGE_RULES: Record<string, LanguageRules> = {
	javascript: {
		keywords: [
			'const',
			'let',
			'var',
			'function',
			'return',
			'if',
			'else',
			'for',
			'while',
			'do',
			'switch',
			'case',
			'break',
			'continue',
			'new',
			'this',
			'class',
			'extends',
			'import',
			'export',
			'from',
			'default',
			'async',
			'await',
			'try',
			'catch',
			'finally',
			'throw',
			'typeof',
			'instanceof',
			'in',
			'of',
			'null',
			'undefined',
			'true',
			'false',
			'yield',
			'super',
			'static',
			'get',
			'set',
		],
		lineComment: '//',
		blockCommentStart: '/*',
		blockCommentEnd: '*/',
		stringDelimiters: ["'", '"', '`'],
	},
	typescript: {
		keywords: [
			'const',
			'let',
			'var',
			'function',
			'return',
			'if',
			'else',
			'for',
			'while',
			'do',
			'switch',
			'case',
			'break',
			'continue',
			'new',
			'this',
			'class',
			'extends',
			'import',
			'export',
			'from',
			'default',
			'async',
			'await',
			'try',
			'catch',
			'finally',
			'throw',
			'typeof',
			'instanceof',
			'in',
			'of',
			'null',
			'undefined',
			'true',
			'false',
			'yield',
			'super',
			'static',
			'get',
			'set',
			'interface',
			'type',
			'enum',
			'implements',
			'abstract',
			'readonly',
			'as',
			'keyof',
			'never',
			'unknown',
			'any',
			'void',
			'string',
			'number',
			'boolean',
		],
		lineComment: '//',
		blockCommentStart: '/*',
		blockCommentEnd: '*/',
		stringDelimiters: ["'", '"', '`'],
	},
	python: {
		keywords: [
			'def',
			'class',
			'return',
			'if',
			'elif',
			'else',
			'for',
			'while',
			'break',
			'continue',
			'import',
			'from',
			'as',
			'try',
			'except',
			'finally',
			'raise',
			'with',
			'yield',
			'lambda',
			'pass',
			'and',
			'or',
			'not',
			'in',
			'is',
			'True',
			'False',
			'None',
			'self',
			'async',
			'await',
			'global',
			'nonlocal',
		],
		lineComment: '#',
		blockCommentStart: '"""',
		blockCommentEnd: '"""',
		stringDelimiters: ["'", '"'],
	},
	rust: {
		keywords: [
			'fn',
			'let',
			'mut',
			'const',
			'struct',
			'enum',
			'impl',
			'trait',
			'pub',
			'use',
			'mod',
			'crate',
			'self',
			'super',
			'return',
			'if',
			'else',
			'match',
			'for',
			'while',
			'loop',
			'break',
			'continue',
			'as',
			'in',
			'ref',
			'move',
			'async',
			'await',
			'unsafe',
			'where',
			'type',
			'dyn',
			'true',
			'false',
			'Some',
			'None',
			'Ok',
			'Err',
			'Self',
		],
		lineComment: '//',
		blockCommentStart: '/*',
		blockCommentEnd: '*/',
		stringDelimiters: ['"'],
	},
	html: {
		keywords: [
			'html',
			'head',
			'body',
			'div',
			'span',
			'p',
			'a',
			'img',
			'script',
			'style',
			'link',
			'meta',
			'title',
			'section',
			'header',
			'footer',
			'nav',
			'main',
			'article',
			'aside',
			'template',
			'slot',
			'component',
		],
		lineComment: '',
		blockCommentStart: '<!--',
		blockCommentEnd: '-->',
		stringDelimiters: ["'", '"'],
	},
	css: {
		keywords: [
			'color',
			'background',
			'border',
			'margin',
			'padding',
			'display',
			'flex',
			'grid',
			'position',
			'width',
			'height',
			'font',
			'text',
			'align',
			'justify',
			'important',
			'none',
			'inherit',
			'initial',
			'auto',
			'solid',
			'relative',
			'absolute',
			'fixed',
			'sticky',
		],
		lineComment: '',
		blockCommentStart: '/*',
		blockCommentEnd: '*/',
		stringDelimiters: ["'", '"'],
	},
	json: {
		keywords: ['true', 'false', 'null'],
		lineComment: '',
		blockCommentStart: '',
		blockCommentEnd: '',
		stringDelimiters: ['"'],
	},
	go: {
		keywords: [
			'func',
			'package',
			'import',
			'return',
			'if',
			'else',
			'for',
			'range',
			'switch',
			'case',
			'default',
			'break',
			'continue',
			'var',
			'const',
			'type',
			'struct',
			'interface',
			'map',
			'chan',
			'go',
			'defer',
			'select',
			'nil',
			'true',
			'false',
			'make',
			'new',
			'append',
			'len',
			'cap',
		],
		lineComment: '//',
		blockCommentStart: '/*',
		blockCommentEnd: '*/',
		stringDelimiters: ['"', '`'],
	},
};

// Default rules for languages not explicitly defined
const DEFAULT_RULES: LanguageRules = {
	keywords: [],
	lineComment: '//',
	blockCommentStart: '/*',
	blockCommentEnd: '*/',
	stringDelimiters: ["'", '"'],
};

function getRulesForLanguage(language: string): LanguageRules {
	return LANGUAGE_RULES[language] || DEFAULT_RULES;
}

/**
 * Highlights a single line of code into tokens.
 * Handles: comments, strings, numbers, keywords, and plain text.
 */
export function highlightLine(
	line: string,
	language: string,
	inBlockComment: boolean
): { tokens: HighlightToken[]; inBlockComment: boolean } {
	const rules = getRulesForLanguage(language);
	const tokens: HighlightToken[] = [];
	let i = 0;
	let currentInBlock = inBlockComment;

	while (i < line.length) {
		// If we're inside a block comment, look for the end
		if (currentInBlock) {
			if (rules.blockCommentEnd && line.startsWith(rules.blockCommentEnd, i)) {
				const endLen = rules.blockCommentEnd.length;
				tokens.push({ text: line.slice(i, i + endLen), type: 'comment' });
				i += endLen;
				currentInBlock = false;
			} else {
				// Consume characters until end of block or end of line
				const endIdx = rules.blockCommentEnd ? line.indexOf(rules.blockCommentEnd, i) : -1;
				if (endIdx === -1) {
					tokens.push({ text: line.slice(i), type: 'comment' });
					i = line.length;
				} else {
					tokens.push({
						text: line.slice(i, endIdx + rules.blockCommentEnd.length),
						type: 'comment',
					});
					i = endIdx + rules.blockCommentEnd.length;
					currentInBlock = false;
				}
			}
			continue;
		}

		// Check for line comment
		if (rules.lineComment && line.startsWith(rules.lineComment, i)) {
			tokens.push({ text: line.slice(i), type: 'comment' });
			i = line.length;
			continue;
		}

		// Check for block comment start
		if (rules.blockCommentStart && line.startsWith(rules.blockCommentStart, i)) {
			const endIdx = line.indexOf(rules.blockCommentEnd, i + rules.blockCommentStart.length);
			if (endIdx !== -1) {
				// Block comment starts and ends on same line
				const end = endIdx + rules.blockCommentEnd.length;
				tokens.push({ text: line.slice(i, end), type: 'comment' });
				i = end;
			} else {
				// Block comment starts but doesn't end on this line
				tokens.push({ text: line.slice(i), type: 'comment' });
				i = line.length;
				currentInBlock = true;
			}
			continue;
		}

		// Check for strings
		let foundString = false;
		for (const delim of rules.stringDelimiters) {
			if (line.startsWith(delim, i)) {
				const closeIdx = findStringEnd(line, i + delim.length, delim);
				if (closeIdx !== -1) {
					tokens.push({ text: line.slice(i, closeIdx + delim.length), type: 'string' });
					i = closeIdx + delim.length;
				} else {
					// Unterminated string — consume rest of line
					tokens.push({ text: line.slice(i), type: 'string' });
					i = line.length;
				}
				foundString = true;
				break;
			}
		}
		if (foundString) continue;

		// Check for numbers
		if (/[0-9]/.test(line[i]) && (i === 0 || /[\s([\]{},;:=+\-*/<>!&|^~%]/.test(line[i - 1]))) {
			let numEnd = i;
			while (numEnd < line.length && /[0-9a-fA-Fx._]/.test(line[numEnd])) {
				numEnd++;
			}
			tokens.push({ text: line.slice(i, numEnd), type: 'number' });
			i = numEnd;
			continue;
		}

		// Check for keywords (word boundary)
		if (/[a-zA-Z_]/.test(line[i])) {
			let wordEnd = i;
			while (wordEnd < line.length && /[a-zA-Z0-9_]/.test(line[wordEnd])) {
				wordEnd++;
			}
			const word = line.slice(i, wordEnd);
			if (rules.keywords.includes(word)) {
				tokens.push({ text: word, type: 'keyword' });
			} else {
				tokens.push({ text: word, type: 'text' });
			}
			i = wordEnd;
			continue;
		}

		// Operators and other characters — batch consecutive non-word chars as text
		let textEnd = i;
		while (
			textEnd < line.length &&
			!/[a-zA-Z0-9_]/.test(line[textEnd]) &&
			!rules.stringDelimiters.some((d) => line.startsWith(d, textEnd)) &&
			!(rules.lineComment && line.startsWith(rules.lineComment, textEnd)) &&
			!(rules.blockCommentStart && line.startsWith(rules.blockCommentStart, textEnd))
		) {
			textEnd++;
		}
		if (textEnd > i) {
			tokens.push({ text: line.slice(i, textEnd), type: 'text' });
			i = textEnd;
		} else {
			// Fallback: advance one character
			tokens.push({ text: line[i], type: 'text' });
			i++;
		}
	}

	return { tokens, inBlockComment: currentInBlock };
}

/**
 * Find the end of a string (closing delimiter), handling escape characters.
 */
function findStringEnd(line: string, startIdx: number, delimiter: string): number {
	let i = startIdx;
	while (i < line.length) {
		if (line[i] === '\\') {
			i += 2; // Skip escaped character
			continue;
		}
		if (line.startsWith(delimiter, i)) {
			return i;
		}
		i++;
	}
	return -1;
}

/**
 * Highlights multiple lines of code, tracking block comment state across lines.
 */
export function highlightCode(content: string, language: string): HighlightedLine[] {
	const lines = content.split('\n');
	const result: HighlightedLine[] = [];
	let inBlockComment = false;

	for (const line of lines) {
		const { tokens, inBlockComment: newState } = highlightLine(line, language, inBlockComment);
		result.push({ tokens });
		inBlockComment = newState;
	}

	return result;
}
