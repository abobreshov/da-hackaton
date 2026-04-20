/* eslint-disable */
// @ts-nocheck

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
const AuthRouteWithChildren = AuthRoute._addFileChildren(AuthRouteChildren);

const rootRouteChildren = {
  AuthRoute: AuthRouteWithChildren,
  LoginRoute,
};

export const routeTree = rootRouteImport
  ._addFileChildren(rootRouteChildren)
  ._addFileTypes({} as any);
