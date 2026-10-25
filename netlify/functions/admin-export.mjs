import { getDatabase } from '@netlify/database';
import { createExportHandler } from './admin-export-core.mjs';
export default createExportHandler(getDatabase);
export const config={path:'/api/admin/export'};
