import { Router } from 'express';
import { authController, rateLimit } from '../../composition.js';
import { authenticate } from './auth.middleware.js';

/** Auth endpoints, mounted at /api/v1/auth. Routing only. */
export const authRouter = Router();

// By IP — there is no authenticated user yet at register/login. Register
// is tighter (account creation is the more sensitive, costlier action);
// login is a little looser since legitimate users sometimes mistype.
// Generous enough that a shared office/NAT IP signing up several
// legitimate users in an hour is never blocked, while still bounding mass
// automated signup/credential-stuffing (both orders of magnitude tighter
// than any real bot's request rate).
const registerLimit = rateLimit({
  windowSeconds: 60 * 60,
  max: 20,
  keyPrefix: 'auth-register',
  keyFn: (req) => req.ip ?? 'unknown',
});
const loginLimit = rateLimit({
  windowSeconds: 15 * 60,
  max: 30,
  keyPrefix: 'auth-login',
  keyFn: (req) => req.ip ?? 'unknown',
});

authRouter.post('/register', registerLimit, authController.register);
authRouter.post('/login', loginLimit, authController.login);
authRouter.post('/refresh', authController.refresh);
authRouter.post('/logout', authController.logout);
authRouter.get('/me', authenticate, authController.me);
authRouter.patch('/me', authenticate, authController.updateProfile);
authRouter.patch('/password', authenticate, authController.changePassword);
authRouter.post('/logout-all', authenticate, authController.logoutAll);
authRouter.delete('/me', authenticate, authController.deleteAccount);
