import { Router }     from 'express';
import protect        from '../middlewares/auth.middleware.js';
import requireRole    from '../middlewares/rbac.middleware.js';
import {
  ingestRequest,
  listRequests,
  getRequestDetail,
  updateRequestStatus,
  addNote,
} from '../controllers/customerRequest.controller.js';

const router = Router();

// ── Public ────────────────────────────────────────────────────────────────────
router.post('/', ingestRequest);

// ── Protected (all authenticated users) ──────────────────────────────────────
router.get('/',   protect, requireRole('admin', 'agent'), listRequests);
router.get('/:id', protect, requireRole('admin', 'agent'), getRequestDetail);

// ── Admin only ────────────────────────────────────────────────────────────────
router.patch('/:id/status', protect, requireRole('admin'), updateRequestStatus);

// ── Admin + Agent ─────────────────────────────────────────────────────────────
router.post('/:id/notes', protect, requireRole('admin', 'agent'), addNote);

export default router;
