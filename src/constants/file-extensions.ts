// SPDX-License-Identifier: GPL-3.0-or-later
// License: GNU GPLv3 or later. See the license file in the project root for more information.
// Copyright © 2021 - present Aleksey Hoffman. All rights reserved.
// Copyright © 2026 - present Joaquin Decima / VasakOS / Vasak Group. All rights reserved.

export const FILE_EXTENSIONS: Record<string, readonly string[]> = {
	IMAGE: ['jpg', 'jpeg', 'png', 'gif', 'bmp', 'webp', 'svg', 'ico', 'tiff', 'tif', 'avif'],
	VIDEO: ['mp4', 'mkv', 'avi', 'mov', 'wmv', 'flv', 'webm', 'm4v', 'mpeg', 'mpg'],
	AUDIO: ['mp3', 'wav', 'flac', 'aac', 'ogg', 'wma', 'm4a', 'opus'],
	CODE: [
		'js',
		'ts',
		'jsx',
		'tsx',
		'vue',
		'py',
		'java',
		'cpp',
		'c',
		'h',
		'rs',
		'go',
		'rb',
		'php',
		'swift',
		'kt',
		'cs',
		'html',
		'css',
		'scss',
		'sass',
		'less',
		'json',
		'xml',
		'yaml',
		'yml',
		'toml',
		'md',
		'sh',
		'bash',
		'ps1',
		'sql',
	],
	ARCHIVE: ['zip', 'rar', '7z', 'tar', 'gz', 'bz2', 'xz', 'zst', 'cpio', 'iso'],
	TEXT: ['txt', 'log', 'ini', 'cfg', 'conf', 'env'],
	PDF: ['pdf'],
	// Debe coincidir con las que el backend sabe dibujar (`video_thumbnail`).
	FONT: ['ttf', 'otf'],
};
