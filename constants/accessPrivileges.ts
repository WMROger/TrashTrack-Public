export const TAB_PRIVILEGE_REQUIREMENTS: Record<string, string> = {
  'collection-scheduler': 'manage_schedules',
  scheduler: 'manage_schedules',
  'route-optimization': 'dispatch_fleet',
  routes: 'dispatch_fleet',
  'truck-inventory': 'dispatch_fleet',
  inventory: 'dispatch_fleet',
  'diesel-estimate': 'dispatch_fleet',
  diesel: 'dispatch_fleet',
  'trip-log': 'dispatch_fleet',
  'operational-overrides': 'dispatch_fleet',
  overrides: 'dispatch_fleet',
  'fleet-monitoring': 'view_telemetry',
  fleet: 'view_telemetry',
  analytics: 'export_reports',
  'driver-accounts': 'manage_users',
  'driver-onboarding': 'manage_users',
  coordinators: 'manage_users',
  drivers: 'manage_users',
  announcements: 'broadcast_alerts',
  'cicto-commands': 'broadcast_alerts',
  'trash-reports': 'acknowledge_incidents',
  reports: 'acknowledge_incidents',
  'service-feedback': 'acknowledge_incidents',
  feedback: 'acknowledge_incidents',
  rewards: 'dispatch_fleet',
  'eco-rewards': 'dispatch_fleet',
  logs: 'purge_records',
};

export function canAccessOperationalTab(tabId: string, privileges: string[] | null | undefined): boolean {
  if (!privileges) return true;
  if (privileges.includes('mayor_interagency_only')) return tabId === 'cicto-commands';
  const requiredPrivilege = TAB_PRIVILEGE_REQUIREMENTS[tabId];
  if (!requiredPrivilege) return true;
  return (
    privileges.includes(requiredPrivilege) ||
    privileges.includes(`${requiredPrivilege}:read`) ||
    privileges.includes(`${requiredPrivilege}:write`)
  );
}

export function canWriteOperationalTab(tabId: string, privileges: string[] | null | undefined): boolean {
  if (!privileges) return true;
  if (privileges.includes('mayor_interagency_only')) return tabId === 'cicto-commands';
  const requiredPrivilege = TAB_PRIVILEGE_REQUIREMENTS[tabId];
  if (!requiredPrivilege) return true;
  if (privileges.includes(`${requiredPrivilege}:write`)) return true;
  if (privileges.includes(`${requiredPrivilege}:read`)) return false;
  return privileges.includes(requiredPrivilege);
}
