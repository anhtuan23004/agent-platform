import { describe, expect, it, vi } from 'vitest';
import { presignedDownloadUrl, presignedUploadUrl } from '../../src/presign.ts';

describe('presigned URLs', () => {
  it('returns an https URL via getSignedUrl', async () => {
    const fakeGetSignedUrl = vi.fn(async () => 'https://s3.example.com/signed?X-Amz=...');
    const url = await presignedUploadUrl(
      {
        bucket: 'b',
        key: 'k',
        contentType: 'application/pdf',
        expiresInSeconds: 600,
      },
      { getSignedUrl: fakeGetSignedUrl as never },
    );
    expect(url).toMatch(/^https:\/\//);
    expect(fakeGetSignedUrl).toHaveBeenCalledOnce();
  });

  it('download URL uses GET', async () => {
    const fakeGetSignedUrl = vi.fn(async (_client: never, command: { input: { Key: string } }) => {
      return `https://s3.example.com/${command.input.Key}?X-Amz=...`;
    });
    const url = await presignedDownloadUrl(
      {
        bucket: 'b',
        key: 'tenants/x/knowledge/y/file.pdf',
        expiresInSeconds: 60,
      },
      { getSignedUrl: fakeGetSignedUrl as never },
    );
    expect(url).toContain('tenants/x/knowledge/y/file.pdf');
  });

  it('signs safe download filename and response content type', async () => {
    const fakeGetSignedUrl = vi.fn(async () => 'https://s3.example.com/signed');
    await presignedDownloadUrl(
      {
        bucket: 'private',
        key: 'tenants/t/pmo/reports/r/report.pdf',
        expiresInSeconds: 300,
        responseContentDisposition: 'attachment; filename="pmo-report.pdf"',
        responseContentType: 'application/pdf',
      },
      { getSignedUrl: fakeGetSignedUrl as never },
    );
    const command = fakeGetSignedUrl.mock.calls[0]?.[1] as {
      input: { ResponseContentDisposition?: string; ResponseContentType?: string };
    };
    expect(command.input).toMatchObject({
      ResponseContentDisposition: 'attachment; filename="pmo-report.pdf"',
      ResponseContentType: 'application/pdf',
    });
  });
});
