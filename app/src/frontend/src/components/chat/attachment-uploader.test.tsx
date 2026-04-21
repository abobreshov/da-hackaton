import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';

const uploadAttachmentsMock = vi.fn();

vi.mock('@/lib/attachments', async () => {
  const actual = await vi.importActual<typeof import('@/lib/attachments')>('@/lib/attachments');
  return {
    ...actual,
    uploadAttachments: (...args: unknown[]) => uploadAttachmentsMock(...args),
  };
});

import { AttachmentUploader } from './attachment-uploader';
import { MAX_FILES_PER_UPLOAD, type AttachmentDto } from '@/lib/attachments';

function makeFile(name: string, size: number, mime: string): File {
  const buf = new Uint8Array(size);
  return new File([buf], name, { type: mime });
}

function makeAttachment(id: string, overrides: Partial<AttachmentDto> = {}): AttachmentDto {
  return {
    id,
    filename: `${id}.pdf`,
    mime: 'application/pdf',
    sizeBytes: 100,
    isImage: false,
    ...overrides,
  };
}

beforeEach(() => {
  uploadAttachmentsMock.mockReset();
  Object.defineProperty(URL, 'createObjectURL', {
    configurable: true,
    writable: true,
    value: vi.fn(() => 'blob:mock-url'),
  });
  Object.defineProperty(URL, 'revokeObjectURL', {
    configurable: true,
    writable: true,
    value: vi.fn(),
  });
});

