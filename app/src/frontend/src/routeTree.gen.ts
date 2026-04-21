/* eslint-disable */
// Hand-written route tree. Keep in sync with routes/* files.

import { Route as rootRouteImport } from './routes/__root';
import { Route as IndexRouteImport } from './routes/index';
import { Route as PublicRouteImport } from './routes/_public';
import { Route as LoginRouteImport } from './routes/login';
import { Route as RegisterRouteImport } from './routes/register';
import { Route as ResetPasswordRouteImport } from './routes/reset-password';
import { Route as Verify2FARouteImport } from './routes/verify-2fa';
import { Route as VerifyEmailRouteImport } from './routes/verify-email';
import { Route as AuthRouteImport } from './routes/_auth';
import { Route as AuthDashboardRouteImport } from './routes/_auth/dashboard';
import { Route as AuthContactsRouteImport } from './routes/_auth/contacts';
import { Route as AuthSessionsRouteImport } from './routes/_auth/sessions';
import { Route as AuthSettingsRouteImport } from './routes/_auth/settings';
import { Route as AuthRoomsIndexRouteImport } from './routes/_auth/rooms/index';
import { Route as AuthRoomsRoomIdRouteImport } from './routes/_auth/rooms/$roomId';
import { Route as AuthDmUserIdRouteImport } from './routes/_auth/dm/$userId';
// --- Admin layout + children (EPIC-10) ---
import { Route as AdminRouteImport } from './routes/_admin';
import { Route as AdminReportsRouteImport } from './routes/_admin/reports';
import { Route as AdminAuditLogRouteImport } from './routes/_admin/audit-log';

const IndexRoute = IndexRouteImport.update({
  id: '/',
  path: '/',
  getParentRoute: () => rootRouteImport,
} as any);

const PublicRoute = PublicRouteImport.update({
  id: '/_public',
  getParentRoute: () => rootRouteImport,
} as any);

const LoginRoute = LoginRouteImport.update({
  id: '/login',
  path: '/login',
  getParentRoute: () => PublicRoute,
} as any);

const RegisterRoute = RegisterRouteImport.update({
  id: '/register',
  path: '/register',
  getParentRoute: () => PublicRoute,
} as any);

const ResetPasswordRoute = ResetPasswordRouteImport.update({
  id: '/reset-password',
  path: '/reset-password',
  getParentRoute: () => PublicRoute,
} as any);

const Verify2FARoute = Verify2FARouteImport.update({
  id: '/verify-2fa',
  path: '/verify-2fa',
  getParentRoute: () => PublicRoute,
} as any);

const VerifyEmailRoute = VerifyEmailRouteImport.update({
  id: '/verify-email',
  path: '/verify-email',
  getParentRoute: () => PublicRoute,
} as any);

const AuthRoute = AuthRouteImport.update({
  id: '/_auth',
  getParentRoute: () => rootRouteImport,
} as any);

const AuthDashboardRoute = AuthDashboardRouteImport.update({
  id: '/dashboard',
  path: '/dashboard',
  getParentRoute: () => AuthRoute,
} as any);

const AuthContactsRoute = AuthContactsRouteImport.update({
  id: '/contacts',
  path: '/contacts',
  getParentRoute: () => AuthRoute,
} as any);

const AuthSessionsRoute = AuthSessionsRouteImport.update({
  id: '/sessions',
  path: '/sessions',
  getParentRoute: () => AuthRoute,
} as any);

const AuthSettingsRoute = AuthSettingsRouteImport.update({
  id: '/settings',
  path: '/settings',
  getParentRoute: () => AuthRoute,
} as any);

const AuthRoomsIndexRoute = AuthRoomsIndexRouteImport.update({
  id: '/rooms/',
  path: '/rooms/',
  getParentRoute: () => AuthRoute,
} as any);

const AuthRoomsRoomIdRoute = AuthRoomsRoomIdRouteImport.update({
  id: '/rooms/$roomId',
  path: '/rooms/$roomId',
  getParentRoute: () => AuthRoute,
} as any);

const AuthDmUserIdRoute = AuthDmUserIdRouteImport.update({
  id: '/dm/$userId',
  path: '/dm/$userId',
  getParentRoute: () => AuthRoute,
} as any);

const PublicRouteChildren = {
  LoginRoute,
  RegisterRoute,
  ResetPasswordRoute,
  Verify2FARoute,
  VerifyEmailRoute,
};
const PublicRouteWithChildren = (PublicRoute as any)._addFileChildren(PublicRouteChildren);

const AuthRouteChildren = {
  AuthDashboardRoute,
  AuthContactsRoute,
  AuthSessionsRoute,
  AuthSettingsRoute,
  AuthRoomsIndexRoute,
  AuthRoomsRoomIdRoute,
  AuthDmUserIdRoute,
};
const AuthRouteWithChildren = (AuthRoute as any)._addFileChildren(AuthRouteChildren);

// --- Admin layout + children (EPIC-10) ---
const AdminRoute = AdminRouteImport.update({
  id: '/_admin',
  getParentRoute: () => rootRouteImport,
} as any);

const AdminReportsRoute = AdminReportsRouteImport.update({
  id: '/reports',
  path: '/reports',
  getParentRoute: () => AdminRoute,
} as any);

