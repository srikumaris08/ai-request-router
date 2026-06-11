/**
 * @file index.js  (src/routes)
 * @description Root router — mounts all sub-routers under /api/v1.
 */
import { Router }            from 'express';
import authRoutes            from './auth.routes.js';
import customerRequestRoutes from './customerRequest.routes.js';

const router = Router();

router.use('/auth',     authRoutes);
router.use('/requests', customerRequestRoutes);

export default router;
