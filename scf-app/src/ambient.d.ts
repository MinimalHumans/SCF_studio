/**
 * Ambient declarations: wa-sqlite example modules (shipped untyped) and
 * the File System Access API (Chromium; not yet in lib.dom).
 */

declare module "wa-sqlite/src/examples/OriginPrivateFileSystemVFS.js" {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  export class OriginPrivateFileSystemVFS { constructor(...args: any[]); }
}

interface FilePickerAcceptType {
  description?: string;
  accept: Record<string, string[]>;
}

interface OpenFilePickerOptions {
  types?: FilePickerAcceptType[];
  excludeAcceptAllOption?: boolean;
  multiple?: boolean;
}

interface SaveFilePickerOptions {
  types?: FilePickerAcceptType[];
  suggestedName?: string;
}

interface Window {
  showOpenFilePicker(
    options?: OpenFilePickerOptions): Promise<FileSystemFileHandle[]>;
  showSaveFilePicker(
    options?: SaveFilePickerOptions): Promise<FileSystemFileHandle>;
}
