import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  uploadAttachments,
  downloadUrl,
  checkFilePreUpload,
  MAX_FILE_BYTES,
  MAX_IMAGE_BYTES,
  MAX_FILES_PER_UPLOAD,
} from './attachments';
import { ApiError } from './api-client';

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

function makeFile(name: string, size: number, mime = 'application/pdf'): File {
  const buf = new Uint8Array(size);
  return new File([buf], name, { type: mime });
}

describe('lib/attachments', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
    Object.defineProperty(document, 'cookie', {
      configurable: true,
      get: () => 'csrf=tok',
      set: () => {},
    });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe('checkFilePreUpload', () => {
    it('passes small files under 20 MiB', () => {
      expect(() => checkFilePreUpload(makeFile('x.pdf', 100, 'application/pdf'))).not.toThrow();
    });

    it('rejects any file over 20 MiB', () => {
      const big = makeFile('huge.pdf', MAX_FILE_BYTES + 1);
      expect(() => checkFilePreUpload(big)).toThrow(ApiError);
    });

    it('rejects images over 3 MiB', () => {
      const bigImg = makeFile('huge.png', MAX_IMAGE_BYTES + 1, 'image/png');
      expect(() => checkFilePreUpload(bigImg)).toThrow(ApiError);
    });

    it('allows a 3 MiB image exactly', () => {
      const img = makeFile('ok.png', MAX_IMAGE_BYTES, 'image/png');
      expect(() => checkFilePreUpload(img)).not.toThrow();
    });
  });

  describe('uploadAttachments', () => {
    it('short-circuits when no files are passed', async () => {
      const res = await uploadAttachments({
        target: { kind: 'room', roomId: 5 },
        files: [],
      });
      expect(res).toEqual({ attachments: [] });
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('POSTs multipart to the room endpoint and returns attachments', async () => {
      fetchMock.mockResolvedValueOnce(
        jsonResponse(
          {
            attachments: [
              {
                id: 'uuid-1',
                filename: 'a.pdf',
                mime: 'application/pdf',
                sizeBytes: 100,
                isImage: false,
              },
            ],
          },
          201,
        ),
      );
      const res = await uploadAttachments({
        target: { kind: 'room', roomId: 5 },
        files: [makeFile('a.pdf', 100)],
      });
      const [url, init] = fetchMock.mock.calls[0];
      expect(url).toMatch(/\/api\/v1\/rooms\/5\/attachments$/);
      expect((init as RequestInit).method).toBe('POST');
      expect((init as RequestInit).credentials).toBe('include');
      expect((init as RequestInit).body).toBeInstanceOf(FormData);
      expect(res.attachments).toHaveLength(1);
      expect(res.attachments[0].id).toBe('uuid-1');
    });

    it('POSTs multipart to the DM endpoint keyed by peer userId', async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse({ attachments: [] }, 201));
      await uploadAttachments({
        target: { kind: 'dm', peerUserId: 42 },
        files: [makeFile('b.png', 100, 'image/png')],
      });
      const [url] = fetchMock.mock.calls[0];
      expect(url).toMatch(/\/api\/v1\/dms\/42\/attachments$/);
    });

    it('does not set a Content-Type header (FormData sets its own boundary)', async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse({ attachments: [] }, 201));
      await uploadAttachments({
        target: { kind: 'room', roomId: 5 },
        files: [makeFile('a.pdf', 100)],
      });
      const [, init] = fetchMock.mock.calls[0];
      const headers = new Headers((init as RequestInit).headers);
      expect(headers.has('content-type')).toBe(false);
    });

    it('appends a comment field when provided', async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse({ attachments: [] }, 201));
      await uploadAttachments({
        target: { kind: 'room', roomId: 5 },
        files: [makeFile('a.pdf', 100)],
        comment: 'hello',
      });
      const [, init] = fetchMock.mock.calls[0];
      const body = (init as RequestInit).body as FormData;
      expect(body.get('comment')).toBe('hello');
    });

    it('rejects uploads over the per-call file cap', async () => {
      const files = Array.from({ length: MAX_FILES_PER_UPLOAD + 1 }, (_, i) =>
        makeFile(`f${i}.pdf`, 10),
      );
      await expect(
        uploadAttachments({ target: { kind: 'room', roomId: 5 }, files }),
      ).rejects.toBeInstanceOf(ApiError);
    });

    it('surfaces server 413 errors as ApiError with parsed code/message', async () => {
      fetchMock.mockResolvedValueOnce(
        new Response(JSON.stringify({ code: 'VALIDATION_FAILED', message: 'file too large' }), {
          status: 413,
          headers: { 'Content-Type': 'application/json' },
        }),
      );
      try {
        await uploadAttachments({
          target: { kind: 'room', roomId: 5 },
          files: [makeFile('a.pdf', 100)],
        });
      } catch (e) {
        expect(e).toBeInstanceOf(ApiError);
        const err = e as ApiError;
        expect(err.status).toBe(413);
        expect(err.code).toBe('VALIDATION_FAILED');
        expect(err.message).toBe('file too large');
      }
    });

    it('surfaces abort as an ApiError without crashing', async () => {
      fetchMock.mockImplementationOnce(() =>
        Promise.reject(new DOMException('aborted', 'AbortError')),
      );
      const ac = new AbortController();
      ac.abort();
      await expect(
        uploadAttachments({
          target: { kind: 'room', roomId: 5 },
          files: [makeFile('a.pdf', 100)],
          signal: ac.signal,
        }),
      ).rejects.toBeInstanceOf(ApiError);
    });
  });

  describe('downloadUrl', () => {
    it('returns the /api/v1/attachments/:id/download path', () => {
      expect(downloadUrl('abc-123')).toMatch(/\/api\/v1\/attachments\/abc-123\/download$/);
    });
  });
});
