import { DirEntry } from "@/types/dir-entry";
import { FILE_EXTENSIONS } from "@/constants/file-extensions";
import { convertFileSrc } from '@tauri-apps/api/core';

export function getFileIcon(entry: DirEntry): string {
  if (entry.is_dir) return "FolderIcon";

  const extension = entry.ext?.toLowerCase();
  if (!extension) return "FileIcon";

  if (FILE_EXTENSIONS.IMAGE.includes(extension)) return "FileImageIcon";
  if (FILE_EXTENSIONS.VIDEO.includes(extension)) return "FileVideoIcon";
  if (FILE_EXTENSIONS.AUDIO.includes(extension)) return "FileAudioIcon";
  if (FILE_EXTENSIONS.CODE.includes(extension)) return "FileCodeIcon";
  if (FILE_EXTENSIONS.ARCHIVE.includes(extension)) return "FileArchiveIcon";
  if (FILE_EXTENSIONS.TEXT.includes(extension)) return "FileTextIcon";

  return "FileIcon";
}

export function getImageSrc(entry: DirEntry): string {
  return convertFileSrc(entry.path);
}