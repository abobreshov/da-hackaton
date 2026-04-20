/**
 * TCP-layer tests: `AttachmentsTcpController` dispatches payloads to the service.
 *
 * Exception translation (HttpException -> RpcException) is handled GLOBALLY
 * by `RpcExceptionFilter` (registered in `src/microservice.ts`), not per
 * handler — so these unit tests assert the service is invoked with the right
 * shape and that errors thrown by the service bubble up unchanged.
 */

import { NotFoundException } from '@nestjs/common';
import { TcpCmd } from '@app/contracts';
import { AttachmentsTcpController } from './attachments.tcp';
import { AttachmentsService } from './attachments.service';
import { AttachmentRow } from './attachments.types';

function makeService(): jest.Mocked<AttachmentsService> {
  return {
    upload: jest.fn(),
    download: jest.fn(),
    findByMessageId: jest.fn(),
  } as unknown as jest.Mocked<AttachmentsService>;
}

function makeRepo(): { findById: jest.Mock } {
  return { findById: jest.fn() };
}

function sampleRow(over: Partial<AttachmentRow> = {}): AttachmentRow {
  return {
    id: 'uuid-1',
    roomId: 1,
    dmId: null,
    messageId: null,
    uploaderId: 42,
    filename: 'a.txt',
    mime: 'text/plain',
    sizeBytes: 5,
    path: '2026/04/uuid-1_a.txt',
    comment: null,
    isImage: false,
    createdAt: new Date('2026-04-20T00:00:00Z'),
    ...over,
  };
}

describe('AttachmentsTcpController', () => {
  let service: jest.Mocked<AttachmentsService>;
  let repo: { findById: jest.Mock };
  let controller: AttachmentsTcpController;

  beforeEach(() => {
    service = makeService();
    repo = makeRepo();
    controller = new AttachmentsTcpController(service, repo as any);
  });

  it('exposes a @MessagePattern for every attachments.* TcpCmd', () => {
    const expected = new Set<string>(Object.values(TcpCmd.attachments));

    const proto = Object.getPrototypeOf(controller);
    const methods = Object.getOwnPropertyNames(proto).filter((m) => m !== 'constructor');

    const seenCmds = new Set<string>();
    for (const m of methods) {
      const raw = Reflect.getMetadata('microservices:pattern', proto[m]);
      if (!raw) continue;
      const patterns: unknown[] = Array.isArray(raw)
        ? raw
        : typeof raw === 'string'
          ? ([] as unknown[]).concat(JSON.parse(raw))
          : [raw];
      for (const p of patterns) {
        if (typeof p === 'string') seenCmds.add(p);
        else if (p && typeof (p as { cmd?: unknown }).cmd === 'string') {
          seenCmds.add((p as { cmd: string }).cmd);
        }
      }
    }

    expect(seenCmds).toEqual(expected);
  });

  it('attachments.upload decodes base64 content and delegates to service.upload', async () => {
    const row = sampleRow();
    service.upload.mockResolvedValue(row);

    const content = Buffer.from('hello world');
    const out = await controller.upload({
      uploaderId: 42,
      scope: { roomId: 1 },
      filename: 'a.txt',
      mime: 'text/plain',
      content: content.toString('base64'),
      comment: 'hi',
    });

    expect(service.upload).toHaveBeenCalledTimes(1);
    const arg = service.upload.mock.calls[0]![0];
    expect(arg.uploaderId).toBe(42);
    expect(arg.scope).toEqual({ roomId: 1 });
    expect(arg.filename).toBe('a.txt');
    expect(arg.mime).toBe('text/plain');
    expect(arg.comment).toBe('hi');
    expect(Buffer.isBuffer(arg.content)).toBe(true);
    expect(arg.content.equals(content)).toBe(true);
    expect(out).toEqual({ attachment: row });
  });

  it('attachments.download returns attachment + base64-encoded content', async () => {
    const row = sampleRow({ id: 'a-dl' });
    const content = Buffer.from([0x00, 0x01, 0x02, 0xff]);
    service.download.mockResolvedValue({ attachment: row, content });

    const out = await controller.download({ attachmentId: 'a-dl', viewerId: 99 });

    expect(service.download).toHaveBeenCalledWith('a-dl', 99);
    expect(out.attachment).toBe(row);
    expect(out.content).toBe(content.toString('base64'));
  });

  it('attachments.listByMessage parses BigInt and delegates', async () => {
    const row = sampleRow({ messageId: 7n });
    service.findByMessageId.mockResolvedValue([row]);

    const out = await controller.listByMessage({ messageId: '7' });

    expect(service.findByMessageId).toHaveBeenCalledWith(7n);
    expect(out).toEqual({ attachments: [row] });
  });

  it('attachments.findById returns attachment or throws NotFound', async () => {
    const row = sampleRow({ id: 'hit' });
    repo.findById.mockResolvedValueOnce(row);
    await expect(controller.findById({ id: 'hit' })).resolves.toEqual({ attachment: row });
    expect(repo.findById).toHaveBeenCalledWith('hit');

    repo.findById.mockResolvedValueOnce(null);
    await expect(controller.findById({ id: 'miss' })).rejects.toBeInstanceOf(NotFoundException);
  });
});
