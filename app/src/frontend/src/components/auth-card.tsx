import * as React from 'react';

interface AuthCardProps {
  title: string;
  description?: React.ReactNode;
  children: React.ReactNode;
  footer?: React.ReactNode;
}

/**
 * Shared wrapper for authentication routes (login, register, reset, 2FA).
 * Keeps the "centered card on gray background" layout in one place.
 */
export function AuthCard({ title, description, children, footer }: AuthCardProps) {
  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center">
      <div className="w-full max-w-md bg-white rounded-lg shadow-sm border border-gray-200 p-8">
        <h1 className="text-2xl font-bold text-gray-900 mb-2">{title}</h1>
        {description && <p className="text-sm text-gray-600 mb-6">{description}</p>}
        {!description && <div className="mb-4" />}
        {children}
        {footer && <div className="mt-6 text-sm text-gray-500">{footer}</div>}
      </div>
    </div>
  );
}