const AdminAuditLogRoute = AdminAuditLogRouteImport.update({
  id: '/audit-log',
  path: '/audit-log',
  getParentRoute: () => AdminRoute,
} as any);

const AdminRouteChildren = {
  AdminReportsRoute,
  AdminAuditLogRoute,
};
const AdminRouteWithChildren = (AdminRoute as any)._addFileChildren(AdminRouteChildren);

const rootRouteChildren = {
  IndexRoute,
  AuthRoute: AuthRouteWithChildren,
  PublicRoute: PublicRouteWithChildren,
  AdminRoute: AdminRouteWithChildren,
};

export const routeTree = (rootRouteImport as any)
  ._addFileChildren(rootRouteChildren)
  ._addFileTypes({} as any);

declare module '@tanstack/react-router' {
  interface FileRoutesByPath {
    '/': {
      id: '/';
      path: '/';
      fullPath: '/';
      preLoaderRoute: typeof IndexRouteImport;
      parentRoute: typeof rootRouteImport;
    };
    '/_public': {
      id: '/_public';
      path: '';
      fullPath: '';
      preLoaderRoute: typeof PublicRouteImport;
      parentRoute: typeof rootRouteImport;
    };
    '/login': {
      id: '/login';
      path: '/login';
      fullPath: '/login';
      preLoaderRoute: typeof LoginRouteImport;
      parentRoute: typeof PublicRouteImport;
    };
    '/register': {
      id: '/register';
      path: '/register';
      fullPath: '/register';
      preLoaderRoute: typeof RegisterRouteImport;
      parentRoute: typeof PublicRouteImport;
    };
    '/reset-password': {
      id: '/reset-password';
      path: '/reset-password';
      fullPath: '/reset-password';
      preLoaderRoute: typeof ResetPasswordRouteImport;
      parentRoute: typeof PublicRouteImport;
    };
    '/verify-2fa': {
      id: '/verify-2fa';
      path: '/verify-2fa';
      fullPath: '/verify-2fa';
      preLoaderRoute: typeof Verify2FARouteImport;
      parentRoute: typeof PublicRouteImport;
    };
    '/verify-email': {
      id: '/verify-email';
      path: '/verify-email';
      fullPath: '/verify-email';
      preLoaderRoute: typeof VerifyEmailRouteImport;
      parentRoute: typeof PublicRouteImport;
    };
    '/_auth': {
      id: '/_auth';
      path: '';
      fullPath: '';
      preLoaderRoute: typeof AuthRouteImport;
      parentRoute: typeof rootRouteImport;
    };
    '/_auth/dashboard': {
      id: '/_auth/dashboard';
      path: '/dashboard';
      fullPath: '/dashboard';
      preLoaderRoute: typeof AuthDashboardRouteImport;
      parentRoute: typeof AuthRouteImport;
    };
    '/_auth/contacts': {
      id: '/_auth/contacts';
      path: '/contacts';
      fullPath: '/contacts';
      preLoaderRoute: typeof AuthContactsRouteImport;
      parentRoute: typeof AuthRouteImport;
    };
    '/_auth/sessions': {
      id: '/_auth/sessions';
      path: '/sessions';
      fullPath: '/sessions';
      preLoaderRoute: typeof AuthSessionsRouteImport;
      parentRoute: typeof AuthRouteImport;
    };
    '/_auth/settings': {
      id: '/_auth/settings';
      path: '/settings';
      fullPath: '/settings';
      preLoaderRoute: typeof AuthSettingsRouteImport;
      parentRoute: typeof AuthRouteImport;
    };
    '/_auth/rooms/': {
      id: '/_auth/rooms/';
      path: '/rooms/';
      fullPath: '/rooms/';
      preLoaderRoute: typeof AuthRoomsIndexRouteImport;
      parentRoute: typeof AuthRouteImport;
    };
    '/_auth/rooms/$roomId': {
      id: '/_auth/rooms/$roomId';
      path: '/rooms/$roomId';
      fullPath: '/rooms/$roomId';
      preLoaderRoute: typeof AuthRoomsRoomIdRouteImport;
      parentRoute: typeof AuthRouteImport;
    };
    '/_auth/dm/$userId': {
      id: '/_auth/dm/$userId';
      path: '/dm/$userId';
      fullPath: '/dm/$userId';
      preLoaderRoute: typeof AuthDmUserIdRouteImport;
      parentRoute: typeof AuthRouteImport;
    };
    // --- Admin layout + children (EPIC-10) ---
    '/_admin': {
      id: '/_admin';
      path: '';
      fullPath: '';
      preLoaderRoute: typeof AdminRouteImport;
      parentRoute: typeof rootRouteImport;
    };
    '/_admin/reports': {
      id: '/_admin/reports';
      path: '/reports';
      fullPath: '/reports';
      preLoaderRoute: typeof AdminReportsRouteImport;
      parentRoute: typeof AdminRouteImport;
    };
    '/_admin/audit-log': {
      id: '/_admin/audit-log';
      path: '/audit-log';
      fullPath: '/audit-log';
      preLoaderRoute: typeof AdminAuditLogRouteImport;
      parentRoute: typeof AdminRouteImport;
    };
  }
}