describe('<AttachmentUploader />', () => {
  it('renders the pick button and opens the file dialog on click', () => {
    const onChange = vi.fn();
    render(
      <AttachmentUploader target={{ kind: 'room', roomId: 5 }} value={[]} onChange={onChange} />,
    );
    const btn = screen.getByTestId('attachment-uploader-pick');
    expect(btn).toHaveTextContent('+ Attach');
  });

  it('uploads picked files and appends to value', async () => {
    uploadAttachmentsMock.mockResolvedValueOnce({
      attachments: [makeAttachment('a1')],
    });
    const onChange = vi.fn();
    render(
      <AttachmentUploader target={{ kind: 'room', roomId: 5 }} value={[]} onChange={onChange} />,
    );
    const input = screen.getByTestId('attachment-uploader-input') as HTMLInputElement;
    await act(async () => {
      fireEvent.change(input, {
        target: { files: [makeFile('a.pdf', 100, 'application/pdf')] },
      });
    });
    await waitFor(() => {
      expect(onChange).toHaveBeenCalledWith([makeAttachment('a1')]);
    });
  });

  it('renders an image thumbnail via object URL after upload', async () => {
    uploadAttachmentsMock.mockResolvedValueOnce({
      attachments: [
        makeAttachment('img1', { isImage: true, filename: 'x.png', mime: 'image/png' }),
      ],
    });
    const Wrapper = () => {
      const [val, setVal] = require('react').useState<AttachmentDto[]>([]);
      return (
        <AttachmentUploader target={{ kind: 'room', roomId: 5 }} value={val} onChange={setVal} />
      );
    };
    render(<Wrapper />);
    const input = screen.getByTestId('attachment-uploader-input') as HTMLInputElement;
    await act(async () => {
      fireEvent.change(input, {
        target: { files: [makeFile('x.png', 100, 'image/png')] },
      });
    });
    await waitFor(() => {
      expect(screen.getByAltText('x.png')).toBeInTheDocument();
    });
    expect(URL.createObjectURL).toHaveBeenCalled();
  });

  it('removes a chip when its remove button is clicked', async () => {
    const att = makeAttachment('a1');
    const onChange = vi.fn();
    render(
      <AttachmentUploader target={{ kind: 'room', roomId: 5 }} value={[att]} onChange={onChange} />,
    );
    fireEvent.click(screen.getByTestId('attachment-chip-remove-a1'));
    expect(onChange).toHaveBeenCalledWith([]);
  });

  it('disables the pick button when at the per-upload cap', () => {
    const value = Array.from({ length: MAX_FILES_PER_UPLOAD }, (_, i) => makeAttachment(`a${i}`));
    render(
      <AttachmentUploader target={{ kind: 'room', roomId: 5 }} value={value} onChange={() => {}} />,
    );
    const btn = screen.getByTestId('attachment-uploader-pick');
    expect(btn).toBeDisabled();
    expect(btn).toHaveTextContent('Max files reached');
  });

  it('surfaces upload errors via onError and does not mutate value', async () => {
    const { ApiError } = await import('@/lib/api-client');
    uploadAttachmentsMock.mockRejectedValueOnce(
      new ApiError({ status: 413, code: 'VALIDATION_FAILED', message: 'too big' }),
    );
    const onChange = vi.fn();
    const onError = vi.fn();
    render(
      <AttachmentUploader
        target={{ kind: 'room', roomId: 5 }}
        value={[]}
        onChange={onChange}
        onError={onError}
      />,
    );
    const input = screen.getByTestId('attachment-uploader-input') as HTMLInputElement;
    await act(async () => {
      fireEvent.change(input, {
        target: { files: [makeFile('a.pdf', 100, 'application/pdf')] },
      });
    });
    await waitFor(() => {
      expect(onError).toHaveBeenCalled();
    });
    expect(onChange).not.toHaveBeenCalled();
  });

  it('renders a per-chip caption input bound to the attachment', () => {
    const att = makeAttachment('a1');
    render(
      <AttachmentUploader
        target={{ kind: 'room', roomId: 5 }}
        value={[att]}
        onChange={() => {}}
      />,
    );
    const field = screen.getByTestId('attachment-chip-comment-a1') as HTMLInputElement;
    expect(field).toBeInTheDocument();
    expect(field.getAttribute('aria-label')).toBe('Caption for a1.pdf');
    expect(field.maxLength).toBe(500);
  });

  it('updates local state as the user types in the caption input', () => {
    const att = makeAttachment('a1');
    render(
      <AttachmentUploader
        target={{ kind: 'room', roomId: 5 }}
        value={[att]}
        onChange={() => {}}
      />,
    );
    const field = screen.getByTestId('attachment-chip-comment-a1') as HTMLInputElement;
    fireEvent.change(field, { target: { value: 'invoice for Q3' } });
    expect(field.value).toBe('invoice for Q3');
  });

  it('forwards the first chip caption to uploadAttachments on the next pick', async () => {
    uploadAttachmentsMock.mockResolvedValueOnce({
      attachments: [makeAttachment('a2')],
    });
    const existing = makeAttachment('a1');
    render(
      <AttachmentUploader
        target={{ kind: 'room', roomId: 5 }}
        value={[existing]}
        onChange={() => {}}
      />,
    );
    const captionField = screen.getByTestId('attachment-chip-comment-a1') as HTMLInputElement;
    fireEvent.change(captionField, { target: { value: 'invoice for Q3' } });
    const fileInput = screen.getByTestId('attachment-uploader-input') as HTMLInputElement;
    await act(async () => {
      fireEvent.change(fileInput, {
        target: { files: [makeFile('b.pdf', 100, 'application/pdf')] },
      });
    });
    await waitFor(() => {
      expect(uploadAttachmentsMock).toHaveBeenCalledTimes(1);
    });
    const callArg = uploadAttachmentsMock.mock.calls[0][0];
    expect(callArg.comment).toBe('invoice for Q3');
  });

  it('omits the comment field when no caption has been typed', async () => {
    uploadAttachmentsMock.mockResolvedValueOnce({
      attachments: [makeAttachment('a2')],
    });
    const existing = makeAttachment('a1');
    render(
      <AttachmentUploader
        target={{ kind: 'room', roomId: 5 }}
        value={[existing]}
        onChange={() => {}}
      />,
    );
    const fileInput = screen.getByTestId('attachment-uploader-input') as HTMLInputElement;
    await act(async () => {
      fireEvent.change(fileInput, {
        target: { files: [makeFile('b.pdf', 100, 'application/pdf')] },
      });
    });
    await waitFor(() => {
      expect(uploadAttachmentsMock).toHaveBeenCalledTimes(1);
    });
    const callArg = uploadAttachmentsMock.mock.calls[0][0];
    expect('comment' in callArg).toBe(false);
  });

  it('caps the caption input at the BFF 500-char limit', () => {
    const att = makeAttachment('a1');
    render(
      <AttachmentUploader
        target={{ kind: 'room', roomId: 5 }}
        value={[att]}
        onChange={() => {}}
      />,
    );
    const field = screen.getByTestId('attachment-chip-comment-a1') as HTMLInputElement;
    const overflow = 'x'.repeat(600);
    fireEvent.change(field, { target: { value: overflow } });
    expect(field.value.length).toBe(500);
  });

  it('pre-validates client-side size caps before uploading', async () => {
    const onChange = vi.fn();
    const onError = vi.fn();
    render(
      <AttachmentUploader
        target={{ kind: 'room', roomId: 5 }}
        value={[]}
        onChange={onChange}
        onError={onError}
      />,
    );
    const input = screen.getByTestId('attachment-uploader-input') as HTMLInputElement;
    const huge = makeFile('huge.png', 4 * 1024 * 1024, 'image/png'); // 4 MiB image
    await act(async () => {
      fireEvent.change(input, { target: { files: [huge] } });
    });
    await waitFor(() => {
      expect(onError).toHaveBeenCalled();
    });
    expect(uploadAttachmentsMock).not.toHaveBeenCalled();
    expect(onChange).not.toHaveBeenCalled();
  });
});
