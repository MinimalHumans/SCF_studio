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

/* P2: the folder half of the API. `entries()` is the async iterator the
 * root scan walks; the permission pair is what makes a remembered
 * directory handle usable after a reload. Neither is in lib.dom yet. */
interface DirectoryPickerOptions {
  id?: string;
  mode?: "read" | "readwrite";
  startIn?: FileSystemHandle | string;
}

interface FileSystemHandlePermissionDescriptor {
  mode?: "read" | "readwrite";
}

interface FileSystemDirectoryHandle {
  entries(): AsyncIterableIterator<[string, FileSystemHandle]>;
  keys(): AsyncIterableIterator<string>;
  queryPermission(
    descriptor?: FileSystemHandlePermissionDescriptor): Promise<PermissionState>;
  requestPermission(
    descriptor?: FileSystemHandlePermissionDescriptor): Promise<PermissionState>;
}

interface Window {
  showDirectoryPicker(
    options?: DirectoryPickerOptions): Promise<FileSystemDirectoryHandle>;
}
