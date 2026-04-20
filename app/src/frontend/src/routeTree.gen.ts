/* eslint-disable */
// Hand-written route tree. Keep in sync with routes/* files.

import { Route as rootRouteImport } from './routes/__root';
import { Route as LoginRouteImport } from './routes/login';
import { Route as AuthRouteImport } from './routes/_auth';
import { Route as AuthDashboardRouteImport } from './routes/_auth/dashboard';

const LoginRoute = LoginRouteImport.update({
  id: '/login',
  path: '/login',
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

const AuthRouteChildren = {
  AuthDashboardRoute,
};
const AuthRouteWithChildren = (AuthRoute as any)._addFileChildren(AuthRouteChildren);

const rootRouteChildren = {
  AuthRoute: AuthRouteWithChildren,
  LoginRoute,
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
  }
}
