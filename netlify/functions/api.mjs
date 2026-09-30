// Netlify Function: runs the Shop Khata API (server/api.js) on /api/*.
// Set MONGO_URI, MONGO_DB_NAME, SHOP_KEY and CLOUDINARY_URL in Netlify → Site configuration → Environment variables.
import { handleApi } from '../../server/api.js';

export default handleApi;
export const config = { path: '/api/*' };
