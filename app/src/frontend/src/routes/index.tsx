import { createFileRoute, redirect } from '@tanstack/react-router';
import { fetchSession } from '@/lib/auth';

/**
 * Root `/` sends authenticated users to `/dashboard` and everyone else to
 * `/login`. Keeps the PDF-requirements invariant that a naked visit always
 * terminates somewhere meaningful.
 */
export const Route = createFileRoute('/')({
  beforeLoad: async () => {
    try {
      await fetchSession();
      throw redirect({ to: '/dashboard' });
    } catch (err) {
      if (err && typeof err === 'object' && 'to' in err) throw err;
      throw redirect({ to: '/login' });
    }
  },
});
