import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { listCatalog } from './rooms';

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

describe('lib/rooms', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('listCatalog() GETs /api/v1/rooms/catalog and returns the parsed payload', async () => {
    const payload = {
      rooms: [{ id: 1, name: 'general', description: 'd', memberCount: 2 }],
      total: 1,
    };
    fetchMock.mockResolvedValueOnce(jsonResponse(payload));

    const res = await listCatalog();

    expect(res).toEqual(payload);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toMatch(/\/api\/v1\/rooms\/catalog$/);
    expect((init as RequestInit).method).toBe('GET');
    expect((init as RequestInit).credentials).toBe('include');
  });

  it('listCatalog() surfaces ApiError on non-2xx responses', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({ code: 'UPSTREAM_UNAVAILABLE', message: 'down' }),
        { status: 502, headers: { 'Content-Type': 'application/json' } },
      ),
    );
    await expect(listCatalog()).rejects.toMatchObject({
      status: 502,
      code: 'UPSTREAM_UNAVAILABLE',
      message: 'down',
    });
  });
});
