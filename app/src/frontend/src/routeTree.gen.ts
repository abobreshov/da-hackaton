/* eslint-disable */
// Hand-written route tree. Keep in sync with routes/* files.

import { Route as rootRouteImport } from './routes/__root';
import { Route as LoginRouteImport } from './routes/login';
import { Route as RegisterRouteImport } from './routes/register';
import { Route as ResetPasswordRouteImport } from './routes/reset-password';
import { Route as Verify2FARouteImport } from './routes/verify-2fa';
import { Route as AuthRouteImport } from './routes/_auth';
import { Route as AuthDashboardRouteImport } from './routes/_auth/dashboard';
import { Route as AuthRoomsIndexRouteImport } from './routes/_auth/rooms/index';

const LoginRoute = LoginRouteImport.update({
  id: '/login',
  path: '/login',
  getParentRoute: () => rootRouteImport,
} as any);

const RegisterRoute = RegisterRouteImport.update({
  id: '/register',
  path: '/register',
  getParentRoute: () => rootRouteImport,
} as any);

const ResetPasswordRoute = ResetPasswordRouteImport.update({
  id: '/reset-password',
  path: '/reset-password',
  getParentRoute: () => rootRouteImport,
} as any);

const Verify2FARoute = Verify2FARouteImport.update({
  id: '/verify-2fa',
  path: '/verify-2fa',
  getParentRoute: () => rootRouteImport,
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

const AuthRoomsIndexRoute = AuthRoomsIndexRouteImport.update({
  id: '/rooms/',
  path: '/rooms/',
  getParentRoute: () => AuthRoute,
} as any);

const AuthRouteChildren = {
  AuthDashboardRoute,
  AuthRoomsIndexRoute,
};
const AuthRouteWithChildren = (AuthRoute as any)._addFileChildren(AuthRouteChildren);

const rootRouteChildren = {
  AuthRoute: AuthRouteWithChildren,
  LoginRoute,
  RegisterRoute,
  ResetPasswordRoute,
  Verify2FARoute,
};

export const routeTree = (rootRouteImport as any)
  ._addFileChildren(rootRouteChildren)
  ._addFileTypes({} as any);

declare module '@tanstack/react-router' {
  interface FileRoutesByPath {
    '/login': {
      id: '/login';
      path: '/login';
      fullPath: '/login';
      preLoaderRoute: typeof LoginRouteImport;
      parentRoute: typeof rootRouteImport;
    };
    '/register': {
      id: '/register';
      path: '/register';
      fullPath: '/register';
      preLoaderRoute: typeof RegisterRouteImport;
      parentRoute: typeof rootRouteImport;
    };
    '/reset-password': {
      id: '/reset-password';
      path: '/reset-password';
      fullPath: '/reset-password';
      preLoaderRoute: typeof ResetPasswordRouteImport;
      parentRoute: typeof rootRouteImport;
    };
    '/verify-2fa': {
      id: '/verify-2fa';
      path: '/verify-2fa';
      fullPath: '/verify-2fa';
      preLoaderRoute: typeof Verify2FARouteImport;
      parentRoute: typeof rootRouteImport;
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
    '/_auth/rooms/': {
      id: '/_auth/rooms/';
      path: '/rooms/';
      fullPath: '/rooms/';
      preLoaderRoute: typeof AuthRoomsIndexRouteImport;
      parentRoute: typeof AuthRouteImport;
    };
  }
}
