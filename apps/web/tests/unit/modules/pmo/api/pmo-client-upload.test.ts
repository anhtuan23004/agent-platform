import { afterEach, describe, expect, it, vi } from 'vitest';
import { pmoApi } from '../../../../../src/modules/pmo/api/client';

class FakeXmlHttpRequest {
  static latest: FakeXmlHttpRequest | null = null;
  method = '';
  url = '';
  body: Document | XMLHttpRequestBodyInit | null = null;
  status = 200;
  responseText = JSON.stringify({
    ingestion_session_id: 'session-1',
    s3_key: 'tenant/pmo/session-1/book.xlsx',
    status: 'uploaded',
  });
  withCredentials = false;
  upload = { onprogress: null as ((event: ProgressEvent) => void) | null };
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;

  constructor() {
    FakeXmlHttpRequest.latest = this;
  }

  open(method: string, url: string) {
    this.method = method;
    this.url = url;
  }

  send(body: Document | XMLHttpRequestBodyInit | null) {
    this.body = body;
    queueMicrotask(() => this.onload?.());
  }
}

describe('pmoApi.uploadWorkbook', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    FakeXmlHttpRequest.latest = null;
  });

  it('uploads multipart through same-origin PMO proxy', async () => {
    vi.stubGlobal('XMLHttpRequest', FakeXmlHttpRequest);
    const file = new File(['data'], 'book.xlsx', {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });

    await expect(
      pmoApi.uploadWorkbook(file, {
        reportingPeriodKey: '2026-W26',
        chatThreadId: 'thread-1',
      }),
    ).resolves.toMatchObject({ ingestion_session_id: 'session-1', status: 'uploaded' });

    const request = FakeXmlHttpRequest.latest;
    expect(request?.method).toBe('POST');
    expect(request?.url).toBe('/api/pmo/v1/upload');
    expect(request?.withCredentials).toBe(true);
    expect(request?.body).toBeInstanceOf(FormData);
    const form = request?.body as FormData;
    expect(form.get('file')).toBe(file);
    expect(form.get('reporting_period_key')).toBe('2026-W26');
    expect(form.get('chat_thread_id')).toBe('thread-1');
  });
});
