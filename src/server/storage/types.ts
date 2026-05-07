export interface StorageProvider {
  write(path: string, data: Buffer | string | NodeJS.ReadableStream): Promise<string>;
  read(path: string): Promise<Buffer>;
  exists(path: string): Promise<boolean>;
  delete(path: string): Promise<void>;
  getUrl(path: string): string;
}
