import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

const useSocketStatusMock = vi.fn();
vi.mock('@/hooks/useSocketStatus', () => ({
  useSocketStatus: () => useSocketStatusMock(),
}));

import { ConnectionBanner } from './connection-banner';

describe('<ConnectionBanner />', () => {
  beforeEach(() => {
    useSocketStatusMock.mockReset();
  });

  it('renders nothing when status is `connected`', () => {
    useSocketStatusMock.mockReturnValue({ status: 'connected', since: null });
    const { container } = render(<ConnectionBanner />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders an aria-live status node when reconnecting', () => {
    useSocketStatusMock.mockReturnValue({ status: 'reconnecting', since: new Date() });
    render(<ConnectionBanner />);
    const banner = screen.getByRole('status');
    expect(banner).toBeInTheDocument();
    expect(banner).toHaveAttribute('aria-live', 'polite');
    expect(banner.textContent ?? '').toMatch(/reconnect/i);
  });

  it('renders an aria-live status node when offline', () => {
    useSocketStatusMock.mockReturnValue({ status: 'offline', since: new Date() });
    render(<ConnectionBanner />);
    const banner = screen.getByRole('status');
    expect(banner).toBeInTheDocument();
    expect(banner).toHaveAttribute('aria-live', 'polite');
    expect(banner.textContent ?? '').toMatch(/offline|disconnected|lost/i);
  });

  it('uses surface-container-high token (no raw hex, no border)', () => {
    useSocketStatusMock.mockReturnValue({ status: 'reconnecting', since: new Date() });
    render(<ConnectionBanner />);
    const banner = screen.getByRole('status');
    expect(banner.className).toContain('bg-surface-container-high');
    expect(banner.className).not.toMatch(/border-(?!none)/);
  });

  it('positions itself absolutely at the top so it overlays the shell', () => {
    useSocketStatusMock.mockReturnValue({ status: 'offline', since: new Date() });
    render(<ConnectionBanner />);
    const banner = screen.getByRole('status');
    // fixed/absolute positioning + top placement so it floats over the shell
    expect(banner.className).toMatch(/fixed|absolute/);
    expect(banner.className).toMatch(/top-/);
  });
});
