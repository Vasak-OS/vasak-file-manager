import { describe, expect, it } from 'vitest';
import { highlightCode, highlightLine } from './syntax-highlighter';

describe('syntax-highlighter', () => {
	describe('highlightLine', () => {
		it('highlights keywords in JavaScript', () => {
			const { tokens } = highlightLine('const x = 5;', 'javascript', false);
			const keywordToken = tokens.find((t) => t.text === 'const');
			expect(keywordToken).toBeDefined();
			expect(keywordToken?.type).toBe('keyword');
		});

		it('highlights strings in single quotes', () => {
			const { tokens } = highlightLine("const s = 'hello';", 'javascript', false);
			const stringToken = tokens.find((t) => t.type === 'string');
			expect(stringToken).toBeDefined();
			expect(stringToken?.text).toBe("'hello'");
		});

		it('highlights strings in double quotes', () => {
			const { tokens } = highlightLine('const s = "world";', 'typescript', false);
			const stringToken = tokens.find((t) => t.type === 'string');
			expect(stringToken).toBeDefined();
			expect(stringToken?.text).toBe('"world"');
		});

		it('highlights line comments in JavaScript', () => {
			const { tokens } = highlightLine('// this is a comment', 'javascript', false);
			expect(tokens).toHaveLength(1);
			expect(tokens[0].type).toBe('comment');
			expect(tokens[0].text).toBe('// this is a comment');
		});

		it('highlights line comments in Python', () => {
			const { tokens } = highlightLine('# a comment', 'python', false);
			expect(tokens).toHaveLength(1);
			expect(tokens[0].type).toBe('comment');
		});

		it('highlights numbers', () => {
			const { tokens } = highlightLine('let x = 42;', 'javascript', false);
			const numToken = tokens.find((t) => t.type === 'number');
			expect(numToken).toBeDefined();
			expect(numToken?.text).toBe('42');
		});

		it('handles block comments that start and end on same line', () => {
			const { tokens, inBlockComment } = highlightLine('/* comment */ code', 'javascript', false);
			expect(inBlockComment).toBe(false);
			const commentToken = tokens.find((t) => t.type === 'comment');
			expect(commentToken).toBeDefined();
			expect(commentToken?.text).toBe('/* comment */');
		});

		it('tracks block comment state across lines', () => {
			const line1 = highlightLine('/* start of', 'javascript', false);
			expect(line1.inBlockComment).toBe(true);

			const line2 = highlightLine('still in comment */', 'javascript', true);
			expect(line2.inBlockComment).toBe(false);
			expect(line2.tokens[0].type).toBe('comment');
		});

		it('highlights Rust keywords', () => {
			const { tokens } = highlightLine('fn main() {', 'rust', false);
			const fnToken = tokens.find((t) => t.text === 'fn');
			expect(fnToken).toBeDefined();
			expect(fnToken?.type).toBe('keyword');
		});

		it('highlights Python keywords', () => {
			const { tokens } = highlightLine('def hello():', 'python', false);
			const defToken = tokens.find((t) => t.text === 'def');
			expect(defToken).toBeDefined();
			expect(defToken?.type).toBe('keyword');
		});

		it('handles escaped characters in strings', () => {
			const { tokens } = highlightLine("const s = 'it\\'s';", 'javascript', false);
			const stringToken = tokens.find((t) => t.type === 'string');
			expect(stringToken).toBeDefined();
			expect(stringToken?.text).toBe("'it\\'s'");
		});

		it('returns text tokens for non-keyword identifiers', () => {
			const { tokens } = highlightLine('myVariable', 'javascript', false);
			expect(tokens).toHaveLength(1);
			expect(tokens[0].type).toBe('text');
			expect(tokens[0].text).toBe('myVariable');
		});

		it('handles empty line', () => {
			const { tokens } = highlightLine('', 'javascript', false);
			expect(tokens).toHaveLength(0);
		});

		it('uses default rules for unknown language', () => {
			const { tokens } = highlightLine('// a comment', 'unknown_lang', false);
			expect(tokens[0].type).toBe('comment');
		});
	});

	describe('highlightCode', () => {
		it('highlights multiple lines preserving block comment state', () => {
			const code = '/* block\ncomment */\nconst x = 1;';
			const lines = highlightCode(code, 'javascript');
			expect(lines).toHaveLength(3);
			// Line 1: block comment start
			expect(lines[0].tokens[0].type).toBe('comment');
			// Line 2: block comment end
			expect(lines[1].tokens[0].type).toBe('comment');
			// Line 3: normal code
			const keywordToken = lines[2].tokens.find((t) => t.text === 'const');
			expect(keywordToken?.type).toBe('keyword');
		});

		it('handles single line input', () => {
			const lines = highlightCode('return true;', 'javascript');
			expect(lines).toHaveLength(1);
			const kwToken = lines[0].tokens.find((t) => t.text === 'return');
			expect(kwToken?.type).toBe('keyword');
			const boolToken = lines[0].tokens.find((t) => t.text === 'true');
			expect(boolToken?.type).toBe('keyword');
		});

		it('returns correct number of lines', () => {
			const code = 'line1\nline2\nline3\nline4\nline5';
			const lines = highlightCode(code, 'text');
			expect(lines).toHaveLength(5);
		});
	});
});
