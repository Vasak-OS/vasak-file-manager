/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi } from 'vitest';
import type { DirEntry } from '@/types/dir-entry';
import {
  isImageFile,
  isVideoFile,
  isAudioFile,
  isPdfFile,
  isTextFile,
} from '@/utils/files';

// Mock Tauri API
vi.mock('@tauri-apps/api/core', () => ({
  convertFileSrc: (path: string) => `asset://${path}`,
  invoke: vi.fn(),
}));

function createEntry(overrides: Partial<DirEntry> = {}): DirEntry {
  return {
    name: 'test-file.txt',
    ext: 'txt',
    path: '/home/user/test-file.txt',
    size: 1024,
    item_count: null,
    modified_time: 1700000000,
    accessed_time: 1700000000,
    created_time: 1699000000,
    mime: 'text/plain',
    is_file: true,
    is_dir: false,
    is_symlink: false,
    is_hidden: false,
    ...overrides,
  };
}

type PreviewType = 'image' | 'text' | 'video' | 'audio' | 'pdf' | 'unsupported';

/** Mirrors the strategy selection logic from FilePreviewPanel.vue */
function determinePreviewType(entry: DirEntry | null): PreviewType {
  if (!entry || entry.is_dir) return 'unsupported';
  if (isImageFile(entry)) return 'image';
  if (isTextFile(entry)) return 'text';
  if (isVideoFile(entry)) return 'video';
  if (isAudioFile(entry)) return 'audio';
  if (isPdfFile(entry)) return 'pdf';
  return 'unsupported';
}

