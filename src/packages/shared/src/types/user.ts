export type UserRole = 'ADMIN' | 'USER';
export type AccessStatus = 'ACTIVE' | 'INACTIVE';

export interface User {
  id: number;
  email: string;
  name: string;
  role: UserRole;
  accessStatus: AccessStatus;
  createdAt: Date;
  updatedAt: Date;
}

export interface Admin {
  id: number;
  email: string;
  name: string;
  accessStatus: AccessStatus;
  twoFactorEnabled: boolean;
  createdAt: Date;
  updatedAt: Date;
}
