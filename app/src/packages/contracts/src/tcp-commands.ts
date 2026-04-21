export const TcpCmd = {
  auth: {
    customer: {
      login: 'auth.customer.login',
      refresh: 'auth.customer.refresh',
      logout: 'auth.customer.logout',
      register: 'auth.customer.register',
      verifyEmail: 'auth.customer.verifyEmail',
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
    findByUsername: 'users.findByUsername',
    ban: 'users.ban',
    unban: 'users.unban',
    listBans: 'users.listBans',
  },
  messages: {
    create: 'messages.create',
    edit: 'messages.edit',
    delete: 'messages.delete',
    list: 'messages.list',
    since: 'messages.since',
    getById: 'messages.getById',
    /** Resolve (or lazily create) the dm_channels row for a user pair. */
    resolveDm: 'messages.resolveDm',
  },
  rooms: {
    create: 'rooms.create',
    join: 'rooms.join',
    leave: 'rooms.leave',
    invite: 'rooms.invite',
    listMy: 'rooms.listMy',
    catalog: 'rooms.catalog',
    membersOf: 'rooms.membersOf',
    ensureMember: 'rooms.ensureMember',
    delete: 'rooms.delete',
    update: 'rooms.update',
    members: {
      promote: 'rooms.members.promote',
      demote: 'rooms.members.demote',
      ban: 'rooms.members.ban',
    },
    bans: {
      unban: 'rooms.bans.unban',
      list: 'rooms.bans.list',
    },
  },
  friends: {
    request: 'friends.request',
    accept: 'friends.accept',
    reject: 'friends.reject',
    remove: 'friends.remove',
    list: 'friends.list',
    listPending: 'friends.listPending',
  },
  presence: {
    touch: 'presence.touch',
    stateOf: 'presence.stateOf',
    disconnect: 'presence.disconnect',
  },
  reports: {
    create: 'reports.create',
    resolve: 'reports.resolve',
    dismiss: 'reports.dismiss',
    list: 'reports.list',
  },
  audit: {
    page: 'audit.page',
  },
  attachments: {
    upload: 'attachments.upload',
    download: 'attachments.download',
    listByMessage: 'attachments.listByMessage',
    findById: 'attachments.findById',
  },
  unread: {
    markRead: 'unread.markRead',
    getForUser: 'unread.getForUser',
    countSince: 'unread.countSince',
  },
  sessions: {
    /** Persist a `user_sessions` row when a login successfully mints tokens. */
    recordLogin: 'sessions.recordLogin',
    /** List active (non-revoked) sessions for a user. */
    listForUser: 'sessions.listForUser',
    /** Revoke a single session by id, scoped to the owning user. */
    revoke: 'sessions.revoke',
  },
} as const;
