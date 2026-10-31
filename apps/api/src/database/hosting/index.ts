export { tenantDatabaseManager, TenantDatabaseManager } from './manager';
export { HostingError, classifyMongoError, redactSecrets } from './errors';
export { TENANT_DB_FIELDS, type TenantDbSource } from './source';
export { LATEST_SCHEMA_VERSION, migrateTenantDatabase, MIGRATIONS } from './migrations';
export { verifyCustomerDatabase, openCustomerConnection } from './verify';
export type { DatabaseHostingMode, DatabaseStatus, DatabaseHealth } from './types';
