// Configuration for the battery's auth/Roles: which names imply others, and what the first
// person to sign up is granted. No factory here, so the battery's module is still the
// implementation. `admin` covers everything, so a module declaring `needs: 'admin'` and one
// declaring `needs: 'reports'` are both the administrator's.

export const config = { implies: { admin: ['*'] }, first: ['admin'] };
