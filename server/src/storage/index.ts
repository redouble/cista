import fs from 'fs';
import path from 'path';
import { config } from '../config.js';

export interface FileStorage {
  save(filename: string, data: Buffer): Promise<string>;
  read(storagePath: string): Promise<Buffer>;
  delete(storagePath: string): Promise<void>;
}

class LocalStorage implements FileStorage {
  async save(filename: string, data: Buffer): Promise<string> {
    const dir = config.storage.localPath;
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    const fullPath = path.join(dir, filename);
    const fileDir = path.dirname(fullPath);
    if (!fs.existsSync(fileDir)) {
      fs.mkdirSync(fileDir, { recursive: true });
    }
    fs.writeFileSync(fullPath, data);
    return filename; // relative to storage root
  }

  async read(storagePath: string): Promise<Buffer> {
    const fullPath = path.join(config.storage.localPath, storagePath);
    return fs.readFileSync(fullPath);
  }

  async delete(storagePath: string): Promise<void> {
    const fullPath = path.join(config.storage.localPath, storagePath);
    if (fs.existsSync(fullPath)) {
      fs.unlinkSync(fullPath);
    }
  }
}

let storageInstance: FileStorage | null = null;

export function getStorage(): FileStorage {
  if (!storageInstance) {
    if (config.storage.type === 'local') {
      storageInstance = new LocalStorage();
    } else {
      // For production, S3-compatible storage would be implemented here
      throw new Error(`Unsupported storage type: ${config.storage.type}`);
    }
  }
  return storageInstance;
}
