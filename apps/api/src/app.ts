import cors from 'cors';
import express, { type Express } from 'express';
import helmet from 'helmet';
import pinoHttp from 'pino-http';
import type { Logger } from 'pino';
import type { Env } from './config/env';
import { createErrorHandler, notFoundHandler } from './middleware/errorHandler';
import { requestId } from './middleware/requestId';
import cookieParser from 'cookie-parser';
import { rejectOperatorInjection } from './middleware/sanitize';
import { registerLocalStorageRoutes } from './modules/documents/localStorageRoutes';
import { createV1Router } from './routes';
import { systemClock, type Clock } from './utils/clock';

export function createApp(env: Env, logger: Logger, deps: { clock?: Clock } = {}): Express {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', env.NODE_ENV === 'production' ? 1 : false);

  app.use(requestId);
  app.use(pinoHttp({ logger, genReqId: (req) => (req as express.Request).id }));
  app.use(helmet());
  app.use(
    cors({
      origin(origin, callback) {
        // Non-browser clients (mobile app, curl) send no Origin header.
        if (!origin || env.CORS_ORIGINS.includes(origin)) return callback(null, true);
        return callback(null, false);
      },
      credentials: true,
    }),
  );
  registerLocalStorageRoutes(app, env); // raw-body uploads; must come before the JSON parser
  app.use(express.json({ limit: '100kb' }));
  app.use(cookieParser());
  app.use(rejectOperatorInjection);

  app.use('/api/v1', createV1Router(env, { clock: deps.clock ?? systemClock }));

  app.use(notFoundHandler);
  app.use(createErrorHandler(logger));
  return app;
}
