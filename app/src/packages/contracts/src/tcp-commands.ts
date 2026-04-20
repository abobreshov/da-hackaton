export const TcpCmd = {
  auth: {
    customer: {
      login: 'auth.customer.login',
      refresh: 'auth.customer.refresh',
      logout: 'auth.customer.logout',
      register: 'auth.customer.register',
      validateToken: 'auth.customer.validateToken',
      passwordResetRequest: 'auth.customer.passwordReset.request',
      passwordResetConfirm: 'auth.customer.passwordReset.confirm',
      passwordChange: 'auth.customer.passwordChange',
      delete: 'auth.customer.delete',
    },
    admin: {
      login: 'auth.admin.login',
      refresh: 'auth.admin.refresh',
      logout: 'auth.admin.logout',
    },
  },
  users: {
    list: 'users.list',
    findById: 'users.findById',
    ban: 'users.ban',
    unban: 'users.unban',
  },
  messages: {
    create: 'messages.create',
    edit: 'messages.edit',
    delete: 'messages.delete',
    list: 'messages.list',
    since: 'messages.since',
  },
  rooms: {
    create: 'rooms.create',
    join: 'rooms.join',
    leave: 'rooms.leave',
    invite: 'rooms.invite',
    listMy: 'rooms.listMy',
    catalog: 'rooms.catalog',
  },
  friends: {
    request: 'friends.request',
    accept: 'friends.accept',
    reject: 'friends.reject',
    remove: 'friends.remove',
  },
  presence: {
    touch: 'presence.touch',
  },
  reports: {
    create: 'reports.create',
    resolve: 'reports.resolve',
    dismiss: 'reports.dismiss',
  },
  audit: {
    page: 'audit.page',
  },
} as const;
