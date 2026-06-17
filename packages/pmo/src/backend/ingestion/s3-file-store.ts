import { GetObjectCommand, S3Client } from '@aws-sdk/client-s3';
import type { PmoFileStore } from './file-store.ts';

/**
 * S3-backed implementation of PmoFileStore.
 * Used at runtime when workflow needs to read uploaded files.
 */
export function createS3FileStore(bucket: string): PmoFileStore {
  return {
    async getBuffer(fileKey: string): Promise<Buffer> {
      const region = process.env.S3_REGION ?? 'ap-southeast-1';
      const s3 = new S3Client({ region });
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