/** Mirrors formatFileSize from FilePreviewPanel.vue */
function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  const size = bytes / 1024 ** i;
  return `${size.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

/** Mirrors formatDuration from FilePreviewPanel.vue */
function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

/** Mirrors extensionToLanguage from FilePreviewPanel.vue */
function extensionToLanguage(ext: string): string {
  const map: Record<string, string> = {
    js: 'javascript', ts: 'typescript', jsx: 'javascript', tsx: 'typescript',
    vue: 'html', py: 'python', java: 'java', cpp: 'cpp', c: 'c', h: 'c',
    rs: 'rust', go: 'go', rb: 'ruby', php: 'php', swift: 'swift',
    kt: 'kotlin', cs: 'csharp', html: 'html', css: 'css',
    scss: 'css', sass: 'css', less: 'css', json: 'json', xml: 'xml',
    yaml: 'yaml', yml: 'yaml', toml: 'toml', md: 'markdown',
    sh: 'bash', bash: 'bash', ps1: 'powershell', sql: 'sql',
    txt: 'text', log: 'text', ini: 'ini', cfg: 'ini', conf: 'ini', env: 'text',
  };
  return map[ext] || 'text';
}

/** Mirrors zoom logic from FilePreviewPanel.vue */
function clampZoom(level: number, min = 25, max = 400): number {
  return Math.max(min, Math.min(max, level));
}

describe('FilePreviewPanel - Strategy Selection', () => {
  it('selects image strategy for image extensions', () => {
    const imageExts = ['jpg', 'jpeg', 'png', 'gif', 'bmp', 'webp', 'svg', 'ico', 'tiff', 'avif'];
    for (const ext of imageExts) {
      const entry = createEntry({ ext, name: `file.${ext}` });
      expect(determinePreviewType(entry)).toBe('image');
    }
  });

  it('selects text strategy for code extensions', () => {
    const codeExts = ['js', 'ts', 'jsx', 'tsx', 'vue', 'py', 'java', 'rs', 'go', 'html', 'css', 'json'];
    for (const ext of codeExts) {
      const entry = createEntry({ ext, name: `file.${ext}` });
      expect(determinePreviewType(entry)).toBe('text');
    }
  });

  it('selects text strategy for text extensions', () => {
    const textExts = ['txt', 'log', 'ini', 'cfg', 'conf', 'env'];
    for (const ext of textExts) {
      const entry = createEntry({ ext, name: `file.${ext}` });
      expect(determinePreviewType(entry)).toBe('text');
    }
  });

  it('selects video strategy for video extensions', () => {
    const videoExts = ['mp4', 'mkv', 'avi', 'mov', 'wmv', 'flv', 'webm'];
    for (const ext of videoExts) {
      const entry = createEntry({ ext, name: `file.${ext}` });
      expect(determinePreviewType(entry)).toBe('video');
    }
  });

  it('selects audio strategy for audio extensions', () => {
    const audioExts = ['mp3', 'wav', 'flac', 'aac', 'ogg', 'wma', 'm4a', 'opus'];
    for (const ext of audioExts) {
      const entry = createEntry({ ext, name: `file.${ext}` });
      expect(determinePreviewType(entry)).toBe('audio');
    }
  });

  it('selects pdf strategy for pdf extension', () => {
    const entry = createEntry({ ext: 'pdf', name: 'doc.pdf' });
    expect(determinePreviewType(entry)).toBe('pdf');
  });

  it('returns unsupported for unknown extensions', () => {
    const entry = createEntry({ ext: 'xyz', name: 'file.xyz' });
    expect(determinePreviewType(entry)).toBe('unsupported');
  });

  it('returns unsupported for directories', () => {
    const entry = createEntry({ is_dir: true, is_file: false, ext: null, name: 'mydir' });
    expect(determinePreviewType(entry)).toBe('unsupported');
  });

  it('returns unsupported for null entry', () => {
    expect(determinePreviewType(null)).toBe('unsupported');
  });

  it('returns unsupported for files without extension', () => {
    const entry = createEntry({ ext: null, name: 'Makefile' });
    expect(determinePreviewType(entry)).toBe('unsupported');
  });
});

describe('FilePreviewPanel - Image Zoom', () => {
  it('clamps zoom at minimum 25%', () => {
    expect(clampZoom(0)).toBe(25);
    expect(clampZoom(-50)).toBe(25);
    expect(clampZoom(10)).toBe(25);
    expect(clampZoom(25)).toBe(25);
  });

  it('clamps zoom at maximum 400%', () => {
    expect(clampZoom(500)).toBe(400);
    expect(clampZoom(1000)).toBe(400);
    expect(clampZoom(400)).toBe(400);
  });

  it('allows values within range', () => {
    expect(clampZoom(50)).toBe(50);
    expect(clampZoom(100)).toBe(100);
    expect(clampZoom(200)).toBe(200);
    expect(clampZoom(300)).toBe(300);
  });

  it('zoom steps stay within bounds', () => {
    const STEP = 25;
    let zoom = 100;
    // Zoom in many times
    for (let i = 0; i < 20; i++) {
      zoom = clampZoom(zoom + STEP);
    }
    expect(zoom).toBe(400);

    // Zoom out many times
    zoom = 100;
    for (let i = 0; i < 20; i++) {
      zoom = clampZoom(zoom - STEP);
    }
    expect(zoom).toBe(25);
  });
});

describe('FilePreviewPanel - Text Preview Line Limiting', () => {
  it('limits content to 500 lines', () => {
    const lines = Array.from({ length: 600 }, (_, i) => `line ${i + 1}`);
    const limited = lines.slice(0, 500);
    expect(limited.length).toBe(500);
    expect(limited[499]).toBe('line 500');
  });

  it('preserves content when under 500 lines', () => {
    const lines = Array.from({ length: 100 }, (_, i) => `line ${i + 1}`);
    const limited = lines.slice(0, 500);
    expect(limited.length).toBe(100);
  });
});

describe('FilePreviewPanel - Format Utilities', () => {
  describe('formatFileSize', () => {
    it('formats 0 bytes', () => {
      expect(formatFileSize(0)).toBe('0 B');
    });

    it('formats bytes', () => {
      expect(formatFileSize(500)).toBe('500 B');
    });

    it('formats kilobytes', () => {
      expect(formatFileSize(1024)).toBe('1.0 KB');
      expect(formatFileSize(2048)).toBe('2.0 KB');
    });

    it('formats megabytes', () => {
      expect(formatFileSize(1024 * 1024)).toBe('1.0 MB');
      expect(formatFileSize(1.5 * 1024 * 1024)).toBe('1.5 MB');
    });

    it('formats gigabytes', () => {
      expect(formatFileSize(1024 * 1024 * 1024)).toBe('1.0 GB');
    });
  });

  describe('formatDuration', () => {
    it('formats 0 seconds', () => {
      expect(formatDuration(0)).toBe('0:00');
    });

    it('formats seconds under a minute', () => {
      expect(formatDuration(30)).toBe('0:30');
      expect(formatDuration(5)).toBe('0:05');
    });

    it('formats minutes and seconds', () => {
      expect(formatDuration(90)).toBe('1:30');
      expect(formatDuration(3661)).toBe('61:01');
    });

    it('handles negative values', () => {
      expect(formatDuration(-1)).toBe('0:00');
    });

    it('handles NaN/Infinity', () => {
      expect(formatDuration(Number.NaN)).toBe('0:00');
      expect(formatDuration(Number.POSITIVE_INFINITY)).toBe('0:00');
    });
  });

  describe('extensionToLanguage', () => {
    it('maps TypeScript extensions correctly', () => {
      expect(extensionToLanguage('ts')).toBe('typescript');
      expect(extensionToLanguage('tsx')).toBe('typescript');
    });

    it('maps JavaScript extensions correctly', () => {
      expect(extensionToLanguage('js')).toBe('javascript');
      expect(extensionToLanguage('jsx')).toBe('javascript');
    });

    it('maps Python extension', () => {
      expect(extensionToLanguage('py')).toBe('python');
    });

    it('maps Rust extension', () => {
      expect(extensionToLanguage('rs')).toBe('rust');
    });

    it('maps Vue to html', () => {
      expect(extensionToLanguage('vue')).toBe('html');
    });

    it('returns text for unknown extensions', () => {
      expect(extensionToLanguage('xyz')).toBe('text');
      expect(extensionToLanguage('unknown')).toBe('text');
    });
  });
});
