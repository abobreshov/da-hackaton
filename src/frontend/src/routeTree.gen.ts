import { Route as rootRoute } from './routes/__root';
import { Route as authRoute } from './routes/_auth';
import { Route as authDashboardRoute } from './routes/_auth/dashboard';
import { Route as loginRoute } from './routes/login';

const authRouteWithChildren = authRoute.addChildren([authDashboardRoute]);
export const routeTree = rootRoute.addChildren([authRouteWithChildren, loginRoute]);
