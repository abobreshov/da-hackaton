import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { AttachmentView } from './attachment-view';
import type { AttachmentDto } from '@/lib/attachments';

function make(id: string, overrides: Partial<AttachmentDto> = {}): AttachmentDto {
  return {
    id,
    filename: `${id}.pdf`,
    mime: 'application/pdf',
    sizeBytes: 1024,
    isImage: false,
    ...overrides,
  };
}

describe('<AttachmentView />', () => {
  it('returns null when list is empty', () => {
    const { container } = render(<AttachmentView attachments={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders an <img> for image attachments pointing at the download URL', () => {
    render(
      <AttachmentView
        attachments={[make('img-1', { filename: 'cat.png', isImage: true, mime: 'image/png' })]}
      />,
    );
    const img = screen.getByAltText('cat.png') as HTMLImageElement;
    expect(img).toBeInTheDocument();
    expect(img.src).toMatch(/\/api\/v1\/attachments\/img-1\/download$/);
  });

  it('wraps the image in a link with noopener noreferrer', () => {
    render(
      <AttachmentView
        attachments={[make('img-1', { filename: 'cat.png', isImage: true, mime: 'image/png' })]}
      />,
    );
    const link = screen.getByRole('link', { name: /open image cat.png/i });
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    expect(link).toHaveAttribute('target', '_blank');
  });

  it('renders a file pill with download attribute for non-images', () => {
    render(
      <AttachmentView attachments={[make('doc-1', { filename: 'report.pdf', sizeBytes: 2048 })]} />,
    );
    const link = screen.getByRole('link', { name: /report\.pdf/ });
    expect(link).toHaveAttribute('download', 'report.pdf');
    expect(link).toHaveAttribute('href', expect.stringMatching(/\/attachments\/doc-1\/download$/));
    expect(screen.getByText(/2 KB/)).toBeInTheDocument();
  });

  it('renders multiple attachments in a list', () => {
    render(
      <AttachmentView
        attachments={[
          make('a', { filename: 'a.pdf' }),
          make('b', { filename: 'b.png', isImage: true, mime: 'image/png' }),
        ]}
      />,
    );
    const list = screen.getByRole('list', { name: /attachments/i });
    expect(list.children).toHaveLength(2);
  });
});
