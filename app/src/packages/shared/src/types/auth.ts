export interface AdminJwtPayload {
  adminId: number;
  email: string;
  iat?: number;
  exp?: number;
}

export interface UserJwtPayload {
  userId: number;
  email: string;
  role: string;
  scopes: string[];
  iat?: number;
  exp?: number;
}

export interface Session {
  adminId?: number;
  userId?: number;
  email: string;
  name: string;
  type: 'admin' | 'user';
  scopes: string[];
}

export interface LoginResponse {
  accessToken: string;
  refreshToken: string;
}

export interface AdminLoginResponse extends LoginResponse {
  admin: { id: number; email: string; name: string };
}

export interface UserLoginResponse extends LoginResponse {
  user: { id: number; email: string; name: string; role: string; scopes: string[] };
}
