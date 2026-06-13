import { GetObjectCommand } from '@aws-sdk/client-s3';
import { getS3Client } from '@seta/shared-storage';
import type { PmoFileStore } from './file-store.ts';

/**
 * S3-backed implementation of PmoFileStore.
 * Used at runtime when workflow needs to read uploaded files.
 */
export function createS3FileStore(bucket: string): PmoFileStore {
  return {
    async getBuffer(fileKey: string): Promise<Buffer> {
      const s3 = getS3Client();
      const response = await s3.send(
        new GetObjectCommand({
          Bucket: bucket,
          Key: fileKey,
        }),
      );
      if (!response.Body) {
        throw new Error(`S3 object not found: ${bucket}/${fileKey}`);
      }
      const bytes = await response.Body.transformToByteArray();
      return Buffer.from(bytes);
    },
  };
}
